"""The main loop: works out which screen the game is on and does the right
thing, forever (or until the task's repeat count is reached)."""

from __future__ import annotations

import logging
import time
import webbrowser

from ..cards import CardPicker
from ..control import Control, StopRequested
from ..maps import ProfileStore
from ..platform.base import BackendError
from ..vision.screen import ScreenReader, State
from ..vision.templates import TemplateStore
from .match import MatchResult, MatchSession
from .stats import Stats, post_webhook
from .steps import StepError, StepRunner

logger = logging.getLogger("aamacro")

POPUP_WORDS = ["ok", "okay", "claim", "close", "tap to continue", "collect", "got it"]


class Bot:
    def __init__(self, settings, backend, ocr, control: Control | None = None, log=None, status=None,
                 store: ProfileStore | None = None, templates: TemplateStore | None = None,
                 stats: Stats | None = None) -> None:
        self.settings = settings
        self.backend = backend
        self.control = control or Control()
        self._log_cb = log
        self._status_cb = status
        self.store = store or ProfileStore()
        self.templates = templates
        self.stats = stats or Stats()
        self.reader = ScreenReader(backend, ocr, settings, templates)
        self.picker = CardPicker(settings)
        self.reader.card_detector = self.picker.count
        self.steps = StepRunner(backend, self.reader, self.control, settings, self.log)
        self.status: dict = {"state": "stopped"}
        self.current: MatchSession | None = None

    # --- reporting -----------------------------------------------------
    def log(self, msg: str) -> None:
        logger.info(msg)
        if self._log_cb:
            self._log_cb(msg)

    def emit(self, **kw) -> None:
        self.status.update(kw)
        if self._status_cb:
            self._status_cb(dict(self.status))

    def failsafe(self) -> None:
        if self.settings.get("safety.failsafe_corner", True) and self.backend.in_failsafe_corner():
            self.log("Mouse pushed into the top-left corner: emergency stop")
            self.control.stop()
            raise StopRequested()

    # --- entry point ---------------------------------------------------
    def run(self) -> None:
        self.emit(state="starting")
        try:
            self._setup_window()
            tasks = [t for t in self.settings.get("tasks") if t.get("enabled", True)]
            if not tasks:
                self.log("No tasks are switched on. Add one in the Tasks tab.")
                return
            while True:
                for task in tasks:
                    self._run_task_safely(task)
                if all(int(t.get("repeat", 0)) > 0 for t in tasks):
                    self.log("All tasks finished")
                    break
        except StopRequested:
            self.log("Stopped")
        except BackendError as exc:
            self.log(f"Error: {exc}")
        except Exception as exc:  # keep the app alive and explain
            logger.exception("bot crashed")
            self.log(f"Unexpected error: {exc!r} (details in the log file)")
        finally:
            self._release_keys()
            self.emit(state="stopped")

    def _release_keys(self) -> None:
        for k in ("w", "a", "s", "d", "space", "shift", "left", "right"):
            try:
                self.backend.key_up(k)
            except Exception:
                pass

    def _setup_window(self) -> None:
        title = self.settings.get("window.title", "Roblox")
        self.backend.ensure_window(title)
        self.backend.focus()
        if self.settings.get("window.auto_resize", True):
            want = (int(self.settings.get("window.client_width")), int(self.settings.get("window.client_height")))
            have = self.backend.size()
            if abs(have[0] - want[0]) > 4 or abs(have[1] - want[1]) > 4:
                ok = self.backend.resize_client(*want)
                self.log(f"Resized Roblox to {want[0]}x{want[1]}" if ok else
                         f"Couldn't resize Roblox (it's {have[0]}x{have[1]}); continuing at that size")
        w, h = self.backend.size()
        self.log(f"Found Roblox ({w}x{h})")

    def _run_task_safely(self, task: dict) -> None:
        lost = 0
        while True:
            try:
                self.run_task(task)
                return
            except BackendError as exc:
                lost += 1
                self.log(f"Lost the Roblox window ({exc}); waiting for it")
                if lost == 2 and self.settings.get("reconnect.private_server_link"):
                    self._rejoin()
                if lost > 12:
                    raise
                self.control.sleep(10)
                try:
                    self._setup_window()
                except BackendError:
                    pass

    # --- one task -------------------------------------------------------
    def run_task(self, task: dict) -> None:
        name = task.get("name", "task")
        repeat = int(task.get("repeat", 0))
        runs = 0
        unknown_since: float | None = None
        recover_tries = 0
        poll = float(self.settings.get("timing.state_poll", 1.0))
        self.log(f'Task "{name}": {"forever" if repeat == 0 else f"{repeat} run(s)"} on "{task.get("map") or "?"}"')
        while repeat == 0 or runs < repeat:
            self.control.check()
            self.failsafe()
            snap = self.reader.snap()
            state = self.reader.classify(snap)
            self.emit(state=state.value, task=name, map=task.get("map", ""))
            if state != State.UNKNOWN:
                unknown_since = None
                recover_tries = 0
            if state == State.DISCONNECTED:
                self.reconnect(snap)
            elif state == State.LOBBY:
                self.enter_match(task)
            elif state in (State.VOTE, State.MATCH, State.CARDS):
                result = self.play(task, snap)
                if not result.disconnected and not result.aborted:
                    runs += 1
            elif state in (State.VICTORY, State.DEFEAT):
                self.click_results(task, snap)
            else:
                now = time.monotonic()
                unknown_since = unknown_since or now
                if self._dismiss_popup(snap):
                    unknown_since = None
                elif now - unknown_since > float(self.settings.get("timing.unknown_timeout", 90)):
                    recover_tries += 1
                    self.recover(recover_tries)
                    unknown_since = None
            self.control.sleep(poll)

    def enter_match(self, task: dict) -> None:
        self.emit(state="lobby: running steps")
        try:
            self.steps.run(task.get("lobby_steps", ""))
        except StepError as exc:
            self.log(f"Lobby steps: {exc}")
            self.control.sleep(2)
            return
        end = time.monotonic() + float(self.settings.get("timing.vote_timeout", 60))
        while time.monotonic() < end:
            state = self.reader.classify(self.reader.snap())
            if state in (State.VOTE, State.MATCH, State.CARDS):
                return
            self.control.sleep(1.0)
        self.log("The match didn't start after the lobby steps; trying again")

    def play(self, task: dict, snap) -> MatchResult:
        session = MatchSession(self, task)
        self.current = session
        self.emit(state="match", wave=0, yen=None, strategy=None, learning="")
        try:
            result = session.run(snap)
        finally:
            self.current = None
        if result.disconnected:
            self.reconnect(result.snap or self.reader.snap())
            return result
        if result.aborted:
            return result
        session.finish(result)
        outcome = "Victory" if result.victory else "Defeat"
        self.log(f"{outcome} at wave {result.wave} ({result.seconds / 60:.1f} min)")
        entry = self.stats.record(task.get("name", ""), task.get("map", ""), task.get("mode", ""),
                                  result.victory, result.wave, result.strategy, result.seconds)
        summary = self.stats.summary()
        self.emit(stats=summary)
        url = self.settings.get("webhook.url", "")
        every = max(1, int(self.settings.get("webhook.every_n", 1)))
        if url and self.settings.get("webhook.on_result", True) and summary["runs"] % every == 0:
            post_webhook(url, entry, summary)
        self.click_results(task, result.snap)
        return result

    # --- results / popups ------------------------------------------------
    def click_results(self, task: dict, snap=None) -> str | None:
        after = task.get("after", "replay")
        order = {"replay": ["replay", "next", "lobby"], "next": ["next", "replay", "lobby"],
                 "lobby": ["lobby", "replay", "next"]}.get(after, ["replay", "next", "lobby"])
        for _ in range(10):
            self.control.check()
            snap = snap or self.reader.snap()
            for kind in order:
                hit = snap.find(self.settings.words(kind), 85)
                if hit:
                    self.backend.click(*hit.box.center)
                    self.log(f'Clicked "{hit.box.text}"')
                    self.control.sleep(2.0)
                    return kind
            self._dismiss_popup(snap)
            snap = None
            self.control.sleep(1.0)
        self.log("Couldn't find Replay/Next/Lobby on the results screen")
        return None

    def _dismiss_popup(self, snap) -> bool:
        hit = snap.find(POPUP_WORDS, 90)
        if hit:
            self.backend.click(*hit.box.center)
            self.control.sleep(0.8)
            return True
        return False

    # --- trouble ---------------------------------------------------------
    def reconnect(self, snap) -> None:
        self.emit(state="reconnecting")
        hit = snap.find(self.settings.words("reconnect_button"), 85)
        if hit:
            self.log(f'Disconnected: clicking "{hit.box.text}"')
            self.backend.click(*hit.box.center)
            self.control.sleep(20)
            if self.reader.classify(self.reader.snap()) != State.DISCONNECTED:
                self._setup_window()
                return
        self._rejoin()

    def _rejoin(self) -> None:
        link = self.settings.get("reconnect.private_server_link", "")
        if not link:
            self.log("Disconnected and no private server link is set (Settings tab); waiting")
            self.control.sleep(30)
            return
        self.log("Rejoining through the private server link")
        webbrowser.open(link)
        self.control.sleep(float(self.settings.get("reconnect.rejoin_wait", 45)))
        try:
            self._setup_window()
        except BackendError as exc:
            self.log(f"Rejoin: {exc}")

    def recover(self, attempt: int) -> None:
        self.log(f"Don't recognise this screen; recovering (try {attempt})")
        snap = self.reader.snap()
        for words in (POPUP_WORDS, ["back", "cancel", "x"], self.settings.words("lobby")):
            hit = snap.find(words, 90)
            if hit:
                self.backend.click(*hit.box.center)
                self.control.sleep(1.5)
                return
        if attempt >= 3:
            self._rejoin()
