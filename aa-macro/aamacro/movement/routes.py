"""Walking routes: record yourself walking once, the macro replays it.

A route is a list of timed key presses. Before replaying, the character can
be reset to the spawn point so every walk starts from the same place, and a
checkpoint word (e.g. "Story") confirms it arrived; if not, it resets and
tries again.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .. import paths
from ..platform.base import norm_key

MOVEMENT_KEYS = {"w", "a", "s", "d", "space", "shift", "left", "right", "up", "down",
                 "i", "o", "q", "e"}


@dataclass
class Route:
    name: str
    events: list[list] = field(default_factory=list)  # [seconds, "down"|"up", key]
    reset_first: bool = True
    checkpoint: str = ""          # text that should be visible on arrival
    retries: int = 2

    @property
    def duration(self) -> float:
        return self.events[-1][0] if self.events else 0.0

    def save(self, folder: Path | None = None) -> Path:
        folder = folder or paths.routes_dir()
        path = folder / f"{paths.safe_name(self.name)}.json"
        path.write_text(json.dumps(asdict(self), indent=1), encoding="utf-8")
        return path

    @staticmethod
    def load(name: str, folder: Path | None = None) -> "Route | None":
        folder = folder or paths.routes_dir()
        path = folder / f"{paths.safe_name(name)}.json"
        if not path.exists():
            return None
        d = json.loads(path.read_text(encoding="utf-8"))
        return Route(d.get("name", name), d.get("events", []), d.get("reset_first", True),
                     d.get("checkpoint", ""), int(d.get("retries", 2)))

    @staticmethod
    def names(folder: Path | None = None) -> list[str]:
        folder = folder or paths.routes_dir()
        return sorted(p.stem for p in folder.glob("*.json"))


def clean_events(events: list[list]) -> list[list]:
    """Sort, start at t=0, and make sure every key that goes down comes up."""
    if not events:
        return []
    events = sorted(events, key=lambda e: e[0])
    t0 = events[0][0]
    out, held = [], set()
    for t, kind, key in events:
        key = norm_key(key)
        if kind == "down":
            if key in held:
                continue  # key auto-repeat
            held.add(key)
        elif kind == "up":
            if key not in held:
                continue
            held.discard(key)
        out.append([round(t - t0, 3), kind, key])
    end = out[-1][0] if out else 0.0
    for key in sorted(held):
        out.append([end, "up", key])
    return out


class RouteRecorder:
    """Records movement keys with a global keyboard hook (pynput)."""

    def __init__(self, keys: set[str] | None = None) -> None:
        self.keys = keys or MOVEMENT_KEYS
        self.events: list[list] = []
        self._listener = None

    @staticmethod
    def _name(key) -> str | None:
        ch = getattr(key, "char", None)
        if ch:
            return norm_key(ch)
        name = getattr(key, "name", None)
        return norm_key(name) if name else None

    def start(self) -> None:
        from pynput import keyboard

        self.events = []

        def on_press(key):
            k = self._name(key)
            if k in self.keys:
                self.events.append([time.monotonic(), "down", k])

        def on_release(key):
            k = self._name(key)
            if k in self.keys:
                self.events.append([time.monotonic(), "up", k])

        self._listener = keyboard.Listener(on_press=on_press, on_release=on_release)
        self._listener.start()

    def stop(self, name: str, checkpoint: str = "", reset_first: bool = True) -> Route:
        if self._listener:
            self._listener.stop()
            self._listener = None
        return Route(name, clean_events(self.events), reset_first, checkpoint)


def reset_character(backend, control, settings) -> None:
    """Respawn (Esc -> R -> Enter by default) so walks start at spawn."""
    for key in settings.get("keys.reset_sequence", ["esc", "r", "enter"]):
        backend.press(key)
        control.sleep(0.35)
    control.sleep(4.0)


def play_route(route: Route, backend, control, settings, reader=None, log=None) -> bool:
    """Replay a route. Returns True if it arrived (or has no checkpoint)."""
    for attempt in range(route.retries + 1):
        if route.reset_first:
            reset_character(backend, control, settings)
        _play_events(route.events, backend, control)
        if not route.checkpoint or reader is None:
            return True
        end = time.monotonic() + 5.0
        while time.monotonic() < end:
            if reader.snap().find([route.checkpoint], 82):
                return True
            control.sleep(0.5)
        if log:
            log(f'Walk "{route.name}": did not see "{route.checkpoint}", retrying ({attempt + 1})')
    return False


def _play_events(events: list[list], backend, control) -> None:
    held: set[str] = set()
    start = time.monotonic()
    try:
        for t, kind, key in events:
            while True:
                if control.paused:
                    # let go of keys while paused, press them again after
                    paused_at = time.monotonic()
                    for k in held:
                        backend.key_up(k)
                    control.check()
                    for k in held:
                        backend.key_down(k)
                    start += time.monotonic() - paused_at
                left = start + t - time.monotonic()
                if left <= 0:
                    break
                control.sleep(min(left, 0.05))
            if kind == "down":
                backend.key_down(key)
                held.add(key)
            else:
                backend.key_up(key)
                held.discard(key)
    finally:
        for k in held:
            backend.key_up(k)
