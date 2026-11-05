"""Chooses where each unit goes.

Damage units go where their range ring covers the most path (weighted by
the chosen strategy), with diminishing returns so they don't all stack on
one corner. Farm units go where they waste no good spots. Support units go
next to the damage units they buff.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .path import PathModel

STRATEGIES = ("balanced", "front", "back", "spread")


@dataclass
class UnitSpec:
    slot: int               # 0-based hotbar slot
    role: str               # dps | farm | support
    count: int
    range_norm: float       # range as a fraction of the window width
    priority: int = 1


@dataclass
class Spot:
    slot: int
    x: float                # fraction of window width
    y: float                # fraction of window height
    role: str
    coverage: float = 0.0

    def to_dict(self) -> dict:
        return {"slot": self.slot, "x": round(self.x, 4), "y": round(self.y, 4),
                "role": self.role, "coverage": round(self.coverage, 3)}

    @staticmethod
    def from_dict(d: dict) -> "Spot":
        return Spot(int(d["slot"]), float(d["x"]), float(d["y"]), d.get("role", "dps"),
                    float(d.get("coverage", 0.0)))


def _weights(samples: np.ndarray, strategy: str) -> np.ndarray:
    heat = np.clip(samples[:, 2], 0.05, 1.0)
    prog = samples[:, 3]
    if strategy == "front":
        return heat * (1.6 - prog)
    if strategy == "back":
        return heat * (0.4 + prog)
    return heat.copy()


def candidate_points(shape: tuple[int, int], valid: np.ndarray | None, path_mask: np.ndarray,
                     clearance: int, step: int = 3, avoid=(), avoid_r: float = 4.0,
                     play: np.ndarray | None = None) -> np.ndarray:
    import cv2

    h, w = shape
    if valid is not None:
        ok = valid.copy()
    else:
        # No scan yet: assume anything not on (or right next to) the path is fine.
        grown = cv2.dilate(path_mask.astype(np.uint8), np.ones((2 * clearance + 1,) * 2, np.uint8))
        ok = grown == 0
        if play is not None:
            ok &= play
    # stay inside the image so clicks don't land on the window border
    ok[:4, :] = ok[-4:, :] = False
    ok[:, :4] = ok[:, -4:] = False
    ys, xs = np.nonzero(ok[::step, ::step])
    pts = np.stack([xs * step, ys * step], axis=1).astype(np.float32)
    for ax, ay in avoid:
        if len(pts) == 0:
            break
        d = np.hypot(pts[:, 0] - ax * w, pts[:, 1] - ay * h)
        pts = pts[d > avoid_r]
    return pts


def choose_spots(path: PathModel, units: list[UnitSpec], strategy: str = "balanced",
                 valid: np.ndarray | None = None, min_spacing: float = 0.035,
                 avoid=(), play: np.ndarray | None = None) -> list[Spot]:
    h, w = path.shape
    samples = path.samples(step=2)
    spacing = max(2.0, min_spacing * w)
    cands = candidate_points((h, w), valid, path.mask, clearance=int(spacing * 0.5),
                             avoid=avoid, avoid_r=spacing, play=play)
    if len(cands) == 0 or len(samples) == 0:
        return []
    weights = _weights(samples, strategy)
    decay = 0.35 if strategy == "spread" else 0.72
    taken = np.zeros(len(cands), bool)
    spots: list[Spot] = []
    cov_cache: dict[int, np.ndarray] = {}

    def coverage_matrix(r_px: float) -> np.ndarray:
        key = int(round(r_px))
        if key not in cov_cache:
            dx = cands[:, None, 0] - samples[None, :, 0]
            dy = cands[:, None, 1] - samples[None, :, 1]
            cov_cache[key] = (dx * dx + dy * dy) <= r_px * r_px
        return cov_cache[key]

    def take(i: int) -> None:
        taken[i] = True
        d = np.hypot(cands[:, 0] - cands[i, 0], cands[:, 1] - cands[i, 1])
        taken[d < spacing] = True

    order = sorted(units, key=lambda u: (u.role != "dps", u.priority, u.slot))
    for unit in order:
        if unit.role == "skip" or unit.count <= 0:
            continue
        r_px = max(4.0, unit.range_norm * w)
        cov = coverage_matrix(r_px)
        for _ in range(unit.count):
            free = ~taken
            if not free.any():
                break
            if unit.role == "farm":
                raw = cov.sum(axis=1).astype(np.float32)
                center_d = np.hypot(cands[:, 0] - w / 2, cands[:, 1] - h / 2) / w
                score = -(raw + center_d)
            elif unit.role == "support":
                dps = [s for s in spots if s.role == "dps"]
                near = np.zeros(len(cands), np.float32)
                for s in dps:
                    d = np.hypot(cands[:, 0] - s.x * w, cands[:, 1] - s.y * h)
                    near += (d <= r_px).astype(np.float32)
                score = near * 1000 + cov.astype(np.float32) @ weights
            else:
                score = cov.astype(np.float32) @ weights
            score = np.where(free, score, -np.inf)
            i = int(np.argmax(score))
            if not np.isfinite(score[i]):
                break
            covered = float(cov[i].astype(np.float32) @ np.ones(len(samples), np.float32)) / len(samples)
            spots.append(Spot(unit.slot, float(cands[i, 0] / w), float(cands[i, 1] / h), unit.role, covered))
            if unit.role == "dps":
                weights = np.where(cov[i], weights * decay, weights)
            take(i)
    return spots
