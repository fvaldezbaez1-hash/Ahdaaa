"""Everything the macro has learned about one map, saved to disk.

Each map keeps a few candidate layouts (one per strategy). After every run
the result is recorded, and the next run picks a layout with UCB1, which
mostly reuses what works best but still tries the others now and then.
"""

from __future__ import annotations

import json
import math
import shutil
import time
from pathlib import Path

import cv2
import numpy as np

from .. import paths
from .optimize import STRATEGIES, Spot
from .path import PathModel


class MapProfile:
    def __init__(self, name: str, folder: Path) -> None:
        self.name = name
        self.folder = folder
        self.reference: np.ndarray | None = None
        self.valid: np.ndarray | None = None
        self.path: PathModel | None = None
        self.unit_ranges: dict[str, float] = {}
        self.layouts: dict[str, dict] = {}
        self.bad_spots: list[list[float]] = []
        self.costs: dict[str, dict] = {}
        self.history: list[dict] = []
        self.best_wave = 0
        self.team_sig = ""

    # --- persistence ---------------------------------------------------
    @classmethod
    def load(cls, name: str, folder: Path) -> "MapProfile":
        p = cls(name, folder)
        meta = folder / "profile.json"
        if meta.exists():
            try:
                d = json.loads(meta.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                d = {}
            p.unit_ranges = d.get("unit_ranges", {})
            p.layouts = d.get("layouts", {})
            p.bad_spots = d.get("bad_spots", [])
            p.costs = d.get("costs", {})
            p.history = d.get("history", [])
            p.best_wave = int(d.get("best_wave", 0))
            p.team_sig = d.get("team_sig", "")
        ref = folder / "reference.png"
        if ref.exists():
            p.reference = cv2.imread(str(ref), cv2.IMREAD_COLOR)
        valid = folder / "valid.png"
        if valid.exists():
            img = cv2.imread(str(valid), cv2.IMREAD_GRAYSCALE)
            p.valid = img > 127 if img is not None else None
        p.path = PathModel.load(folder / "path.npz")
        return p

    def save(self) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        meta = {
            "name": self.name, "unit_ranges": self.unit_ranges, "layouts": self.layouts,
            "bad_spots": self.bad_spots, "costs": self.costs, "history": self.history[-300:],
            "best_wave": self.best_wave, "team_sig": self.team_sig, "saved": time.time(),
        }
        tmp = self.folder / "profile.tmp"
        tmp.write_text(json.dumps(meta, indent=1), encoding="utf-8")
        tmp.replace(self.folder / "profile.json")
        if self.reference is not None:
            cv2.imwrite(str(self.folder / "reference.png"), self.reference)
        if self.valid is not None:
            cv2.imwrite(str(self.folder / "valid.png"), self.valid.astype(np.uint8) * 255)
        if self.path is not None:
            self.path.save(self.folder / "path.npz")

    # --- state ---------------------------------------------------------
    @property
    def learned(self) -> bool:
        return self.path is not None and any(v.get("spots") for v in self.layouts.values())

    def forget(self, keep_history: bool = True) -> None:
        """Start learning this map again from scratch."""
        self.valid = None
        self.path = None
        self.layouts = {}
        self.bad_spots = []
        self.reference = None
        for f in ("valid.png", "path.npz", "reference.png"):
            (self.folder / f).unlink(missing_ok=True)
        if not keep_history:
            self.history = []
            self.best_wave = 0

    def set_layout(self, strategy: str, spots: list[Spot]) -> None:
        entry = self.layouts.setdefault(strategy, {"runs": 0, "reward": 0.0, "wins": 0, "best_wave": 0})
        entry["spots"] = [s.to_dict() for s in spots]

    def spots(self, strategy: str) -> list[Spot]:
        return [Spot.from_dict(d) for d in self.layouts.get(strategy, {}).get("spots", [])]

    def choose_strategy(self, explore: float = 1.2) -> str | None:
        options = [k for k in STRATEGIES if self.layouts.get(k, {}).get("spots")]
        options += [k for k in self.layouts if k not in options and self.layouts[k].get("spots")]
        if not options:
            return None
        for k in options:
            if self.layouts[k].get("runs", 0) == 0:
                return k
        total = sum(self.layouts[k]["runs"] for k in options)

        def ucb(k):
            e = self.layouts[k]
            mean = e["reward"] / e["runs"]
            return mean + explore * math.sqrt(math.log(total) / e["runs"])

        return max(options, key=ucb)

    def best_strategy(self) -> str | None:
        options = [k for k, v in self.layouts.items() if v.get("runs")]
        if not options:
            return None
        return max(options, key=lambda k: self.layouts[k]["reward"] / self.layouts[k]["runs"])

    def record(self, strategy: str | None, victory: bool, wave: int | None, mode: str = "") -> float:
        wave = int(wave or 0)
        self.best_wave = max(self.best_wave, wave)
        if victory:
            reward = 1.0
        elif self.best_wave > 0:
            reward = 0.8 * wave / self.best_wave
        else:
            reward = 0.0
        if strategy and strategy in self.layouts:
            e = self.layouts[strategy]
            e["runs"] = e.get("runs", 0) + 1
            e["reward"] = e.get("reward", 0.0) + reward
            e["wins"] = e.get("wins", 0) + int(victory)
            e["best_wave"] = max(e.get("best_wave", 0), wave)
        self.history.append({"t": time.time(), "strategy": strategy, "victory": victory,
                             "wave": wave, "mode": mode, "reward": round(reward, 3)})
        return reward

    def recent_losses(self) -> int:
        n = 0
        for h in reversed(self.history):
            if h.get("victory"):
                break
            n += 1
        return n

    def add_bad_spot(self, x: float, y: float) -> None:
        self.bad_spots.append([round(x, 4), round(y, 4)])
        self.bad_spots = self.bad_spots[-200:]

    def learn_cost(self, slot: int, kind: str, level: int, yen: int) -> None:
        if yen <= 0:
            return
        entry = self.costs.setdefault(str(slot), {})
        key = f"{kind}{level}"
        samples = entry.get(key)
        if not isinstance(samples, list):
            samples = [samples] if samples else []
        samples.append(int(yen))
        entry[key] = samples[-5:]

    def known_cost(self, slot: int, kind: str, level: int) -> int | None:
        """Median of the last few prices seen (robust to income arriving
        mid-measurement)."""
        v = self.costs.get(str(slot), {}).get(f"{kind}{level}")
        if not v:
            return None
        samples = sorted(v if isinstance(v, list) else [v])
        return int(samples[len(samples) // 2])

    def stats(self) -> dict:
        runs = len(self.history)
        wins = sum(1 for h in self.history if h.get("victory"))
        return {"runs": runs, "wins": wins, "best_wave": self.best_wave,
                "learned": self.learned, "best": self.best_strategy()}

    def overlay(self) -> np.ndarray | None:
        """Picture of what was learned: path (red->yellow = spawn->base),
        placeable area (green tint) and the best layout's spots."""
        base = self.reference
        if base is None:
            if self.path is None:
                return None
            base = np.zeros((360, 640, 3), np.uint8)
        img = cv2.resize(base, (640, int(round(base.shape[0] * 640 / base.shape[1]))))
        h, w = img.shape[:2]
        layer = img.copy()
        if self.valid is not None:
            v = cv2.resize(self.valid.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST) > 0
            layer[v] = (0.6 * layer[v] + 0.4 * np.array([60, 200, 60])).astype(np.uint8)
        if self.path is not None:
            m = cv2.resize(self.path.mask.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST) > 0
            prog = cv2.resize(np.nan_to_num(self.path.progress, nan=0.5), (w, h))
            colors = np.stack([np.zeros_like(prog), 255 * prog, np.full_like(prog, 255)], axis=-1)
            layer[m] = colors[m].astype(np.uint8)
        img = cv2.addWeighted(layer, 0.7, img, 0.3, 0)
        strat = self.best_strategy() or self.choose_strategy() or ""
        for s in self.spots(strat):
            c = (int(s.x * w), int(s.y * h))
            color = {"dps": (255, 80, 40), "farm": (0, 215, 255), "support": (255, 0, 200)}.get(s.role, (255, 255, 255))
            cv2.circle(img, c, 7, color, -1)
            cv2.circle(img, c, 7, (0, 0, 0), 1)
            cv2.putText(img, str(s.slot + 1), (c[0] - 4, c[1] + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 0), 1)
        for x, y in self.bad_spots:
            c = (int(x * w), int(y * h))
            cv2.drawMarker(img, c, (0, 0, 255), cv2.MARKER_TILTED_CROSS, 8, 2)
        return img


class ProfileStore:
    def __init__(self, folder: Path | None = None) -> None:
        self.folder = folder or paths.maps_dir()

    def _dir(self, name: str) -> Path:
        return self.folder / paths.safe_name(name)

    def names(self) -> list[str]:
        out = []
        for d in sorted(self.folder.iterdir()):
            meta = d / "profile.json"
            if d.is_dir():
                name = d.name
                if meta.exists():
                    try:
                        name = json.loads(meta.read_text(encoding="utf-8")).get("name", d.name)
                    except json.JSONDecodeError:
                        pass
                out.append(name)
        return out

    def get(self, name: str) -> MapProfile:
        return MapProfile.load(name, self._dir(name))

    def delete(self, name: str) -> None:
        shutil.rmtree(self._dir(name), ignore_errors=True)
