"""A tiny script language for getting from the lobby into a match.

Clicks are by *text on screen* ("click \"Story\""), not by fixed pixels,
so scripts keep working at any window size and survive small UI moves.

    walk play_area              replay a recorded walking route
    click "Play" [8]            wait up to 8 s for the text, then click it
    optional click "Claim"      click it if it shows up within 2 s, else skip
    click_at 0.50 0.62          click a spot (fractions of the window)
    click_template start_btn    click a saved template image
    key e / hold w 1.5          press E / hold W for 1.5 s
    scroll -5                   scroll the mouse wheel
    wait 2                      wait 2 seconds
    wait_for "Vote" [20]        wait for text to appear
    reset                       respawn the character
"""

from __future__ import annotations

import shlex
import time
from dataclasses import dataclass

from ..movement.routes import Route, play_route, reset_character

COMMANDS = {"walk", "click", "click_at", "click_template", "key", "press", "hold", "scroll",
            "wait", "wait_for", "reset"}


class StepError(Exception):
    pass


@dataclass
class Step:
    line_no: int
    command: str
    args: list[str]
    optional: bool = False
    raw: str = ""


def parse(script: str) -> list[Step]:
    steps = []
    for n, raw in enumerate((script or "").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            parts = shlex.split(line, posix=True)
        except ValueError as exc:
            raise StepError(f"line {n}: {exc}") from exc
        optional = False
        if parts and parts[0].lower() == "optional":
            optional, parts = True, parts[1:]
        if not parts:
            raise StepError(f"line {n}: nothing after 'optional'")
        cmd = parts[0].lower()
        if cmd not in COMMANDS:
            raise StepError(f'line {n}: unknown command "{parts[0]}"')
        steps.append(Step(n, cmd, parts[1:], optional, line))
        _validate(steps[-1])
    return steps


def _validate(s: Step) -> None:
    need = {"walk": 1, "click": 1, "click_at": 2, "click_template": 1, "key": 1, "press": 1,
            "hold": 2, "scroll": 1, "wait": 1, "wait_for": 1, "reset": 0}[s.command]
    if len(s.args) < need:
        raise StepError(f"line {s.line_no}: {s.command} needs {need} value(s)")
    nums = {"click_at": [0, 1], "hold": [1], "scroll": [0], "wait": [0]}.get(s.command, [])
    for i in nums:
        try:
            float(s.args[i])
        except ValueError as exc:
            raise StepError(f'line {s.line_no}: "{s.args[i]}" is not a number') from exc


class StepRunner:
    def __init__(self, backend, reader, control, settings, log=None) -> None:
        self.backend = backend
        self.reader = reader
        self.control = control
        self.settings = settings
        self.log = log or (lambda m: None)

    def run(self, script: str) -> None:
        for step in parse(script):
            self.control.check()
            ok = self._do(step)
            if not ok and not step.optional:
                raise StepError(f"line {step.line_no} failed: {step.raw}")

    def _wait_text(self, text: str, timeout: float):
        end = time.monotonic() + timeout
        while True:
            snap = self.reader.snap()
            hit = snap.find([text], 82)
            if hit:
                return hit
            if time.monotonic() >= end:
                return None
            self.control.sleep(0.4)

    def _do(self, s: Step) -> bool:
        a = s.args
        b = self.backend
        delay = float(self.settings.get("timing.click_delay", 0.15))
        if s.command == "walk":
            route = Route.load(a[0])
            if route is None:
                raise StepError(f'line {s.line_no}: no recorded walk called "{a[0]}"')
            return play_route(route, b, self.control, self.settings, self.reader, self.log)
        if s.command == "click":
            timeout = float(a[1]) if len(a) > 1 else (2.0 if s.optional else 8.0)
            hit = self._wait_text(a[0], timeout)
            if not hit:
                return False
            b.click(*hit.box.center)
            self.control.sleep(delay + 0.3)
            return True
        if s.command == "click_at":
            w, h = b.size()
            b.click(float(a[0]) * w, float(a[1]) * h)
            self.control.sleep(delay + 0.3)
            return True
        if s.command == "click_template":
            timeout = float(a[1]) if len(a) > 1 else (2.0 if s.optional else 8.0)
            end = time.monotonic() + timeout
            while True:
                m = self.reader.find_template(self.reader.snap(read_text=False), a[0])
                if m:
                    b.click(*m.center)
                    self.control.sleep(delay + 0.3)
                    return True
                if time.monotonic() >= end:
                    return False
                self.control.sleep(0.4)
        if s.command in ("key", "press"):
            b.press(a[0])
            self.control.sleep(delay)
            return True
        if s.command == "hold":
            b.key_down(a[0])
            try:
                self.control.sleep(float(a[1]))
            finally:
                b.key_up(a[0])
            return True
        if s.command == "scroll":
            b.scroll(int(float(a[0])))
            return True
        if s.command == "wait":
            self.control.sleep(float(a[0]))
            return True
        if s.command == "wait_for":
            timeout = float(a[1]) if len(a) > 1 else 15.0
            return self._wait_text(a[0], timeout) is not None
        if s.command == "reset":
            reset_character(b, self.control, self.settings)
            return True
        return False
