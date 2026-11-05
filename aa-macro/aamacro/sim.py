"""A tiny fake tower-defense map used by the tests and the demo.

It draws a textured map with a winding path, enemies walking along it, and
the placement ghost (green when placeable, red when not) at the cursor
while a unit is selected. Nothing here touches Roblox.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

DEFAULT_PATH = [(0.02, 0.30), (0.40, 0.30), (0.40, 0.70), (0.72, 0.70), (0.72, 0.28), (0.98, 0.28)]


class SimMap:
    def __init__(self, width: int = 1280, height: int = 720, seed: int = 0,
                 path=None, play_area=(0.03, 0.10, 0.94, 0.72)) -> None:
        self.w, self.h = width, height
        self.rng = np.random.default_rng(seed)
        self.path = [(x * width, y * height) for x, y in (path or DEFAULT_PATH)]
        self.path_width = 0.035 * width
        self.play_area = play_area
        self.water = (int(0.08 * width), int(0.55 * height), int(0.22 * width), int(0.18 * height))
        self.range_px = int(0.11 * width)
        self.background = self._draw_background()
        seg = [math.dist(a, b) for a, b in zip(self.path, self.path[1:])]
        self.seg = seg
        self.length = sum(seg)
        self.enemy_speed = 0.12   # path lengths per second
        self.spawn_every = 0.8

    def _draw_background(self) -> np.ndarray:
        noise = self.rng.integers(30, 110, (self.h // 8, self.w // 8, 3), dtype=np.uint8)
        img = cv2.resize(noise, (self.w, self.h), interpolation=cv2.INTER_CUBIC)
        img = cv2.GaussianBlur(img, (5, 5), 0)
        img[..., 1] = np.clip(img[..., 1].astype(int) + 50, 0, 255)  # grassy
        for _ in range(60):  # rocks/trees: texture for alignment
            x, y = int(self.rng.integers(0, self.w)), int(self.rng.integers(0, self.h))
            r = int(self.rng.integers(4, 14))
            color = tuple(int(c) for c in self.rng.integers(10, 200, 3))
            cv2.circle(img, (x, y), r, color, -1)
        x, y, w, h = self.water
        cv2.rectangle(img, (x, y), (x + w, y + h), (160, 90, 30), -1)
        pts = np.array(self.path, np.int32)
        cv2.polylines(img, [pts], False, (70, 110, 150), int(self.path_width))
        # HUD bars (not part of the play area)
        cv2.rectangle(img, (0, 0), (self.w, int(0.08 * self.h)), (25, 25, 25), -1)
        cv2.rectangle(img, (0, int(0.86 * self.h)), (self.w, self.h), (25, 25, 25), -1)
        return img

    def point_at(self, s: float) -> tuple[float, float]:
        d = max(0.0, min(1.0, s)) * self.length
        for (a, b), L in zip(zip(self.path, self.path[1:]), self.seg):
            if d <= L:
                f = d / L if L else 0
                return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
            d -= L
        return self.path[-1]

    def dist_to_path(self, x: float, y: float) -> float:
        best = 1e9
        for a, b in zip(self.path, self.path[1:]):
            ax, ay = a
            bx, by = b
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy or 1.0
            t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
            best = min(best, math.hypot(x - (ax + t * dx), y - (ay + t * dy)))
        return best

    def valid_at(self, x: float, y: float) -> bool:
        px, py, pw, ph = self.play_area
        if not (px * self.w <= x <= (px + pw) * self.w and py * self.h <= y <= (py + ph) * self.h):
            return False
        wx, wy, ww, wh = self.water
        if wx <= x <= wx + ww and wy <= y <= wy + wh:
            return False
        return self.dist_to_path(x, y) > self.path_width * 0.75

    def in_ghost_area(self, x: float, y: float) -> bool:
        px, py, pw, ph = self.play_area
        return px * self.w <= x <= (px + pw) * self.w and py * self.h <= y <= (py + ph) * self.h

    def render(self, t: float, cursor=None, selected: bool = False, units=()) -> np.ndarray:
        img = self.background.copy()
        n = int(t / self.spawn_every) + 1
        for i in range(n):
            s = (t - i * self.spawn_every) * self.enemy_speed
            if 0 <= s <= 1:
                x, y = self.point_at(s)
                cv2.circle(img, (int(x), int(y)), 9, (40, 40, 200), -1)
        for ux, uy in units:
            cv2.rectangle(img, (int(ux) - 8, int(uy) - 8), (int(ux) + 8, int(uy) + 8), (230, 200, 40), -1)
        if selected and cursor is not None and self.in_ghost_area(*cursor):
            cx, cy = int(cursor[0]), int(cursor[1])
            ok = self.valid_at(cx, cy)
            cv2.circle(img, (cx, cy), 14, (60, 210, 60) if ok else (40, 40, 230), -1)
            cv2.circle(img, (cx, cy), self.range_px, (255, 255, 255), 2)
        return img


class SimGameBackend:
    """Wraps SimMap as a FakeBackend whose picture reacts to input."""

    def __init__(self, sim: SimMap, slot_keys=("1", "2", "3", "4", "5", "6")) -> None:
        from .platform.fake import FakeBackend

        self.sim = sim
        self.t = 0.0
        self.selected: str | None = None
        self.slot_keys = set(slot_keys)
        self.units: list[tuple[float, float]] = []
        self.backend = FakeBackend(self.frame)
        self.backend.listeners.append(self._on_action)

    def frame(self) -> np.ndarray:
        return self.sim.render(self.t, self.backend.cursor, self.selected is not None, self.units)

    def _on_action(self, action: tuple) -> None:
        kind = action[0]
        if kind == "press" and action[1] in self.slot_keys:
            self.selected = None if self.selected == action[1] else action[1]
        elif kind == "click" and action[1] == "left" and self.selected:
            x, y = action[2], action[3]
            if self.sim.valid_at(x, y):
                self.units.append((x, y))
            self.selected = None
        elif kind == "click" and action[1] == "right":
            self.selected = None
