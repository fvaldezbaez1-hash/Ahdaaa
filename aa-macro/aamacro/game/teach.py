"""Teach by doing: click through the menus yourself once and the macro writes
the step script for you, using the words you clicked on (not pixels)."""

from __future__ import annotations

import threading
import time

from ..geometry import Rect
from ..platform.base import norm_key
from ..vision.ocr import merge_lines

IGNORE_KEYS = {"f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12"}


def describe_click(boxes, x: float, y: float, width: int, height: int) -> str:
    """Pick the words under (or right next to) a click."""
    best, best_d = None, None
    for b in boxes:
        r = b.rect.expand(int(0.006 * width))
        if r.contains(x, y):
            d = 0.0
        else:
            cx, cy = b.center
            d = ((cx - x) ** 2 + (cy - y) ** 2) ** 0.5
            if d > 0.035 * width:
                continue
        # prefer the smallest box that contains the click (a button label
        # rather than a whole merged line)
        key = (d, b.rect.area)
        if best is None or key < best_d:
            best, best_d = b, key
    if best is not None and len(best.text.strip()) >= 2:
        text = best.text.strip().replace('"', "'")
        return f'click "{text}"'
    return f"click_at {x / width:.3f} {y / height:.3f}"


def build_script(events, ocr, width: int, height: int) -> str:
    """events: ("click", t, x, y, frame) or ("key", t, key, duration)."""
    lines = ["# Recorded with Teach. Edit freely."]
    last_t = None
    for ev in events:
        t = ev[1]
        if last_t is not None:
            gap = t - last_t
            if ev[0] == "key" and gap > 0.8:
                lines.append(f"wait {min(gap, 5.0):.1f}")
        if ev[0] == "click":
            _, _, x, y, frame = ev
            boxes = merge_lines(ocr.read(frame)) if frame is not None else []
            lines.append(describe_click(boxes, x, y, width, height))
        else:
            _, _, key, duration = ev
            lines.append(f"hold {key} {duration:.2f}" if duration > 0.35 else f"key {key}")
        last_t = t if ev[0] != "key" else t + ev[3]
    return "\n".join(lines) + "\n"


class TeachRecorder:
    def __init__(self, backend, ocr) -> None:
        self.backend = backend
        self.ocr = ocr
        self.events: list[tuple] = []
        self._mouse = None
        self._keys = None
        self._down: dict[str, float] = {}
        self._lock = threading.Lock()

    def start(self) -> None:
        from pynput import keyboard, mouse

        self.events = []

        def on_click(sx, sy, button, pressed):
            if not pressed or getattr(button, "name", "") != "left":
                return
            pos = self.backend.from_screen(sx, sy)
            if pos is None:
                return
            w, h = self.backend.window.width * self.backend.window.scale, \
                self.backend.window.height * self.backend.window.scale
            if not Rect(0, 0, int(w), int(h)).contains(*pos):
                return  # clicked outside Roblox (e.g. on this app)
            try:
                frame = self.backend.capture()
            except Exception:
                frame = None
            with self._lock:
                self.events.append(("click", time.monotonic(), pos[0], pos[1], frame))

        def name(key):
            ch = getattr(key, "char", None)
            return norm_key(ch) if ch else norm_key(getattr(key, "name", "") or "")

        def on_press(key):
            k = name(key)
            if k and k not in IGNORE_KEYS and k not in self._down:
                self._down[k] = time.monotonic()

        def on_release(key):
            k = name(key)
            t0 = self._down.pop(k, None)
            if t0 is not None:
                with self._lock:
                    self.events.append(("key", t0, k, time.monotonic() - t0))

        self._mouse = mouse.Listener(on_click=on_click)
        self._keys = keyboard.Listener(on_press=on_press, on_release=on_release)
        self._mouse.start()
        self._keys.start()

    def stop(self) -> str:
        for listener in (self._mouse, self._keys):
            if listener:
                listener.stop()
        self._mouse = self._keys = None
        with self._lock:
            events = sorted(self.events, key=lambda e: e[1])
        w, h = self.backend.size()
        return build_script(events, self.ocr, w, h)
