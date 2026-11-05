"""Windows backend: Win32 via ctypes (no pywin32 needed).

Keys are sent as hardware scan codes, because Roblox ignores plain virtual
key events for movement. The mouse is moved with SetCursorPos followed by a
1-pixel relative nudge, which Roblox needs to register hover.
"""

from __future__ import annotations

import ctypes
import time
from ctypes import wintypes

import numpy as np

from . import capture
from .base import Backend, BackendError, WindowInfo, norm_key

user32 = ctypes.WinDLL("user32", use_last_error=True)


def _enable_dpi_awareness() -> None:
    """Make window rects and capture both use physical pixels."""
    try:
        # PER_MONITOR_AWARE_V2
        if user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):
            return
    except (AttributeError, OSError):
        pass
    try:
        ctypes.WinDLL("shcore").SetProcessDpiAwareness(2)
        return
    except (AttributeError, OSError):
        pass
    try:
        user32.SetProcessDPIAware()
    except (AttributeError, OSError):
        pass


_enable_dpi_awareness()

ULONG_PTR = ctypes.c_size_t

INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_SCANCODE = 0x0008
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_MIDDLEDOWN = 0x0020
MOUSEEVENTF_MIDDLEUP = 0x0040
MOUSEEVENTF_WHEEL = 0x0800
MAPVK_VK_TO_VSC = 0
SW_RESTORE = 9
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _INPUTUNION)]


user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
user32.SendInput.restype = wintypes.UINT
user32.MapVirtualKeyW.argtypes = [wintypes.UINT, wintypes.UINT]
user32.MapVirtualKeyW.restype = wintypes.UINT
user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                ctypes.c_int, ctypes.c_int, wintypes.UINT]
user32.GetForegroundWindow.restype = wintypes.HWND
user32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
user32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]

WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows.argtypes = [WNDENUMPROC, wintypes.LPARAM]

VK = {
    "esc": 0x1B, "enter": 0x0D, "space": 0x20, "tab": 0x09, "backspace": 0x08,
    "shift": 0xA0, "rshift": 0xA1, "ctrl": 0xA2, "rctrl": 0xA3, "alt": 0xA4, "ralt": 0xA5,
    "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
    "insert": 0x2D, "delete": 0x2E, "home": 0x24, "end": 0x23, "pageup": 0x21, "pagedown": 0x22,
    "comma": 0xBC, "period": 0xBE, "slash": 0xBF, "minus": 0xBD, "equals": 0xBB,
    "semicolon": 0xBA, "quote": 0xDE, "lbracket": 0xDB, "rbracket": 0xDD,
    "backslash": 0xDC, "grave": 0xC0, "capslock": 0x14,
}
VK.update({f"f{i}": 0x6F + i for i in range(1, 13)})
EXTENDED = {"left", "up", "right", "down", "insert", "delete", "home", "end",
            "pageup", "pagedown", "rctrl", "ralt"}


def _vk(key: str) -> int:
    k = norm_key(key)
    if k in VK:
        return VK[k]
    if len(k) == 1 and (k.isalpha() or k.isdigit()):
        return ord(k.upper())
    raise BackendError(f"Unknown key: {key!r}")


def _send(*inputs: INPUT) -> None:
    arr = (INPUT * len(inputs))(*inputs)
    sent = user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))
    if sent != len(inputs):
        raise BackendError(f"SendInput failed (error {ctypes.get_last_error()}). "
                           "If Roblox runs as admin, run AA Macro as admin too.")


def _mouse(flags: int, dx: int = 0, dy: int = 0, data: int = 0) -> INPUT:
    inp = INPUT(type=INPUT_MOUSE)
    inp.mi = MOUSEINPUT(dx, dy, data & 0xFFFFFFFF, flags, 0, 0)
    return inp


def _key(key: str, up: bool) -> INPUT:
    k = norm_key(key)
    vk = _vk(k)
    scan = user32.MapVirtualKeyW(vk, MAPVK_VK_TO_VSC)
    flags = KEYEVENTF_SCANCODE | (KEYEVENTF_KEYUP if up else 0)
    if k in EXTENDED:
        flags |= KEYEVENTF_EXTENDEDKEY
    inp = INPUT(type=INPUT_KEYBOARD)
    inp.ki = KEYBDINPUT(0, scan, flags, 0, 0)
    return inp


