"""Matches the current view to the map's saved reference picture.

If the camera ended up slightly rotated, zoomed or shifted, the learned
spots are moved to match, so clicks still land in the right place.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np

ALIGN_WIDTH = 640


@dataclass
class Alignment:
    ok: bool
    H: np.ndarray | None       # reference px -> current px (both at ALIGN_WIDTH)
    inliers: int
    angle: float               # degrees, + = current view rotated clockwise vs reference
    scale: float
    shift: tuple[float, float] # fraction of width/height
    ref_shape: tuple[int, int] = (1, 1)
    cur_shape: tuple[int, int] = (1, 1)

    def map_point(self, x_norm: float, y_norm: float) -> tuple[float, float]:
        """Reference fraction -> current fraction."""
        if not self.ok or self.H is None:
            return x_norm, y_norm
        rh, rw = self.ref_shape
        ch, cw = self.cur_shape
        p = np.array([[[x_norm * rw, y_norm * rh]]], np.float32)
        q = cv2.perspectiveTransform(p, self.H)[0, 0]
        return float(q[0] / cw), float(q[1] / ch)


def _prep(img: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    h, w = gray.shape
    if w != ALIGN_WIDTH:
        gray = cv2.resize(gray, (ALIGN_WIDTH, int(round(h * ALIGN_WIDTH / w))), interpolation=cv2.INTER_AREA)
    return gray


def _mask(shape, play_area_norm) -> np.ndarray | None:
    if not play_area_norm:
        return None
    h, w = shape
    x, y, pw, ph = play_area_norm
    m = np.zeros((h, w), np.uint8)
    m[int(y * h):int((y + ph) * h), int(x * w):int((x + pw) * w)] = 255
    return m


class Aligner:
    def __init__(self, reference: np.ndarray, play_area_norm=None, features: int = 1500) -> None:
        self.orb = cv2.ORB_create(nfeatures=features, scaleFactor=1.2, nlevels=8)
        self.ref = _prep(reference)
        self.play_area = play_area_norm
        self.kp, self.des = self.orb.detectAndCompute(self.ref, _mask(self.ref.shape, play_area_norm))
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING)

    @property
    def ref_shape(self) -> tuple[int, int]:
        return self.ref.shape

    def estimate(self, frame: np.ndarray, min_inliers: int = 25) -> Alignment:
        cur = _prep(frame)
        fail = Alignment(False, None, 0, 0.0, 1.0, (0.0, 0.0))
        if self.des is None or len(self.kp) < 10:
            return fail
        kp, des = self.orb.detectAndCompute(cur, _mask(cur.shape, self.play_area))
        if des is None or len(kp) < 10:
            return fail
        pairs = self.matcher.knnMatch(self.des, des, k=2)
        good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < 0.78 * p[1].distance]
        if len(good) < min_inliers:
            return fail
        src = np.float32([self.kp[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst = np.float32([kp[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        H, inl = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
        A, inl2 = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4.0)
        n = int(inl.sum()) if inl is not None else 0
        if H is None or n < min_inliers:
            return fail
        angle, scale, shift = 0.0, 1.0, (0.0, 0.0)
        if A is not None:
            angle = math.degrees(math.atan2(A[1, 0], A[0, 0]))
            scale = math.hypot(A[0, 0], A[1, 0])
            shift = (float(A[0, 2] / cur.shape[1]), float(A[1, 2] / cur.shape[0]))
        return Alignment(True, H, n, angle, scale, shift, self.ref.shape[:2], cur.shape[:2])
