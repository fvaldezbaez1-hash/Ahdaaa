"""Finds where units can be placed: selects a unit, sweeps the cursor over a
grid, and reads whether the placement ghost says yes or no at each point.
It also measures the unit's range ring while it's at it."""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from ..geometry import Rect
from ..vision.preview import PreviewClassifier


@dataclass
class ScanResult:
    grid: np.ndarray                     # rows x cols: 1 valid, 0 invalid, -1 nothing
    area: Rect                           # scanned area in window pixels
    frame_size: tuple[int, int]          # (w, h)
    rings: list[float] = field(default_factory=list)

    def ring_norm(self) -> float | None:
        if len(self.rings) < 2:
            return None
        return float(np.median(self.rings)) / self.frame_size[0]

    def valid_fraction(self) -> float:
        known = self.grid >= 0
        return float((self.grid == 1).sum() / max(1, known.sum()))

    def to_mask(self, shape: tuple[int, int]) -> np.ndarray:
        """Valid-placement mask at the given (h, w) analysis size."""
        h, w = shape
        fw, fh = self.frame_size
        mask = np.zeros((h, w), np.uint8)
        x0, y0 = int(self.area.x * w / fw), int(self.area.y * h / fh)
        x1, y1 = int(self.area.right * w / fw), int(self.area.bottom * h / fh)
        if x1 <= x0 or y1 <= y0:
            return mask.astype(bool)
        g = (self.grid == 1).astype(np.uint8) * 255
        block = cv2.resize(g, (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)
        mask[y0:y1, x0:x1] = block
        return mask > 127


def grid_points(area: Rect, cols: int, rows: int) -> list[tuple[int, int, int, int]]:
    """Serpentine order (row, col, x, y) so the cursor never jumps far."""
    pts = []
    for r in range(rows):
        y = area.y + (r + 0.5) * area.h / rows
        cs = range(cols) if r % 2 == 0 else range(cols - 1, -1, -1)
        for c in cs:
            x = area.x + (c + 0.5) * area.w / cols
            pts.append((r, c, int(x), int(y)))
    return pts


class PlacementScanner:
    def __init__(self, backend, control, settings, classifier: PreviewClassifier | None = None) -> None:
        self.backend = backend
        self.control = control
        self.settings = settings
        self.classifier = classifier or PreviewClassifier(settings.get("learning.preview_calibration"))

    def cancel(self, slot_key: str, x: float, y: float) -> None:
        """Put the selected unit away without placing it."""
        how = str(self.settings.get("keys.cancel_placement", "same_key")).lower()
        if how == "same_key":
            self.backend.press(slot_key)
        elif how == "right_click":
            self.backend.click(x, y, "right")
        else:
            self.backend.press(how)

    def scan(self, slot: int, area: Rect, cols: int, rows: int, log=None) -> ScanResult:
        keys = self.settings.get("keys.slots")
        slot_key = keys[slot]
        hover = float(self.settings.get("timing.hover_delay", 0.09))
        # park the cursor at the edge so the baseline has no hover effects
        self.backend.move(area.x + 2, area.y + 2)
        self.control.sleep(0.2)
        baseline = self.backend.capture()
        h, w = baseline.shape[:2]
        roi = max(16, int(0.05 * w))
        self.backend.press(slot_key)
        self.control.sleep(0.35)
        grid = np.full((rows, cols), -1, np.int8)
        rings: list[float] = []
        x, y = area.x + 2, area.y + 2
        try:
            for n, (r, c, x, y) in enumerate(grid_points(area, cols, rows)):
                self.control.check()
                self.backend.move(x, y)
                self.control.sleep(hover)
                frame = self.backend.capture()
                res = self.classifier.classify(baseline, frame, (x, y), roi, find_ring=(n % 6 == 0))
                grid[r, c] = -1 if res.valid is None else int(res.valid)
                if res.ring_radius:
                    rings.append(res.ring_radius)
        finally:
            self.cancel(slot_key, x, y)
        result = ScanResult(grid, area, (w, h), rings)
        if log:
            log(f"Placement scan: {result.valid_fraction():.0%} of the map is placeable"
                + (f", unit range ≈ {result.ring_norm():.3f} of the width" if result.ring_norm() else ""))
        return result

    def measure_ring(self, slot: int, x: float, y: float) -> float | None:
        """Range of one unit (fraction of width), read from its ring."""
        slot_key = self.settings.get("keys.slots")[slot]
        self.backend.move(x + 60, y + 60)
        self.control.sleep(0.15)
        baseline = self.backend.capture()
        w = baseline.shape[1]
        self.backend.press(slot_key)
        self.control.sleep(0.3)
        try:
            self.backend.move(x, y)
            self.control.sleep(float(self.settings.get("timing.hover_delay", 0.09)) + 0.05)
            res = self.classifier.classify(baseline, self.backend.capture(), (x, y), max(16, int(0.05 * w)))
        finally:
            self.cancel(slot_key, x, y)
        return res.ring_radius / w if res.ring_radius else None

