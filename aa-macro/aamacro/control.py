"""Start / pause / stop control shared by the bot thread and the UI."""

from __future__ import annotations

import threading
import time


class StopRequested(Exception):
    """Raised inside the bot when the user presses Stop."""


class Control:
    def __init__(self) -> None:
        self._stop = threading.Event()
        self._running = threading.Event()
        self._running.set()  # not paused

    # --- UI side -------------------------------------------------------
    def stop(self) -> None:
        self._stop.set()
        self._running.set()  # wake a paused bot so it can exit

    def pause(self) -> None:
        self._running.clear()

    def resume(self) -> None:
        self._running.set()

    def toggle_pause(self) -> bool:
        if self.paused:
            self.resume()
        else:
            self.pause()
        return self.paused

    def reset(self) -> None:
        self._stop.clear()
        self._running.set()

    @property
    def stopped(self) -> bool:
        return self._stop.is_set()

    @property
    def paused(self) -> bool:
        return not self._running.is_set()

    # --- bot side ------------------------------------------------------
    def check(self) -> None:
        """Block while paused; raise if stopped."""
        if self._stop.is_set():
            raise StopRequested()
        while not self._running.is_set():
            self._running.wait(0.2)
        if self._stop.is_set():
            raise StopRequested()

    def sleep(self, seconds: float) -> None:
        """Sleep that reacts to pause/stop within ~50 ms."""
        end = time.monotonic() + max(0.0, seconds)
        while True:
            self.check()
            left = end - time.monotonic()
            if left <= 0:
                return
            self._stop.wait(min(left, 0.05))
