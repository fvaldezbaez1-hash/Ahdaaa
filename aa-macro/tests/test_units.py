import pytest

from aamacro.config import Settings
from aamacro.control import Control
from aamacro.game.units import BuildExecutor, fallback_spots, plan_auto, plan_custom
from aamacro.maps import ProfileStore
from aamacro.maps.optimize import Spot
from aamacro.maps.scan import PlacementScanner
from aamacro.sim import SimGameBackend, SimMap
from aamacro.vision.screen import ScreenReader

TEAM = [
    {"role": "dps", "max_place": 2, "upgrade_to": 99, "priority": 1},
    {"role": "farm", "max_place": 2, "upgrade_to": 3, "priority": 2},
    {"role": "support", "max_place": 1, "upgrade_to": 2, "priority": 3},
    {"role": "skip"}, {"role": "skip"}, {"role": "skip"},
]
SPOTS = [Spot(0, .3, .3, "dps"), Spot(0, .5, .3, "dps"), Spot(1, .2, .8, "farm"),
         Spot(1, .3, .8, "farm"), Spot(2, .4, .4, "support")]


def test_auto_plan_order():
    plan = [str(a) for a in plan_auto(TEAM, SPOTS)]
    assert plan == ["place slot 2", "place slot 1", "place slot 2", "upgrade slot 2 to 3",
                    "place slot 1", "place slot 3", "upgrade slot 1 to max", "upgrade slot 3 to 2"]
    no_farm_first = [str(a) for a in plan_auto(TEAM, SPOTS, farm_first=False)]
    assert no_farm_first[0] == "place slot 1"


def test_custom_plan():
    plan = [str(a) for a in plan_custom("place 1 x2, upgrade 1 to 3\nwait 2; upgrade all", TEAM, SPOTS)]
    assert plan[:4] == ["place slot 1", "place slot 1", "upgrade slot 1 to 3", "wait 2s"]
    assert plan[4:] == [f"upgrade slot {i} to max" for i in range(1, 7)]
    with pytest.raises(ValueError):
        plan_custom("summon 3", TEAM, SPOTS)
    with pytest.raises(ValueError):
        plan_custom("place 9", TEAM, SPOTS)


class YenWallet:
    """Fixed-income wallet: prices are exact."""

    def __init__(self, game, start=5000):
        self.game, self.start = game, start

    def __call__(self):
        return self.start - 400 * len(self.game.units)


def test_executor_places_learns_price_and_retries_bad_spot(tmp_path):
    sim = SimMap(seed=9)
    game = SimGameBackend(sim)
    s = Settings({"timing": {"hover_delay": 0.0}})
    profile = ProfileStore(tmp_path).get("m")
    # one spot sits on the path (refused), one is fine
    on_path = sim.point_at(0.2)
    good = (0.5 * sim.w, 0.18 * sim.h)
    assert not sim.valid_at(*on_path) and sim.valid_at(*good)
    spots = [(0, on_path[0], on_path[1]), (0, good[0], good[1])]
    plan = plan_auto([{"role": "dps", "max_place": 2, "upgrade_to": 0, "priority": 1}] + TEAM[3:] * 2,
                     [Spot(0, 0, 0, "dps"), Spot(0, 0, 0, "dps")])
    ex = BuildExecutor(game.backend, ScreenReader(game.backend, None, s), Control(), s, plan, spots,
                       profile, read_yen=YenWallet(game), scanner=PlacementScanner(game.backend, Control(), s))
    for _ in range(12):
        if ex.finished:
            break
        ex.tick(YenWallet(game)())
    assert len(game.units) == 2
    assert all(sim.valid_at(x, y) for x, y in game.units)
    assert profile.known_cost(0, "place", 0) == 400
    assert game.selected is None


def test_fallback_spots_respect_valid_mask():
    import numpy as np

    valid = np.zeros((90, 160), bool)
    valid[:, 80:] = True
    spots = fallback_spots(TEAM, valid, [0, 0, 1, 1], (1280, 720), 0.04)
    assert len(spots) == 5
    assert all(s.x >= 0.5 for s in spots)
