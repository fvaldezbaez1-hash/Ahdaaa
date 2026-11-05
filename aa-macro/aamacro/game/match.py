"""One match from start to results: camera, learning, placing, upgrading,
cards, and reading the outcome."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass

import cv2

from ..geometry import Rect
from ..maps import STRATEGIES, PathLearner, UnitSpec, choose_spots
from ..maps.align import ALIGN_WIDTH, Aligner
from ..maps.path import play_mask
from ..maps.scan import PlacementScanner
from ..movement import normalize_camera, play_route
from ..movement.routes import Route
from ..vision.screen import State
from .steps import StepError
from .units import BuildExecutor, fallback_spots, plan_auto, plan_custom


@dataclass
class MatchResult:
    victory: bool | None
    wave: int
    strategy: str | None
    seconds: float
    disconnected: bool = False
    aborted: bool = False
    snap: object = None


def team_signature(team: list[dict]) -> str:
    return json.dumps([[u.get("role"), int(u.get("max_place", 0)), float(u.get("range", 0))] for u in team])


class MatchSession:
    def __init__(self, bot, task: dict) -> None:
        self.bot = bot
        self.task = task
        self.s = bot.settings
        self.b = bot.backend
        self.reader = bot.reader
        self.control = bot.control
        self.log = bot.log
        self.profile = bot.store.get(task["map"]) if task.get("map") else None
        self.strategy: str | None = None
        self.executor: BuildExecutor | None = None
        self.learner: PathLearner | None = None
        self.alignment = None
        self.max_wave = 0
        self.yen: int | None = None
        self.yen_region = None
        self.lobby_seen = 0
        self.left_early = False
        self.scanner = PlacementScanner(self.b, self.control, self.s)

    # --- helpers -----------------------------------------------------
    def _status(self, **kw) -> None:
        self.bot.emit(**kw)

    def _read_yen_now(self) -> int | None:
        region = self.yen_region or self.s.get("hud.yen_region")
        snap = self.reader.snap(read_text=region is None)
        return self.reader.read_yen(snap, region)

    def _learn_yen_region(self, snap) -> None:
        if self.yen_region or self.s.get("hud.yen_region"):
            return
        from ..vision.screen import YEN_RE

        for b in snap.boxes:
            if YEN_RE.search(b.text):
                r = b.rect.expand(int(b.rect.h * 0.8))
                r = Rect(r.x - r.w // 2, r.y, r.w * 2, r.h).clamp(snap.width, snap.height)
                self.yen_region = r.to_norm(snap.width, snap.height)
                return

    def _click_vote(self, snap) -> bool:
        hit = snap.find(self.s.words("vote"), 85)
        if hit:
            self.b.click(*hit.box.center)
            self.control.sleep(0.6)
            self.log("Voted to start")
            return True
        return False

    # --- setup -------------------------------------------------------
    def _units(self) -> list[UnitSpec]:
        team = self.s.get("team")
        out = []
        default = float(self.s.get("learning.default_range", 0.12))
        for i, u in enumerate(team):
            role = str(u.get("role", "dps")).lower()
            if role == "skip" or int(u.get("max_place", 0)) <= 0:
                continue
            r = float(u.get("range") or 0) or (self.profile.unit_ranges.get(str(i)) if self.profile else None) or default
            out.append(UnitSpec(i, role, int(u.get("max_place", 1)), float(r), int(u.get("priority", i + 1))))
        return out

    def _setup(self, frame) -> None:
        p = self.profile
        aligner = None
        if p is not None and p.reference is not None:
            aligner = Aligner(p.reference, self.s.get("hud.play_area"))
        if self.s.get("camera.normalize", True):
            self.alignment = normalize_camera(self.b, self.control, self.s, aligner, self.log)
        elif aligner:
            self.alignment = aligner.estimate(frame)
        frame = self.b.capture()
        if p is None:
            return
        if p.reference is None:
            p.reference = cv2.resize(frame, (ALIGN_WIDTH, int(round(frame.shape[0] * ALIGN_WIDTH / frame.shape[1]))))
            self.log(f'New map "{p.name}": saved a reference picture, starting to learn it')
        learning = bool(self.s.get("learning.enabled", True))
        team_sig = team_signature(self.s.get("team"))
        if p.team_sig and p.team_sig != team_sig:
            self.log("Team changed since last time: rebuilding this map's layouts")
            p.layouts = {}
        p.team_sig = team_sig
        if learning and p.valid is None:
            self._scan(frame)
        if p.path is None:
            if learning:
                self.learner = PathLearner(frame.shape[:2], self.s.get("hud.play_area"))
                self.learn_started = time.monotonic()
                self.log("Watching where enemies walk…")
                self._status(learning="watching enemy path")
            else:
                self._use_fallback(frame)
        else:
            self._start_build()  # rebuilds layouts if the team changed

    def _scan(self, frame) -> None:
        team = self.s.get("team")
        units = [i for i, u in enumerate(team) if str(u.get("role")).lower() != "skip"]
        if not units:
            return
        h, w = frame.shape[:2]
        area = Rect.from_norm(self.s.get("hud.play_area") or [0, 0, 1, 1], w, h)
        self._status(learning="scanning placeable ground")
        res = self.scanner.scan(units[0], area, int(self.s.get("learning.scan_cols", 22)),
                                int(self.s.get("learning.scan_rows", 12)), self.log)
        if (res.grid >= 0).sum() < 0.1 * res.grid.size:
            self.log("Couldn't see the placement preview; will guess placeable ground from the path")
            return
        from ..maps.path import analysis_size

        aw, ah = analysis_size(w, h)
        self.profile.valid = res.to_mask((ah, aw))
        ring = res.ring_norm()
        if ring:
            self.profile.unit_ranges[str(units[0])] = round(ring, 4)
        # measure the other units' range rings at a placeable point
        import numpy as np

        ys, xs = np.nonzero(res.grid == 1)
        if len(xs):
            k = len(xs) // 2
            from ..maps.scan import grid_points

            pts = {(r, c): (x, y) for r, c, x, y in grid_points(area, res.grid.shape[1], res.grid.shape[0])}
            px, py = pts[(int(ys[k]), int(xs[k]))]
            for i in units[1:]:
                if float(team[i].get("range") or 0) > 0:
                    continue
                r = self.scanner.measure_ring(i, px, py)
                if r:
                    self.profile.unit_ranges[str(i)] = round(r, 4)
        self.profile.save()

    def _build_layouts(self) -> None:
        p = self.profile
        units = self._units()
        play = play_mask(p.path.shape, self.s.get("hud.play_area"))
        valid = None
        if p.valid is not None:
            valid = cv2.resize(p.valid.astype("uint8"), (p.path.shape[1], p.path.shape[0]),
                               interpolation=cv2.INTER_NEAREST)
            # The scan is coarse: keep a little away from the edges of the
            # placeable area, where the true border is uncertain.
            cell = p.path.shape[1] / max(1, int(self.s.get("learning.scan_cols", 22)))
            k = max(1, int(cell * 0.3))
            eroded = cv2.erode(valid, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1, 2 * k + 1)))
            valid = (eroded if eroded.sum() > 0.3 * valid.sum() else valid).astype(bool)
        for strat in self.s.get("learning.strategies") or list(STRATEGIES):
            spots = choose_spots(p.path, units, strat, valid, float(self.s.get("learning.min_spacing", 0.035)),
                                 p.bad_spots, play)
            if spots:
                p.set_layout(strat, spots)
        p.save()

    def _finish_learning(self) -> None:
        model = self.learner.result() if self.learner else None
        self.learner = None
        if model is None or model.coverage() < 0.002:
            self.log("Couldn't see enemies moving yet; placing units with a simple fallback layout this run")
            self._use_fallback(self.b.capture())
            return
        self.profile.path = model
        self._build_layouts()
        self.log(f'Learned the enemy path on "{self.profile.name}" and built {len(self.profile.layouts)} layouts')
        self._status(learning="learned")
        self._start_build()

    def _use_fallback(self, frame) -> None:
        h, w = frame.shape[:2]
        spots = fallback_spots(self.s.get("team"), self.profile.valid if self.profile else None,
                               self.s.get("hud.play_area"), (w, h), float(self.s.get("learning.min_spacing", 0.035)))
        self.strategy = None
        self._make_executor(spots, aligned=False)

    def _start_build(self) -> None:
        p = self.profile
        if not p.learned:
            self._build_layouts()
        self.strategy = p.choose_strategy(float(self.s.get("learning.explore", 1.2)))
        spots = p.spots(self.strategy) if self.strategy else []
        if not spots:
            self._use_fallback(self.b.capture())
            return
        e = p.layouts[self.strategy]
        self.log(f'Layout "{self.strategy}" (tried {e.get("runs", 0)}x, '
                 f'avg score {e.get("reward", 0) / max(1, e.get("runs", 0)):.2f})')
        self._status(strategy=self.strategy)
        self._make_executor(spots, aligned=True)

    def _make_executor(self, spots, aligned: bool) -> None:
        w, h = self.b.size()
        px = []
        for s in spots:
            x, y = s.x, s.y
            if aligned and self.alignment is not None and getattr(self.alignment, "ok", False):
                x, y = self.alignment.map_point(x, y)
            px.append((s.slot, x * w, y * h))
        team = self.s.get("team")
        try:
            if self.s.get("build.order") == "custom" and self.s.get("build.custom"):
                plan = plan_custom(self.s.get("build.custom"), team, spots)
            else:
                plan = plan_auto(team, spots, bool(self.s.get("build.farm_first", True)))
        except ValueError as exc:
            self.log(f"{exc}; using the automatic build order")
            plan = plan_auto(team, spots, bool(self.s.get("build.farm_first", True)))
        self.executor = BuildExecutor(self.b, self.reader, self.control, self.s, plan, px, self.profile,
                                      self.log, self._read_yen_now, self.scanner)
        if self.learner is not None:
            for s in spots:
                self.learner.ignore_circle(s.x, s.y, 0.03)

    # --- cards -------------------------------------------------------
    def pick_card(self, snap) -> bool:
        best, ranked = self.bot.picker.decide(snap)
        if not best:
            return False
        for r in ranked:
            self.log("  card: " + r.describe())
        self.log(f"Picked card: {best.card.title or '?'}")
        self.b.click(*best.card.center)
        self.control.sleep(0.6)
        after = self.reader.snap()
        if self.bot.picker.count(after) >= 2:
            hit = after.find(self.s.words("confirm"), 85)
            if hit:
                self.b.click(*hit.box.center)
                self.control.sleep(0.6)
        self.bot.emit(last_card=best.card.title)
        return True

    # --- main loop ---------------------------------------------------
    def run(self, first_snap) -> MatchResult:
        start = time.monotonic()
        last_vote = start
        if self.reader.classify(first_snap) == State.VOTE:
            self._click_vote(first_snap)
        route = self.task.get("match_route")
        if route:
            r = Route.load(route)
            if r:
                play_route(r, self.b, self.control, self.s, self.reader, self.log)
        self._setup(self.b.capture())
        poll = float(self.s.get("timing.state_poll", 1.0))
        interval = float(self.s.get("timing.action_interval", 1.0))
        timeout = float(self.s.get("timing.match_timeout", 3600))
        learn_secs = float(self.s.get("learning.path_learn_seconds", 25))
        next_check = 0.0
        next_action = time.monotonic() + 0.5
        next_feed = 0.0
        while True:
            self.control.check()
            self.bot.failsafe()
            now = time.monotonic()
            if self.learner is not None and now >= next_feed:
                self.learner.feed(self.b.capture(), now)
                next_feed = now + 0.18
                elapsed = now - self.learn_started
                if (self.learner.ready() and elapsed >= learn_secs) or elapsed >= learn_secs * 3:
                    self._finish_learning()
            if now >= next_check:
                snap = self.reader.snap()
                state = self.reader.classify(snap)
                if state in (State.VICTORY, State.DEFEAT):
                    return MatchResult(state == State.VICTORY, self.max_wave, self.strategy, now - start, snap=snap)
                if state == State.DISCONNECTED:
                    return MatchResult(None, self.max_wave, self.strategy, now - start, disconnected=True, snap=snap)
                if state == State.CARDS:
                    self.pick_card(snap)
                    next_check = time.monotonic() + 0.4
                    continue
                if state == State.VOTE:
                    self._click_vote(snap)
                if state == State.LOBBY:
                    self.lobby_seen += 1
                    if self.lobby_seen >= 3:
                        self.log("Ended up back in the lobby")
                        return MatchResult(None, self.max_wave, self.strategy, now - start, aborted=True, snap=snap)
                else:
                    self.lobby_seen = 0
                wave = self.reader.read_wave(snap)
                # Some lobbies show a plain "Start" button instead of a vote:
                # press it while the waves haven't begun.
                if not wave and now - start < 60 and now - last_vote > 3 and self._click_vote(snap):
                    last_vote = now
                if wave is not None and wave < 1000:
                    if wave > self.max_wave and self.learner is not None:
                        self.learner.begin_wave(now)
                    self.max_wave = max(self.max_wave, wave)
                self._learn_yen_region(snap)
                yen = self.reader.read_yen(snap, self.yen_region)
                if yen is not None:
                    self.yen = yen
                self._status(wave=self.max_wave, yen=self.yen)
                max_waves = int(self.task.get("max_waves") or 0)
                if max_waves and self.max_wave >= max_waves and not self.left_early:
                    self.left_early = True
                    self._leave_early()
                next_check = time.monotonic() + poll
            if self.executor is not None and not self.executor.finished and now >= next_action:
                self.executor.last_yen = None
                self.executor.tick(self.yen)
                if self.executor.last_yen is not None:
                    self.yen = self.executor.last_yen
                next_action = time.monotonic() + interval
            if now - start > timeout:
                self.log("Match took too long; treating it as stuck")
                return MatchResult(None, self.max_wave, self.strategy, now - start, aborted=True)
            self.control.sleep(0.05 if self.learner is not None else 0.12)

    def _leave_early(self) -> None:
        script = self.task.get("leave_steps") or ""
        if not script.strip():
            self.log(f"Reached wave {self.max_wave}; no leave steps set, so playing on")
            return
        self.log(f"Reached wave {self.max_wave}: leaving as set in the task")
        try:
            self.bot.steps.run(script)
        except StepError as exc:
            self.log(f"Leave steps failed: {exc}")

    def finish(self, result: MatchResult) -> None:
        p = self.profile
        if p is None:
            return
        reward = p.record(result.strategy, bool(result.victory), result.wave, self.task.get("mode", ""))
        losses_limit = int(self.s.get("learning.relearn_after_losses", 4))
        tried_all = all(v.get("runs", 0) > 0 for v in p.layouts.values()) if p.layouts else False
        if losses_limit and p.recent_losses() >= losses_limit and tried_all and not result.victory:
            self.log(f'Lost {p.recent_losses()} in a row on "{p.name}": relearning the map next run')
            p.forget()
        p.save()
        self.log(f"Run scored {reward:.2f} for layout {result.strategy or '-'}")
