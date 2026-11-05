import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Keep tests away from the real user data folder.
os.environ.setdefault("AAMACRO_HOME", tempfile.mkdtemp(prefix="aamacro-test-"))


@pytest.fixture
def settings():
    from aamacro.config import Settings

    return Settings()


class FakeOcr:
    """OCR stand-in: returns whatever boxes the test sets."""

    def __init__(self, boxes=None):
        self.boxes = list(boxes or [])

    def read(self, image):
        return list(self.boxes)


def box(text, x, y, w=80, h=24, conf=0.95):
    from aamacro.geometry import Rect
    from aamacro.vision.ocr import TextBox

    return TextBox(text, conf, Rect(x, y, w, h))


@pytest.fixture
def fake_ocr():
    return FakeOcr()
