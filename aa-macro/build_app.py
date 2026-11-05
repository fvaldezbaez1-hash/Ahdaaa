"""Builds the app with PyInstaller: python build_app.py

Output: dist/AA Macro/ (Windows/Linux) or dist/AA Macro.app (macOS).
"""
import sys

import PyInstaller.__main__

args = [
    "run_app.py",
    "--name", "AA Macro",
    "--noconfirm",
    "--clean",
    "--windowed",
    "--collect-all", "rapidocr_onnxruntime",
    "--collect-binaries", "onnxruntime",
    "--hidden-import", "pynput.keyboard._win32",
    "--hidden-import", "pynput.mouse._win32",
    "--hidden-import", "pynput.keyboard._darwin",
    "--hidden-import", "pynput.mouse._darwin",
    "--hidden-import", "pynput.keyboard._xorg",
    "--hidden-import", "pynput.mouse._xorg",
]
if sys.platform == "darwin":
    args += ["--osx-bundle-identifier", "com.aamacro.app"]
PyInstaller.__main__.run(args)
