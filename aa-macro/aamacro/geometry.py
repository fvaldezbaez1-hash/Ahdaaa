"""Small geometry helpers. All on-screen positions inside the game are in
pixels of the captured Roblox client area (top-left = 0,0)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    w: int
    h: int

    @property
    def center(self) -> tuple[int, int]:
        return (self.x + self.w // 2, self.y + self.h // 2)

    @property
    def right(self) -> int:
        return self.x + self.w

    @property
    def bottom(self) -> int:
        return self.y + self.h

    @property
    def area(self) -> int:
        return max(0, self.w) * max(0, self.h)

    def contains(self, px: float, py: float) -> bool:
        return self.x <= px < self.right and self.y <= py < self.bottom

    def clamp(self, width: int, height: int) -> "Rect":
        x = min(max(self.x, 0), max(width - 1, 0))
        y = min(max(self.y, 0), max(height - 1, 0))
        r = min(max(self.right, x + 1), width)
        b = min(max(self.bottom, y + 1), height)
        return Rect(x, y, r - x, b - y)

    def expand(self, px: int) -> "Rect":
        return Rect(self.x - px, self.y - px, self.w + 2 * px, self.h + 2 * px)

    def iou(self, other: "Rect") -> float:
        ix = max(0, min(self.right, other.right) - max(self.x, other.x))
        iy = max(0, min(self.bottom, other.bottom) - max(self.y, other.y))
        inter = ix * iy
        union = self.area + other.area - inter
        return inter / union if union else 0.0

    def to_norm(self, width: int, height: int) -> list[float]:
        return [self.x / width, self.y / height, self.w / width, self.h / height]

    @staticmethod
    def from_norm(norm, width: int, height: int) -> "Rect":
        x, y, w, h = norm
        return Rect(int(round(x * width)), int(round(y * height)),
                    max(1, int(round(w * width))), max(1, int(round(h * height))))

    @staticmethod
    def bounding(points) -> "Rect":
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        x0, y0 = int(min(xs)), int(min(ys))
        return Rect(x0, y0, int(max(xs)) - x0 + 1, int(max(ys)) - y0 + 1)
