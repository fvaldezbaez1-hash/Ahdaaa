"""The AA Macro window."""

from __future__ import annotations

import logging
import queue
import threading
import time
import tkinter as tk
from tkinter import messagebox, ttk

from .. import APP_NAME, __version__, paths
from ..cards import CardPicker
from ..cards.effects import EFFECT_KEYS
from ..config import DEFAULTS, Settings
from ..control import Control, StopRequested
from ..game.bot import Bot
from ..game.stats import Stats
from ..game.steps import StepError, StepRunner, parse
from ..maps import ProfileStore
from ..movement.routes import Route, RouteRecorder
from ..platform import BackendError, get_backend
from ..vision.ocr import make_engine
from ..vision.preview import PreviewClassifier
from ..vision.screen import ScreenReader
from ..vision.templates import TemplateStore
from .hotkeys import Hotkeys
from .widgets import RegionPicker, scrolled_text, show_image

logger = logging.getLogger("aamacro")

ROLES = ["dps", "farm", "support", "skip"]
MODES = ["story", "infinite", "legend", "raid", "portal", "dungeon", "contract", "infinity castle", "event"]
AFTER = ["replay", "next", "lobby"]

EFFECT_LABELS = {
    "enemy_speed": "Enemy speed", "enemy_health": "Enemy health", "enemy_damage": "Enemy damage",
    "enemy_shield": "Enemy shield/defense", "enemy_count": "More enemies", "reward": "Rewards (gems, pearls…)",
    "unit_damage": "Unit damage", "unit_range": "Unit range", "unit_attack_speed": "Unit attack speed",
    "unit_cooldown": "Unit cooldown / SPA", "cost": "Placement/upgrade cost", "yen": "Yen income",
    "base_health": "Base health", "crit": "Crit",
}


class ScrollFrame(ttk.Frame):
    def __init__(self, parent) -> None:
        super().__init__(parent)
        canvas = tk.Canvas(self, highlightthickness=0)
        sb = ttk.Scrollbar(self, orient="vertical", command=canvas.yview)
        self.inner = ttk.Frame(canvas)
        self.inner.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=self.inner, anchor="nw")
        canvas.configure(yscrollcommand=sb.set)
        canvas.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")
        def wheel(e):
            if e.num == 4:
                step = -1
            elif e.num == 5:
                step = 1
            else:
                step = -1 if e.delta > 0 else 1
            canvas.yview_scroll(step, "units")

        def on_wheel(e):
            # only scroll the page the pointer is over, and let text boxes
            # scroll themselves
            if not str(e.widget).startswith(str(self)) or isinstance(e.widget, (tk.Text, tk.Listbox)):
                return
            wheel(e)

        for seq in ("<MouseWheel>", "<Button-4>", "<Button-5>"):
            self.bind_all(seq, on_wheel, add="+")


