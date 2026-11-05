import math

import cv2
import numpy as np
import pytest

from aamacro.config import Settings
from aamacro.control import Control
from aamacro.geometry import Rect
from aamacro.maps import PathLearner, ProfileStore, UnitSpec, choose_spots
from aamacro.maps.align import Aligner
from aamacro.maps.scan import PlacementScanner
from aamacro.sim import SimGameBackend, SimMap


def learn_path(sim, seconds=14.0, fps=6):
    learner = PathLearner((sim.h, sim.w), sim.play_area)
    t = 0.0
    while t < seconds:
        learner.feed(sim.render(t), t)
        t += 1.0 / fps
    return learner.result()


def test_path_learner_finds_path_and_direction():
    sim = SimMap(seed=1)
    model = learn_path(sim)
    assert model is not None
    h, w = model.shape
    # most learned path pixels lie on the real path
    ys, xs = np.nonzero(model.mask)
    d = np.array([sim.dist_to_path(x * sim.w / w, y * sim.h / h) for x, y in zip(xs, ys)])
    assert np.mean(d < sim.path_width * 1.2) > 0.85
    # and it covers most of the real path
    hits = 0
    for s in np.linspace(0.05, 0.95, 30):
        x, y = sim.point_at(s)
        gx, gy = int(x * w / sim.w), int(y * h / sim.h)
        hits += model.mask[max(0, gy - 2):gy + 3, max(0, gx - 2):gx + 3].any()
    assert hits >= 24
    # progress grows from spawn to base
    def prog(s):
        x, y = sim.point_at(s)
        gx, gy = int(x * w / sim.w), int(y * h / sim.h)
        patch = model.progress[max(0, gy - 3):gy + 4, max(0, gx - 3):gx + 4]
        return float(np.nanmean(patch))
    assert prog(0.1) < prog(0.5) < prog(0.9)


def test_optimizer_places_near_path_and_valid():
    sim = SimMap(seed=2)
    model = learn_path(sim)
    units = [UnitSpec(0, "dps", 3, 0.11, 1), UnitSpec(1, "farm", 2, 0.05, 2), UnitSpec(2, "support", 1, 0.08, 3)]
    from aamacro.maps.path import play_mask
    play = play_mask(model.shape, sim.play_area)
    spots = choose_spots(model, units, "balanced", play=play)
    assert len(spots) == 6
    dps = [s for s in spots if s.role == "dps"]
    farm = [s for s in spots if s.role == "farm"]
    for s in spots:
        assert sim.in_ghost_area(s.x * sim.w, s.y * sim.h)
    for s in dps:
        assert sim.dist_to_path(s.x * sim.w, s.y * sim.h) < sim.range_px
        assert s.coverage > 0.05
    mean_dps = np.mean([sim.dist_to_path(s.x * sim.w, s.y * sim.h) for s in dps])
    mean_farm = np.mean([sim.dist_to_path(s.x * sim.w, s.y * sim.h) for s in farm])
    assert mean_farm > mean_dps
    for a in spots:
        for b in spots:
            if a is not b:
                assert math.hypot((a.x - b.x) * sim.w, (a.y - b.y) * sim.h) >= 0.03 * sim.w
    # strategies differ
    front = choose_spots(model, units[:1], "front", play=play)
    back = choose_spots(model, units[:1], "back", play=play)
    def mean_prog(sp):
        ps = []
        h, w = model.shape
        for s in sp:
            x, y = s.x * sim.w, s.y * sim.h
            best = min(np.linspace(0, 1, 200), key=lambda t: math.dist(sim.point_at(t), (x, y)))
            ps.append(best)
        return np.mean(ps)
    assert mean_prog(front) < mean_prog(back)


def test_scanner_reads_ghost_colors():
    sim = SimMap(seed=3)
    game = SimGameBackend(sim)
    s = Settings()
    area = Rect.from_norm(sim.play_area, sim.w, sim.h)
    res = PlacementScanner(game.backend, Control(), s).scan(0, area, 16, 9)
    from aamacro.maps.scan import grid_points
    agree = total = 0
    for r, c, x, y in grid_points(area, 16, 9):
        truth = sim.valid_at(x, y)
        agree += (res.grid[r, c] == 1) == truth
        total += 1
    assert agree / total > 0.95
    assert res.ring_norm() == pytest.approx(sim.range_px / sim.w, abs=0.01)
    # it left the unit unselected
    assert game.selected is None


def test_alignment_recovers_rotation_and_points():
    sim = SimMap(seed=4)
    ref = sim.render(0.0)
    M = cv2.getRotationMatrix2D((640, 360), 6.0, 1.0)
    M[0, 2] += 25
    cur = cv2.warpAffine(ref, M, (1280, 720), borderMode=cv2.BORDER_REFLECT)
    al = Aligner(ref, (0.0, 0.08, 1.0, 0.78)).estimate(cur)
    assert al.ok and al.inliers >= 25
    assert abs(abs(al.angle) - 6.0) < 1.0
    for x, y in [(0.3, 0.4), (0.7, 0.6)]:
        mx, my = al.map_point(x, y)
        p = M @ np.array([x * 1280, y * 720, 1.0])
        assert abs(mx * 1280 - p[0]) < 6 and abs(my * 720 - p[1]) < 6
    assert not Aligner(ref).estimate(np.zeros_like(ref)).ok


def test_profile_roundtrip_and_ucb(tmp_path):
    sim = SimMap(seed=5)
    model = learn_path(sim, seconds=8)
    store = ProfileStore(tmp_path)
    p = store.get("Namek Act 6")
    p.path = model
    p.reference = sim.render(0)
    for strat in ("balanced", "front", "back"):
        p.set_layout(strat, choose_spots(model, [UnitSpec(0, "dps", 2, 0.1)], strat))
    for price in (1000, 1200, 60, 1100):   # one bad reading (income arrived mid-way)
        p.learn_cost(0, "up", 1, price)
    p.save()
    q = store.get("Namek Act 6")
    assert q.learned and store.names() == ["Namek Act 6"]
    assert q.known_cost(0, "up", 1) == 1100
    seen = set()
    for _ in range(3):
        s = q.choose_strategy()
        seen.add(s)
        q.record(s, victory=(s == "back"), wave=20 if s == "back" else 12)
    assert seen == {"balanced", "front", "back"}
    picks = [q.choose_strategy(explore=0.2) for _ in range(5)]
    for s in picks:
        q.record(s, victory=(s == "back"), wave=20 if s == "back" else 12)
    assert q.best_strategy() == "back"
    assert q.overlay() is not None
    store.delete("Namek Act 6")
    assert store.names() == []
