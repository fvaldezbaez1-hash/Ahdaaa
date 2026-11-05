"""Learns where enemies walk by watching the screen.

Every frame is compared to the previous one; whatever moves inside the play
area adds heat. The first moment each spot moves in a wave tells how far
along the path it is (spawn = early, base = late), so the macro knows which
end is which without being told.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

ANALYSIS_WIDTH = 320


def analysis_size(width: int, height: int) -> tuple[int, int]:
    return ANALYSIS_WIDTH, max(1, int(round(height * ANALYSIS_WIDTH / width)))


def play_mask(shape: tuple[int, int], play_area_norm) -> np.ndarray:
    h, w = shape
    mask = np.zeros((h, w), bool)
    if play_area_norm:
        x, y, pw, ph = play_area_norm
        mask[int(y * h):int((y + ph) * h), int(x * w):int((x + pw) * w)] = True
    else:
        mask[:] = True
    return mask


@dataclass
class PathModel:
    mask: np.ndarray        # bool, analysis resolution
    heat: np.ndarray        # 0..1
    progress: np.ndarray    # 0 (spawn) .. 1 (base); NaN off-path

    @property
    def shape(self) -> tuple[int, int]:
        return self.mask.shape

    def coverage(self) -> float:
        return float(self.mask.mean())

    def samples(self, step: int = 2) -> np.ndarray:
        """Rows of (x, y, heat, progress) in analysis pixels."""
        ys, xs = np.nonzero(self.mask[::step, ::step])
        ys, xs = ys * step, xs * step
        prog = np.nan_to_num(self.progress[ys, xs], nan=0.5)
        return np.stack([xs, ys, self.heat[ys, xs], prog], axis=1).astype(np.float32)

    def save(self, path: Path) -> None:
        np.savez_compressed(path, mask=self.mask, heat=self.heat.astype(np.float16),
                            progress=self.progress.astype(np.float16))

    @staticmethod
    def load(path: Path) -> "PathModel | None":
        if not path.exists():
            return None
        d = np.load(path)
        return PathModel(d["mask"].astype(bool), d["heat"].astype(np.float32),
                         d["progress"].astype(np.float32))


class PathLearner:
    def __init__(self, frame_shape: tuple[int, int], play_area_norm=None,
                 diff_threshold: int = 18, quiet_gap: float = 4.0) -> None:
        h, w = frame_shape
        self.aw, self.ah = analysis_size(w, h)
        self.play = play_mask((self.ah, self.aw), play_area_norm)
        self.ignore = np.zeros((self.ah, self.aw), np.uint8)
        self.heat = np.zeros((self.ah, self.aw), np.float32)
        self.waves: list[np.ndarray] = []
        self.first_seen = np.full((self.ah, self.aw), np.inf, np.float32)
        self.prev: np.ndarray | None = None
        self.wave_start: float | None = None
        self.last_motion: float | None = None
        self.diff_threshold = diff_threshold
        self.quiet_gap = quiet_gap
        self.frames = 0
        self.motion_frames = 0

    # --- inputs ------------------------------------------------------
    def ignore_circle(self, x_norm: float, y_norm: float, r_norm: float) -> None:
        """Stop learning from a spot (e.g. our own unit's attack effects)."""
        cv2.circle(self.ignore, (int(x_norm * self.aw), int(y_norm * self.ah)),
                   max(1, int(r_norm * self.aw)), 1, -1)

    def begin_wave(self, t: float) -> None:
        self._commit()
        self.wave_start = t

    def _commit(self) -> None:
        if np.isfinite(self.first_seen).sum() > 20:
            self.waves.append(self.first_seen.copy())
            self.waves = self.waves[-12:]
        self.first_seen[:] = np.inf

    def feed(self, frame: np.ndarray, t: float) -> None:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
        small = cv2.resize(gray, (self.aw, self.ah), interpolation=cv2.INTER_AREA)
        small = cv2.GaussianBlur(small, (3, 3), 0)
        if self.prev is None:
            self.prev = small
            return
        diff = cv2.absdiff(small, self.prev) > self.diff_threshold
        self.prev = small
        self.frames += 1
        if diff.mean() > 0.25:
            return  # whole screen changed: camera move or a menu, not enemies
        diff &= self.play & (self.ignore == 0)
        diff = cv2.morphologyEx(diff.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)).astype(bool)
        if not diff.any():
            return
        if self.last_motion is not None and t - self.last_motion > self.quiet_gap:
            self.begin_wave(t)  # motion resumed after a quiet spell: new wave
        if self.wave_start is None:
            self.wave_start = t
        self.last_motion = t
        self.motion_frames += 1
        self.heat += diff
        newly = diff & np.isinf(self.first_seen)
        self.first_seen[newly] = t - self.wave_start

    # --- output ------------------------------------------------------
    def ready(self, min_motion_frames: int = 25) -> bool:
        return self.motion_frames >= min_motion_frames

    def result(self) -> PathModel | None:
        if self.heat.max() <= 0:
            return None
        waves = self.waves + ([self.first_seen] if np.isfinite(self.first_seen).sum() > 20 else [])
        heat = self.heat / self.heat.max()
        nz = heat[heat > 0]
        thr = max(0.06, 0.18 * float(np.percentile(nz, 99))) if nz.size else 1.0
        mask = (heat >= thr).astype(np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
        if n <= 1:
            return None
        biggest = stats[1:, cv2.CC_STAT_AREA].max()
        keep = np.zeros_like(mask, bool)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] >= max(12, 0.15 * biggest):
                keep |= labels == i
        progress = np.full(mask.shape, np.nan, np.float32)
        if waves:
            stack = np.stack(waves).astype(np.float32)
            stack[~np.isfinite(stack)] = np.nan
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                arrival = np.nanmedian(stack, axis=0) if len(waves) > 1 else stack[0]
            known = keep & np.isfinite(arrival)
            if known.sum() >= 5:
                vals = arrival[known]
                ranks = vals.argsort().argsort().astype(np.float32)
                progress[known] = ranks / max(1, len(vals) - 1)
                progress = _fill_along(progress, keep)
        return PathModel(keep, heat.astype(np.float32), progress)


def _fill_along(progress: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Fill path pixels that never got an arrival time from their neighbours."""
    known = np.isfinite(progress) & mask
    vals = np.where(known, progress, 0).astype(np.float32)
    weight = known.astype(np.float32)
    for k in (5, 11, 21, 41):
        num = cv2.blur(vals, (k, k))
        den = cv2.blur(weight, (k, k))
        fill = mask & ~np.isfinite(progress) & (den > 1e-3)
        progress[fill] = num[fill] / den[fill]
        if not (mask & ~np.isfinite(progress)).any():
            break
    return progress
