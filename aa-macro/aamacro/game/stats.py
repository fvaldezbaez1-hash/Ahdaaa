"""Win/loss stats and optional Discord webhook reports."""

from __future__ import annotations

import json
import threading
import time
import urllib.request
from pathlib import Path

from .. import paths


class Stats:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or (paths.data_dir() / "stats.json")
        self.lock = threading.Lock()
        self.session = {"runs": 0, "wins": 0, "losses": 0, "started": time.time(), "waves": []}
        self.all_time = {"runs": 0, "wins": 0, "losses": 0}
        self.history: list[dict] = []
        if self.path.exists():
            try:
                d = json.loads(self.path.read_text(encoding="utf-8"))
                self.all_time.update(d.get("all_time", {}))
                self.history = d.get("history", [])[-500:]
            except (OSError, json.JSONDecodeError):
                pass

    def record(self, task: str, map_name: str, mode: str, victory: bool | None, wave: int,
               strategy: str | None, seconds: float) -> dict:
        entry = {"t": time.time(), "task": task, "map": map_name, "mode": mode,
                 "result": "victory" if victory else "defeat" if victory is False else "unknown",
                 "wave": wave, "strategy": strategy, "seconds": round(seconds)}
        with self.lock:
            for bucket in (self.session, self.all_time):
                bucket["runs"] += 1
                if victory:
                    bucket["wins"] += 1
                elif victory is False:
                    bucket["losses"] += 1
            self.session["waves"].append(wave)
            self.history.append(entry)
            self.history = self.history[-500:]
            self._save()
        return entry

    def _save(self) -> None:
        try:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"all_time": self.all_time, "history": self.history}), encoding="utf-8")
            tmp.replace(self.path)
        except OSError:
            pass

    def summary(self) -> dict:
        s = self.session
        done = s["wins"] + s["losses"]
        elapsed = time.time() - s["started"]
        return {
            "runs": s["runs"], "wins": s["wins"], "losses": s["losses"],
            "win_rate": (s["wins"] / done) if done else 0.0,
            "avg_wave": (sum(s["waves"]) / len(s["waves"])) if s["waves"] else 0.0,
            "runs_per_hour": s["runs"] / (elapsed / 3600) if elapsed > 60 else 0.0,
            "elapsed": elapsed,
            "all_time_runs": self.all_time["runs"],
        }


def post_webhook(url: str, entry: dict, summary: dict, timeout: float = 8.0) -> bool:
    if not url or not url.startswith("https://"):
        return False
    won = entry["result"] == "victory"
    embed = {
        "title": f"{'Victory' if won else 'Defeat' if entry['result'] == 'defeat' else 'Run ended'} — {entry['map'] or entry['task']}",
        "color": 0x2ECC71 if won else 0xE74C3C,
        "fields": [
            {"name": "Mode", "value": entry["mode"] or "-", "inline": True},
            {"name": "Wave", "value": str(entry["wave"]), "inline": True},
            {"name": "Layout", "value": entry["strategy"] or "-", "inline": True},
            {"name": "Session", "value": f"{summary['wins']}W / {summary['losses']}L "
                                         f"({summary['win_rate']:.0%})", "inline": True},
            {"name": "Runs/hour", "value": f"{summary['runs_per_hour']:.1f}", "inline": True},
        ],
        "footer": {"text": "AA Macro"},
    }
    data = json.dumps({"embeds": [embed]}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json",
                                                          "User-Agent": "AAMacro"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False
