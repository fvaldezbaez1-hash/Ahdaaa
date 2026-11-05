"""Pick the input/capture backend for this operating system."""

from __future__ import annotations

import sys

from .base import Backend, BackendError, WindowInfo, norm_key

__all__ = ["Backend", "BackendError", "WindowInfo", "norm_key", "get_backend"]


def get_backend(settings=None) -> Backend:
    if sys.platform == "win32":
        from .windows import WindowsBackend

        return WindowsBackend()
    if sys.platform == "darwin":
        from .mac import MacBackend

        titlebar = settings.get("window.mac_titlebar", 28) if settings else 28
        return MacBackend(titlebar_points=float(titlebar))
    raise BackendError(
        "AA Macro controls Roblox on Windows and macOS only. "
        "On other systems you can still run the tests and the simulator."
    )
