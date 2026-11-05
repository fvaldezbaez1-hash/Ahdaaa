import numpy as np
import pytest

from aamacro.config import Settings
from aamacro.control import Control, StopRequested
from aamacro.game.steps import StepError, StepRunner, parse
from aamacro.game.teach import build_script, describe_click
from aamacro.movement.routes import Route, _play_events, clean_events
from aamacro.platform.fake import FakeBackend
from aamacro.vision.screen import ScreenReader

from .conftest import FakeOcr, box


def test_parse_and_errors():
    steps = parse('# hi\nclick "Story"\noptional click "Claim"\nclick_at 0.5 0.6\nwait 1\nhold w 0.2\n')
    assert [s.command for s in steps] == ["click", "click", "click_at", "wait", "hold"]
    assert steps[1].optional
    with pytest.raises(StepError):
        parse("jump 3")
    with pytest.raises(StepError):
        parse("click_at half 0.2")
    with pytest.raises(StepError):
        parse('click "unclosed')


def test_runner_clicks_text_and_handles_optional():
    ocr = FakeOcr([box("Story", 200, 300, 100, 30), box("Play", 600, 600, 80, 30)])
    backend = FakeBackend()
    reader = ScreenReader(backend, ocr, Settings())
    runner = StepRunner(backend, reader, Control(), Settings())
    runner.run('click "story"\noptional click "Claim" 0.1\nclick_at 0.5 0.5\nkey e\n')
    assert backend.clicks() == [(250, 315), (640, 360)]
    assert backend.pressed() == ["e"]
    with pytest.raises(StepError):
        runner.run('click "Raid" 0.1')


def test_runner_stops():
    c = Control()
    c.stop()
    backend = FakeBackend()
    runner = StepRunner(backend, ScreenReader(backend, FakeOcr(), Settings()), c, Settings())
    with pytest.raises(StopRequested):
        runner.run("wait 5")


def test_clean_events_pairs_keys():
    ev = clean_events([[10.0, "down", "W"], [10.1, "down", "w"], [11.0, "down", "d"], [11.5, "up", "w"]])
    assert ev == [[0.0, "down", "w"], [1.0, "down", "d"], [1.5, "up", "w"], [1.5, "up", "d"]]


def test_route_roundtrip_and_play(tmp_path):
    r = Route("to_story", clean_events([[0, "down", "w"], [0.05, "up", "w"]]), True, "Story")
    r.save(tmp_path)
    loaded = Route.load("to_story", tmp_path)
    assert loaded.events == r.events and loaded.checkpoint == "Story"
    backend = FakeBackend()
    _play_events(loaded.events, backend, Control())
    assert [a for a in backend.actions if a[0] in ("key_down", "key_up")] == [("key_down", "w"), ("key_up", "w")]
    assert backend.held == set()


def test_teach_uses_words_not_pixels():
    boxes = [box("Story", 200, 300, 100, 30), box("Legend Stages", 200, 360, 160, 30)]
    assert describe_click(boxes, 240, 312, 1280, 720) == 'click "Story"'
    assert describe_click(boxes, 900, 100, 1280, 720) == "click_at 0.703 0.139"

    class O:
        def read(self, img):
            return boxes

    frame = np.zeros((720, 1280, 3), np.uint8)
    script = build_script([("click", 0.0, 240, 312, frame), ("key", 2.0, "e", 0.1),
                           ("key", 2.5, "w", 1.2)], O(), 1280, 720)
    lines = [l for l in script.splitlines() if not l.startswith("#")]
    assert lines == ['click "Story"', "wait 2.0", "key e", "hold w 1.20"]
    parse(script)  # the generated script is valid
