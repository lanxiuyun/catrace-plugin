import ctypes
import io
import os
import struct
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

from ctypes import wintypes
from loguru import logger
import pythoncom
import win32com.client
import win32clipboard
import win32gui
import win32process
from PIL import Image, ImageGrab

WH_KEYBOARD_LL = 13
WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
WM_SYSKEYDOWN = 0x0104
WM_SYSKEYUP = 0x0105
WM_APP = 0x8000
WM_APP_PASTE_IMAGE = WM_APP + 1
VK_V = 0x56
VK_CONTROL = 0x11
VK_LCONTROL = 0xA2
VK_RCONTROL = 0xA3
LLKHF_INJECTED = 0x10
GA_ROOT = 2
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
INJECTED_MAGIC = 0x5049464D

TARGET_EXPLORER_CLASSES = {"CabinetWClass", "ExploreWClass"}
TARGET_DESKTOP_CLASSES = {"Progman", "WorkerW", "SHELLDLL_DefView", "SysListView32"}

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

LRESULT = ctypes.c_longlong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_long
ULONG_PTR = (
    ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong
)
HOOKPROC = ctypes.WINFUNCTYPE(LRESULT, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class GUITHREADINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("hwndActive", wintypes.HWND),
        ("hwndFocus", wintypes.HWND),
        ("hwndCapture", wintypes.HWND),
        ("hwndMenuOwner", wintypes.HWND),
        ("hwndMoveSize", wintypes.HWND),
        ("hwndCaret", wintypes.HWND),
        ("rcCaret", wintypes.RECT),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class INPUT_UNION(ctypes.Union):
    _fields_ = [("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", INPUT_UNION)]


@dataclass
class ForegroundContext:
    hwnd: int
    root_hwnd: int
    class_name: str
    process_name: str
    is_desktop: bool
    is_explorer: bool

    @property
    def is_target(self) -> bool:
        return self.is_desktop or self.is_explorer


kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.QueryFullProcessImageNameW.argtypes = [
    wintypes.HANDLE,
    wintypes.DWORD,
    wintypes.LPWSTR,
    ctypes.POINTER(wintypes.DWORD),
]
kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.CloseHandle.restype = wintypes.BOOL
user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
user32.GetAncestor.restype = wintypes.HWND
user32.GetWindowThreadProcessId.argtypes = [
    wintypes.HWND,
    ctypes.POINTER(wintypes.DWORD),
]
user32.GetWindowThreadProcessId.restype = wintypes.DWORD
user32.GetGUIThreadInfo.argtypes = [wintypes.DWORD, ctypes.POINTER(GUITHREADINFO)]
user32.GetGUIThreadInfo.restype = wintypes.BOOL
user32.PostThreadMessageW.argtypes = [
    wintypes.DWORD,
    wintypes.UINT,
    wintypes.WPARAM,
    wintypes.LPARAM,
]
user32.PostThreadMessageW.restype = wintypes.BOOL
user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
user32.SendInput.restype = wintypes.UINT
user32.SetWindowsHookExW.argtypes = [
    ctypes.c_int,
    HOOKPROC,
    wintypes.HINSTANCE,
    wintypes.DWORD,
]
user32.SetWindowsHookExW.restype = wintypes.HHOOK
user32.CallNextHookEx.argtypes = [
    wintypes.HHOOK,
    ctypes.c_int,
    wintypes.WPARAM,
    wintypes.LPARAM,
]
user32.CallNextHookEx.restype = LRESULT
user32.UnhookWindowsHookEx.argtypes = [wintypes.HHOOK]
user32.UnhookWindowsHookEx.restype = wintypes.BOOL
user32.IsChild.argtypes = [wintypes.HWND, wintypes.HWND]
user32.IsChild.restype = wintypes.BOOL
user32.GetMessageW.argtypes = [
    ctypes.POINTER(wintypes.MSG),
    wintypes.HWND,
    wintypes.UINT,
    wintypes.UINT,
]
user32.GetMessageW.restype = wintypes.BOOL
user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.TranslateMessage.restype = wintypes.BOOL
user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.DispatchMessageW.restype = LRESULT
kernel32.GetCurrentThreadId.argtypes = []
kernel32.GetCurrentThreadId.restype = wintypes.DWORD

hook_handle = None
keyboard_proc_ref = None
main_thread_id = 0
pending_candidates: set[int] = set()
ctrl_v_event_counter = 0


def get_process_name(pid: int) -> str:
    process_handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not process_handle:
        return ""

    try:
        buffer_size = wintypes.DWORD(1024)
        process_path = ctypes.create_unicode_buffer(buffer_size.value)
        ok = kernel32.QueryFullProcessImageNameW(
            process_handle, 0, process_path, ctypes.byref(buffer_size)
        )
        if not ok:
            return ""
        return os.path.basename(process_path.value).lower()
    finally:
        kernel32.CloseHandle(process_handle)


def get_window_class_name(hwnd: int) -> str:
    try:
        return win32gui.GetClassName(hwnd)
    except Exception:
        return ""


def has_ancestor_class(hwnd: int, class_names: set[str], max_depth: int = 8) -> bool:
    current = hwnd
    for _ in range(max_depth):
        if not current:
            return False
        try:
            current_class = win32gui.GetClassName(current)
        except Exception:
            return False
        if current_class in class_names:
            return True
        current = win32gui.GetParent(current)
    return False


def get_foreground_context() -> ForegroundContext | None:
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return None

    root_hwnd = user32.GetAncestor(hwnd, GA_ROOT) or hwnd

    try:
        class_name = win32gui.GetClassName(hwnd)
    except Exception:
        class_name = ""

    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
    except Exception:
        pid = 0

    process_name = get_process_name(pid) if pid else ""
    is_desktop = (
        process_name == "explorer.exe"
        and class_name in TARGET_DESKTOP_CLASSES
        and (
            class_name in {"Progman", "WorkerW"}
            or has_ancestor_class(hwnd, {"SHELLDLL_DefView", "WorkerW", "Progman"})
        )
    )

    try:
        root_class_name = win32gui.GetClassName(root_hwnd)
    except Exception:
        root_class_name = ""

    is_explorer = (
        process_name == "explorer.exe" and root_class_name in TARGET_EXPLORER_CLASSES
    )

    return ForegroundContext(
        hwnd=hwnd,
        root_hwnd=root_hwnd,
        class_name=class_name,
        process_name=process_name,
        is_desktop=is_desktop,
        is_explorer=is_explorer,
    )


def get_root_window(hwnd: int) -> int:
    if not hwnd:
        return 0
    return user32.GetAncestor(hwnd, GA_ROOT) or hwnd


def get_window_candidates() -> set[int]:
    candidates: set[int] = set()
    foreground = user32.GetForegroundWindow()
    if foreground:
        candidates.add(int(foreground))
        candidates.add(int(get_root_window(foreground)))

        pid = wintypes.DWORD(0)
        thread_id = user32.GetWindowThreadProcessId(foreground, ctypes.byref(pid))
        gui = GUITHREADINFO(cbSize=ctypes.sizeof(GUITHREADINFO))
        if thread_id and user32.GetGUIThreadInfo(thread_id, ctypes.byref(gui)):
            for hwnd in (gui.hwndActive, gui.hwndFocus):
                if hwnd:
                    candidates.add(int(hwnd))
                    candidates.add(int(get_root_window(hwnd)))
    return {hwnd for hwnd in candidates if hwnd}


def parse_location_url(location_url: str) -> Path | None:
    if not location_url:
        return None
    parsed = urlparse(location_url)
    if parsed.scheme != "file":
        return None

    path_text = unquote(parsed.path)
    if path_text.startswith("/") and len(path_text) > 2 and path_text[2] == ":":
        path_text = path_text[1:]
    path_text = path_text.replace("/", "\\")
    return Path(path_text)


def build_window_candidates(context: ForegroundContext) -> set[int]:
    candidates = {int(context.hwnd), int(context.root_hwnd)}

    current = int(context.hwnd)
    for _ in range(6):
        if not current:
            break
        current = win32gui.GetParent(current)
        if not current:
            break
        candidates.add(int(current))

    foreground = user32.GetForegroundWindow()
    if foreground:
        candidates.add(int(foreground))
        candidates.add(int(user32.GetAncestor(foreground, GA_ROOT) or foreground))

        pid = wintypes.DWORD(0)
        thread_id = user32.GetWindowThreadProcessId(foreground, ctypes.byref(pid))
        gui = GUITHREADINFO(cbSize=ctypes.sizeof(GUITHREADINFO))
        if thread_id and user32.GetGUIThreadInfo(thread_id, ctypes.byref(gui)):
            for hwnd in (gui.hwndActive, gui.hwndFocus):
                if hwnd:
                    candidates.add(int(hwnd))
                    candidates.add(int(user32.GetAncestor(hwnd, GA_ROOT) or hwnd))

    return {hwnd for hwnd in candidates if hwnd}


def window_matches_candidates(window_hwnd: int, candidates: set[int]) -> bool:
    if not candidates:
        return False
    if window_hwnd in candidates:
        return True
    return any(
        bool(user32.IsChild(window_hwnd, hwnd))
        or bool(user32.IsChild(hwnd, window_hwnd))
        for hwnd in candidates
    )


def get_explorer_folder(candidates: set[int], retries: int = 6) -> Path | None:
    if not candidates:
        return None

    for _ in range(retries):
        pythoncom.CoInitialize()
        try:
            shell = win32com.client.Dispatch("Shell.Application")
            for window in shell.Windows():
                try:
                    window_hwnd = int(window.HWND)
                    is_match = window_hwnd in candidates or any(
                        bool(user32.IsChild(window_hwnd, hwnd)) for hwnd in candidates
                    )
                    if not is_match:
                        continue
                    try:
                        folder_path = str(window.Document.Folder.Self.Path)
                        if folder_path:
                            return Path(folder_path)
                    except Exception:
                        pass

                    location_path = parse_location_url(str(window.LocationURL))
                    if location_path:
                        return location_path
                except Exception:
                    continue
        except Exception:
            pass
        finally:
            pythoncom.CoUninitialize()
        time.sleep(0.03)
    return None


def resolve_save_directory(candidates: set[int]) -> Path | None:
    if not candidates:
        return None
    for hwnd in candidates:
        if get_window_class_name(hwnd) in TARGET_DESKTOP_CLASSES:
            return Path.home() / "Desktop"
    return get_explorer_folder(candidates, retries=8)


def grab_clipboard_image() -> Image.Image | None:
    try:
        data = ImageGrab.grabclipboard()
    except Exception:
        data = None

    if isinstance(data, Image.Image):
        return data
    return grab_clipboard_image_from_win32()


def get_dib_image_offset(dib_data: bytes) -> int:
    if len(dib_data) < 16:
        raise ValueError("DIB data is too short.")

    header_size = struct.unpack_from("<I", dib_data, 0)[0]
    bit_count = struct.unpack_from("<H", dib_data, 14)[0]
    compression = struct.unpack_from("<I", dib_data, 16)[0]
    colors_used = 0
    if header_size >= 36 and len(dib_data) >= 36:
        colors_used = struct.unpack_from("<I", dib_data, 32)[0]

    offset = header_size
    if bit_count <= 8:
        palette_entries = colors_used or (1 << bit_count)
        offset += palette_entries * 4
    elif compression == 3:
        if header_size == 40:
            offset += 12
        elif header_size >= 52:
            offset += 16
    return offset


def image_from_dib(dib_data: bytes) -> Image.Image | None:
    if not dib_data:
        return None

    try:
        pixel_offset = get_dib_image_offset(dib_data)
        file_size = 14 + len(dib_data)
        bmp_header = struct.pack(
            "<2sIHHI",
            b"BM",
            file_size,
            0,
            0,
            14 + pixel_offset,
        )
        image = Image.open(io.BytesIO(bmp_header + dib_data))
        image.load()
        return image
    except Exception as exc:
        logger.debug(f"Failed to decode DIB clipboard image: {exc}")
        return None


def grab_clipboard_image_from_win32() -> Image.Image | None:
    png_format = win32clipboard.RegisterClipboardFormat("PNG")
    formats = [
        png_format,
        win32clipboard.CF_DIB,
        getattr(win32clipboard, "CF_DIBV5", 17),
    ]

    try:
        win32clipboard.OpenClipboard()
    except Exception as exc:
        logger.debug(f"Failed to open clipboard: {exc}")
        return None

    try:
        for clipboard_format in formats:
            try:
                if not win32clipboard.IsClipboardFormatAvailable(clipboard_format):
                    continue
                data = win32clipboard.GetClipboardData(clipboard_format)
            except Exception as exc:
                logger.debug(
                    f"Failed to read clipboard format {clipboard_format}: {exc}"
                )
                continue

            if not data:
                continue

            try:
                if clipboard_format == png_format:
                    image = Image.open(io.BytesIO(data))
                    image.load()
                    return image
                image = image_from_dib(data)
                if image is not None:
                    return image
            except Exception as exc:
                logger.debug(
                    f"Failed to decode clipboard format {clipboard_format}: {exc}"
                )
                continue
    finally:
        win32clipboard.CloseClipboard()

    return None


def clipboard_has_image() -> bool:
    return grab_clipboard_image() is not None


def build_output_path(directory: Path) -> Path:
    timestamp = datetime.now().strftime("%Y-%m-%d %H-%M-%S")
    base_name = f"Pasted Image {timestamp}"
    candidate = directory / f"{base_name}.png"

    sequence = 1
    while candidate.exists():
        sequence += 1
        candidate = directory / f"{base_name} ({sequence}).png"
    return candidate


def save_clipboard_image(save_directory: Path) -> bool:
    image = grab_clipboard_image()
    if image is None:
        return False

    try:
        save_directory.mkdir(parents=True, exist_ok=True)
        output_path = build_output_path(save_directory)
        image.save(output_path, format="PNG")
        logger.info(f"Saved image: {output_path}")
        return True
    except Exception as exc:
        logger.error(f"Failed to save image: {exc}")
        return False


def ctrl_pressed() -> bool:
    return any(
        user32.GetAsyncKeyState(vk_code) & 0x8000
        for vk_code in (VK_CONTROL, VK_LCONTROL, VK_RCONTROL)
    )


def send_ctrl_v() -> None:
    inputs = (INPUT * 4)(
        INPUT(
            type=INPUT_KEYBOARD,
            ki=KEYBDINPUT(wVk=VK_CONTROL, dwExtraInfo=INJECTED_MAGIC),
        ),
        INPUT(type=INPUT_KEYBOARD, ki=KEYBDINPUT(wVk=VK_V, dwExtraInfo=INJECTED_MAGIC)),
        INPUT(
            type=INPUT_KEYBOARD,
            ki=KEYBDINPUT(
                wVk=VK_V, dwFlags=KEYEVENTF_KEYUP, dwExtraInfo=INJECTED_MAGIC
            ),
        ),
        INPUT(
            type=INPUT_KEYBOARD,
            ki=KEYBDINPUT(
                wVk=VK_CONTROL, dwFlags=KEYEVENTF_KEYUP, dwExtraInfo=INJECTED_MAGIC
            ),
        ),
    )
    user32.SendInput(len(inputs), inputs, ctypes.sizeof(INPUT))


def should_intercept_paste(candidates: set[int]) -> bool:
    if not candidates:
        return False
    if not clipboard_has_image():
        return False
    for hwnd in candidates:
        class_name = get_window_class_name(hwnd)
        if (
            class_name in TARGET_DESKTOP_CLASSES
            or class_name in TARGET_EXPLORER_CLASSES
        ):
            return True
    return False


def handle_intercepted_paste(candidates: set[int]) -> None:
    folder = resolve_save_directory(candidates)
    if folder is None:
        logger.warning("Could not resolve save directory, fallback to normal Ctrl+V.")
        send_ctrl_v()
        return
    logger.info(f"Resolved save directory: {folder}")
    if not save_clipboard_image(folder):
        logger.warning(
            "Clipboard has no image or save failed, fallback to normal Ctrl+V."
        )
        send_ctrl_v()


def keyboard_proc(n_code: int, w_param: int, l_param: int) -> int:
    global pending_candidates, ctrl_v_event_counter

    if n_code < 0:
        return user32.CallNextHookEx(hook_handle, n_code, w_param, l_param)

    kb_data = ctypes.cast(l_param, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents

    if kb_data.vkCode == VK_V and w_param in (WM_KEYDOWN, WM_SYSKEYDOWN):
        ctrl_v_event_counter += 1
        is_injected = bool(kb_data.flags & LLKHF_INJECTED)
        is_our_injected = int(kb_data.dwExtraInfo) == INJECTED_MAGIC
        is_ctrl_down = ctrl_pressed()
        context = get_foreground_context()
        if context:
            logger.debug(
                f"Ctrl+V event#{ctrl_v_event_counter} time={kb_data.time} injected={is_injected} "
                f"our_injected={is_our_injected} ctrl_down={is_ctrl_down} "
                f"class={context.class_name} process={context.process_name} "
                f"target={context.is_target}"
            )
        else:
            logger.debug(
                f"Ctrl+V event#{ctrl_v_event_counter} time={kb_data.time} injected={is_injected} "
                f"our_injected={is_our_injected} ctrl_down={is_ctrl_down} foreground=<none>"
            )

    if (
        kb_data.vkCode == VK_V
        and w_param in (WM_KEYDOWN, WM_SYSKEYDOWN)
        and int(kb_data.dwExtraInfo) != INJECTED_MAGIC
        and ctrl_pressed()
    ):
        candidates = get_window_candidates()
        if should_intercept_paste(candidates):
            pending_candidates = set(candidates)
            if main_thread_id:
                ok = bool(
                    user32.PostThreadMessageW(main_thread_id, WM_APP_PASTE_IMAGE, 0, 0)
                )
                if ok:
                    logger.info(
                        f"Ctrl+V intercepted, WM_APP posted. candidates={sorted(pending_candidates)}"
                    )
                else:
                    logger.error(
                        f"PostThreadMessageW failed, last_error={ctypes.get_last_error()}"
                    )
            else:
                logger.error("Ctrl+V intercept failed: main_thread_id is empty.")
            return 1
        logger.debug("Ctrl+V passthrough: non-target window.")

    return user32.CallNextHookEx(hook_handle, n_code, w_param, l_param)


def install_hook() -> None:
    global hook_handle, keyboard_proc_ref
    keyboard_proc_ref = HOOKPROC(keyboard_proc)
    hook_handle = user32.SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_proc_ref, None, 0)
    if not hook_handle:
        raise ctypes.WinError(ctypes.get_last_error())


def uninstall_hook() -> None:
    global hook_handle
    if hook_handle:
        user32.UnhookWindowsHookEx(hook_handle)
        hook_handle = None


def run_message_loop() -> None:
    global pending_candidates
    msg = wintypes.MSG()
    while user32.GetMessageW(ctypes.byref(msg), 0, 0, 0) != 0:
        if msg.message == WM_APP_PASTE_IMAGE:
            logger.debug("Received WM_APP_PASTE_IMAGE on main loop.")
            candidates = set(pending_candidates)
            pending_candidates.clear()
            handle_intercepted_paste(candidates)
            continue
        user32.TranslateMessage(ctypes.byref(msg))
        user32.DispatchMessageW(ctypes.byref(msg))


def main() -> None:
    global main_thread_id
    logger.info("PasteDrop is running. Press Ctrl+C to stop.")
    main_thread_id = int(kernel32.GetCurrentThreadId())
    logger.info(f"Main thread id: {main_thread_id}")
    install_hook()
    try:
        run_message_loop()
    except KeyboardInterrupt:
        logger.info("Stopping listener.")
    finally:
        uninstall_hook()


if __name__ == "__main__":
    main()
