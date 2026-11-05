"""Settings: built-in defaults merged with the user's saved settings.json.

Everything the game might change in an update (button words, keys, screen
regions) lives here, so it can be fixed from the app without new code.
"""

from __future__ import annotations

import copy
import json
import threading
from pathlib import Path
from typing import Any

from . import paths

DEFAULT_LOBBY_STEPS = """\
# One step per line. Lines starting with # are ignored.
# Examples (edit to match the menus you use):
#   walk play_area            replay a recorded walking route
#   click "Play"              click the text "Play" wherever it is on screen
#   click_at 0.50 0.62        click a spot (fractions of the window)
#   key e / hold w 1.5        press E / hold W for 1.5 s
#   wait 2                    wait 2 seconds
#   wait_for "Vote" 20        wait up to 20 s for that text
#   click_template start_btn  click a saved template image
click "Play"
wait 1
"""


def _team_defaults() -> list[dict]:
    return [
        {
            "name": f"Slot {i + 1}",
            "role": "dps",          # dps | farm | support | skip
            "max_place": 3,         # how many copies to place
            "upgrade_to": 99,       # upgrade level to stop at (99 = max)
            "priority": i + 1,      # lower = placed/upgraded earlier
            "range": 0.0,           # 0 = learn it; else fraction of window width
        }
        for i in range(6)
    ]


DEFAULTS: dict[str, Any] = {
    "version": 1,
    "window": {
        "title": "Roblox",
        "client_width": 1280,
        "client_height": 720,
        "auto_resize": True,
        "mac_titlebar": 28,
    },
    "keys": {
        "slots": ["1", "2", "3", "4", "5", "6"],
        "upgrade": "r",
        "sell": "x",
        "unit_overview": "f",
        "cancel_placement": "same_key",   # same_key | right_click | <key name>
        "zoom_in": "i",
        "zoom_out": "o",
        "rotate_left": "left",
        "rotate_right": "right",
        "interact": "e",
        "reset_sequence": ["esc", "r", "enter"],
        "deselect": "",                 # key to close the unit panel after upgrading ("" = none)
    },
    "hotkeys": {"start": "f1", "pause": "f2", "stop": "f3"},
    "timing": {
        "state_poll": 1.0,
        "click_delay": 0.15,
        "hover_delay": 0.09,
        "unknown_timeout": 90,
        "match_timeout": 3600,
        "action_interval": 1.0,
        "anti_idle": 300,
        "vote_timeout": 60,
    },
    # Words the OCR looks for to recognise each screen (case-insensitive,
    # fuzzy). Update these if the game renames a button.
    "screens": {
        "victory": ["victory", "stage cleared", "you win", "cleared"],
        "defeat": ["defeat", "game over", "you lost", "failed"],
        "replay": ["replay", "retry", "play again", "restart"],
        "next": ["next", "next level", "next stage", "continue", "next room"],
        "lobby": ["return to lobby", "back to lobby", "lobby", "leave"],
        "vote": ["vote start", "vote", "start", "ready", "yes"],
        "lobby_marks": ["summon", "units", "play", "shop", "codes", "items"],
        "match_marks": ["wave", "yen", "upgrade"],
        "disconnect": ["disconnected", "reconnect", "error code", "lost connection",
                       "you were kicked", "idle"],
        "reconnect_button": ["reconnect", "rejoin", "ok"],
        "card_prompt": ["choose a card", "pick a card", "choose one", "select a card",
                        "choose", "select one", "pick one"],
        "confirm": ["confirm", "select", "choose", "accept"],
    },
    "hud": {
        # Fractions of the window [x, y, w, h]. null = find automatically.
        "yen_region": None,
        "wave_region": None,
        "play_area": [0.03, 0.10, 0.94, 0.72],
    },
    "team": _team_defaults(),
    "build": {
        "order": "auto",            # auto | custom
        "custom": "",               # e.g. "place 1 x1, upgrade 1 to 3, place 2 x2"
        "farm_first": True,
        "verify_with_yen": True,
    },
    "tasks": [
        {
            "name": "Main farm",
            "enabled": True,
            "map": "My map",
            "mode": "infinite",       # story | infinite | legend | raid | portal | dungeon | event
            "repeat": 0,              # 0 = forever
            "after": "replay",        # replay | next | lobby
            "max_waves": 0,           # 0 = play until the game ends it
            "lobby_steps": DEFAULT_LOBBY_STEPS,
            "leave_steps": "",        # run when max_waves is reached
            "match_route": "",        # walking route to run at match start
            "card_profile": "auto",   # auto | summer | portal | dungeon | default
        }
    ],
    "cards": {
        "enabled": True,
        "greed": 0.5,               # 0 = safest picks, 1 = chase rewards
        "weights": {
            "enemy_speed": -1.0,
            "enemy_health": -0.8,
            "enemy_damage": -0.6,
            "enemy_shield": -0.6,
            "enemy_count": -0.7,
            "reward": 0.6,
            "unit_damage": 1.0,
            "unit_range": 0.7,
            "unit_attack_speed": 0.8,
            "unit_cooldown": -0.8,
            "cost": -0.6,
            "yen": 0.5,
            "base_health": 0.4,
            "crit": 0.5,
        },
        "must_pick": [],
        "never_pick": [],
        "room_priority": ["Rare Chest", "Chest", "Shop", "Hoard", "Shrine", "Boss", "Curse"],
        "avoid_curses": [],
        "relic_priority": [],
        "columns_fallback": 3,
        "unknown_card_score": 0.0,
    },
    "learning": {
        "enabled": True,
        "scan_cols": 22,
        "scan_rows": 12,
        "path_learn_seconds": 25,
        "min_spacing": 0.035,
        "default_range": 0.12,
        "explore": 1.2,
        "strategies": ["balanced", "front", "back", "spread"],
        "relearn_after_losses": 4,
    },
    "camera": {
        "normalize": True,
        "zoom_out_presses": 20,
        "zoom_in_presses": 0,
        "align_rotate": True,
        "rotate_tap": 0.06,
        "max_rotate_taps": 40,
    },
    "reconnect": {
        "private_server_link": "",
        "rejoin_wait": 45,
    },
    "webhook": {"url": "", "on_result": True, "every_n": 1},
    "safety": {"failsafe_corner": True},
    "ocr": {"engine": "rapidocr", "min_confidence": 0.45, "upscale_small": True},
}


