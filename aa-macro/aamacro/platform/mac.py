"""macOS backend: Quartz events + window list via pyobjc.

The app needs these permissions (System Settings > Privacy & Security):
Screen Recording (to see the game), Accessibility (to click/type) and
Input Monitoring (for the F1/F2/F3 hotkeys).
"""

from __future__ import annotations

import time

import numpy as np

from . import capture
from .base import Backend, BackendError, WindowInfo, norm_key

try:
    import Quartz  # type: ignore
except ImportError as exc:  # pragma: no cover - only on Macs without pyobjc
    raise BackendError("pyobjc (Quartz) is missing; install requirements.txt") from exc

KEYCODES = {
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19,
    "3": 20, "4": 21, "6": 22, "5": 23, "equals": 24, "9": 25, "7": 26, "minus": 27,
    "8": 28, "0": 29, "rbracket": 30, "o": 31, "u": 32, "lbracket": 33, "i": 34,
    "p": 35, "enter": 36, "l": 37, "j": 38, "quote": 39, "k": 40, "semicolon": 41,
    "backslash": 42, "comma": 43, "slash": 44, "n": 45, "m": 46, "period": 47,
    "tab": 48, "space": 49, "grave": 50, "backspace": 51, "esc": 53, "cmd": 55,
    "shift": 56, "capslock": 57, "alt": 58, "ctrl": 59, "rshift": 60, "ralt": 61,
    "rctrl": 62, "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
    "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
    "left": 123, "right": 124, "down": 125, "up": 126, "delete": 117, "home": 115,
    "end": 119, "pageup": 116, "pagedown": 121,
}

ROBLOX_OWNERS = {"roblox", "robloxplayer"}

_BUTTONS = {
    "left": (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp,
             Quartz.kCGEventLeftMouseDragged, Quartz.kCGMouseButtonLeft),
    "right": (Quartz.kCGEventRightMouseDown, Quartz.kCGEventRightMouseUp,
              Quartz.kCGEventRightMouseDragged, Quartz.kCGMouseButtonRight),
    "middle": (Quartz.kCGEventOtherMouseDown, Quartz.kCGEventOtherMouseUp,
               Quartz.kCGEventOtherMouseDragged, Quartz.kCGMouseButtonCenter),
}


def _post(event) -> None:
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)


