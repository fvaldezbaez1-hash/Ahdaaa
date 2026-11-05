"""The interface every OS backend implements.

All coordinates passed to a backend are pixels inside the captured Roblox
client area (the image returned by capture()). Each backend converts them
to whatever the OS needs (physical pixels on Windows, points on a Mac).
"""

from __future__ import annotations

import abc
import time
from dataclasses import dataclass

import numpy as np

KEY_ALIASES = {
    "escape": "esc", "return": "enter", "spacebar": "space", " ": "space",
    "arrowleft": "left", "arrowright": "right", "arrowup": "up", "arrowdown": "down",
    "control": "ctrl", "option": "alt", "del": "delete", "pgup": "pageup",
    "pgdn": "pagedown", ",": "comma", ".": "period", "/": "slash", "-": "minus",
    "=": "equals", ";": "semicolon", "'": "quote", "[": "lbracket", "]": "rbracket",
    "\\": "backslash", "`": "grave", "lshift": "shift", "lctrl": "ctrl", "lalt": "alt",
}


def norm_key(key: str) -> str:
    k = str(key).strip().lower()
    return KEY_ALIASES.get(k, k)


@dataclass
class WindowInfo:
    handle: object          # HWND on Windows, PID on Mac
    title: str
    left: float             # client area origin in OS screen units
    top: float
    width: float            # client size in OS screen units
    height: float
    scale: float = 1.0      # captured pixels per OS screen unit


class BackendError(RuntimeError):
    pass


class Backend(abc.ABC):
    name = "base"

    def __init__(self) -> None:
        self.window: WindowInfo | None = None

    # --- window ------------------------------------------------------
    @abc.abstractmethod
    def locate(self, title: str) -> WindowInfo | None:
        """Find the game window and remember it. Returns None if missing."""

    @abc.abstractmethod
    def focus(self) -> None:
        ...

    def resize_client(self, width: int, height: int) -> bool:
        return False

    @abc.abstractmethod
    def capture(self) -> np.ndarray:
        """BGR image of the game's client area."""

    def size(self) -> tuple[int, int]:
        img = self.capture()
        return img.shape[1], img.shape[0]

    # --- mouse -------------------------------------------------------
    @abc.abstractmethod
    def move(self, x: float, y: float) -> None:
        ...

    @abc.abstractmethod
    def mouse_down(self, button: str = "left") -> None:
        ...

    @abc.abstractmethod
    def mouse_up(self, button: str = "left") -> None:
        ...

    @abc.abstractmethod
    def scroll(self, clicks: int) -> None:
        """Positive = up/zoom in, negative = down/zoom out."""

    def click(self, x: float, y: float, button: str = "left", hold: float = 0.04) -> None:
        self.move(x, y)
        time.sleep(0.03)
        self.mouse_down(button)
        time.sleep(hold)
        self.mouse_up(button)

    # --- keyboard ----------------------------------------------------
    @abc.abstractmethod
    def key_down(self, key: str) -> None:
        ...

    @abc.abstractmethod
    def key_up(self, key: str) -> None:
        ...

    def press(self, key: str, hold: float = 0.05) -> None:
        self.key_down(key)
        time.sleep(hold)
        self.key_up(key)

    # --- misc --------------------------------------------------------
    def from_screen(self, sx: float, sy: float) -> tuple[float, float] | None:
        """OS screen coordinates (e.g. from a mouse hook) -> window pixels."""
        w = self.window
        if not w:
            return None
        return (sx - w.left) * (w.scale or 1.0), (sy - w.top) * (w.scale or 1.0)

    def cursor_screen_pos(self) -> tuple[float, float] | None:
        return None

    def in_failsafe_corner(self) -> bool:
        pos = self.cursor_screen_pos()
        return bool(pos and pos[0] <= 3 and pos[1] <= 3)

    def ensure_window(self, title: str) -> WindowInfo:
        info = self.locate(title)
        if info is None:
            raise BackendError(f'Could not find a window called "{title}". Is Roblox open?')
        return info
