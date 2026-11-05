"""Puts the camera in the same place every match.

1. Zoom all the way out (then optionally in a few steps).
2. If the map has a saved reference picture, tap the rotate keys until the
   view lines up with it.
"""

from __future__ import annotations

from ..geometry import Rect


def normalize_camera(backend, control, settings, aligner=None, log=None):
    cfg = settings.get("camera")
    keys = settings.get("keys")
    w, h = backend.size()
    play = Rect.from_norm(settings.get("hud.play_area") or [0, 0, 1, 1], w, h)
    backend.move(*play.center)
    control.sleep(0.1)
    for _ in range(int(cfg.get("zoom_out_presses", 0))):
        backend.press(keys["zoom_out"], 0.03)
        control.sleep(0.03)
    for _ in range(int(cfg.get("zoom_in_presses", 0))):
        backend.press(keys["zoom_in"], 0.03)
        control.sleep(0.03)
    control.sleep(0.4)
    if aligner is None or not cfg.get("align_rotate", True):
        return None
    tap = float(cfg.get("rotate_tap", 0.06))
    al = aligner.estimate(backend.capture())
    if not al.ok:
        if log:
            log("Camera: couldn't match this view to the saved map picture; using it as is")
        return al
    direction = keys["rotate_left"] if al.angle > 0 else keys["rotate_right"]
    other = keys["rotate_right"] if direction == keys["rotate_left"] else keys["rotate_left"]
    flips = 0
    for _ in range(int(cfg.get("max_rotate_taps", 40))):
        if abs(al.angle) < 1.5:
            break
        before = abs(al.angle)
        backend.press(direction, tap)
        control.sleep(0.25)
        nxt = aligner.estimate(backend.capture())
        if not nxt.ok:
            break
        if abs(nxt.angle) > before + 0.3:
            direction, other = other, direction
            flips += 1
            if flips > 3:
                break
        al = nxt
    if log:
        log(f"Camera lined up with the saved map (off by {al.angle:+.1f}°)")
    return al
