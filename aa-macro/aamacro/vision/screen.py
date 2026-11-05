"""Takes screenshots, reads them, and works out which screen the game is on."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable

import numpy as np

from ..geometry import Rect
from .ocr import NullOcr, OcrEngine, TextBox, TextHit, find_all, find_text, merge_lines, parse_number
from .templates import TemplateStore


class State(str, Enum):
    UNKNOWN = "unknown"
    DISCONNECTED = "disconnected"
    LOBBY = "lobby"
    VOTE = "vote"
    MATCH = "match"
    CARDS = "cards"
    VICTORY = "victory"
    DEFEAT = "defeat"


@dataclass
class Snapshot:
    image: np.ndarray
    boxes: list[TextBox] = field(default_factory=list)
    taken: float = field(default_factory=time.monotonic)

    @property
    def width(self) -> int:
        return self.image.shape[1]

    @property
    def height(self) -> int:
        return self.image.shape[0]

    def find(self, queries, threshold: float = 80.0, region: Rect | None = None) -> TextHit | None:
        return find_text(self.boxes, queries, threshold, region)

    def find_all(self, queries, threshold: float = 80.0) -> list[TextHit]:
        return find_all(self.boxes, queries, threshold)

    def text(self) -> str:
        return " | ".join(b.text for b in self.boxes)


WAVE_RE = re.compile(r"wave\s*[:#]?\s*(\d{1,4})", re.I)
YEN_RE = re.compile(r"(?:¥|\$|yen)\s*([\d][\d,.]*\s*[kKmM]?)|([\d][\d,.]*\s*[kKmM]?)\s*(?:¥|yen)", re.I)


class ScreenReader:
    def __init__(self, backend, ocr: OcrEngine | None, settings,
                 templates: TemplateStore | None = None) -> None:
        self.backend = backend
        self.ocr = ocr or NullOcr()
        self.settings = settings
        self.templates = templates
        self.card_detector: Callable[[Snapshot], int] | None = None
        self.last: Snapshot | None = None

    # --- capture -----------------------------------------------------
    def snap(self, read_text: bool = True) -> Snapshot:
        img = self.backend.capture()
        boxes = merge_lines(self.ocr.read(img)) if read_text else []
        self.last = Snapshot(img, boxes)
        return self.last

    def read_region(self, image: np.ndarray, norm_rect) -> list[TextBox]:
        h, w = image.shape[:2]
        r = Rect.from_norm(norm_rect, w, h).clamp(w, h)
        boxes = self.ocr.read(image[r.y:r.bottom, r.x:r.right])
        return [TextBox(b.text, b.conf, Rect(b.rect.x + r.x, b.rect.y + r.y, b.rect.w, b.rect.h))
                for b in boxes]

    # --- classification ----------------------------------------------
    def classify(self, snap: Snapshot) -> State:
        s = self.settings
        if snap.find(s.words("disconnect"), 85):
            return State.DISCONNECTED
        buttons = s.words("replay") + s.words("next") + s.words("lobby")
        has_buttons = bool(snap.find(buttons, 85))
        if snap.find(s.words("victory"), 85) and has_buttons:
            return State.VICTORY
        if snap.find(s.words("defeat"), 85) and has_buttons:
            return State.DEFEAT
        if self.card_detector and self.card_detector(snap) >= 2:
            return State.CARDS
        if snap.find(s.words("vote"), 88) and snap.find(["vote"], 85):
            return State.VOTE
        if self.read_wave(snap) is not None or len(snap.find_all(s.words("match_marks"), 88)) >= 2:
            return State.MATCH
        if len(snap.find_all(s.words("lobby_marks"), 85)) >= 2:
            return State.LOBBY
        if snap.find(s.words("vote"), 90):
            return State.VOTE
        return State.UNKNOWN

    # --- HUD numbers -------------------------------------------------
    def read_wave(self, snap: Snapshot) -> int | None:
        region = self.settings.get("hud.wave_region")
        boxes = self.read_region(snap.image, region) if region else snap.boxes
        for b in boxes:
            m = WAVE_RE.search(b.text)
            if m:
                return int(m.group(1))
        return None

    def read_yen(self, snap: Snapshot, region=None) -> int | None:
        region = region or self.settings.get("hud.yen_region")
        boxes = self.read_region(snap.image, region) if region else snap.boxes
        best = None
        for b in boxes:
            m = YEN_RE.search(b.text)
            if m:
                value = parse_number(m.group(1) or m.group(2))
                if value is not None and (best is None or b.conf > best[1]):
                    best = (value, b.conf)
        if best is None and region:
            # Inside a dedicated region any number is the yen amount.
            for b in boxes:
                value = parse_number(b.text)
                if value is not None:
                    return value
        return best[0] if best else None

    # --- templates ---------------------------------------------------
    def find_template(self, snap: Snapshot, name: str, threshold: float = 0.82):
        if not self.templates:
            return None
        return self.templates.find(snap.image, name, threshold)
