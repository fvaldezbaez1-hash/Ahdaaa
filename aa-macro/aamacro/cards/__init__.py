"""Card reading and picking."""

from __future__ import annotations

from .detect import find_cards
from .effects import parse_effects
from .scoring import Card, ScoredCard, choose, score_card

__all__ = ["Card", "ScoredCard", "choose", "score_card", "parse_effects", "find_cards", "CardPicker"]


class CardPicker:
    """Reads the cards on screen and returns the one the user's rules prefer."""

    def __init__(self, settings) -> None:
        self.settings = settings

    def rules(self) -> dict:
        return self.settings.get("cards", {})

    def detect(self, snapshot) -> list[Card]:
        return find_cards(snapshot.image, snapshot.boxes, self.settings.words("card_prompt"),
                          int(self.settings.get("cards.columns_fallback", 3)))

    def count(self, snapshot) -> int:
        if not self.settings.get("cards.enabled", True):
            return 0
        return len(self.detect(snapshot))

    def decide(self, snapshot) -> tuple[ScoredCard | None, list[ScoredCard]]:
        return choose(self.detect(snapshot), self.rules())
