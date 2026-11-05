"""Where the app keeps settings, learned maps, routes and logs."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def data_dir() -> Path:
    override = os.environ.get("AAMACRO_HOME")
    if override:
        base = Path(override)
    elif sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home())) / "AAMacro"
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / "AAMacro"
    else:
        base = Path.home() / ".aamacro"
    base.mkdir(parents=True, exist_ok=True)
    return base


def sub(name: str) -> Path:
    p = data_dir() / name
    p.mkdir(parents=True, exist_ok=True)
    return p


def settings_file() -> Path:
    return data_dir() / "settings.json"


def maps_dir() -> Path:
    return sub("maps")


def routes_dir() -> Path:
    return sub("routes")


def templates_dir() -> Path:
    return sub("templates")


def logs_dir() -> Path:
    return sub("logs")


def screenshots_dir() -> Path:
    return sub("screenshots")


def safe_name(name: str) -> str:
    """Turn a user-visible name into a safe file name."""
    keep = "".join(c if c.isalnum() or c in "-_ " else "_" for c in name).strip()
    return keep.replace(" ", "_") or "unnamed"
