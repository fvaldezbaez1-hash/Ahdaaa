"""Image templates the user captures from their own game (optional extra to
OCR for buttons that have no text, e.g. an icon)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .. import paths
from ..geometry import Rect


@dataclass(frozen=True)
class Match:
    name: str
    rect: Rect
    score: float

    @property
    def center(self) -> tuple[int, int]:
        return self.rect.center


class TemplateStore:
    def __init__(self, folder: Path | None = None) -> None:
        self.folder = folder or paths.templates_dir()
        self._cache: dict[str, tuple[np.ndarray, int]] = {}

    def names(self) -> list[str]:
        return sorted(p.stem for p in self.folder.glob("*.png"))

    def save(self, name: str, image: np.ndarray, captured_width: int) -> Path:
        name = paths.safe_name(name)
        path = self.folder / f"{name}.png"
        cv2.imwrite(str(path), image)
        (self.folder / f"{name}.json").write_text(json.dumps({"width": captured_width}))
        self._cache.pop(name, None)
        return path

    def delete(self, name: str) -> None:
        for ext in (".png", ".json"):
            (self.folder / f"{name}{ext}").unlink(missing_ok=True)
        self._cache.pop(name, None)

    def _load(self, name: str) -> tuple[np.ndarray, int] | None:
        if name in self._cache:
            return self._cache[name]
        path = self.folder / f"{name}.png"
        if not path.exists():
            return None
        img = cv2.imread(str(path), cv2.IMREAD_COLOR)
        meta = self.folder / f"{name}.json"
        width = 1280
        if meta.exists():
            try:
                width = int(json.loads(meta.read_text()).get("width", 1280))
            except (ValueError, json.JSONDecodeError):
                pass
        self._cache[name] = (img, width)
        return self._cache[name]

    def find(self, frame: np.ndarray, name: str, threshold: float = 0.82,
             region: Rect | None = None) -> Match | None:
        loaded = self._load(name)
        if loaded is None:
            return None
        tpl, captured_width = loaded
        return match_template(frame, tpl, name, captured_width, threshold, region)


def match_template(frame: np.ndarray, tpl: np.ndarray, name: str = "",
                   captured_width: int | None = None, threshold: float = 0.82,
                   region: Rect | None = None) -> Match | None:
    """Multi-scale template match around the expected scale."""
    if frame is None or tpl is None:
        return None
    h, w = frame.shape[:2]
    ox = oy = 0
    if region:
        r = region.clamp(w, h)
        frame = frame[r.y:r.bottom, r.x:r.right]
        ox, oy = r.x, r.y
    base = (w / captured_width) if captured_width else 1.0
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    tgray = cv2.cvtColor(tpl, cv2.COLOR_BGR2GRAY)
    best: Match | None = None
    for factor in (1.0, 0.94, 1.06, 0.88, 1.12):
        s = base * factor
        tw, th = int(round(tgray.shape[1] * s)), int(round(tgray.shape[0] * s))
        if tw < 6 or th < 6 or tw > gray.shape[1] or th > gray.shape[0]:
            continue
        t = cv2.resize(tgray, (tw, th), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
        res = cv2.matchTemplate(gray, t, cv2.TM_CCOEFF_NORMED)
        _, score, _, loc = cv2.minMaxLoc(res)
        if score >= threshold and (best is None or score > best.score):
            best = Match(name, Rect(loc[0] + ox, loc[1] + oy, tw, th), float(score))
        if best and best.score > 0.95:
            break
    return best
