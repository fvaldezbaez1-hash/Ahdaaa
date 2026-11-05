"""Text recognition (OCR) and fuzzy text search.

Reading words instead of matching pixel templates is what lets the macro
survive window-size changes and small UI updates: it looks for the word
"Replay" wherever it is, at whatever size.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from typing import Iterable, Protocol

import numpy as np

from ..geometry import Rect

try:
    from rapidfuzz import fuzz
except ImportError:  # pragma: no cover
    fuzz = None


@dataclass(frozen=True)
class TextBox:
    text: str
    conf: float
    rect: Rect

    @property
    def center(self) -> tuple[int, int]:
        return self.rect.center

    @property
    def norm(self) -> str:
        return normalize(self.text)


def normalize(text: str) -> str:
    t = text.lower().replace("¥", "¥")
    t = re.sub(r"[^a-z0-9%+\-.¥$/ ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


_FOLD = [("rn", "m"), ("vv", "w"), ("cl", "d"), ("0", "o"), ("1", "l"), ("5", "s"), ("|", "l")]


def ocr_fold(text: str) -> str:
    """Undo the most common OCR letter confusions inside words."""
    words = []
    for w in text.split():
        if re.search(r"[a-z]", w):
            for src, dst in _FOLD:
                w = w.replace(src, dst)
        words.append(w)
    return " ".join(words)


def similarity(a: str, b: str) -> float:
    """0..100 similarity, tolerant of OCR noise and extra words."""
    a, b = normalize(a), normalize(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 100.0
    fa, fb = ocr_fold(a), ocr_fold(b)
    if (fa, fb) != (a, b):
        return max(_similarity(a, b), _similarity(fa, fb) * 0.99)
    return _similarity(a, b)


def _similarity(a: str, b: str) -> float:
    if a == b:
        return 100.0
    if fuzz is None:  # pragma: no cover
        return 98.0 if f" {b} " in f" {a} " or f" {a} " in f" {b} " else 0.0
    best = max(fuzz.ratio(a, b), fuzz.ratio(a.replace(" ", ""), b.replace(" ", "")))
    # Compare the shorter phrase against same-length runs of whole words in
    # the longer one, so "lobby" matches "Return to Lobby" but "next" does
    # not match "context".
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    sw, lw = shorter.split(), longer.split()
    n = len(sw)
    for i in range(len(lw) - n + 1):
        window = " ".join(lw[i:i + n])
        best = max(best, fuzz.ratio(shorter, window) * 0.98)
    return float(best)


class OcrEngine(Protocol):
    def read(self, image: np.ndarray) -> list[TextBox]:
        ...


class RapidOcrEngine:
    """RapidOCR (ONNX). Loaded on first use; thread-safe."""

    def __init__(self, min_confidence: float = 0.45, upscale_small: bool = True) -> None:
        self.min_confidence = min_confidence
        self.upscale_small = upscale_small
        self._engine = None
        self._lock = threading.Lock()

    def _get(self):
        if self._engine is None:
            from rapidocr_onnxruntime import RapidOCR

            self._engine = RapidOCR()
        return self._engine

    def read(self, image: np.ndarray) -> list[TextBox]:
        if image is None or image.size == 0:
            return []
        scale = 1.0
        img = image
        if self.upscale_small and min(image.shape[:2]) < 64:
            import cv2

            scale = 64.0 / min(image.shape[:2])
            img = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        with self._lock:
            result, _ = self._get()(img)
        boxes: list[TextBox] = []
        for item in result or []:
            pts, text, conf = item[0], str(item[1]), float(item[2])
            if conf < self.min_confidence or not text.strip():
                continue
            pts = [(p[0] / scale, p[1] / scale) for p in pts]
            boxes.append(TextBox(text.strip(), conf, Rect.bounding(pts)))
        return boxes


class NullOcr:
    """Used when OCR is unavailable: sees no text."""

    def read(self, image: np.ndarray) -> list[TextBox]:
        return []


def make_engine(settings=None) -> OcrEngine:
    min_conf = settings.get("ocr.min_confidence", 0.45) if settings else 0.45
    upscale = settings.get("ocr.upscale_small", True) if settings else True
    try:
        import rapidocr_onnxruntime  # noqa: F401
    except ImportError:
        return NullOcr()
    return RapidOcrEngine(min_conf, upscale)


# --- searching -----------------------------------------------------------
@dataclass(frozen=True)
class TextHit:
    box: TextBox
    query: str
    score: float


def merge_lines(boxes: list[TextBox], gap: float = 0.8) -> list[TextBox]:
    """Join boxes that sit on the same line close together ("Return" "to"
    "Lobby" -> "Return to Lobby"), keeping the originals too."""
    out = list(boxes)
    # 1) group into rows by vertical centre
    rows: list[list[TextBox]] = []
    for b in sorted(boxes, key=lambda b: b.rect.center[1]):
        for row in rows:
            ref = row[0]
            if abs(b.rect.center[1] - ref.rect.center[1]) < max(ref.rect.h, b.rect.h) * 0.6:
                row.append(b)
                break
        else:
            rows.append([b])
    # 2) inside each row, chain neighbours left to right
    for row in rows:
        row.sort(key=lambda b: b.rect.x)
        line = [row[0]]
        for b in row[1:] + [None]:
            last = line[-1]
            if b is not None and 0 <= b.rect.x - last.rect.right < max(last.rect.h, b.rect.h) * (gap + 1.5):
                line.append(b)
                continue
            if len(line) > 1:
                pts = []
                for item in line:
                    pts += [(item.rect.x, item.rect.y), (item.rect.right, item.rect.bottom)]
                out.append(TextBox(" ".join(item.text for item in line),
                                   min(item.conf for item in line), Rect.bounding(pts)))
            if b is not None:
                line = [b]
    return out


def find_text(boxes: Iterable[TextBox], queries: Iterable[str] | str,
              threshold: float = 80.0, region: Rect | None = None) -> TextHit | None:
    """Best match for any of the queries, or None."""
    if isinstance(queries, str):
        queries = [queries]
    queries = [q for q in queries if q]
    best: TextHit | None = None
    for box in boxes:
        if region and not region.contains(*box.center):
            continue
        for q in queries:
            s = similarity(box.text, q)
            if s >= threshold and (best is None or s > best.score or
                                   (s == best.score and len(box.norm) < len(best.box.norm))):
                best = TextHit(box, q, s)
    return best


def find_all(boxes: Iterable[TextBox], queries: Iterable[str], threshold: float = 80.0) -> list[TextHit]:
    hits = []
    for box in boxes:
        scored = [(similarity(box.text, q), q) for q in queries if q]
        if scored:
            s, q = max(scored)
            if s >= threshold:
                hits.append(TextHit(box, q, s))
    return hits


_NUM = re.compile(r"(\d[\d,. ]*)\s*([kKmMbB]?)")


def parse_number(text: str) -> int | None:
    """'¥12,345' -> 12345, '1.2K' -> 1200, 'Wave 12' -> 12."""
    t = text.replace("O", "0").replace("o", "0") if re.search(r"\d", text) else text
    m = _NUM.search(t)
    if not m:
        return None
    raw, suffix = m.group(1).strip(), m.group(2).lower()
    mult = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}.get(suffix, 1)
    if mult > 1:
        try:
            return int(float(raw.replace(",", "").replace(" ", "")) * mult)
        except ValueError:
            return None
    digits = re.sub(r"[^\d]", "", raw)
    return int(digits) if digits else None
