"""Turns card text such as "+100% SummerPearls, +50% enemy speed" into numbers
the scorer can weigh: {"reward": 100, "enemy_speed": 50}."""

from __future__ import annotations

import re

EFFECT_KEYS = [
    "enemy_speed", "enemy_health", "enemy_damage", "enemy_shield", "enemy_count",
    "reward", "unit_damage", "unit_range", "unit_attack_speed", "unit_cooldown",
    "cost", "yen", "base_health", "crit",
]

DANGER_KEYS = {"enemy_speed", "enemy_health", "enemy_damage", "enemy_shield", "enemy_count"}

REWARD_WORDS = (
    "gem", "pearl", "summerpearl", "token", "xp", "exp", "experience", "coin", "gold",
    "star", "reward", "drop", "loot", "currency", "candy", "candies", "shard", "essence",
    "ticket", "point", "mana",
)
PLUS_WORDS = ("increase", "more", "faster", "extra", "bonus", "boost", "gain", "higher",
              "greater", "double", "triple", "additional", "empower", "buff")
MINUS_WORDS = ("decrease", "reduce", "less", "slower", "lower", "fewer", "cut", "weaken",
               "slow", "debuff", "minus", "discount", "cheaper")

_NUM = re.compile(r"([+\-−–]?)\s*(\d+(?:\.\d+)?)\s*(%|x\b)?", re.I)
_MULT = re.compile(r"\bx\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*x\b", re.I)


_SUBJECT = re.compile(r"\b(enem\w*|boss\w*|mobs?|foes?|units?|towers?|your|allies|ally|base)\b", re.I)


def _clauses(text: str) -> list[str]:
    t = text.replace("\n", ",").replace(";", ",").replace("|", ",")
    t = re.sub(r"(?<=\d)\s+(?=[+\-−–]\s*\d)", ",", t)  # "+50% a +50% b"
    parts: list[str] = []
    for chunk in t.split(","):
        pieces = re.split(r"\s+(?:and|&)\s+", chunk, flags=re.I)
        for i, piece in enumerate(pieces):
            piece = piece.strip()
            if not piece:
                continue
            # "and" joins two effects only if both halves carry a number
            if parts and i > 0 and not re.search(r"\d", piece):
                parts[-1] += f" and {piece}"
            else:
                parts.append(piece)
    # "Enemies have 30% more HP and move 10% slower": the second half
    # inherits the subject of the first.
    out: list[str] = []
    subject = ""
    for p in parts:
        m = _SUBJECT.search(p)
        if m:
            subject = m.group(1).lower()
            out.append(p)
        else:
            out.append(f"{subject} {p}" if subject else p)
    return out


def _stat(clause: str) -> str | None:
    c = clause.lower()
    enemy = any(w in c for w in ("enem", "boss", "mob", "foe", "opponent"))
    if "crit" in c:
        return "crit"
    if re.search(r"\b(spa|cooldown|cd|attack interval)\b", c):
        return "unit_cooldown"
    if "attack speed" in c or "atk speed" in c or "attack rate" in c or "fire rate" in c:
        return "unit_attack_speed"
    if "range" in c:
        return "unit_range"
    if any(w in c for w in ("cost", "price", "placement fee")):
        return "cost"
    if re.search(r"\b(yen|money|cash|income)\b", c):
        return "yen"
    if any(w in c for w in REWARD_WORDS):
        return "reward"
    if re.search(r"\b(spawn|enemy count|more enemies|extra enemies|number of enemies)\b", c):
        return "enemy_count"
    if any(w in c for w in ("speed", "faster", "slower", "move", "walk")):
        return "enemy_speed" if enemy or "move" in c or "walk" in c else "unit_attack_speed"
    if any(w in c for w in ("health", "hp", "durab")):
        if "base" in c and not enemy:
            return "base_health"
        return "enemy_health" if enemy or "unit" not in c else "base_health"
    if any(w in c for w in ("shield", "armor", "armour", "defense", "defence", "resist")):
        return "enemy_shield"
    if any(w in c for w in ("damage", "dmg", "attack", "power")):
        return "enemy_damage" if enemy else "unit_damage"
    return None


def _sign(clause: str, explicit: str) -> int:
    if explicit in ("-", "−", "–"):
        return -1
    if explicit == "+":
        return 1
    c = clause.lower()
    plus = any(re.search(rf"\b{w}", c) for w in PLUS_WORDS)
    minus = any(re.search(rf"\b{w}", c) for w in MINUS_WORDS)
    if minus and not plus:
        return -1
    return 1


def parse_effects(text: str) -> dict[str, float]:
    effects: dict[str, float] = {}
    for clause in _clauses(text):
        stat = _stat(clause)
        if not stat:
            continue
        value = None
        mult = _MULT.search(clause)
        num = _NUM.search(clause)
        if num and num.group(3) == "%":
            value = _sign(clause, num.group(1)) * float(num.group(2))
        elif mult:
            factor = float(mult.group(1) or mult.group(2))
            value = (factor - 1.0) * 100.0
        elif re.search(r"\bdouble\b", clause, re.I):
            value = 100.0
        elif re.search(r"\btriple\b", clause, re.I):
            value = 200.0
        elif re.search(r"\bhalf\b|\bhalved\b", clause, re.I):
            value = -50.0
        elif num:
            value = _sign(clause, num.group(1)) * float(num.group(2))
        if value is None:
            continue
        effects[stat] = effects.get(stat, 0.0) + value
    return effects