_BUTTONS = {
    "left": (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
    "right": (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
    "middle": (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
}


def _window_text(hwnd) -> str:
    n = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def _class_name(hwnd) -> str:
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


class WindowsBackend(Backend):
    name = "windows"

    def locate(self, title: str) -> WindowInfo | None:
        found: list = []
        want = title.strip().lower()

        @WNDENUMPROC
        def cb(hwnd, _lparam):
            if user32.IsWindowVisible(hwnd):
                text = _window_text(hwnd)
                if text and (text.strip().lower() == want or
                             (want in text.lower() and _class_name(hwnd) == "WINDOWSCLIENT")):
                    found.append(hwnd)
            return True

        user32.EnumWindows(cb, 0)
        if not found:
            self.window = None
            return None
        # Prefer the real Roblox client class, then the biggest window.
        def score(h):
            r = wintypes.RECT()
            user32.GetClientRect(h, ctypes.byref(r))
            return (_class_name(h) == "WINDOWSCLIENT", (r.right - r.left) * (r.bottom - r.top))

        hwnd = max(found, key=score)
        self.window = self._info(hwnd)
        return self.window

    def _info(self, hwnd) -> WindowInfo:
        r = wintypes.RECT()
        user32.GetClientRect(hwnd, ctypes.byref(r))
        pt = wintypes.POINT(0, 0)
        user32.ClientToScreen(hwnd, ctypes.byref(pt))
        return WindowInfo(hwnd, _window_text(hwnd), pt.x, pt.y, r.right - r.left, r.bottom - r.top, 1.0)

    def _require(self) -> WindowInfo:
        if not self.window:
            raise BackendError("Game window not located yet.")
        return self.window

    def refresh(self) -> WindowInfo:
        w = self._require()
        self.window = self._info(w.handle)
        return self.window

    def focus(self) -> None:
        w = self._require()
        hwnd = w.handle
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, SW_RESTORE)
            time.sleep(0.3)
        if user32.GetForegroundWindow() != hwnd:
            user32.SetForegroundWindow(hwnd)
            time.sleep(0.15)
        if user32.GetForegroundWindow() != hwnd:
            # Windows only lets the foreground app steal focus; a tap of
            # ALT counts as user input and unlocks it.
            _send(_key("alt", False), _key("alt", True))
            user32.SetForegroundWindow(hwnd)
            time.sleep(0.15)
        self.refresh()

    def resize_client(self, width: int, height: int) -> bool:
        w = self._require()
        hwnd = w.handle
        user32.ShowWindow(hwnd, SW_RESTORE)
        wr, cr = wintypes.RECT(), wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(wr))
        user32.GetClientRect(hwnd, ctypes.byref(cr))
        border_w = (wr.right - wr.left) - (cr.right - cr.left)
        border_h = (wr.bottom - wr.top) - (cr.bottom - cr.top)
        ok = user32.SetWindowPos(hwnd, None, wr.left, wr.top, width + border_w,
                                 height + border_h, SWP_NOZORDER | SWP_NOACTIVATE)
        time.sleep(0.4)
        info = self.refresh()
        return bool(ok) and abs(info.width - width) <= 2 and abs(info.height - height) <= 2

    def capture(self) -> np.ndarray:
        w = self.refresh()
        if w.width <= 0 or w.height <= 0:
            raise BackendError("Roblox window is minimised.")
        return capture.grab(w.left, w.top, w.width, w.height)

    def _to_screen(self, x: float, y: float) -> tuple[int, int]:
        w = self._require()
        return int(round(w.left + x)), int(round(w.top + y))

    def move(self, x: float, y: float) -> None:
        sx, sy = self._to_screen(x, y)
        user32.SetCursorPos(sx, sy)
        _send(_mouse(MOUSEEVENTF_MOVE, 1, 0))
        _send(_mouse(MOUSEEVENTF_MOVE, -1, 0))

    def mouse_down(self, button: str = "left") -> None:
        _send(_mouse(_BUTTONS[button][0]))

    def mouse_up(self, button: str = "left") -> None:
        _send(_mouse(_BUTTONS[button][1]))

    def scroll(self, clicks: int) -> None:
        step = 1 if clicks > 0 else -1
        for _ in range(abs(int(clicks))):
            _send(_mouse(MOUSEEVENTF_WHEEL, data=120 * step))
            time.sleep(0.02)

    def key_down(self, key: str) -> None:
        _send(_key(key, False))

    def key_up(self, key: str) -> None:
        _send(_key(key, True))

    def cursor_screen_pos(self) -> tuple[float, float] | None:
        pt = wintypes.POINT()
        if user32.GetCursorPos(ctypes.byref(pt)):
            return float(pt.x), float(pt.y)
        return None