class MacBackend(Backend):
    name = "mac"

    def __init__(self, titlebar_points: float = 28.0) -> None:
        super().__init__()
        self.titlebar = titlebar_points
        self._held_button: str | None = None
        self._last_point = (0.0, 0.0)

    # --- window ------------------------------------------------------
    def locate(self, title: str) -> WindowInfo | None:
        opts = Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements
        windows = Quartz.CGWindowListCopyWindowInfo(opts, Quartz.kCGNullWindowID) or []
        want = title.strip().lower()
        best = None
        for w in windows:
            owner = str(w.get("kCGWindowOwnerName", "") or "")
            name = str(w.get("kCGWindowName", "") or "")
            if int(w.get("kCGWindowLayer", 0)) != 0:
                continue
            if owner.lower() not in ROBLOX_OWNERS and name.lower() != want and want not in owner.lower():
                continue
            b = w.get("kCGWindowBounds") or {}
            area = float(b.get("Width", 0)) * float(b.get("Height", 0))
            if area > 0 and (best is None or area > best[0]):
                best = (area, w, b)
        if not best:
            self.window = None
            return None
        _, w, b = best
        x, y = float(b["X"]), float(b["Y"])
        width, height = float(b["Width"]), float(b["Height"])
        titlebar = 0.0 if self._is_fullscreen(x, y, width, height) else self.titlebar
        self.window = WindowInfo(
            handle=int(w.get("kCGWindowOwnerPID", 0)),
            title=str(w.get("kCGWindowName", "") or w.get("kCGWindowOwnerName", "")),
            left=x, top=y + titlebar, width=width, height=height - titlebar,
            scale=self.window.scale if self.window else 1.0,
        )
        try:
            self.capture()  # learns the Retina scale before any click
        except Exception:
            pass
        return self.window

    @staticmethod
    def _is_fullscreen(x: float, y: float, w: float, h: float) -> bool:
        try:
            from AppKit import NSScreen  # type: ignore

            for screen in NSScreen.screens():
                f = screen.frame()
                if abs(f.size.width - w) < 2 and abs(f.size.height - h) < 2:
                    return True
        except Exception:
            pass
        return False

    def _require(self) -> WindowInfo:
        if not self.window:
            raise BackendError("Game window not located yet.")
        return self.window

    def focus(self) -> None:
        w = self._require()
        try:
            from AppKit import NSApplicationActivateIgnoringOtherApps, NSRunningApplication  # type: ignore

            app = NSRunningApplication.runningApplicationWithProcessIdentifier_(int(w.handle))
            if app is not None:
                app.activateWithOptions_(NSApplicationActivateIgnoringOtherApps)
                time.sleep(0.3)
        except Exception as exc:  # pragma: no cover
            raise BackendError(f"Could not focus Roblox: {exc}") from exc

    def resize_client(self, width: int, height: int) -> bool:
        """Resize via the Accessibility API. Width/height are captured pixels."""
        w = self._require()
        scale = w.scale or 1.0
        try:
            import ApplicationServices as AS  # type: ignore

            app = AS.AXUIElementCreateApplication(int(w.handle))
            err, wins = AS.AXUIElementCopyAttributeValue(app, AS.kAXWindowsAttribute, None)
            if err or not wins:
                return False
            size = Quartz.CGSize(width / scale, height / scale + self.titlebar)
            value = AS.AXValueCreate(AS.kAXValueCGSizeType, size)
            AS.AXUIElementSetAttributeValue(wins[0], AS.kAXSizeAttribute, value)
            time.sleep(0.4)
            self.locate(w.title or "Roblox")
            return True
        except Exception:
            return False

    def capture(self) -> np.ndarray:
        w = self._require()
        img = capture.grab(w.left, w.top, w.width, w.height)
        # On Retina screens mss returns more pixels than points.
        w.scale = img.shape[1] / max(1.0, w.width)
        return img

    # --- coordinates -------------------------------------------------
    def _to_screen(self, x: float, y: float) -> tuple[float, float]:
        w = self._require()
        s = w.scale or 1.0
        return w.left + x / s, w.top + y / s

    # --- mouse -------------------------------------------------------
    def move(self, x: float, y: float) -> None:
        px, py = self._to_screen(x, y)
        if self._held_button:
            kind, button = _BUTTONS[self._held_button][2], _BUTTONS[self._held_button][3]
        else:
            kind, button = Quartz.kCGEventMouseMoved, Quartz.kCGMouseButtonLeft
        _post(Quartz.CGEventCreateMouseEvent(None, kind, (px, py), button))
        # A tiny nudge so Roblox notices the hover.
        _post(Quartz.CGEventCreateMouseEvent(None, kind, (px + 1, py), button))
        _post(Quartz.CGEventCreateMouseEvent(None, kind, (px, py), button))
        self._last_point = (px, py)

    def _current_point(self) -> tuple[float, float]:
        loc = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
        return float(loc.x), float(loc.y)

    def mouse_down(self, button: str = "left") -> None:
        down, _, _, btn = _BUTTONS[button]
        _post(Quartz.CGEventCreateMouseEvent(None, down, self._current_point(), btn))
        self._held_button = button

    def mouse_up(self, button: str = "left") -> None:
        _, up, _, btn = _BUTTONS[button]
        _post(Quartz.CGEventCreateMouseEvent(None, up, self._current_point(), btn))
        self._held_button = None

    def scroll(self, clicks: int) -> None:
        step = 1 if clicks > 0 else -1
        for _ in range(abs(int(clicks))):
            _post(Quartz.CGEventCreateScrollWheelEvent(None, Quartz.kCGScrollEventUnitLine, 1, step))
            time.sleep(0.02)

    # --- keyboard ----------------------------------------------------
    def _code(self, key: str) -> int:
        k = norm_key(key)
        if k not in KEYCODES:
            raise BackendError(f"Unknown key: {key!r}")
        return KEYCODES[k]

    def key_down(self, key: str) -> None:
        _post(Quartz.CGEventCreateKeyboardEvent(None, self._code(key), True))

    def key_up(self, key: str) -> None:
        _post(Quartz.CGEventCreateKeyboardEvent(None, self._code(key), False))

    def cursor_screen_pos(self) -> tuple[float, float] | None:
        try:
            return self._current_point()
        except Exception:
            return None
