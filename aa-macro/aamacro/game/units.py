"""Placing and upgrading units.

The build plan says *what* to do in which order; the executor does one step
per tick, checks it worked (yen went down, or a unit appeared), learns what
things cost, and marks spots that never accept a unit so they get avoided.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

import cv2
import numpy as np

from ..maps.optimize import Spot


@dataclass
class Action:
    kind: str                 # place | upgrade | wait
    slot: int = -1
    target: int = 0           # upgrade level to reach
    seconds: float = 0.0

    def __str__(self) -> str:
        if self.kind == "place":
            return f"place slot {self.slot + 1}"
        if self.kind == "upgrade":
            return f"upgrade slot {self.slot + 1} to {'max' if self.target >= 99 else self.target}"
        return f"wait {self.seconds:g}s"


@dataclass
class PlacedUnit:
    slot: int
    x: float
    y: float
    level: int = 0
    maxed: bool = False
    fails: int = 0


@dataclass
class Pending:
    slot: int
    x: float
    y: float
    fails: int = 0


def _role(team, i) -> str:
    return str(team[i].get("role", "dps")).lower()


def plan_auto(team: list[dict], spots: list[Spot], farm_first: bool = True) -> list[Action]:
    per_slot: dict[int, int] = {}
    for s in spots:
        per_slot[s.slot] = per_slot.get(s.slot, 0) + 1
    active = [i for i in range(len(team)) if per_slot.get(i) and _role(team, i) != "skip"]
    prio = sorted(active, key=lambda i: (int(team[i].get("priority", i + 1)), i))
    farms = [i for i in prio if _role(team, i) == "farm"]
    dps = [i for i in prio if _role(team, i) == "dps"]
    support = [i for i in prio if _role(team, i) == "support"]
    acts: list[Action] = []
    placed: dict[int, int] = {i: 0 for i in active}

    def place(i):
        if placed[i] < per_slot[i]:
            acts.append(Action("place", i))
            placed[i] += 1

    if farm_first:
        for i in farms:
            place(i)
    for i in dps:
        place(i)
    for i in farms:
        while placed[i] < per_slot[i]:
            place(i)
    for i in farms:
        acts.append(Action("upgrade", i, int(team[i].get("upgrade_to", 99))))
    for i in dps + support:
        while placed[i] < per_slot[i]:
            place(i)
    for i in dps + support:
        acts.append(Action("upgrade", i, int(team[i].get("upgrade_to", 99))))
    return acts


_CUSTOM = re.compile(r"^(place|upgrade|wait)\s+(all|\d+(?:\.\d+)?)?(?:\s*x\s*(\d+))?(?:\s+to\s+(max|\d+))?$", re.I)


def plan_custom(text: str, team: list[dict], spots: list[Spot]) -> list[Action]:
    """'place 1 x2, upgrade 1 to 3, place 2, upgrade all to max, wait 5'."""
    acts: list[Action] = []
    for part in re.split(r"[,\n;]+", text or ""):
        part = part.strip()
        if not part:
            continue
        m = _CUSTOM.match(part)
        if not m:
            raise ValueError(f'build order: can\'t read "{part}"')
        kind, who, times, to = m.group(1).lower(), m.group(2), m.group(3), m.group(4)
        if kind == "wait":
            acts.append(Action("wait", seconds=float(who or 1)))
            continue
        slots = list(range(len(team))) if (who or "all").lower() == "all" else [int(who) - 1]
        for i in slots:
            if not 0 <= i < len(team):
                raise ValueError(f'build order: there is no slot {i + 1}')
            if kind == "place":
                acts += [Action("place", i) for _ in range(int(times or 1))]
            else:
                target = 99 if (to or "max").lower() == "max" else int(to)
                acts.append(Action("upgrade", i, target))
    return acts


class BuildExecutor:
    def __init__(self, backend, reader, control, settings, plan: list[Action],
                 spots_px: list[tuple[int, float, float]], profile=None, log=None,
                 read_yen=None, scanner=None) -> None:
        self.b = backend
        self.reader = reader
        self.control = control
        self.settings = settings
        self.plan = list(plan)
        self.profile = profile
        self.log = log or (lambda m: None)
        self.read_yen = read_yen or (lambda: None)
        self.scanner = scanner
        self.units: list[PlacedUnit] = []
        self.free: dict[int, list[Pending]] = {}
        for slot, x, y in spots_px:
            self.free.setdefault(slot, []).append(Pending(slot, x, y))
        self.done_actions = 0
        self.last_yen: int | None = None

    def _yen(self) -> int | None:
        self.last_yen = self.read_yen()
        return self.last_yen

    @property
    def finished(self) -> bool:
        return not self.plan

    def _keys(self):
        return self.settings.get("keys")

    def _w(self):
        return self.b.size()

    # --- one step ----------------------------------------------------
    def tick(self, yen: int | None) -> str:
        """Do (at most) one placement or upgrade. Returns what happened."""
        while self.plan:
            act = self.plan[0]
            if act.kind == "wait":
                self.plan.pop(0)
                self.control.sleep(act.seconds)
                return "waited"
            if act.kind == "place":
                if not self.free.get(act.slot):
                    self.plan.pop(0)  # nowhere left to put it
                    continue
                res = self._place(act.slot, yen)
                if res in ("placed", "skipped"):
                    self.plan.pop(0)
                    self.done_actions += 1
                return res
            if act.kind == "upgrade":
                todo = [u for u in self.units if u.slot == act.slot and not u.maxed and u.level < act.target]
                if not todo:
                    self.plan.pop(0)
                    continue
                unit = min(todo, key=lambda u: u.level)
                res = self._upgrade(unit, yen)
                if res == "upgraded":
                    self.done_actions += 1
                return res
        return "done"

    # --- placing -----------------------------------------------------
    def _roi(self, img, x, y, r):
        h, w = img.shape[:2]
        x0, y0, x1, y1 = max(0, int(x - r)), max(0, int(y - r)), min(w, int(x + r)), min(h, int(y + r))
        return img[y0:y1, x0:x1]

    def _changed(self, before, after, x, y) -> float:
        r = max(8, int(0.02 * before.shape[1]))
        a, b = self._roi(before, x, y, r), self._roi(after, x, y, r)
        if a.size == 0 or a.shape != b.shape:
            return 0.0
        diff = cv2.absdiff(a, b).max(axis=2) > 30
        return float(diff.mean())

    def _neutral_point(self) -> tuple[float, float]:
        w, h = self._w()
        x, y, pw, ph = self.settings.get("hud.play_area") or [0, 0, 1, 1]
        return (x + pw * 0.5) * w, (y + 0.02) * h

    def _put_back(self, key: str) -> None:
        """Return a still-selected unit to the hotbar."""
        if self.scanner:
            self.scanner.cancel(key, *self._neutral_point())
        else:
            self.b.press(key)

    def _holding_unit(self, before, after, x: float, y: float) -> bool | None:
        """Is a placement ghost still following the cursor? None = can't tell."""
        classifier = getattr(self.scanner, "classifier", None)
        if classifier is None:
            return None
        roi = max(12, int(0.03 * before.shape[1]))
        return classifier.classify(before, after, (x, y), roi, find_ring=False).valid is not None

    def _place(self, slot: int, yen: int | None) -> str:
        pend = self.free[slot][0]
        cost = self.profile.known_cost(slot, "place", 0) if self.profile else None
        if yen is not None and cost and yen < cost:
            return "waiting"
        key = self._keys()["slots"][slot]
        # Read yen right before acting: the main loop's reading may be old.
        yen = self._yen() if yen is not None else None
        if yen is not None and cost and yen < cost:
            return "waiting"
        before = self.b.capture()
        self.b.press(key)
        self.control.sleep(0.25)
        spot = self._verified_point(before, pend)
        if spot is None:
            self._put_back(key)
            pend.fails += 1
            return self._refused(pend, money_known=True) if pend.fails >= 2 else "failed"
        pend.x, pend.y = spot
        if yen is not None:
            yen = self._yen() or yen  # tight before/after window = accurate price
        self.b.click(pend.x, pend.y)
        self.control.sleep(0.3)
        yen_after = self._yen() if yen is not None else None
        nx, ny = self._neutral_point()
        self.b.move(nx, ny)  # take the cursor (and any ghost) away
        self.control.sleep(0.2)
        after = self.b.capture()
        if yen_after is None:
            yen_after = self._yen()
        changed = self._changed(before, after, pend.x, pend.y)
        holding = self._holding_unit(before, after, nx, ny)
        paid = yen is not None and yen_after is not None and yen_after < yen - 5
        if paid or (changed > 0.05 and holding is not True):
            self.free[slot].pop(0)
            self.units.append(PlacedUnit(slot, pend.x, pend.y))
            if paid and self.profile:
                self.profile.learn_cost(slot, "place", 0, yen - yen_after)
            self.log(f"Placed slot {slot + 1} at ({pend.x:.0f}, {pend.y:.0f})")
            return "placed"
        # didn't work: put the unit back in the hotbar (only if still held)
        if holding is not False:
            self._put_back(key)
        money_known = yen is not None and yen_after is not None
        if money_known and cost and yen < cost * 1.02:
            return "waiting"
        if money_known and not cost and yen < self._cheapest_known_place() * 0.98:
            return "waiting"
        pend.fails += 1
        limit = 3 if money_known else 6
        if pend.fails >= limit:
            return self._refused(pend, money_known)
        return "failed"

    def _cheapest_known_place(self) -> float:
        if not self.profile:
            return 0.0
        costs = [self.profile.known_cost(i, "place", 0) for i in range(6)]
        costs = [c for c in costs if c]
        return float(min(costs)) if costs else 0.0

    def _refused(self, pend: Pending, money_known: bool) -> str:
        slot = pend.slot
        self.free[slot].remove(pend)
        if self.profile and money_known:
            w, h = self._w()
            self.profile.add_bad_spot(pend.x / w, pend.y / h)
        alt = self._alternative(pend)
        if alt:
            self.free[slot].insert(0, alt)
            self.log(f"Slot {slot + 1}: spot refused the unit, trying a spot nearby")
            return "failed"
        self.log(f"Slot {slot + 1}: spot refused the unit, skipping that copy")
        return "skipped"

    def _verified_point(self, before, pend: Pending) -> tuple[float, float] | None:
        """Hover the planned spot; if the placement preview says no, try a
        few points around it. Returns where to click (None = nowhere OK)."""
        hover = float(self.settings.get("timing.hover_delay", 0.09)) + 0.05
        classifier = getattr(self.scanner, "classifier", None)
        if classifier is None:
            self.b.move(pend.x, pend.y)
            self.control.sleep(hover)
            return pend.x, pend.y
        w, h = self._w()
        roi = max(12, int(0.03 * w))
        tries = [(pend.x, pend.y)]
        for radius in (0.015 * w, 0.03 * w):
            for k in range(8):
                ang = 2 * math.pi * k / 8
                x, y = pend.x + radius * math.cos(ang), pend.y + radius * math.sin(ang)
                if 2 < x < w - 2 and 2 < y < h - 2:
                    tries.append((x, y))
        saw_preview = False
        for x, y in tries:
            self.b.move(x, y)
            self.control.sleep(hover)
            res = classifier.classify(before, self.b.capture(), (x, y), roi, find_ring=False)
            if res.valid:
                return x, y
            saw_preview |= res.valid is not None
        # No preview at all (the game may not show one): click the plan.
        if not saw_preview:
            self.b.move(pend.x, pend.y)
            self.control.sleep(hover)
            return pend.x, pend.y
        return None

    def _alternative(self, pend: Pending) -> Pending | None:
        """Nearest spot around a refused one that the scan said is valid."""
        w, h = self._w()
        valid = self.profile.valid if self.profile is not None else None
        spacing = float(self.settings.get("learning.min_spacing", 0.035)) * w
        taken = [(u.x, u.y) for u in self.units] + [(p.x, p.y) for ps in self.free.values() for p in ps]
        bad = [(x * w, y * h) for x, y in (self.profile.bad_spots if self.profile else [])]
        for radius in (spacing, spacing * 1.6, spacing * 2.4):
            for k in range(12):
                ang = 2 * math.pi * k / 12
                x, y = pend.x + radius * math.cos(ang), pend.y + radius * math.sin(ang)
                if not (0 < x < w and 0 < y < h):
                    continue
                if valid is not None:
                    vh, vw = valid.shape
                    if not valid[min(vh - 1, int(y * vh / h)), min(vw - 1, int(x * vw / w))]:
                        continue
                if any(math.hypot(x - a, y - b) < spacing * 0.9 for a, b in taken + bad):
                    continue
                return Pending(pend.slot, x, y, 0)
        return None

    # --- upgrading ---------------------------------------------------
    def _upgrade(self, unit: PlacedUnit, yen: int | None) -> str:
        cost = self.profile.known_cost(unit.slot, "up", unit.level + 1) if self.profile else None
        if yen is not None and cost and yen < cost:
            return "waiting"
        keys = self._keys()
        yen = self._yen() if yen is not None else None
        if yen is not None and cost and yen < cost:
            return "waiting"
        self.b.click(unit.x, unit.y)
        self.control.sleep(0.35)
        if yen is not None:
            yen = self._yen() or yen
        self.b.press(keys["upgrade"])
        self.control.sleep(0.3)
        yen_after = self._yen()
        deselect = str(self.settings.get("keys.deselect", "") or "").lower()
        if deselect and deselect not in ("none", "esc"):
            self.b.press(deselect)
        if yen is not None and yen_after is not None:
            if yen_after < yen - 5:
                unit.level += 1
                unit.fails = 0
                if self.profile:
                    self.profile.learn_cost(unit.slot, "up", unit.level, yen - yen_after)
                self.log(f"Upgraded slot {unit.slot + 1} to level {unit.level}")
                return "upgraded"
            if cost and yen < cost * 1.02:
                return "waiting"
            unit.fails += 1
            if unit.level >= 1 and unit.fails >= 3:
                unit.maxed = True
                self.log(f"Slot {unit.slot + 1} looks fully upgraded (level {unit.level})")
            elif unit.fails >= 6:
                unit.maxed = True
                self.log(f"Slot {unit.slot + 1}: upgrading never worked. Check the upgrade key "
                         f'("{keys["upgrade"]}") in Settings.')
            return "failed"
        # No way to read yen: assume it worked and keep pressing in later ticks.
        unit.level += 1
        return "upgraded"