def deep_merge(base: dict, override: dict) -> dict:
    """Return base with override applied recursively (lists replace)."""
    out = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


class Settings:
    """Thread-safe settings store with dotted-path access."""

    def __init__(self, data: dict | None = None, path: Path | None = None) -> None:
        self._lock = threading.RLock()
        self.path = path
        self.data = deep_merge(DEFAULTS, data or {})
        self._normalise()

    # --- persistence ---------------------------------------------------
    @classmethod
    def load(cls, path: Path | None = None) -> "Settings":
        path = path or paths.settings_file()
        data: dict = {}
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                backup = path.with_suffix(".broken.json")
                try:
                    path.replace(backup)
                except OSError:
                    pass
                data = {}
        return cls(data, path)

    def save(self) -> None:
        if not self.path:
            return
        with self._lock:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
            tmp.replace(self.path)

    # --- access --------------------------------------------------------
    def get(self, dotted: str, default: Any = None) -> Any:
        with self._lock:
            node: Any = self.data
            for part in dotted.split("."):
                if isinstance(node, dict) and part in node:
                    node = node[part]
                elif isinstance(node, list) and part.isdigit() and int(part) < len(node):
                    node = node[int(part)]
                else:
                    return default
            return node

    def set(self, dotted: str, value: Any) -> None:
        with self._lock:
            parts = dotted.split(".")
            node: Any = self.data
            for part in parts[:-1]:
                if isinstance(node, list):
                    node = node[int(part)]
                else:
                    node = node.setdefault(part, {})
            last = parts[-1]
            if isinstance(node, list):
                node[int(last)] = value
            else:
                node[last] = value

    def words(self, screen: str) -> list[str]:
        return [w for w in self.get(f"screens.{screen}", []) if w]

    def _normalise(self) -> None:
        team = self.data.get("team") or []
        defaults = _team_defaults()
        fixed = []
        for i in range(6):
            slot = team[i] if i < len(team) and isinstance(team[i], dict) else {}
            fixed.append({**defaults[i], **slot})
        self.data["team"] = fixed
        slots = list(self.data["keys"].get("slots") or [])
        while len(slots) < 6:
            slots.append(str(len(slots) + 1))
        self.data["keys"]["slots"] = slots[:6]
        if not self.data.get("tasks"):
            self.data["tasks"] = copy.deepcopy(DEFAULTS["tasks"])
        task_default = DEFAULTS["tasks"][0]
        self.data["tasks"] = [{**task_default, **t} for t in self.data["tasks"] if isinstance(t, dict)]
