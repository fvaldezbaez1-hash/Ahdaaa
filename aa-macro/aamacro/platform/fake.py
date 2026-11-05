"""A backend that talks to nothing: used by tests and the built-in simulator.

`frames` is either a fixed image or a callable returning the current image,
so tests can script what the "game" shows after each action.
"""

from __future__ import annotations

from typing import Callable

import numpy as np

from .base import Backend, WindowInfo, norm_key


class FakeBackend(Backend):
    name = "fake"

    def __init__(self, frame: np.ndarray | Callable[[], np.ndarray] | None = None,
                 size: tuple[int, int] = (1280, 720)) -> None:
        super().__init__()
        self._frame = frame if frame is not None else np.zeros((size[1], size[0], 3), np.uint8)
        self.actions: list[tuple] = []
        self.cursor = (0.0, 0.0)
        self.held: set[str] = set()
        self.listeners: list[Callable[[tuple], None]] = []

    def set_frame(self, frame) -> None:
        self._frame = frame

    def _emit(self, action: tuple) -> None:
        self.actions.append(action)
        for fn in list(self.listeners):
            fn(action)

    def locate(self, title: str) -> WindowInfo | None:
        img = self.capture()
        self.window = WindowInfo("fake", title, 0, 0, img.shape[1], img.shape[0], 1.0)
        return self.window

    def focus(self) -> None:
        self._emit(("focus",))

    def resize_client(self, width: int, height: int) -> bool:
        self._emit(("resize", width, height))
        return True

    def capture(self) -> np.ndarray:
        f = self._frame() if callable(self._frame) else self._frame
        return f.copy()

    def move(self, x: float, y: float) -> None:
        self.cursor = (float(x), float(y))
        self._emit(("move", round(x), round(y)))

    def mouse_down(self, button: str = "left") -> None:
        self._emit(("mouse_down", button, round(self.cursor[0]), round(self.cursor[1])))

    def mouse_up(self, button: str = "left") -> None:
        self._emit(("mouse_up", button, round(self.cursor[0]), round(self.cursor[1])))

    def click(self, x: float, y: float, button: str = "left", hold: float = 0.0) -> None:
        self.cursor = (float(x), float(y))
        self._emit(("click", button, round(x), round(y)))

    def scroll(self, clicks: int) -> None:
        self._emit(("scroll", int(clicks)))

    def key_down(self, key: str) -> None:
        self.held.add(norm_key(key))
        self._emit(("key_down", norm_key(key)))

    def key_up(self, key: str) -> None:
        self.held.discard(norm_key(key))
        self._emit(("key_up", norm_key(key)))

    def press(self, key: str, hold: float = 0.0) -> None:
        self._emit(("press", norm_key(key)))

    def cursor_screen_pos(self) -> tuple[float, float] | None:
        return self.cursor

    def in_failsafe_corner(self) -> bool:
        return False

    # helpers for tests
    def clicks(self) -> list[tuple[int, int]]:
        return [(a[2], a[3]) for a in self.actions if a[0] == "click"]

    def pressed(self) -> list[str]:
        return [a[1] for a in self.actions if a[0] == "press"]