def fallback_spots(team: list[dict], valid: np.ndarray | None, play_area, size, spacing: float) -> list[Spot]:
    """When no path could be learned: spread units over placeable ground near
    the middle of the map."""
    w, h = size
    px, py, pw, ph = play_area or [0, 0, 1, 1]
    pts = []
    for gy in np.linspace(py + 0.1 * ph, py + 0.9 * ph, 9):
        for gx in np.linspace(px + 0.1 * pw, px + 0.9 * pw, 15):
            if valid is not None:
                vh, vw = valid.shape
                if not valid[min(vh - 1, int(gy * vh)), min(vw - 1, int(gx * vw))]:
                    continue
            pts.append((float(gx), float(gy)))
    pts.sort(key=lambda p: math.hypot(p[0] - (px + pw / 2), p[1] - (py + ph / 2)))
    chosen: list[Spot] = []
    for i, unit in sorted(enumerate(team), key=lambda t: int(t[1].get("priority", t[0] + 1))):
        if _role(team, i) == "skip":
            continue
        for _ in range(int(unit.get("max_place", 1))):
            for p in pts:
                if all(math.hypot((p[0] - s.x) * w, (p[1] - s.y) * h) >= spacing * w for s in chosen):
                    chosen.append(Spot(i, p[0], p[1], _role(team, i)))
                    break
    return chosen
