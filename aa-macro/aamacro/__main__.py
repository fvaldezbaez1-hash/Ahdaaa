"""Start AA Macro.

    AA Macro                 open the app
    AA Macro --selftest      check OCR, vision and OS access, then exit
    AA Macro --demo          run the map-learning demo and save a picture
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from logging.handlers import RotatingFileHandler


def _setup_logging() -> None:
    from . import paths

    handler = RotatingFileHandler(paths.logs_dir() / "aamacro.log", maxBytes=2_000_000, backupCount=3,
                                  encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    root = logging.getLogger("aamacro")
    root.setLevel(logging.INFO)
    root.addHandler(handler)


def selftest(out_path: str | None = None) -> int:
    """Checks that work without Roblox; used by the build to verify the app."""
    lines: list[str] = []
    ok = True

    def check(name, fn, required=True):
        nonlocal ok
        t = time.perf_counter()
        try:
            detail = fn()
            lines.append(f"PASS {name} ({time.perf_counter() - t:.2f}s){': ' + str(detail) if detail else ''}")
        except Exception as exc:  # noqa: BLE001
            if required:
                ok = False
                lines.append(f"FAIL {name}: {exc!r}")
            else:
                lines.append(f"WARN {name}: {exc!r} (needs a screen / permission; fine on a build server)")

    def ocr():
        import cv2
        import numpy as np

        from .vision.ocr import RapidOcrEngine, find_text, merge_lines

        img = np.full((160, 560, 3), 25, np.uint8)
        cv2.putText(img, "Return to Lobby", (30, 95), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 3)
        boxes = merge_lines(RapidOcrEngine().read(img))
        if not find_text(boxes, ["return to lobby"]):
            raise RuntimeError(f"read {[b.text for b in boxes]}")
        return " | ".join(b.text for b in boxes)

    def cards():
        from .cards import choose
        from .cards.scoring import Card

        best, _ = choose([Card("Low Tide", "-25% enemy speed", (0, 0)),
                          Card("Tsunami", "+100% SummerPearls, +50% enemy speed, +50% enemy health", (0, 0))],
                         {"greed": 0.5, "weights": {"enemy_speed": -1, "enemy_health": -0.8, "reward": 0.6}})
        if best.card.title != "Low Tide":
            raise RuntimeError(best.card.title)
        return "picked Low Tide"

    def learning():
        from .maps import PathLearner, UnitSpec, choose_spots
        from .sim import SimMap

        sim = SimMap(seed=3)
        learner = PathLearner((sim.h, sim.w), sim.play_area)
        t = 0.0
        while t < 10:
            learner.feed(sim.render(t), t)
            t += 1 / 6
        spots = choose_spots(learner.result(), [UnitSpec(0, "dps", 3, 0.11)], "balanced")
        if len(spots) != 3:
            raise RuntimeError(f"{len(spots)} spots")
        return "3 spots chosen"

    def backend():
        from .platform import get_backend

        b = get_backend()
        found = b.locate("Roblox")
        return f"{b.name} backend; Roblox window {'found' if found else 'not open'}"

    def screen():
        from .platform import capture

        img = capture.grab(0, 0, 64, 64)
        return f"captured {img.shape[1]}x{img.shape[0]}"

    def gui():
        import tkinter  # noqa: F401

        return "tkinter available"

    check("ocr", ocr)
    check("cards", cards)
    check("map learning", learning)
    check("gui toolkit", gui)
    if sys.platform in ("win32", "darwin"):
        check("os backend", backend)
        check("screen capture", screen, required=False)
    report = "\n".join(lines) + f"\n{'ALL OK' if ok else 'SOME CHECKS FAILED'}\n"
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(report)
    if sys.stdout is not None:
        try:
            sys.stdout.write(report)
        except Exception:
            pass
    return 0 if ok else 1


def demo(out_path: str) -> int:
    import cv2

    from .maps import MapProfile, PathLearner, UnitSpec, choose_spots
    from .maps.path import play_mask
    from .sim import SimMap

    sim = SimMap(seed=11)
    learner = PathLearner((sim.h, sim.w), sim.play_area)
    t = 0.0
    while t < 14:
        learner.feed(sim.render(t), t)
        t += 1 / 6
    model = learner.result()
    units = [UnitSpec(0, "dps", 3, 0.11, 1), UnitSpec(1, "dps", 2, 0.09, 2),
             UnitSpec(2, "farm", 2, 0.05, 3), UnitSpec(3, "support", 1, 0.08, 4)]
    from pathlib import Path

    prof = MapProfile("demo", Path(out_path).parent / "demo-unsaved")
    prof.reference = sim.render(0)
    prof.path = model
    prof.set_layout("balanced", choose_spots(model, units, "balanced", play=play_mask(model.shape, sim.play_area)))
    prof.layouts["balanced"].update(runs=1, reward=1.0)
    cv2.imwrite(out_path, prof.overlay())
    print(f"saved {out_path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="AA Macro")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--selftest-out")
    parser.add_argument("--demo", metavar="PNG")
    parser.add_argument("--gui-smoke", type=float, default=0.0, help=argparse.SUPPRESS)
    parser.add_argument("--version", action="store_true")
    args, _ = parser.parse_known_args(argv)
    if args.version:
        from . import __version__

        print(__version__)
        return 0
    if args.selftest:
        return selftest(args.selftest_out)
    if args.demo:
        return demo(args.demo)
    _setup_logging()
    from .ui.app import run_app

    return run_app(args.gui_smoke)


if __name__ == "__main__":
    sys.exit(main())
