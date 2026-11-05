import cv2
import numpy as np
import pytest

from aamacro.cards import CardPicker, choose, parse_effects
from aamacro.cards.detect import cards_from_columns, find_card_rects
from aamacro.cards.scoring import Card
from aamacro.config import Settings
from aamacro.vision.ocr import merge_lines
from aamacro.vision.screen import Snapshot

from .conftest import box


@pytest.mark.parametrize("text,expected", [
    ("-25% enemy speed", {"enemy_speed": -25}),
    ("+100% SummerPearls, +50% enemy speed, +50% enemy health",
     {"reward": 100, "enemy_speed": 50, "enemy_health": 50}),
    ("-15% placement/upgrade cost", {"cost": -15}),
    ("Units deal 20% more damage", {"unit_damage": 20}),
    ("Enemies have 30% more HP and move 10% slower", {"enemy_health": 30, "enemy_speed": -10}),
    ("Reduce cooldown by 15%", {"unit_cooldown": -15}),
    ("x2 Gems", {"reward": 100}),
    ("Increase unit range by 10%", {"unit_range": 10}),
    ("Enemies take 25% less damage", {"enemy_damage": -25}),
])
def test_parse_effects(text, expected):
    assert parse_effects(text) == pytest.approx(expected)


def rules(**kw):
    r = Settings().get("cards")
    r.update(kw)
    return r


SUMMER = [
    Card("Low Tide", "-25% enemy speed", (100, 300)),
    Card("Rising Tide", "+50% SummerPearls +50% enemy health", (300, 300)),
    Card("Tsunami", "+100% SummerPearls, +50% enemy speed, +50% enemy health", (500, 300)),
]


def test_greed_changes_pick():
    assert choose(SUMMER, rules(greed=0.5))[0].card.title == "Low Tide"
    assert choose(SUMMER, rules(greed=1.0))[0].card.title == "Tsunami"
    assert choose(SUMMER, rules(greed=0.0))[0].card.title == "Low Tide"


def test_known_cards_fix_bad_ocr_text():
    cards = [Card("Tsunarni", "+1OO% Summer...", (0, 0)), Card("Low Tide", "", (0, 0))]
    best, ranked = choose(cards, rules(greed=1.0))
    assert ranked[0].known in ("Tsunami", "Low Tide")
    assert {r.known for r in ranked} == {"Tsunami", "Low Tide"}


def test_must_and_never():
    best, _ = choose(SUMMER, rules(greed=0.5, must_pick=["Rising Tide"]))
    assert best.card.title == "Rising Tide"
    best, _ = choose(SUMMER, rules(greed=0.5, never_pick=["Low Tide"]))
    assert best.card.title != "Low Tide"
    # everything banned: still picks the least bad one
    best, _ = choose(SUMMER, rules(greed=0.5, never_pick=["Low Tide", "Rising Tide", "Tsunami"]))
    assert best.card.title == "Low Tide"


def test_dungeon_rooms_and_curses():
    rooms = [Card("Shop", "", (0, 0)), Card("Rare Chest", "", (0, 0)), Card("Boss", "", (0, 0))]
    assert choose(rooms, rules())[0].card.title == "Rare Chest"
    custom = rules(room_priority=["Boss", "Shop", "Rare Chest"])
    assert choose(rooms, custom)[0].card.title == "Boss"
    curse = [Card("Curse", "Curse of Haste: enemies 40% faster", (0, 0)), Card("Shrine", "", (0, 0))]
    r = rules(room_priority=["Curse", "Shrine"], avoid_curses=["Curse of Haste"])
    assert choose(curse, r)[0].card.title == "Shrine"


def _card_image(titles_and_text, size=(1280, 720), boxes=True):
    img = np.full((size[1], size[0], 3), (40, 30, 25), np.uint8)
    n = len(titles_and_text)
    cw, ch = 300, 400
    gap = (size[0] - n * cw) // (n + 1)
    rects = []
    for i, (title, text) in enumerate(titles_and_text):
        x = gap + i * (cw + gap)
        y = 170
        if boxes:
            cv2.rectangle(img, (x, y), (x + cw, y + ch), (90, 70, 160), -1)
            cv2.rectangle(img, (x, y), (x + cw, y + ch), (230, 230, 230), 3)
        cv2.putText(img, title, (x + 20, y + 70), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (255, 255, 255), 2)
        for j, line in enumerate(text):
            cv2.putText(img, line, (x + 20, y + 150 + j * 45), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (240, 240, 240), 2)
        rects.append((x, y, cw, ch))
    cv2.putText(img, "Choose a card", (480, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 2)
    return img, rects


SUMMER_LINES = [
    ("Low Tide", ["-25% enemy speed"]),
    ("Rising Tide", ["+50% SummerPearls", "+50% enemy health"]),
    ("Tsunami", ["+100% SummerPearls", "+50% enemy speed", "+50% enemy health"]),
]


def test_find_card_rects():
    img, rects = _card_image(SUMMER_LINES)
    found = find_card_rects(img)
    assert len(found) == 3
    for r, (x, y, w, h) in zip(found, rects):
        assert abs(r.x - x) < 8 and abs(r.w - w) < 12


def test_columns_without_boxes():
    boxes = [box("Low Tide", 100, 250, 150, 30), box("-25% enemy speed", 100, 330, 200, 22),
             box("Rising Tide", 520, 250, 170, 30), box("+50% SummerPearls", 520, 330, 200, 22),
             box("Tsunami", 930, 250, 130, 30), box("+100% SummerPearls", 930, 330, 210, 22)]
    cards = cards_from_columns(boxes, 1280, 720)
    assert [c.title for c in cards] == ["Low Tide", "Rising Tide", "Tsunami"]


def test_end_to_end_with_real_ocr():
    pytest.importorskip("rapidocr_onnxruntime")
    from aamacro.vision.ocr import RapidOcrEngine

    ocr = RapidOcrEngine()
    for draw_boxes in (True, False):
        img, rects = _card_image(SUMMER_LINES, boxes=draw_boxes)
        snap = Snapshot(img, merge_lines(ocr.read(img)))
        picker = CardPicker(Settings({"cards": {"greed": 0.5}}))
        best, ranked = picker.decide(snap)
        assert best is not None, snap.text()
        assert len(ranked) == 3
        assert best.card.title.lower().startswith("low tide")
        x, y, w, h = rects[0]
        assert x <= best.card.center[0] <= x + w
        greedy = CardPicker(Settings({"cards": {"greed": 1.0}}))
        assert "tsunami" in greedy.decide(snap)[0].card.title.lower()


def test_no_cards_on_normal_screen():
    boxes = [box("Wave 12", 600, 20), box("¥4,500", 40, 650), box("Upgrade", 900, 400)]
    img = np.zeros((720, 1280, 3), np.uint8)
    assert CardPicker(Settings()).count(Snapshot(img, boxes)) == 0
