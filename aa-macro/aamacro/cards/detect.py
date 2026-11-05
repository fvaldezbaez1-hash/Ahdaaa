"""Finds the cards on a "pick one" screen.

Two independent methods, so it keeps working when the game restyles cards:
1. Shapes: same-sized rectangles lined up in a row.
2. Text columns: blocks of text side by side (each card = one column).
"""

from __future__ import annotations

import cv2
import numpy as np

from ..geometry import Rect
from ..vision.ocr import TextBox, find_text
from .data import DUNGEON_ROOMS, KNOWN_CARDS
from .effects import parse_effects
from .scoring import Card


def find_card_rects(image: np.ndarray) -> list[Rect]:
    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 40, 120)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    frame_area = w * h
    cands: list[Rect] = []
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        area = cw * ch
        if not (0.015 * frame_area <= area <= 0.30 * frame_area):
            continue
        aspect = ch / max(cw, 1)
        if not (0.55 <= aspect <= 2.8):
            continue
        # must look like a filled box outline, not a random blob
        if cv2.contourArea(cv2.convexHull(c)) < 0.75 * area:
            continue
        r = Rect(x, y, cw, ch)
        if any(r.iou(o) > 0.7 for o in cands):
            continue
        cands.append(r)
    # Drop boxes that contain another candidate (outer frames / panels).
    cands = [r for r in cands if not any(
        o is not r and o.area < r.area * 0.8 and r.contains(*o.center) and o.w > r.w * 0.6 for o in cands)]
    best: list[Rect] = []
    for r in cands:
        group = [o for o in cands
                 if abs(o.w - r.w) <= 0.15 * r.w and abs(o.h - r.h) <= 0.15 * r.h
                 and abs(o.center[1] - r.center[1]) <= 0.12 * r.h]
        # no overlaps inside a row of cards
        row: list[Rect] = []
        for o in sorted(group, key=lambda o: o.x):
            if not row or o.x >= row[-1].right - 0.05 * r.w:
                row.append(o)
        if len(row) >= 2 and (len(row), sum(o.area for o in row)) > (len(best), sum(o.area for o in best)):
            best = row
    return best[:6]


def _text_in(boxes: list[TextBox], rect: Rect) -> list[TextBox]:
    inside = [b for b in boxes if rect.contains(*b.center)]
    # Keep only original OCR boxes (merged lines duplicate words).
    singles = [b for b in inside if not any(o is not b and o.rect.area > b.rect.area
                                            and o.text.startswith(b.text) and o.text != b.text
                                            for o in inside)]
    return sorted(singles or inside, key=lambda b: (b.rect.y, b.rect.x))


def _make_card(rect: Rect, boxes: list[TextBox]) -> Card:
    lines = _text_in(boxes, rect)
    title = ""
    if lines:
        # Title: the tallest text in the top half, else the first line.
        top = [b for b in lines if b.rect.center[1] < rect.y + rect.h * 0.55] or lines
        title_box = max(top, key=lambda b: (b.rect.h, -b.rect.y))
        title = title_box.text
        body = [b.text for b in lines if b is not title_box]
    else:
        body = []
    return Card(title=title, text=" ".join(body) or title, center=rect.center, rect=rect)


def cards_from_columns(boxes: list[TextBox], width: int, height: int) -> list[Card]:
    """Group text into side-by-side columns."""
    area = [b for b in boxes if 0.08 * height < b.center[1] < 0.92 * height]
    if len(area) < 4:
        return []
    area.sort(key=lambda b: b.center[0])
    columns: list[list[TextBox]] = [[area[0]]]
    for b in area[1:]:
        prev = columns[-1]
        prev_right = max(o.rect.right for o in prev)
        if b.rect.x - prev_right > 0.025 * width and b.center[0] - np.mean([o.center[0] for o in prev]) > 0.08 * width:
            columns.append([b])
        else:
            prev.append(b)
    columns = [c for c in columns if len(c) >= 2]
    if not 2 <= len(columns) <= 6:
        return []
    cards = []
    for col in columns:
        pts = []
        for b in col:
            pts += [(b.rect.x, b.rect.y), (b.rect.right, b.rect.bottom)]
        cards.append(_make_card(Rect.bounding(pts).expand(4), col))
    # Real card rows have similar vertical extents.
    tops = [c.rect.y for c in cards]
    if max(tops) - min(tops) > 0.25 * height:
        return []
    return cards


def card_confidence(card: Card) -> bool:
    """Does this look like a real card (not random UI text)?"""
    full = f"{card.title} {card.text}"
    if parse_effects(card.text or card.title):
        return True
    names = list(KNOWN_CARDS) + DUNGEON_ROOMS
    return find_text([TextBox(card.title, 1.0, Rect(0, 0, 1, 1))], names, 88) is not None or \
        any(n.lower() in full.lower() for n in names if len(n) >= 5)


def find_cards(image: np.ndarray, boxes: list[TextBox], prompt_words: list[str] | None = None,
               columns_fallback: int = 3) -> list[Card]:
    h, w = image.shape[:2]
    prompted = bool(prompt_words and find_text(boxes, prompt_words, 85))
    rects = find_card_rects(image)
    cards = [_make_card(r, boxes) for r in rects]
    if len(cards) >= 2 and (prompted or sum(card_confidence(c) for c in cards) >= 2):
        return cards
    cards = cards_from_columns(boxes, w, h)
    if len(cards) >= 2 and (prompted or sum(card_confidence(c) for c in cards) >= 2):
        return cards
    if prompted and columns_fallback >= 2:
        # Last resort: split the middle of the screen into equal columns.
        n = columns_fallback
        top, bottom = int(h * 0.2), int(h * 0.85)
        left, right = int(w * 0.1), int(w * 0.9)
        cw = (right - left) // n
        rects = [Rect(left + i * cw, top, cw, bottom - top) for i in range(n)]
        cards = [_make_card(r, boxes) for r in rects]
        if sum(1 for c in cards if c.title) >= 2:
            return cards
    return []