class App:
    def __init__(self, root: tk.Tk, settings: Settings | None = None) -> None:
        self.root = root
        self.s = settings or Settings.load()
        self.q: queue.Queue = queue.Queue()
        self.binds: list[tuple] = []
        self.text_lists: list[tuple[tk.Text, str]] = []
        self.backend = None
        self.ocr = None
        self.control = Control()
        self.bot: Bot | None = None
        self.thread: threading.Thread | None = None
        self.store = ProfileStore()
        self.templates = TemplateStore()
        self.stats = Stats()
        self.hotkeys = Hotkeys()
        self.route_rec: RouteRecorder | None = None
        self.teacher = None
        self.task_index = 0

        root.title(f"{APP_NAME} {__version__}")
        root.geometry("980x700")
        root.minsize(860, 560)
        style = ttk.Style(root)
        if "clam" in style.theme_names() and root.tk.call("tk", "windowingsystem") == "x11":
            style.theme_use("clam")
        style.configure("Big.TButton", font=("TkDefaultFont", 12, "bold"), padding=8)
        style.configure("Head.TLabel", font=("TkDefaultFont", 11, "bold"))

        self.nb = ttk.Notebook(root)
        self.nb.pack(fill="both", expand=True, padx=8, pady=(8, 0))
        self._build_run()
        self._build_tasks()
        self._build_team()
        self._build_cards()
        self._build_maps()
        self._build_tools()
        self._build_settings()

        bar = ttk.Frame(root)
        bar.pack(fill="x", padx=8, pady=6)
        ttk.Button(bar, text="Save settings", command=self.save).pack(side="right")
        ttk.Label(bar, text=f"Data folder: {paths.data_dir()}", foreground="#666").pack(side="left")

        self._start_hotkeys()
        root.protocol("WM_DELETE_WINDOW", self.on_close)
        root.after(120, self._poll)

    # ------------------------------------------------------------------
    # generic field helpers
    # ------------------------------------------------------------------
    def field(self, parent, row, label, path, kind="str", choices=None, width=14, col=0, tip=""):
        ttk.Label(parent, text=label).grid(row=row, column=col, sticky="w", padx=(0, 8), pady=2)
        value = self.s.get(path)
        if kind == "bool":
            var = tk.BooleanVar(value=bool(value))
            w = ttk.Checkbutton(parent, variable=var)
        elif kind == "choice":
            var = tk.StringVar(value=str(value))
            w = ttk.Combobox(parent, textvariable=var, values=choices or [], width=width, state="readonly")
        else:
            if kind == "list":
                shown = ", ".join(str(v) for v in (value or []))
            else:
                shown = "" if value is None else str(value)
            var = tk.StringVar(value=shown)
            w = ttk.Entry(parent, textvariable=var, width=width)
        w.grid(row=row, column=col + 1, sticky="w", pady=2)
        if tip:
            ttk.Label(parent, text=tip, foreground="#666").grid(row=row, column=col + 2, sticky="w", padx=6)
        self.binds.append((var, path, kind))
        return var

    def text_list(self, parent, path, height=5, width=30) -> tk.Text:
        t = scrolled_text(parent, height=height, width=width)
        t.insert("1.0", "\n".join(self.s.get(path) or []))
        self.text_lists.append((t, path))
        return t

    def collect(self) -> None:
        """Copy everything from the window into the settings."""
        for var, path, kind in self.binds:
            raw = var.get()
            try:
                if kind == "int":
                    value = int(float(raw))
                elif kind == "float":
                    value = float(raw)
                elif kind == "bool":
                    value = bool(raw)
                elif kind == "list":
                    value = [w.strip() for w in str(raw).split(",") if w.strip()]
                else:
                    value = raw
            except ValueError:
                continue
            self.s.set(path, value)
        for text, path in self.text_lists:
            lines = [ln.strip() for ln in text.get("1.0", "end").splitlines() if ln.strip()]
            self.s.set(path, lines)
        self._collect_team()
        self._commit_task()

    def save(self) -> None:
        self.collect()
        self.s.save()
        self.log("Settings saved")
        self._start_hotkeys()

    # ------------------------------------------------------------------
    # logging / status (thread-safe through the queue)
    # ------------------------------------------------------------------
    def log(self, msg: str) -> None:
        self.q.put(("log", msg))

    def _status(self, status: dict) -> None:
        self.q.put(("status", status))

    def _poll(self) -> None:
        try:
            while True:
                kind, payload = self.q.get_nowait()
                if kind == "log":
                    stamp = time.strftime("%H:%M:%S")
                    self.log_text.configure(state="normal")
                    self.log_text.insert("end", f"{stamp}  {payload}\n")
                    self.log_text.see("end")
                    lines = int(self.log_text.index("end-1c").split(".")[0])
                    if lines > 3000:
                        self.log_text.delete("1.0", f"{lines - 2500}.0")
                    self.log_text.configure(state="disabled")
                elif kind == "status":
                    self._show_status(payload)
                elif kind == "call":
                    payload()
        except queue.Empty:
            pass
        running = bool(self.thread and self.thread.is_alive())
        self.start_btn.configure(state="disabled" if running else "normal")
        self.pause_btn.configure(text="Resume (F2)" if self.control.paused and running else "Pause (F2)")
        self.root.after(120, self._poll)

    def _show_status(self, st: dict) -> None:
        for key, var in self.status_vars.items():
            if key in st and st[key] is not None:
                v = st[key]
                var.set(f"{v:,}" if key == "yen" and isinstance(v, int) else str(v))
        stats = st.get("stats")
        if stats:
            self.stats_var.set(
                f"Runs {stats['runs']}   Wins {stats['wins']}   Losses {stats['losses']}   "
                f"Win rate {stats['win_rate']:.0%}   Avg wave {stats['avg_wave']:.1f}   "
                f"Runs/hour {stats['runs_per_hour']:.1f}")

    # ------------------------------------------------------------------
    # backend / OCR
    # ------------------------------------------------------------------
    def need_backend(self, locate: bool = True):
        try:
            if self.backend is None:
                self.backend = get_backend(self.s)
            if locate:
                self.backend.ensure_window(self.s.get("window.title", "Roblox"))
            return self.backend
        except BackendError as exc:
            messagebox.showerror(APP_NAME, str(exc))
            return None

    def need_ocr(self):
        if self.ocr is None:
            self.ocr = make_engine(self.s)
        return self.ocr

    def run_bg(self, fn, name: str) -> None:
        def wrap():
            try:
                fn()
            except StopRequested:
                self.log(f"{name}: stopped")
            except Exception as exc:
                logger.exception(name)
                self.log(f"{name} failed: {exc}")
        threading.Thread(target=wrap, daemon=True, name=name).start()

    # ------------------------------------------------------------------
    # Run tab
    # ------------------------------------------------------------------
    def _build_run(self) -> None:
        tab = ttk.Frame(self.nb, padding=10)
        self.nb.add(tab, text="Run")
        top = ttk.Frame(tab)
        top.pack(fill="x")
        self.start_btn = ttk.Button(top, text="Start (F1)", style="Big.TButton", command=self.start)
        self.start_btn.pack(side="left")
        self.pause_btn = ttk.Button(top, text="Pause (F2)", style="Big.TButton", command=self.pause)
        self.pause_btn.pack(side="left", padx=6)
        ttk.Button(top, text="Stop (F3)", style="Big.TButton", command=self.stop).pack(side="left")
        ttk.Button(top, text="Find Roblox", command=self.find_roblox).pack(side="right")
        ttk.Label(tab, text="Emergency stop: push the mouse into the top-left corner of the screen.",
                  foreground="#666").pack(anchor="w", pady=(4, 8))

        grid = ttk.LabelFrame(tab, text="Now", padding=8)
        grid.pack(fill="x")
        self.status_vars = {}
        items = [("state", "Screen"), ("task", "Task"), ("map", "Map"), ("wave", "Wave"),
                 ("yen", "Yen"), ("strategy", "Layout"), ("learning", "Learning"), ("last_card", "Last card")]
        for i, (key, label) in enumerate(items):
            r, c = divmod(i, 4)
            ttk.Label(grid, text=label + ":", foreground="#555").grid(row=r, column=c * 2, sticky="w", padx=(0, 4))
            var = tk.StringVar(value="-")
            ttk.Label(grid, textvariable=var, style="Head.TLabel", width=18).grid(row=r, column=c * 2 + 1, sticky="w")
            self.status_vars[key] = var
        self.stats_var = tk.StringVar(value="No runs yet this session")
        ttk.Label(tab, textvariable=self.stats_var).pack(anchor="w", pady=6)

        self.log_text = scrolled_text(tab, height=18)
        self.log_text.frame.pack(fill="both", expand=True)
        self.log_text.configure(state="disabled")

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.collect()
        self.s.save()
        backend = self.need_backend(locate=False)
        if backend is None:
            return
        self.control.reset()
        self.log("Starting… (F2 pause, F3 stop)")
        self.bot = Bot(self.s, backend, self.need_ocr(), self.control, log=self.log, status=self._status,
                       store=self.store, templates=self.templates, stats=self.stats)
        self.thread = threading.Thread(target=self.bot.run, daemon=True, name="bot")
        self.thread.start()

    def pause(self) -> None:
        if self.thread and self.thread.is_alive():
            paused = self.control.toggle_pause()
            self.log("Paused" if paused else "Resumed")

    def stop(self) -> None:
        self.control.stop()

    def find_roblox(self) -> None:
        b = self.need_backend()
        if b:
            w, h = b.size()
            self.log(f'Found "{b.window.title}" — game area {w}x{h}')

    def _start_hotkeys(self) -> None:
        hk = self.s.get("hotkeys")
        ok = self.hotkeys.start({
            hk.get("start", "f1"): lambda: self.q.put(("call", self.start)),
            hk.get("pause", "f2"): lambda: self.q.put(("call", self.pause)),
            hk.get("stop", "f3"): lambda: self.q.put(("call", self.stop)),
        })
        if not ok and self.hotkeys.error:
            self.log(f"Hotkeys unavailable ({self.hotkeys.error}). Use the buttons instead.")

    # ------------------------------------------------------------------
    # Tasks tab
    # ------------------------------------------------------------------
    def _build_tasks(self) -> None:
        tab = ttk.Frame(self.nb, padding=10)
        self.nb.add(tab, text="Tasks")
        left = ttk.Frame(tab)
        left.pack(side="left", fill="y")
        ttk.Label(left, text="Tasks run top to bottom", style="Head.TLabel").pack(anchor="w")
        self.task_list = tk.Listbox(left, height=14, width=26, exportselection=False)
        self.task_list.pack(fill="y", expand=True, pady=4)
        self.task_list.bind("<<ListboxSelect>>", self._select_task)
        row = ttk.Frame(left)
        row.pack(fill="x")
        ttk.Button(row, text="Add", command=self._add_task).pack(side="left")
        ttk.Button(row, text="Copy", command=self._copy_task).pack(side="left", padx=4)
        ttk.Button(row, text="Delete", command=self._delete_task).pack(side="left")
        row2 = ttk.Frame(left)
        row2.pack(fill="x", pady=4)
        ttk.Button(row2, text="▲", width=3, command=lambda: self._move_task(-1)).pack(side="left")
        ttk.Button(row2, text="▼", width=3, command=lambda: self._move_task(1)).pack(side="left", padx=4)

        right = ttk.Frame(tab, padding=(14, 0, 0, 0))
        right.pack(side="left", fill="both", expand=True)
        f = ttk.Frame(right)
        f.pack(fill="x")
        self.tv = {k: tk.StringVar() for k in ("name", "map", "mode", "repeat", "after", "max_waves", "match_route")}
        self.tv_enabled = tk.BooleanVar(value=True)
        rows = [("Name", "name", None), ("Map name (the macro learns one map per name)", "map", "map"),
                ("Mode", "mode", MODES), ("Runs (0 = forever)", "repeat", None),
                ("After each match", "after", AFTER), ("Leave at wave (0 = never)", "max_waves", None),
                ("Walk at match start (optional)", "match_route", "route")]
        for i, (label, key, kind) in enumerate(rows):
            ttk.Label(f, text=label).grid(row=i, column=0, sticky="w", pady=2)
            if isinstance(kind, list):
                w = ttk.Combobox(f, textvariable=self.tv[key], values=kind, width=24, state="readonly")
            elif kind == "map":
                w = ttk.Combobox(f, textvariable=self.tv[key], values=self.store.names(), width=24)
                self.map_combo = w
            elif kind == "route":
                w = ttk.Combobox(f, textvariable=self.tv[key], values=[""] + Route.names(), width=24)
                self.route_combo = w
            else:
                w = ttk.Entry(f, textvariable=self.tv[key], width=26)
            w.grid(row=i, column=1, sticky="w", padx=8)
        ttk.Checkbutton(f, text="Enabled", variable=self.tv_enabled).grid(row=len(rows), column=1, sticky="w", padx=8)

        ttk.Label(right, text="Lobby steps: how to get from the lobby into this match",
                  style="Head.TLabel").pack(anchor="w", pady=(10, 0))
        self.steps_text = scrolled_text(right, height=10)
        self.steps_text.frame.pack(fill="both", expand=True)
        b = ttk.Frame(right)
        b.pack(fill="x", pady=4)
        self.teach_btn = ttk.Button(b, text="Teach (record my clicks)", command=self.toggle_teach)
        self.teach_btn.pack(side="left")
        ttk.Button(b, text="Check script", command=self.check_steps).pack(side="left", padx=4)
        ttk.Button(b, text="Run steps once", command=self.run_steps_once).pack(side="left")
        ttk.Label(right, text="Leave steps (used when 'Leave at wave' is reached)").pack(anchor="w", pady=(8, 0))
        self.leave_text = scrolled_text(right, height=3)
        self.leave_text.frame.pack(fill="x")
        self._refresh_task_list()
        self._load_task(0)

    def _tasks(self) -> list[dict]:
        return self.s.get("tasks")

    def _refresh_task_list(self) -> None:
        self.task_list.delete(0, "end")
        for t in self._tasks():
            mark = "" if t.get("enabled", True) else " (off)"
            self.task_list.insert("end", f"{t.get('name', 'task')}{mark}")
        if self._tasks():
            self.task_list.selection_clear(0, "end")
            self.task_list.selection_set(min(self.task_index, len(self._tasks()) - 1))

    def _load_task(self, i: int) -> None:
        tasks = self._tasks()
        if not tasks:
            return
        self.task_index = max(0, min(i, len(tasks) - 1))
        t = tasks[self.task_index]
        for k, var in self.tv.items():
            var.set(str(t.get(k, "")))
        self.tv_enabled.set(bool(t.get("enabled", True)))
        self.steps_text.delete("1.0", "end")
        self.steps_text.insert("1.0", t.get("lobby_steps", ""))
        self.leave_text.delete("1.0", "end")
        self.leave_text.insert("1.0", t.get("leave_steps", ""))

    def _commit_task(self) -> None:
        tasks = self._tasks()
        if not tasks or not hasattr(self, "steps_text"):
            return
        t = tasks[self.task_index]
        for k, var in self.tv.items():
            v = var.get()
            if k in ("repeat", "max_waves"):
                try:
                    v = int(float(v or 0))
                except ValueError:
                    v = 0
            t[k] = v
        t["enabled"] = bool(self.tv_enabled.get())
        t["lobby_steps"] = self.steps_text.get("1.0", "end").rstrip() + "\n"
        t["leave_steps"] = self.leave_text.get("1.0", "end").strip()

    def _select_task(self, _e=None) -> None:
        sel = self.task_list.curselection()
        if not sel or sel[0] == self.task_index:
            return
        self._commit_task()
        self._load_task(sel[0])
        self._refresh_task_list()

    def _add_task(self) -> None:
        self._commit_task()
        new = dict(DEFAULTS["tasks"][0])
        new["name"] = f"Task {len(self._tasks()) + 1}"
        self._tasks().append(new)
        self.task_index = len(self._tasks()) - 1
        self._refresh_task_list()
        self._load_task(self.task_index)

    def _copy_task(self) -> None:
        self._commit_task()
        t = dict(self._tasks()[self.task_index])
        t["name"] += " copy"
        self._tasks().insert(self.task_index + 1, t)
        self.task_index += 1
        self._refresh_task_list()
        self._load_task(self.task_index)

    def _delete_task(self) -> None:
        if len(self._tasks()) <= 1:
            messagebox.showinfo(APP_NAME, "Keep at least one task (you can switch it off instead).")
            return
        del self._tasks()[self.task_index]
        self.task_index = max(0, self.task_index - 1)
        self._refresh_task_list()
        self._load_task(self.task_index)

    def _move_task(self, d: int) -> None:
        self._commit_task()
        tasks, i = self._tasks(), self.task_index
        j = i + d
        if 0 <= j < len(tasks):
            tasks[i], tasks[j] = tasks[j], tasks[i]
            self.task_index = j
            self._refresh_task_list()

    def check_steps(self) -> None:
        try:
            steps = parse(self.steps_text.get("1.0", "end"))
            messagebox.showinfo(APP_NAME, f"Looks good: {len(steps)} step(s).")
        except StepError as exc:
            messagebox.showerror(APP_NAME, str(exc))

    def run_steps_once(self) -> None:
        b = self.need_backend()
        if not b:
            return
        if self.thread and self.thread.is_alive():
            messagebox.showinfo(APP_NAME, "Stop the macro first.")
            return
        script = self.steps_text.get("1.0", "end")
        self.control.reset()
        control = self.control  # so Stop (F3) also stops this

        def go():
            b.focus()
            StepRunner(b, ScreenReader(b, self.need_ocr(), self.s, self.templates), control, self.s, self.log).run(script)
            self.log("Steps finished")
        self.run_bg(go, "Lobby steps")

    def toggle_teach(self) -> None:
        from ..game.teach import TeachRecorder

        if self.teacher is None:
            b = self.need_backend()
            if not b:
                return
            try:
                self.teacher = TeachRecorder(b, self.need_ocr())
                self.teacher.start()
            except Exception as exc:
                self.teacher = None
                messagebox.showerror(APP_NAME, f"Couldn't start recording: {exc}")
                return
            self.teach_btn.configure(text="Stop teaching")
            self.log("Teaching: click through the menus in Roblox (from the lobby to the match). "
                     "Press 'Stop teaching' when the match starts.")
            return
        teacher, self.teacher = self.teacher, None
        self.teach_btn.configure(text="Teach (record my clicks)")
        self.log("Reading what you clicked…")

        def finish():
            script = teacher.stop()
            self.q.put(("call", lambda: self._set_steps(script)))
        self.run_bg(finish, "Teach")

    def _set_steps(self, script: str) -> None:
        if self.steps_text.get("1.0", "end").strip() and not messagebox.askyesno(
                APP_NAME, "Replace the current lobby steps with the recorded ones?"):
            self.steps_text.insert("end", "\n" + script)
        else:
            self.steps_text.delete("1.0", "end")
            self.steps_text.insert("1.0", script)
        self.log("Recorded steps added to the task")

    # ------------------------------------------------------------------
    # Team tab
    # ------------------------------------------------------------------
    def _build_team(self) -> None:
        tab = ttk.Frame(self.nb, padding=10)
        self.nb.add(tab, text="Team")
        ttk.Label(tab, text="Your hotbar (slots 1–6)", style="Head.TLabel").grid(row=0, column=0, columnspan=7, sticky="w")
        heads = ["Slot", "Name (for you)", "Role", "Copies", "Upgrade to (99 = max)", "Priority (1 = first)",
                 "Range (0 = learn)"]
        for c, h in enumerate(heads):
            ttk.Label(tab, text=h, foreground="#555").grid(row=1, column=c, sticky="w", padx=4)
        self.team_vars = []
        for i in range(6):
            u = self.s.get("team")[i]
            vars_ = {
                "name": tk.StringVar(value=u.get("name", "")),
                "role": tk.StringVar(value=u.get("role", "dps")),
                "max_place": tk.StringVar(value=str(u.get("max_place", 3))),
                "upgrade_to": tk.StringVar(value=str(u.get("upgrade_to", 99))),
                "priority": tk.StringVar(value=str(u.get("priority", i + 1))),
                "range": tk.StringVar(value=str(u.get("range", 0.0))),
            }
            ttk.Label(tab, text=str(i + 1)).grid(row=i + 2, column=0, padx=4)
            ttk.Entry(tab, textvariable=vars_["name"], width=18).grid(row=i + 2, column=1, padx=4, pady=2)
            ttk.Combobox(tab, textvariable=vars_["role"], values=ROLES, width=9, state="readonly").grid(row=i + 2, column=2, padx=4)
            ttk.Spinbox(tab, textvariable=vars_["max_place"], from_=0, to=10, width=5).grid(row=i + 2, column=3, padx=4)
            ttk.Spinbox(tab, textvariable=vars_["upgrade_to"], from_=0, to=99, width=5).grid(row=i + 2, column=4, padx=4)
            ttk.Spinbox(tab, textvariable=vars_["priority"], from_=1, to=6, width=5).grid(row=i + 2, column=5, padx=4)
            ttk.Entry(tab, textvariable=vars_["range"], width=7).grid(row=i + 2, column=6, padx=4)
            self.team_vars.append(vars_)
        help_text = ("Roles: dps = damage (placed where it hits the most path), farm = money units (kept out "
                     "of the way, upgraded early), support = buffers (placed next to your damage units), "
                     "skip = never placed. Copies = how many of that unit to put down (the game's placement cap).")
        ttk.Label(tab, text=help_text, wraplength=860, foreground="#555", justify="left").grid(
            row=9, column=0, columnspan=7, sticky="w", pady=10)
        box = ttk.LabelFrame(tab, text="Build order", padding=8)
        box.grid(row=10, column=0, columnspan=7, sticky="ew")
        self.field(box, 0, "Order", "build.order", "choice", ["auto", "custom"], width=10)
        self.field(box, 1, "Place farm units first", "build.farm_first", "bool")
        self.field(box, 2, "Custom order", "build.custom", "str", width=70,
                   tip="")
        ttk.Label(box, text='e.g.  place 2, place 1 x2, upgrade 2 to 3, upgrade 1 to max, place 3, upgrade all',
                  foreground="#666").grid(row=3, column=0, columnspan=3, sticky="w")

    def _collect_team(self) -> None:
        if not hasattr(self, "team_vars"):
            return
        team = self.s.get("team")
        for i, vars_ in enumerate(self.team_vars):
            u = team[i]
            u["name"] = vars_["name"].get()
            u["role"] = vars_["role"].get() or "dps"
            for k, conv in (("max_place", int), ("upgrade_to", int), ("priority", int), ("range", float)):
                try:
                    u[k] = conv(float(vars_[k].get()))
                except ValueError:
                    pass

    # ------------------------------------------------------------------
    # Cards tab
    # ------------------------------------------------------------------
    def _build_cards(self) -> None:
        sf = ScrollFrame(self.nb)
        self.nb.add(sf, text="Cards")
        tab = sf.inner
        tab.configure(padding=10)
        self.field(tab, 0, "Pick cards automatically", "cards.enabled", "bool")
        ttk.Label(tab, text="Greed", style="Head.TLabel").grid(row=1, column=0, sticky="w", pady=(8, 0))
        greed = tk.DoubleVar(value=float(self.s.get("cards.greed", 0.5)))
        self.binds.append((greed, "cards.greed", "float"))
        row = ttk.Frame(tab)
        row.grid(row=2, column=0, columnspan=4, sticky="w")
        ttk.Label(row, text="Safe").pack(side="left")
        ttk.Scale(row, from_=0, to=1, variable=greed, length=320).pack(side="left", padx=6)
        ttk.Label(row, text="Greedy").pack(side="left")
        ttk.Label(tab, text="Safe prefers cards that make enemies weaker; greedy takes harder cards for "
                            "bigger rewards (e.g. Tsunami's +100% pearls).", foreground="#555",
                  wraplength=820).grid(row=3, column=0, columnspan=4, sticky="w")

        w = ttk.LabelFrame(tab, text="How much each effect matters (per 1%; negative = bad when it goes up)",
                           padding=8)
        w.grid(row=4, column=0, columnspan=4, sticky="ew", pady=8)
        for i, key in enumerate(EFFECT_KEYS):
            r, c = divmod(i, 2)
            self.field(w, r, EFFECT_LABELS.get(key, key), f"cards.weights.{key}", "float", width=7, col=c * 2)

        lists = ttk.Frame(tab)
        lists.grid(row=5, column=0, columnspan=4, sticky="ew")
        specs = [("Always pick (top = best)", "cards.must_pick"), ("Never pick", "cards.never_pick"),
                 ("Dungeon rooms, best first", "cards.room_priority"), ("Curses to avoid", "cards.avoid_curses"),
                 ("Relics, best first", "cards.relic_priority")]
        for i, (label, path) in enumerate(specs):
            r, c = divmod(i, 3)
            box = ttk.Frame(lists, padding=4)
            box.grid(row=r, column=c, sticky="nsew")
            ttk.Label(box, text=label).pack(anchor="w")
            t = self.text_list(box, path, height=6, width=26)
            t.frame.pack(fill="both")
        ttk.Label(tab, text="One card name per line. Names are matched loosely, so small reading mistakes are fine.",
                  foreground="#555").grid(row=6, column=0, columnspan=4, sticky="w")
        ttk.Button(tab, text="Test on the current screen", command=self.test_cards).grid(
            row=7, column=0, sticky="w", pady=8)

    def test_cards(self) -> None:
        b = self.need_backend()
        if not b:
            return
        self.collect()

        def go():
            reader = ScreenReader(b, self.need_ocr(), self.s, self.templates)
            snap = reader.snap()
            best, ranked = CardPicker(self.s).decide(snap)
            if not ranked:
                self.log("No cards found on screen. (Open a card choice in Roblox, then test again.)")
                return
            for r in ranked:
                self.log("  " + r.describe())
            self.log(f"Would pick: {best.card.title}")
        self.run_bg(go, "Card test")

    # ------------------------------------------------------------------
    # Maps tab
    # ------------------------------------------------------------------
    def _build_maps(self) -> None:
        tab = ttk.Frame(self.nb, padding=10)
        self.nb.add(tab, text="Maps")
        ttk.Label(tab, text="Maps the macro has learned", style="Head.TLabel").pack(anchor="w")
        cols = ("runs", "wins", "best_wave", "best", "learned")
        self.map_tree = ttk.Treeview(tab, columns=cols, height=14)
        self.map_tree.heading("#0", text="Map")
        for c, h in zip(cols, ["Runs", "Wins", "Best wave", "Best layout", "Learned"]):
            self.map_tree.heading(c, text=h)
            self.map_tree.column(c, width=90, anchor="center")
        self.map_tree.column("#0", width=260)
        self.map_tree.pack(fill="both", expand=True, pady=6)
        row = ttk.Frame(tab)
        row.pack(fill="x")
        ttk.Button(row, text="Refresh", command=self.refresh_maps).pack(side="left")
        ttk.Button(row, text="View what it learned", command=self.view_map).pack(side="left", padx=4)
        ttk.Button(row, text="Relearn", command=self.relearn_map).pack(side="left")
        ttk.Button(row, text="Delete", command=self.delete_map).pack(side="left", padx=4)
        ttk.Label(tab, text="First run on a new map: it scans where units can go, watches the enemies to find "
                            "the path, then builds several layouts. Every run is scored and the best layout gets "
                            "used more often. Spots the game refuses are remembered and avoided.",
                  foreground="#555", wraplength=880, justify="left").pack(anchor="w", pady=8)
        self.refresh_maps()

    def refresh_maps(self) -> None:
        self.map_tree.delete(*self.map_tree.get_children())
        names = self.store.names()
        for name in names:
            st = self.store.get(name).stats()
            self.map_tree.insert("", "end", text=name, values=(st["runs"], st["wins"], st["best_wave"],
                                                              st["best"] or "-", "yes" if st["learned"] else "not yet"))
        if hasattr(self, "map_combo"):
            self.map_combo.configure(values=names)

    def _selected_map(self) -> str | None:
        sel = self.map_tree.selection()
        return self.map_tree.item(sel[0], "text") if sel else None

    def view_map(self) -> None:
        name = self._selected_map()
        if not name:
            return
        p = self.store.get(name)
        img = p.overlay()
        if img is None:
            messagebox.showinfo(APP_NAME, "Nothing learned for this map yet.")
            return
        show_image(self.root, name, img, "Path: red = where enemies spawn, yellow = near your base. Green tint = "
                                         "placeable ground. Dots = unit spots of the best layout (number = slot). "
                                         "X = spots the game refused.")

    def relearn_map(self) -> None:
        name = self._selected_map()
        if name and messagebox.askyesno(APP_NAME, f'Forget the path and layouts for "{name}" and learn it again?'):
            p = self.store.get(name)
            p.forget()
            p.save()
            self.refresh_maps()

    def delete_map(self) -> None:
        name = self._selected_map()
        if name and messagebox.askyesno(APP_NAME, f'Delete everything learned about "{name}"?'):
            self.store.delete(name)
            self.refresh_maps()

    # ------------------------------------------------------------------
    # Tools tab
    # ------------------------------------------------------------------
    def _build_tools(self) -> None:
        sf = ScrollFrame(self.nb)
        self.nb.add(sf, text="Tools")
        tab = sf.inner
        tab.configure(padding=10)

        win = ttk.LabelFrame(tab, text="Roblox window", padding=8)
        win.pack(fill="x", pady=4)
        self.field(win, 0, "Game area width", "window.client_width", "int", width=7)
        self.field(win, 1, "Game area height", "window.client_height", "int", width=7)
        self.field(win, 2, "Resize Roblox automatically", "window.auto_resize", "bool")
        ttk.Button(win, text="Resize now", command=self.resize_now).grid(row=0, column=3, padx=8)
        ttk.Button(win, text="Read the screen", command=self.read_screen).grid(row=1, column=3, padx=8)

        reg = ttk.LabelFrame(tab, text="Screen areas (drag a box on a screenshot)", padding=8)
        reg.pack(fill="x", pady=4)
        for i, (label, path, prompt) in enumerate([
            ("Map area (where units can go; leave out the menus)", "hud.play_area",
             "Drag a box over the map itself, leaving out the hotbar and other menus."),
            ("Yen counter (optional: found automatically)", "hud.yen_region",
             "Drag a box tightly around your yen/money counter."),
            ("Wave counter (optional: found automatically)", "hud.wave_region",
             "Drag a box around the wave counter."),
        ]):
            ttk.Label(reg, text=label).grid(row=i, column=0, sticky="w")
            ttk.Button(reg, text="Pick", command=lambda p=path, q=prompt: self.pick_region(p, q)).grid(row=i, column=1, padx=4)
            ttk.Button(reg, text="Clear", command=lambda p=path: self.clear_region(p)).grid(row=i, column=2)

        cal = ttk.LabelFrame(tab, text="Placement preview colours (optional, makes scanning exact)", padding=8)
        cal.pack(fill="x", pady=4)
        ttk.Label(cal, text="Click a button, then follow the messages in the Run tab's log.",
                  foreground="#555").grid(row=0, column=0, columnspan=3, sticky="w")
        ttk.Button(cal, text="Sample a spot where units CAN go", command=lambda: self.calibrate("valid")).grid(row=1, column=0, pady=4)
        ttk.Button(cal, text="Sample a spot where units CAN'T go", command=lambda: self.calibrate("invalid")).grid(row=1, column=1, padx=6)
        ttk.Button(cal, text="Reset", command=self.reset_calibration).grid(row=1, column=2)

        walk = ttk.LabelFrame(tab, text="Walking routes", padding=8)
        walk.pack(fill="x", pady=4)
        self.route_name = tk.StringVar(value="play_area")
        self.route_check = tk.StringVar()
        self.route_reset = tk.BooleanVar(value=True)
        ttk.Label(walk, text="Name").grid(row=0, column=0, sticky="w")
        ttk.Entry(walk, textvariable=self.route_name, width=18).grid(row=0, column=1, sticky="w")
        ttk.Label(walk, text="Text you see when you arrive (optional)").grid(row=1, column=0, sticky="w")
        ttk.Entry(walk, textvariable=self.route_check, width=18).grid(row=1, column=1, sticky="w")
        ttk.Checkbutton(walk, text="Respawn first so every walk starts at the same place",
                        variable=self.route_reset).grid(row=2, column=0, columnspan=2, sticky="w")
        self.route_btn = ttk.Button(walk, text="Record walk", command=self.toggle_route)
        self.route_btn.grid(row=0, column=2, padx=8)
        self.route_listbox = tk.Listbox(walk, height=4, width=22)
        self.route_listbox.grid(row=0, column=3, rowspan=3, padx=8)
        ttk.Button(walk, text="Delete", command=self.delete_route).grid(row=1, column=2)
        ttk.Label(walk, text="Use a route in a task with:  walk <name>", foreground="#555").grid(
            row=3, column=0, columnspan=3, sticky="w")
        self._refresh_routes()

        tpl = ttk.LabelFrame(tab, text="Image templates (for buttons with no text)", padding=8)
        tpl.pack(fill="x", pady=4)
        self.tpl_name = tk.StringVar(value="my_button")
        ttk.Entry(tpl, textvariable=self.tpl_name, width=18).grid(row=0, column=0)
        ttk.Button(tpl, text="Capture from screen", command=self.capture_template).grid(row=0, column=1, padx=6)
        ttk.Label(tpl, text="Use with:  click_template <name>", foreground="#555").grid(row=0, column=2)

        demo = ttk.LabelFrame(tab, text="See the learning work (no Roblox needed)", padding=8)
        demo.pack(fill="x", pady=4)
        ttk.Button(demo, text="Run the learning demo", command=self.run_demo).pack(side="left")
        ttk.Label(demo, text="Simulates a map, learns its path and shows where it would put units.",
                  foreground="#555").pack(side="left", padx=8)

    def resize_now(self) -> None:
        self.collect()
        b = self.need_backend()
        if b:
            w, h = int(self.s.get("window.client_width")), int(self.s.get("window.client_height"))
            ok = b.resize_client(w, h)
            self.log(f"Resized Roblox to {w}x{h}" if ok else "Couldn't resize Roblox; resize it by hand")

    def read_screen(self) -> None:
        b = self.need_backend()
        if not b:
            return

        def go():
            reader = ScreenReader(b, self.need_ocr(), self.s, self.templates)
            reader.card_detector = CardPicker(self.s).count
            snap = reader.snap()
            state = reader.classify(snap)
            self.log(f"Screen: {state.value}   wave: {reader.read_wave(snap)}   yen: {reader.read_yen(snap)}")
            self.log("Text seen: " + (snap.text()[:900] or "(none)"))
        self.run_bg(go, "Read screen")

    def _screenshot(self):
        b = self.need_backend()
        if not b:
            return None, None
        try:
            return b, b.capture()
        except BackendError as exc:
            messagebox.showerror(APP_NAME, str(exc))
            return None, None

    def pick_region(self, path: str, prompt: str) -> None:
        _, img = self._screenshot()
        if img is None:
            return
        picker = RegionPicker(self.root, img, prompt)
        self.root.wait_window(picker)
        if picker.result:
            self.s.set(path, [round(v, 4) for v in picker.result])
            self.s.save()
            self.log(f"Saved {path} = {self.s.get(path)}")

    def clear_region(self, path: str) -> None:
        self.s.set(path, None if path != "hud.play_area" else DEFAULTS["hud"]["play_area"])
        self.s.save()
        self.log(f"Reset {path}")

    def calibrate(self, kind: str) -> None:
        b = self.need_backend()
        if not b:
            return
        can = "CAN" if kind == "valid" else "CAN'T"
        self.log(f"Step 1: in Roblox, rest the mouse on a spot where a unit {can} go, with NO unit selected. "
                 "Capturing in 4 seconds…")
        state = {}

        def first():
            pos = b.cursor_screen_pos()
            state["pos"] = b.from_screen(*pos) if pos else None
            state["base"] = b.capture()
            self.log("Step 2: now press a unit's hotkey (keep the mouse still). Capturing in 4 seconds…")
            self.root.after(4000, second)

        def second():
            if not state.get("pos"):
                self.log("Couldn't read the mouse position")
                return
            hover = b.capture()
            radius = max(16, int(0.05 * hover.shape[1]))
            clf = PreviewClassifier()
            res = clf.classify(state["base"], hover, state["pos"], radius, find_ring=False)
            if res.valid is None:
                self.log("Didn't see a unit preview under the mouse. Try again.")
                return
            sample = clf.sample(state["base"], hover, state["pos"], radius)
            cal = dict(self.s.get("learning.preview_calibration") or {})
            cal[kind] = sample
            self.s.set("learning.preview_calibration", cal)
            self.s.save()
            self.log(f"Saved the '{kind}' colour sample. Press the unit's hotkey again to put it away.")

        self.root.after(4000, first)

    def reset_calibration(self) -> None:
        self.s.set("learning.preview_calibration", None)
        self.s.save()
        self.log("Placement colour samples cleared (using automatic red/green detection)")

    def _refresh_routes(self) -> None:
        self.route_listbox.delete(0, "end")
        names = Route.names()
        for n in names:
            self.route_listbox.insert("end", n)
        if hasattr(self, "route_combo"):
            self.route_combo.configure(values=[""] + names)

    def toggle_route(self) -> None:
        if self.route_rec is None:
            try:
                self.route_rec = RouteRecorder()
                self.route_rec.start()
            except Exception as exc:
                self.route_rec = None
                messagebox.showerror(APP_NAME, f"Couldn't start recording: {exc}")
                return
            self.route_btn.configure(text="Stop & save")
            self.log("Recording: click into Roblox and walk (WASD/space). Press 'Stop & save' when you arrive.")
            return
        route = self.route_rec.stop(self.route_name.get().strip() or "route", self.route_check.get().strip(),
                                    self.route_reset.get())
        self.route_rec = None
        self.route_btn.configure(text="Record walk")
        if not route.events:
            self.log("No movement keys were recorded")
            return
        route.save()
        self.log(f'Saved walk "{route.name}" ({route.duration:.1f} s, {len(route.events)} key events)')
        self._refresh_routes()

    def delete_route(self) -> None:
        sel = self.route_listbox.curselection()
        if sel:
            name = self.route_listbox.get(sel[0])
            (paths.routes_dir() / f"{name}.json").unlink(missing_ok=True)
            self._refresh_routes()

    def capture_template(self) -> None:
        _, img = self._screenshot()
        if img is None:
            return
        picker = RegionPicker(self.root, img, "Drag a box tightly around the button or icon.")
        self.root.wait_window(picker)
        crop = picker.crop()
        if crop is not None and crop.size:
            path = self.templates.save(self.tpl_name.get(), crop, img.shape[1])
            self.log(f"Saved template {path.stem}")

    def run_demo(self) -> None:
        def go():
            from ..maps import MapProfile, PathLearner, UnitSpec, choose_spots
            from ..maps.path import play_mask
            from ..sim import SimMap

            sim = SimMap(seed=int(time.time()) % 1000)
            learner = PathLearner((sim.h, sim.w), sim.play_area)
            t = 0.0
            while t < 14:
                learner.feed(sim.render(t), t)
                t += 1 / 6
            model = learner.result()
            units = [UnitSpec(0, "dps", 3, 0.11, 1), UnitSpec(1, "dps", 2, 0.09, 2),
                     UnitSpec(2, "farm", 2, 0.05, 3), UnitSpec(3, "support", 1, 0.08, 4)]
            prof = MapProfile("demo", paths.data_dir() / "demo-unsaved")
            prof.reference = sim.render(0)
            prof.path = model
            prof.set_layout("balanced", choose_spots(model, units, "balanced",
                                                     play=play_mask(model.shape, sim.play_area)))
            prof.layouts["balanced"]["runs"] = 1
            prof.layouts["balanced"]["reward"] = 1.0
            img = prof.overlay()
            self.q.put(("call", lambda: show_image(
                self.root, "Learning demo", img,
                "Simulated map. The macro watched enemies for 14 seconds, found the path (red = spawn, "
                "yellow = base) and placed slots 1–2 (damage) where they cover the most path, 3 (farm) out "
                "of the way and 4 (support) next to the damage units.")))
        self.run_bg(go, "Demo")

    # ------------------------------------------------------------------
    # Settings tab
    # ------------------------------------------------------------------
    def _build_settings(self) -> None:
        sf = ScrollFrame(self.nb)
        self.nb.add(sf, text="Settings")
        tab = sf.inner
        tab.configure(padding=10)

        keys = ttk.LabelFrame(tab, text="Game keys (change if the game uses different ones)", padding=8)
        keys.pack(fill="x", pady=4)
        slots = ttk.Frame(keys)
        slots.grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 4))
        for i in range(6):
            self.field(slots, 0, f"Slot {i + 1}", f"keys.slots.{i}", width=4, col=i * 2)
            slots.grid_columnconfigure(i * 2 + 1, pad=14)
        rows = [("Upgrade unit", "keys.upgrade"), ("Sell unit", "keys.sell"),
                ("Put a selected unit away", "keys.cancel_placement"), ("Zoom out", "keys.zoom_out"),
                ("Zoom in", "keys.zoom_in"), ("Rotate camera left", "keys.rotate_left"),
                ("Rotate camera right", "keys.rotate_right"), ("Deselect after upgrade (blank = none)", "keys.deselect")]
        for i, (label, path) in enumerate(rows):
            self.field(keys, 1 + i, label, path, width=12)
        self.field(keys, 10, "Respawn keys", "keys.reset_sequence", "list", width=18, tip="comma separated")
        ttk.Label(keys, text='"Put a selected unit away": same_key (press the slot again), right_click, or a key name.',
                  foreground="#666").grid(row=11, column=0, columnspan=3, sticky="w")

        hk = ttk.LabelFrame(tab, text="App hotkeys", padding=8)
        hk.pack(fill="x", pady=4)
        self.field(hk, 0, "Start", "hotkeys.start", width=6)
        self.field(hk, 1, "Pause / resume", "hotkeys.pause", width=6)
        self.field(hk, 2, "Stop", "hotkeys.stop", width=6)
        self.field(hk, 3, "Emergency stop when the mouse hits the top-left corner", "safety.failsafe_corner", "bool")

        cam = ttk.LabelFrame(tab, text="Camera", padding=8)
        cam.pack(fill="x", pady=4)
        self.field(cam, 0, "Set the camera at match start", "camera.normalize", "bool")
        self.field(cam, 1, "Zoom-out presses", "camera.zoom_out_presses", "int", width=5)
        self.field(cam, 2, "Zoom-in presses after that", "camera.zoom_in_presses", "int", width=5)
        self.field(cam, 3, "Rotate to match the saved map picture", "camera.align_rotate", "bool")

        learn = ttk.LabelFrame(tab, text="Learning", padding=8)
        learn.pack(fill="x", pady=4)
        self.field(learn, 0, "Learn maps", "learning.enabled", "bool")
        self.field(learn, 1, "Scan grid columns", "learning.scan_cols", "int", width=5)
        self.field(learn, 2, "Scan grid rows", "learning.scan_rows", "int", width=5)
        self.field(learn, 3, "Seconds to watch enemies", "learning.path_learn_seconds", "float", width=5)
        self.field(learn, 4, "Min. space between units (fraction of width)", "learning.min_spacing", "float", width=6)
        self.field(learn, 5, "Default unit range (fraction of width)", "learning.default_range", "float", width=6)
        self.field(learn, 6, "Try other layouts (higher = more often)", "learning.explore", "float", width=5)
        self.field(learn, 7, "Relearn after this many losses in a row", "learning.relearn_after_losses", "int", width=5)

        tim = ttk.LabelFrame(tab, text="Timing (seconds)", padding=8)
        tim.pack(fill="x", pady=4)
        for i, (label, path) in enumerate([
            ("Check the screen every", "timing.state_poll"), ("Between unit actions", "timing.action_interval"),
            ("Mouse hover wait", "timing.hover_delay"), ("Recover after unknown screen for", "timing.unknown_timeout"),
            ("Give up on a match after", "timing.match_timeout"), ("Wait for match to start", "timing.vote_timeout"),
        ]):
            self.field(tim, i, label, path, "float", width=6)

        rc = ttk.LabelFrame(tab, text="Reconnect & reports", padding=8)
        rc.pack(fill="x", pady=4)
        self.field(rc, 0, "Private server link (to rejoin after disconnects)", "reconnect.private_server_link", width=48)
        self.field(rc, 1, "Wait after rejoining", "reconnect.rejoin_wait", "float", width=6)
        self.field(rc, 2, "Discord webhook URL (optional)", "webhook.url", width=48)
        self.field(rc, 3, "Report every N runs", "webhook.every_n", "int", width=5)

        words = ttk.LabelFrame(tab, text="Words the macro looks for on screen (comma separated; fix these if a "
                                         "game update renames a button)", padding=8)
        words.pack(fill="x", pady=4)
        for i, key in enumerate(DEFAULTS["screens"]):
            self.field(words, i, key.replace("_", " ").capitalize(), f"screens.{key}", "list", width=70)

    # ------------------------------------------------------------------
    def on_close(self) -> None:
        self.control.stop()
        try:
            self.collect()
            self.s.save()
        except Exception:
            logger.exception("save on close")
        self.hotkeys.stop()
        if self.route_rec:
            self.route_rec.stop("unsaved")
        self.root.destroy()


def run_app(smoke: float = 0.0) -> int:
    root = tk.Tk()
    app = App(root)
    if smoke:
        def finish():
            app.collect()
            for i in range(len(app.nb.tabs())):
                app.nb.select(i)
                root.update()
            root.destroy()
        root.after(int(smoke * 1000), finish)
    root.mainloop()
    return 0
