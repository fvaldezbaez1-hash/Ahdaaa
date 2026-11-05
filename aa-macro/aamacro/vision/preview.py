"""Reads the unit placement preview (the "ghost" that follows the cursor
when a unit is selected): can the unit go here, and how big is its range
ring?

Works by comparing a frame with the ghost against a frame without it, so it
does not depend on the game's exact colours. Optional calibration samples
(taken in the Tools tab) make the valid/invalid decision exact.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class PreviewResult:
    valid: bool | None        # None = no ghost visible (off-map / UI)
    changed: float            # fraction of the area around the cursor that changed
    red: float                # fraction of changed pixels that are red
    green: float
    ring_radius: float | None # range ring radius in pixels, if seen


def hue_hist(hsv: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Hue x saturation histogram. Hue is circular (red sits at both 0 and
    179), so it is shifted to centre red in one bin and smoothed around the
    circle."""
    sel = mask > 0
    hue = (hsv[..., 0].astype(np.int32)[sel] + 5) % 180
    sat = hsv[..., 1][sel]
    # two saturation bands only: greyish/white vs. clearly coloured
    hist, _, _ = np.histogram2d(hue, sat, bins=[np.linspace(0, 180, 19), [0, 70, 256]])
    hist = 0.5 * hist + 0.25 * np.roll(hist, 1, axis=0) + 0.25 * np.roll(hist, -1, axis=0)
    flat = hist.flatten().astype(np.float32)
    total = flat.sum()
    return flat / total if total else flat


class PreviewClassifier:
    def __init__(self, calibration: dict | None = None, diff_threshold: int = 28) -> None:
        self.diff_threshold = diff_threshold
        self.valid_hist = None
        self.invalid_hist = None
        if calibration:
            if calibration.get("valid"):
                self.valid_hist = np.asarray(calibration["valid"], np.float32)
            if calibration.get("invalid"):
                self.invalid_hist = np.asarray(calibration["invalid"], np.float32)

    @property
    def calibrated(self) -> bool:
        return self.valid_hist is not None and self.invalid_hist is not None

    def changed_mask(self, baseline: np.ndarray, hover: np.ndarray) -> np.ndarray:
        diff = cv2.absdiff(baseline, hover)
        gray = diff.max(axis=2)
        mask = (gray > self.diff_threshold).astype(np.uint8) * 255
        return cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))

    def sample(self, baseline: np.ndarray, hover: np.ndarray, cursor: tuple[float, float],
               radius: int) -> list[float]:
        """Colour fingerprint of the ghost, for calibration."""
        mask, hsv = self._roi(baseline, hover, cursor, radius)
        return hue_hist(hsv, mask).tolist()

    def _roi(self, baseline, hover, cursor, radius):
        h, w = hover.shape[:2]
        cx, cy = int(cursor[0]), int(cursor[1])
        x0, y0 = max(0, cx - radius), max(0, cy - radius)
        x1, y1 = min(w, cx + radius), min(h, cy + radius)
        mask = self.changed_mask(baseline[y0:y1, x0:x1], hover[y0:y1, x0:x1])
        hsv = cv2.cvtColor(hover[y0:y1, x0:x1], cv2.COLOR_BGR2HSV)
        return mask, hsv

    def classify(self, baseline: np.ndarray, hover: np.ndarray, cursor: tuple[float, float],
                 radius: int, find_ring: bool = True) -> PreviewResult:
        mask, hsv = self._roi(baseline, hover, cursor, radius)
        area = mask.size or 1
        changed_px = int(np.count_nonzero(mask))
        changed = changed_px / area
        if changed < 0.01:
            return PreviewResult(None, changed, 0.0, 0.0, None)
        sel = mask > 0
        hh, ss, vv = hsv[..., 0][sel], hsv[..., 1][sel], hsv[..., 2][sel]
        red = float(np.mean(((hh < 10) | (hh > 170)) & (ss > 90) & (vv > 70)))
        green = float(np.mean((hh > 38) & (hh < 88) & (ss > 70) & (vv > 70)))
        if self.calibrated:
            hist = hue_hist(hsv, mask)
            dv = cv2.compareHist(hist.astype(np.float32), self.valid_hist, cv2.HISTCMP_BHATTACHARYYA)
            di = cv2.compareHist(hist.astype(np.float32), self.invalid_hist, cv2.HISTCMP_BHATTACHARYYA)
            valid = dv <= di
        else:
            valid = not (red > 0.22 and red > green * 1.2)
        ring = ring_radius(self.changed_mask(baseline, hover), cursor, min_r=radius * 0.6) if find_ring else None
        return PreviewResult(valid, changed, red, green, ring)


def ring_radius(mask: np.ndarray, center: tuple[float, float], min_r: float = 10.0) -> float | None:
    """Radius of a circle drawn around `center` in a changed-pixel mask.

    Counts changed pixels at each distance and divides by the ring's
    circumference, so a thin circle stands out as a sharp peak.
    """
    ys, xs = np.nonzero(mask)
    if len(xs) < 30:
        return None
    d = np.hypot(xs - center[0], ys - center[1])
    max_r = int(d.max()) + 2
    if max_r <= min_r + 4:
        return None
    hist = np.bincount(d.astype(int), minlength=max_r + 1).astype(np.float64)
    r = np.arange(len(hist), dtype=np.float64)
    density = hist / np.maximum(2 * np.pi * np.maximum(r, 1.0), 1.0)
    density = np.convolve(density, np.ones(3) / 3, mode="same")
    lo = int(min_r)
    if lo >= len(density) - 1:
        return None
    seg = density[lo:]
    peak = int(np.argmax(seg)) + lo
    # a real ring covers a good part of its circumference
    coverage = hist[max(0, peak - 2):peak + 3].sum() / (2 * np.pi * max(peak, 1))
    if coverage < 0.35:
        return None
    return float(peak)
