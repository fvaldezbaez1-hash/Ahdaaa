"""Cards we already know. Text read from the screen is used for anything not
listed, so new cards still get scored. Values from community guides for
Update 21 (Nov 2026); correct them in-game if they change."""

KNOWN_CARDS: dict[str, dict] = {
    # Summer Hunt weather (Update 21)
    "Low Tide": {"context": "summer", "effects": {"enemy_speed": -25}},
    "Rising Tide": {"context": "summer", "effects": {"reward": 50, "enemy_health": 50}},
    "Tsunami": {"context": "summer", "effects": {"reward": 100, "enemy_speed": 50, "enemy_health": 50}},
    # Dungeon relics (Update 20)
    "Golden Branch": {"context": "dungeon_shop", "effects": {"cost": -15}},
    "Golden Mushroom": {"context": "dungeon_shop", "effects": {"cost": -30}},
    "Glacial Axe": {"context": "dungeon_shop", "effects": {"enemy_speed": -30}},
    "Ice Dagger": {"context": "dungeon_shop", "effects": {"enemy_speed": -20}},
}

# Dungeon room names; ranked by the user's room priority list.
DUNGEON_ROOMS = ["Rare Chest", "Chest", "Shop", "Hoard", "Shrine", "Boss", "Curse"]
