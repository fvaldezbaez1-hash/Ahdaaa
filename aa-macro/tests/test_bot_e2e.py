"""The real Bot plays a simulated game end to end: lobby -> vote -> match
(learns the path, scans the ground, places + upgrades) -> card pick ->
victory -> replay, twice."""

import math
import threading
import time

import cv2
import numpy as np

from aamacro.config import Settings
from aamacro.control import Control
from aamacro.game.bot import Bot
from aamacro.game.stats import Stats
from aamacro.geometry import Rect
from aamacro.maps import ProfileStore
from aamacro.platform.fake import FakeBackend
from aamacro.sim import SimMap
from aamacro.vision.ocr import TextBox

PLACE_COST = 500
UPGRADE_COST = 800
MAX_LEVEL = 3


class SimFullGame:
    def __init__(self, speed=8.0, match_len=110.0, card_at=55.0):
        self.sim = SimMap(seed=7)
        self.speed = speed
        self.match_len = match_len
        self.card_at = card_at
        self.screen = "lobby"
        self.match_start = None
        self.spent = 0
        self.placed: list[list] = []      # [x, y, level]
        self.selected: str | None = None
        self.selected_unit: int | None = None
        self.cards_done = False
        self.card_choice = None
        self.matches = 0
        self.lock = threading.RLock()
        self.backend = FakeBackend(self.frame)
        self.backend.listeners.append(self.on_action)
        self.card_rects = [Rect(130 + i * 380, 170, 300, 400) for i in range(3)]

    def mt(self):
        return (time.monotonic() - self.match_start) * self.speed if self.match_start else 0.0

    @property
    def yen(self):
        return 600 + int(self.mt() * 60) - self.spent

    def update(self):
        with self.lock:
            if self.screen == "match":
                if self.mt() >= self.card_at and not self.cards_done:
                    self.screen = "cards"
                elif self.mt() >= self.match_len:
                    self.screen = "victory"

    def frame(self):
        self.update()
        if self.screen in ("match", "cards"):
            img = self.sim.render(self.mt(), self.backend.cursor, self.selected is not None,
                                  [(x, y) for x, y, _ in self.placed])
            if self.screen == "cards":
                img = (img * 0.3).astype(np.uint8)
                for r in self.card_rects:
                    cv2.rectangle(img, (r.x, r.y), (r.right, r.bottom), (90, 70, 160), -1)
                    cv2.rectangle(img, (r.x, r.y), (r.right, r.bottom), (230, 230, 230), 3)
            return img
        color = {"lobby": (60, 60, 60), "vote": (60, 40, 40), "victory": (20, 90, 20)}[self.screen]
        return np.full((720, 1280, 3), color, np.uint8)

    def boxes(self):
        self.update()
        B = lambda t, x, y, w=120, h=28: TextBox(t, 0.95, Rect(x, y, w, h))  # noqa: E731
        if self.screen == "lobby":
            return [B("Summon", 20, 300), B("Play", 20, 340), B("Shop", 20, 380)]
        if self.screen == "vote":
            return [B("Vote Start", 580, 200, 140), B("Wave 0", 600, 20)]
        if self.screen == "match":
            return [B(f"Wave {1 + int(self.mt() / 5)}", 600, 20), B(f"¥{self.yen:,}", 30, 640, 140)]
        if self.screen == "cards":
            cards = [("Low Tide", "-25% enemy speed"), ("Rising Tide", "+50% SummerPearls +50% enemy health"),
                     ("Tsunami", "+100% SummerPearls +50% enemy speed")]
            out = [B("Choose a card", 520, 100, 240)]
            for r, (t, d) in zip(self.card_rects, cards):
                out += [B(t, r.x + 20, r.y + 50, 200, 34), B(d, r.x + 10, r.y + 150, 280, 22)]
            return out
        return [B("VICTORY", 560, 120, 160, 40), B("Replay", 480, 600), B("Return to Lobby", 700, 600, 180)]

    def hit(self, x, y):
        for b in self.boxes():
            if b.rect.expand(4).contains(x, y):
                return b.text
        return None

    def on_action(self, a):
        with self.lock:
            kind = a[0]
            if kind == "click" and a[1] == "left":
                x, y = a[2], a[3]
                text = self.hit(x, y)
                if self.screen == "lobby" and text == "Play":
                    self.screen = "vote"
                elif self.screen == "vote" and text == "Vote Start":
                    self.screen = "match"
                    self.match_start = time.monotonic()
                    self.spent = 0
                    self.placed = []
                    self.cards_done = False
                elif self.screen == "cards":
                    for i, r in enumerate(self.card_rects):
                        if r.contains(x, y):
                            self.card_choice = i
                            self.cards_done = True
                            self.screen = "match"
                elif self.screen == "victory" and text == "Replay":
                    self.matches += 1
                    self.screen = "vote"
                elif self.screen == "match":
                    if self.selected:
                        if self.sim.valid_at(x, y) and self.yen >= PLACE_COST and \
                                all(math.hypot(x - px, y - py) > 20 for px, py, _ in self.placed):
                            self.placed.append([x, y, 0])
                            self.spent += PLACE_COST
                            self.selected = None
                    else:
                        near = [i for i, (px, py, _) in enumerate(self.placed) if math.hypot(x - px, y - py) < 14]
                        self.selected_unit = near[0] if near else None
            elif kind == "press" and self.screen == "match":
                key = a[1]
                if key in "123456":
                    self.selected = None if self.selected == key else key
                elif key == "r" and self.selected_unit is not None:
                    u = self.placed[self.selected_unit]
                    if u[2] < MAX_LEVEL and self.yen >= UPGRADE_COST:
                        u[2] += 1
                        self.spent += UPGRADE_COST


