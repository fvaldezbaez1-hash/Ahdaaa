import cv2
import numpy as np
import pytest

from aamacro.platform.fake import FakeBackend
from aamacro.vision.ocr import find_text, merge_lines, parse_number, similarity
from aamacro.vision.preview import PreviewClassifier, ring_radius
from aamacro.vision.screen import ScreenReader, Snapshot, State
from aamacro.vision.templates import match_template

from .conftest import FakeOcr, box


def test_similarity_whole_words():
    assert similarity("Return to Lobby", "lobby") >= 95
    assert similarity("Rep1ay", "replay") >= 80
    assert similarity("context", "next") < 80
    assert similarity("Vote Start", "start") >= 95
    assert similarity("ReturnToLobby", "return to lobby") >= 90


def test_find_text_prefers_best_match():
    boxes = [box("Next", 100, 100), box("Replay", 300, 100), box("Return to Lobby", 500, 100)]
    hit = find_text(boxes, ["replay"])
    assert hit and hit.box.text == "Replay"
    assert find_text(boxes, ["summon"]) is None


def test_merge_lines_joins_words():
    boxes = [box("Return", 100, 100, 60, 20), box("to", 166, 101, 20, 20), box("Lobby", 192, 100, 50, 20)]
    merged = merge_lines(boxes)
    assert any(b.text == "Return to Lobby" for b in merged)


@pytest.mark.parametrize("text,value", [
    ("¥12,345", 12345), ("1.2K", 1200), ("Wave 12", 12), ("$ 900", 900), ("nothing", None),
])
def test_parse_number(text, value):
    assert parse_number(text) == value


def test_classify_results_and_match(settings):
    ocr = FakeOcr([box("VICTORY", 560, 120), box("Replay", 500, 600), box("Return to Lobby", 700, 600)])
    reader = ScreenReader(FakeBackend(), ocr, settings)
    assert reader.classify(reader.snap()) == State.VICTORY

    ocr.boxes = [box("DEFEAT", 560, 120), box("Retry", 500, 600)]
    assert reader.classify(reader.snap()) == State.DEFEAT

    ocr.boxes = [box("Wave 7", 600, 20), box("¥4,500", 40, 650)]
    snap = reader.snap()
    assert reader.classify(snap) == State.MATCH
    assert reader.read_wave(snap) == 7
    assert reader.read_yen(snap) == 4500

    ocr.boxes = [box("Summon", 20, 300), box("Play", 20, 340), box("Shop", 20, 380)]
    assert reader.classify(reader.snap()) == State.LOBBY

    ocr.boxes = [box("Disconnected", 500, 300), box("Reconnect", 560, 400)]
    assert reader.classify(reader.snap()) == State.DISCONNECTED

    ocr.boxes = [box("Vote Start", 560, 200)]
    assert reader.classify(reader.snap()) == State.VOTE

    ocr.boxes = []
    assert reader.classify(reader.snap()) == State.UNKNOWN


def test_victory_needs_buttons(settings):
    # Plain word "victory" in a quest list must not end the match.
    ocr = FakeOcr([box("Victory quest: 3/5", 20, 300), box("Wave 3", 600, 20)])
    reader = ScreenReader(FakeBackend(), ocr, settings)
    assert reader.classify(reader.snap()) == State.MATCH


def _scene(seed=1):
    rng = np.random.default_rng(seed)
    img = rng.integers(40, 120, (360, 640, 3), dtype=np.uint8)
    return cv2.GaussianBlur(img, (7, 7), 0)


def _ghost(base, center, color, ring=90):
    img = base.copy()
    cv2.circle(img, center, 18, color, -1)
    cv2.circle(img, center, ring, (255, 255, 255), 2)
    return img


def test_preview_valid_vs_red():
    base = _scene()
    clf = PreviewClassifier()
    ok = clf.classify(base, _ghost(base, (300, 180), (60, 200, 60)), (300, 180), 40)
    bad = clf.classify(base, _ghost(base, (300, 180), (30, 30, 230)), (300, 180), 40)
    none = clf.classify(base, base.copy(), (300, 180), 40)
    assert ok.valid is True
    assert bad.valid is False
    assert none.valid is None
    assert ok.ring_radius == pytest.approx(90, abs=3)


def test_preview_calibrated():
    base = _scene(2)
    clf = PreviewClassifier()
    valid_s = clf.sample(base, _ghost(base, (300, 180), (200, 120, 40)), (300, 180), 40)
    invalid_s = clf.sample(base, _ghost(base, (300, 180), (40, 40, 160)), (300, 180), 40)
    clf = PreviewClassifier({"valid": valid_s, "invalid": invalid_s})
    assert clf.classify(base, _ghost(base, (200, 150), (205, 125, 45)), (200, 150), 40).valid is True
    assert clf.classify(base, _ghost(base, (200, 150), (42, 38, 158)), (200, 150), 40).valid is False


def test_ring_radius_ignores_noise():
    mask = np.zeros((300, 300), np.uint8)
    rng = np.random.default_rng(0)
    mask[rng.integers(0, 300, 200), rng.integers(0, 300, 200)] = 255
    assert ring_radius(mask, (150, 150), 20) is None
    cv2.circle(mask, (150, 150), 70, 255, 2)
    assert ring_radius(mask, (150, 150), 20) == pytest.approx(70, abs=3)


def test_template_match_scaled():
    frame = _scene(3)
    cv2.rectangle(frame, (400, 250), (480, 290), (0, 200, 255), -1)
    cv2.putText(frame, "GO", (420, 280), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    tpl = frame[245:295, 395:485].copy()
    big = cv2.resize(frame, None, fx=2.0, fy=2.0)
    m = match_template(big, tpl, "go", captured_width=640)
    assert m is not None
    cx, cy = m.center
    assert abs(cx - 880) < 8 and abs(cy - 540) < 8


def test_real_ocr_reads_rendered_text():
    pytest.importorskip("rapidocr_onnxruntime")
    from aamacro.vision.ocr import RapidOcrEngine

    img = np.full((200, 640, 3), 30, np.uint8)
    cv2.putText(img, "Return to Lobby", (40, 90), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 3)
    cv2.putText(img, "Wave 12", (420, 170), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
    boxes = merge_lines(RapidOcrEngine().read(img))
    hit = find_text(boxes, ["return to lobby"])
    assert hit is not None
    assert hit.box.rect.contains(200, 80)
    snap = Snapshot(img, boxes)
    from aamacro.config import Settings
    reader = ScreenReader(FakeBackend(img), FakeOcr(boxes), Settings())
    assert reader.read_wave(snap) == 12
