"""Scores cards with the user's rules and picks the best one.

Order of rules (strongest first):
1. "Never pick" list   -> heavy penalty (still chosen if every card is banned)
2. "Must pick" list    -> heavy bonus, earlier entries beat later ones
3. Dungeon room / relic priority lists
4. Effect weights      -> sum(weight x value), with greed shifting the balance
                          between rewards and danger
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..vision.ocr import similarity
from .data import DUNGEON_ROOMS, KNOWN_CARDS
from .effects import DANGER_KEYS, parse_effects

MATCH = 84.0


@dataclass
class Card:
    title: str
    text: str
    center: tuple[int, int]
    rect: object = None


@dataclass
class ScoredCard:
    card: Card
    score: float
    effects: dict[str, float] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)
    known: str | None = None

    def describe(self) -> str:
        eff = ", ".join(f"{k} {v:+g}%" for k, v in self.effects.items()) or "no effects read"
        why = "; ".join(self.reasons)
        return f"{self.card.title or '?'} = {self.score:.1f} ({eff}){' — ' + why if why else ''}"


def _best_name(text: str, names) -> tuple[str | None, float, int]:
    best, best_s, idx = None, 0.0, -1
    for i, name in enumerate(names):
        s = similarity(text, name)
        if s > best_s:
            best, best_s, idx = name, s, i
    return best, best_s, idx


def _known(card: Card) -> tuple[str | None, dict]:
    """Look the card up by its title, or by a distinctive name in its text."""
    for source, from_title in ((card.title, True), (card.text, False)):
        if not source:
            continue
        name, s, _ = _best_name(source, KNOWN_CARDS.keys())
        if name and s >= MATCH and (from_title or len(name) >= 6):
            return name, dict(KNOWN_CARDS[name]["effects"])
    return None, {}


def score_card(card: Card, rules: dict) -> ScoredCard:
    full = f"{card.title} {card.text}".strip()
    scored = ScoredCard(card, 0.0)
    known, effects = _known(card)
    parsed = parse_effects(card.text or card.title)
    if not effects:
        effects = parsed
    scored.known = known
    scored.effects = effects

    greed = min(1.0, max(0.0, float(rules.get("greed", 0.5))))
    reward_mult = 0.4 + 1.6 * greed
    danger_mult = 1.6 - 1.2 * greed
    weights = rules.get("weights", {})
    for key, value in effects.items():
        w = float(weights.get(key, 0.0))
        if key in ("reward", "yen"):
            w *= reward_mult
        elif key in DANGER_KEYS:
            w *= danger_mult
        scored.score += w * value

    def listed(names) -> tuple[str | None, int]:
        for i, n in enumerate(names or []):
            if n and (similarity(card.title, n) >= MATCH or similarity(full, n) >= 92):
                return n, i
        return None, -1

    name, i = listed(rules.get("never_pick"))
    if name:
        scored.score -= 1000
        scored.reasons.append(f'never-pick "{name}"')
    name, i = listed(rules.get("must_pick"))
    if name:
        scored.score += 1000 + (100 - i) * 10
        scored.reasons.append(f'must-pick #{i + 1} "{name}"')

    rooms = rules.get("room_priority") or DUNGEON_ROOMS
    room, s, idx = _best_name(card.title or full, rooms)
    if room and s >= 90:
        scored.score += 500 - idx * 25
        scored.reasons.append(f'room #{idx + 1} "{room}"')
        if room.lower() == "curse":
            for curse in rules.get("avoid_curses") or []:
                if curse and similarity(full, curse) >= MATCH:
                    scored.score -= 800
                    scored.reasons.append(f'avoided curse "{curse}"')

    name, i = listed(rules.get("relic_priority"))
    if name:
        scored.score += 300 - i * 15
        scored.reasons.append(f'relic #{i + 1} "{name}"')

    if not effects and not scored.reasons:
        scored.score += float(rules.get("unknown_card_score", 0.0))
        scored.reasons.append("unknown card")
    return scored


def choose(cards: list[Card], rules: dict) -> tuple[ScoredCard | None, list[ScoredCard]]:
    scored = [score_card(c, rules) for c in cards]
    if not scored:
        return None, []
    ranked = sorted(scored, key=lambda s: s.score, reverse=True)
    return ranked[0], ranked