class SimOcr:
    def __init__(self, game):
        self.game = game

    def read(self, image):
        return self.game.boxes()


def test_bot_plays_simulated_game(tmp_path):
    game = SimFullGame()
    settings = Settings({
        "timing": {"state_poll": 0.12, "action_interval": 0.05, "hover_delay": 0.0, "click_delay": 0.0,
                   "unknown_timeout": 30, "vote_timeout": 10},
        "camera": {"normalize": False},
        "learning": {"scan_cols": 12, "scan_rows": 7, "path_learn_seconds": 1.0},
        "team": [
            {"name": "Carry", "role": "dps", "max_place": 2, "upgrade_to": 99, "priority": 1},
            {"name": "Farm", "role": "farm", "max_place": 1, "upgrade_to": 2, "priority": 2},
            {"role": "skip"}, {"role": "skip"}, {"role": "skip"}, {"role": "skip"},
        ],
        "tasks": [{"name": "Sim", "map": "SimMap", "lobby_steps": 'click "Play"', "after": "replay",
                   "repeat": 2}],
    })
    logs = []
    control = Control()
    bot = Bot(settings, game.backend, SimOcr(game), control, log=logs.append,
              store=ProfileStore(tmp_path / "maps"), stats=Stats(tmp_path / "stats.json"))
    th = threading.Thread(target=bot.run, daemon=True)
    th.start()
    th.join(timeout=150)
    if th.is_alive():
        control.stop()
        th.join(5)
    text = "\n".join(logs)
    assert not th.is_alive(), text
    summary = bot.stats.summary()
    assert summary["runs"] == 2 and summary["wins"] == 2, text
    assert game.matches == 2, text
    assert game.card_choice == 0, text            # Low Tide at default greed
    assert "Learned the enemy path" in text, text
    assert "Placed slot 1" in text and "Placed slot 2" in text, text
    assert "Upgraded slot" in text, text
    profile = ProfileStore(tmp_path / "maps").get("SimMap")
    assert profile.learned and profile.valid is not None
    assert len(profile.history) == 2
    # prices are learned (the 8x-speed sim earns money mid-measurement, so
    # exact values are checked in test_units instead)
    assert profile.known_cost(0, "place", 0)
    # second run reused the learned map instead of learning again
    assert text.count("Learned the enemy path") == 1, text
