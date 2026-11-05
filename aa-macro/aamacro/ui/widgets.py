"""Small Tk helpers: show OpenCV images, pick a region on a screenshot."""

from __future__ import annotations

import base64
import tkinter as tk
from tkinter import ttk

import cv2
import numpy as np


def to_photo(img: np.ndarray, max_w: int = 960, max_h: int = 600) -> tuple[tk.PhotoImage, float]:
    h, w = img.shape[:2]
    scale = min(1.0, max_w / w, max_h / h)
    if scale < 1.0:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, png = cv2.imencode(".png", img)
    return tk.PhotoImage(data=base64.b64encode(png.tobytes()).decode()), scale


def show_image(parent, title: str, img: np.ndarray, caption: str = "") -> None:
    win = tk.Toplevel(parent)
    win.title(title)
    photo, _ = to_photo(img)
    label = ttk.Label(win, image=photo)
    label.image = photo  # keep a reference
    label.pack(padx=8, pady=8)
    if caption:
        ttk.Label(win, text=caption, wraplength=900, justify="left").pack(padx=8, pady=(0, 8), anchor="w")
    ttk.Button(win, text="Close", command=win.destroy).pack(pady=(0, 8))


class RegionPicker(tk.Toplevel):
    """Drag a box on a screenshot; returns [x, y, w, h] as fractions."""

    def __init__(self, parent, img: np.ndarray, prompt: str) -> None:
        super().__init__(parent)
        self.title("Drag a box")
        self.result: list[float] | None = None
        self.img = img
        self.photo, self.scale = to_photo(img, 1000, 620)
        ttk.Label(self, text=prompt, wraplength=980).pack(padx=8, pady=6, anchor="w")
        self.canvas = tk.Canvas(self, width=self.photo.width(), height=self.photo.height(),
                                cursor="crosshair", highlightthickness=0)
        self.canvas.pack(padx=8)
        self.canvas.create_image(0, 0, image=self.photo, anchor="nw")
        self.rect = None
        self.start = None
        self.canvas.bind("<ButtonPress-1>", self._down)
        self.canvas.bind("<B1-Motion>", self._drag)
        bar = ttk.Frame(self)
        bar.pack(fill="x", padx=8, pady=8)
        ttk.Button(bar, text="Use this box", command=self._ok).pack(side="right")
        ttk.Button(bar, text="Cancel", command=self.destroy).pack(side="right", padx=6)
        self.transient(parent)
        self.grab_set()

    def _down(self, e):
        self.start = (e.x, e.y)
        if self.rect:
            self.canvas.delete(self.rect)
        self.rect = self.canvas.create_rectangle(e.x, e.y, e.x, e.y, outline="#ff3b6b", width=2)

    def _drag(self, e):
        if self.rect and self.start:
            self.canvas.coords(self.rect, self.start[0], self.start[1], e.x, e.y)

    def _ok(self):
        if self.rect:
            x0, y0, x1, y1 = self.canvas.coords(self.rect)
            W, H = self.photo.width(), self.photo.height()
            x0, x1 = sorted((max(0, x0), min(W, x1)))
            y0, y1 = sorted((max(0, y0), min(H, y1)))
            if x1 - x0 > 3 and y1 - y0 > 3:
                self.result = [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H]
        self.destroy()

    def crop(self) -> np.ndarray | None:
        if not self.result:
            return None
        h, w = self.img.shape[:2]
        x, y, rw, rh = self.result
        return self.img[int(y * h):int((y + rh) * h), int(x * w):int((x + rw) * w)].copy()


def scrolled_text(parent, height: int = 8, width: int = 60) -> tk.Text:
    frame = ttk.Frame(parent)
    text = tk.Text(frame, height=height, width=width, wrap="word", undo=True, font="TkFixedFont")
    sb = ttk.Scrollbar(frame, orient="vertical", command=text.yview)
    text.configure(yscrollcommand=sb.set)
    text.pack(side="left", fill="both", expand=True)
    sb.pack(side="right", fill="y")
    text.frame = frame
    return text
