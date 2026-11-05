"""Global F1/F2/F3 hotkeys (work while Roblox has focus)."""

from __future__ import annotations

from typing import Callable


class Hotkeys:
    def __init__(self) -> None:
        self._listener = None
        self.error: str | None = None

    def start(self, mapping: dict[str, Callable[[], None]]) -> bool:
        self.stop()
        try:
            from pynput import keyboard
        except Exception as exc:  # no display / no permission
            self.error = str(exc)
            return False
        combos = {}
        for key, fn in mapping.items():
            k = key.strip().lower()
            if not k:
                continue
            combos[f"<{k}>" if len(k) > 1 else k] = fn
        try:
            self._listener = keyboard.GlobalHotKeys(combos)
            self._listener.start()
            return True
        except Exception as exc:
            self.error = str(exc)
            self._listener = None
            return False

    def stop(self) -> None:
        if self._listener:
            try:
                self._listener.stop()
            except Exception:
                pass
            self._listener = None
