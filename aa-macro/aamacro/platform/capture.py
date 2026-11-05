"""Screen capture with mss (one instance per thread, as mss requires)."""

from __future__ import annotations

import threading

import numpy as np

_local = threading.local()


def _mss():
    inst = getattr(_local, "mss", None)
    if inst is None:
        import mss  # imported lazily so tests don't need a display

        inst = mss.mss()
        _local.mss = inst
    return inst


def grab(left: float, top: float, width: float, height: float) -> np.ndarray:
    """Grab a screen rectangle (OS screen units) as a BGR uint8 image."""
    region = {
        "left": int(round(left)),
        "top": int(round(top)),
        "width": max(1, int(round(width))),
        "height": max(1, int(round(height))),
    }
    shot = _mss().grab(region)
    img = np.asarray(shot, dtype=np.uint8)  # BGRA
    return np.ascontiguousarray(img[:, :, :3])
