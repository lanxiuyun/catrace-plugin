# PasteDrop worker — Windows PowerShell 常驻进程（内含 Add-Type C# 全局键盘钩子）。
#
# 为什么 PowerShell：全局低级键盘钩子（WH_KEYBOARD_LL）需要 Win32 消息循环，
# Node 纯 JS 做不到；而 PowerShell 是 Windows 标配，无需安装任何额外依赖
# （bt-music 已大量使用同款 Add-Type C# 方案）。剪贴板读图用 System.Windows.Forms
# （-Sta 启动），explorer 路径用 Shell.Application COM，全在进程内完成。
#
# 协议（stdout，仅 ASCII）：
#   {"op":"ready"} / {"op":"saved"} / {"op":"fatal","message":"..."} / {"op":"exit"}
# saved 详情写 runtime/last-saved.txt（纯路径文本，路径可能含中文不走 stdout）。
# 关闭：Node 侧写 runtime/shutdown.signal，本循环每 200ms 检查后退出；
# 超时由 Node taskkill 兜底。
#
# 配置来自环境变量（Node sidecar spawn 时注入）：
#   CATRACE_PD_SAVE_SCOPE    both | desktop | explorer
#   CATRACE_PD_NAME_PREFIX   文件名前缀

$ErrorActionPreference = 'Stop'
$script:Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:ShutdownFile = Join-Path $script:Root 'shutdown.signal'
$script:LastSavedFile = Join-Path $script:Root 'last-saved.txt'
if (Test-Path $script:ShutdownFile) { Remove-Item $script:ShutdownFile -Force }
if (Test-Path $script:LastSavedFile) { Remove-Item $script:LastSavedFile -Force }

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;

public static class CatracePasteHook
{
    public const int WH_KEYBOARD_LL = 13;
    public const uint WM_KEYDOWN = 0x0100;
    public const uint WM_KEYUP = 0x0101;
    public const uint WM_SYSKEYDOWN = 0x0104;
    public const uint WM_SYSKEYUP = 0x0105;
    public const uint WM_APP = 0x8000;
    public const uint WM_APP_PASTE = WM_APP + 1;
    public const uint WM_QUIT = 0x0012;
    public const uint VK_V = 0x56;
    public const uint VK_CONTROL = 0x11;
    public const uint VK_LCONTROL = 0xA2;
    public const uint VK_RCONTROL = 0xA3;
    public const uint LLKHF_INJECTED = 0x10;
    public const uint GA_ROOT = 2;
    public const uint OBJID_NATIVEOM = 0xFFFFFFF0;
    public const uint OBJID_CLIENT = 0xFFFFFFFC;
    public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const int INPUT_KEYBOARD = 1;
    public const uint CF_BITMAP = 2;
    public const uint CF_DIB = 3;
    public const uint CF_DIBV5 = 17;
    public const uint CF_HDROP = 15;
    public static readonly UIntPtr INJECTED_MAGIC = new UIntPtr(0x5049464D);
    public const int WM_KEYFIRST = 0x0100;
    public const int WM_KEYLAST = 0x0108;

    public delegate IntPtr LowLevelKeyboardProc(int nCode, UIntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT
    {
        public uint vkCode, scanCode, flags, time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int ptX, ptY;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct GUITHREADINFO
    {
        public uint cbSize, flags;
        public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
        public int rcLeft, rcTop, rcRight, rcBottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk, wScan;
        public uint dwFlags, time;
        public UIntPtr dwExtraInfo;
    }

    // x64 上 INPUT 的 union 按 MOUSEINPUT 对齐为 32 字节，整结构 40 字节。
    // 只塞 KEYBDINPUT 时 Marshal.SizeOf=32，SendInput 会直接失败（桌面/资源管理器粘贴全废）。
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int dx, dy;
        public uint mouseData, dwFlags, time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT
    {
        public uint type;
        public INPUTUNION U;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookExW(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern int GetMessageW(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
    [DllImport("user32.dll")]
    static extern bool TranslateMessage(ref MSG lpMsg);
    [DllImport("user32.dll")]
    static extern IntPtr DispatchMessageW(ref MSG lpMsg);
    [DllImport("user32.dll")]
    static extern bool PostThreadMessageW(uint idThread, uint Msg, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern void PostQuitMessage(int nExitCode);
    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")]
    static extern IntPtr GetParent(IntPtr hWnd);
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")]
    static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);
    [DllImport("user32.dll")]
    static extern bool IsChild(IntPtr hWndParent, IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindowExW(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);
    [DllImport("oleacc.dll")]
    static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint dwObjectID, ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppvObject);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);
    [DllImport("kernel32.dll")]
    static extern bool QueryFullProcessImageNameW(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref uint lpdwSize);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr hObject);
    [DllImport("user32.dll")]
    static extern IntPtr GetClipboardData(uint uFormat);
    [DllImport("user32.dll")]
    static extern bool IsClipboardFormatAvailable(uint uFormat);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern uint RegisterClipboardFormatW(string lpszFormat);
    [DllImport("user32.dll")]
    static extern bool OpenClipboard(IntPtr hWndNewOwner);
    [DllImport("user32.dll")]
    static extern bool CloseClipboard();
    [DllImport("kernel32.dll")]
    static extern IntPtr GlobalLock(IntPtr hMem);
    [DllImport("kernel32.dll")]
    static extern bool GlobalUnlock(IntPtr hMem);
    [DllImport("kernel32.dll")]
    static extern int GlobalSize(IntPtr hMem);

    static LowLevelKeyboardProc _proc;
    static IntPtr _hook;
    static uint _mainThread;
    static volatile bool _running;
    static string _shutdownFile;
    static string _lastSavedFile;
    static string _scope;
    static string _namePrefix;
    static string _saveFormat;
    static volatile bool _vKeyUpSeen = true;
    static uint _pngFormat;
    static uint _jfifFormat;
    static uint _jpegFormat;
    static uint _imagePngFormat;
    static uint _imageJpegFormat;

    static readonly string[] DesktopClasses = { "Progman", "WorkerW", "SHELLDLL_DefView", "SysListView32", "XamlExplorerHostIslandWindow" };
    static readonly string[] ExplorerClasses = { "CabinetWClass", "ExploreWClass" };

    public static int Install(string shutdownFile, string lastSavedFile)
    {
        _shutdownFile = shutdownFile;
        _lastSavedFile = lastSavedFile;
        _scope = (Environment.GetEnvironmentVariable("CATRACE_PD_SAVE_SCOPE") ?? "both").Trim().ToLowerInvariant();
        if (_scope != "desktop" && _scope != "explorer") _scope = "both";
        _namePrefix = Environment.GetEnvironmentVariable("CATRACE_PD_NAME_PREFIX");
        if (string.IsNullOrWhiteSpace(_namePrefix)) _namePrefix = "Pasted Image";
        _saveFormat = (Environment.GetEnvironmentVariable("CATRACE_PD_SAVE_FORMAT") ?? "auto").Trim().ToLowerInvariant();
        if (_saveFormat != "png" && _saveFormat != "jpg") _saveFormat = "auto";
        _pngFormat = RegisterClipboardFormatW("PNG");
        _jfifFormat = RegisterClipboardFormatW("JFIF");
        _jpegFormat = RegisterClipboardFormatW("JPEG");
        _imagePngFormat = RegisterClipboardFormatW("image/png");
        _imageJpegFormat = RegisterClipboardFormatW("image/jpeg");
        _mainThread = GetCurrentThreadId();
        _proc = HookProc;
        _hook = SetWindowsHookExW(WH_KEYBOARD_LL, _proc, IntPtr.Zero, 0);
        if (_hook == IntPtr.Zero) return Marshal.GetLastWin32Error();
        _running = true;
        return 0;
    }

    public static void Run()
    {
        // 独立 watchdog 只负责关停信号。主线程用阻塞 GetMessage，持续、及时地
        // 泵送 WH_KEYBOARD_LL 消息；不再每 60ms 轮询，避免全局键盘输入卡顿。
        var watchdog = new Thread(() =>
        {
            while (_running)
            {
                if (File.Exists(_shutdownFile))
                {
                    _running = false;
                    PostThreadMessageW(_mainThread, WM_QUIT, UIntPtr.Zero, IntPtr.Zero);
                    break;
                }
                Thread.Sleep(200);
            }
        });
        watchdog.IsBackground = true;
        watchdog.Start();

        MSG msg;
        while (_running && GetMessageW(out msg, IntPtr.Zero, 0, 0) > 0)
        {
            if (msg.message == WM_APP_PASTE)
            {
                try
                {
                    IntPtr captured = msg.lParam;
                    if (ShouldInterceptTarget(captured)) HandlePaste(captured);
                    else SendCtrlV();
                }
                catch { SendCtrlV(); }
                continue;
            }
            TranslateMessage(ref msg);
            DispatchMessageW(ref msg);
        }
    }

    public static void Uninstall()
    {
        if (_hook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
        }
    }

    static void DebugLine(string s)
    {
        try { Console.Error.WriteLine("[pastedrop] " + s); } catch { }
    }

    static IntPtr HookProc(int nCode, UIntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            KBDLLHOOKSTRUCT kb = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            if (kb.vkCode == VK_V && (wParam == (UIntPtr)WM_KEYUP || wParam == (UIntPtr)WM_SYSKEYUP))
            {
                _vKeyUpSeen = true;
            }
            if (kb.vkCode == VK_V &&
                (wParam == (UIntPtr)WM_KEYDOWN || wParam == (UIntPtr)WM_SYSKEYDOWN) &&
                (int)kb.dwExtraInfo != (int)INJECTED_MAGIC &&
                (kb.flags & LLKHF_INJECTED) == 0 &&
                CtrlDown())
            {
                // 对齐原版 PasteDrop：只在「目标窗口 + 剪贴板是图片」时吞掉 Ctrl+V。
                // 其它情况 CallNextHookEx 放行，绝不依赖 SendInput 补发（x64 INPUT 很容易发失败）。
                // 钩子里只查 IsClipboardFormatAvailable，不读像素、不跑 COM。
                if (!_vKeyUpSeen)
                    return CallNextHookEx(_hook, nCode, wParam, lParam);
                _vKeyUpSeen = false;

                IntPtr fg = GetForegroundWindow();
                if (InScope(fg) && ClipboardHasImageFast())
                {
                    PostThreadMessageW(_mainThread, WM_APP_PASTE, UIntPtr.Zero, fg);
                    return (IntPtr)1;
                }
            }
        }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    static bool CtrlDown()
    {
        return (GetAsyncKeyState((int)VK_CONTROL) & 0x8000) != 0 ||
               (GetAsyncKeyState((int)VK_LCONTROL) & 0x8000) != 0 ||
               (GetAsyncKeyState((int)VK_RCONTROL) & 0x8000) != 0;
    }

    static string ClassName(IntPtr hwnd)
    {
        var sb = new StringBuilder(256);
        if (hwnd == IntPtr.Zero || GetClassNameW(hwnd, sb, sb.Capacity) == 0) return "";
        return sb.ToString();
    }

    static string ProcessNameOf(IntPtr hwnd)
    {
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (pid == 0) return "";
        IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (h == IntPtr.Zero) return "";
        try
        {
            uint size = 1024;
            var sb = new StringBuilder((int)size);
            if (!QueryFullProcessImageNameW(h, 0, sb, ref size)) return "";
            return Path.GetFileName(sb.ToString()).ToLowerInvariant();
        }
        finally { CloseHandle(h); }
    }

    static bool HasAncestorClass(IntPtr hwnd, string[] classes, int maxDepth = 8)
    {
        IntPtr cur = hwnd;
        for (int i = 0; i < maxDepth && cur != IntPtr.Zero; i++)
        {
            string c = ClassName(cur);
            if (c.Length > 0 && Array.IndexOf(classes, c) >= 0) return true;
            cur = GetParent(cur);
        }
        return false;
    }

    static bool InScope(IntPtr hwnd)
    {
        if (IsDesktopForeground(hwnd)) return _scope != "explorer";
        if (IsExplorerForeground(hwnd)) return _scope != "desktop";

        // 兜底：前台 hwnd 不是目标类，但同线程 GUI focus/active 窗口是
        //（Win11 合成层 / 弹窗前台）。取 focus→active 的 root 再判一次，避免漏拦。
        uint pid;
        uint tid = GetWindowThreadProcessId(hwnd, out pid);
        if (tid != 0)
        {
            GUITHREADINFO gti = new GUITHREADINFO();
            gti.cbSize = (uint)Marshal.SizeOf(typeof(GUITHREADINFO));
            if (GetGUIThreadInfo(tid, ref gti))
            {
                foreach (IntPtr candidate in new IntPtr[] { gti.hwndFocus, gti.hwndActive })
                {
                    if (candidate == IntPtr.Zero) continue;
                    if (candidate != hwnd)
                    {
                        if (IsDesktopForeground(candidate)) return _scope != "explorer";
                        if (IsExplorerForeground(candidate)) return _scope != "desktop";
                    }
                    IntPtr root = GetAncestor(candidate, GA_ROOT);
                    if (root != IntPtr.Zero && root != candidate)
                    {
                        if (IsDesktopForeground(root)) return _scope != "explorer";
                        if (IsExplorerForeground(root)) return _scope != "desktop";
                    }
                }
            }
        }
        return false;
    }

    static bool IsExplorerForeground(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        IntPtr root = GetAncestor(hwnd, GA_ROOT);
        string rootCls = ClassName(root);
        string cls = ClassName(hwnd);
        if (rootCls == "CabinetWClass" || rootCls == "ExploreWClass" ||
            cls == "CabinetWClass" || cls == "ExploreWClass" ||
            HasAncestorClass(hwnd, ExplorerClasses))
            return true;
        return ProcessNameOf(hwnd) == "explorer.exe" &&
            (rootCls == "CabinetWClass" || HasAncestorClass(hwnd, ExplorerClasses));
    }

    static bool IsDesktopForeground(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        if (IsExplorerForeground(hwnd)) return false;
        string cls = ClassName(hwnd);
        IntPtr root = GetAncestor(hwnd, GA_ROOT);
        string rootCls = ClassName(root);
        if (rootCls == "Shell_TrayWnd" || rootCls == "Shell_SecondaryTrayWnd" ||
            cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd")
            return false;
        if (Array.IndexOf(DesktopClasses, cls) >= 0) return true;
        if (Array.IndexOf(DesktopClasses, rootCls) >= 0) return true;
        if (HasAncestorClass(hwnd, DesktopClasses)) return true;
        if (ProcessNameOf(hwnd) == "explorer.exe" &&
            (cls.IndexOf("XamlExplorerHost") >= 0 || rootCls.IndexOf("XamlExplorerHost") >= 0))
            return true;
        return false;
    }

    static bool ClipboardHasImageFast()
    {
        try
        {
            // 复制的是文件（含图片文件）时交给资源管理器自己粘贴。
            if (IsClipboardFormatAvailable(CF_HDROP)) return false;
            if (IsClipboardFormatAvailable(CF_DIBV5)) return true;
            if (IsClipboardFormatAvailable(CF_DIB)) return true;
            if (IsClipboardFormatAvailable(CF_BITMAP)) return true;
            if (_pngFormat != 0 && IsClipboardFormatAvailable(_pngFormat)) return true;
            if (_imagePngFormat != 0 && IsClipboardFormatAvailable(_imagePngFormat)) return true;
            if (_jfifFormat != 0 && IsClipboardFormatAvailable(_jfifFormat)) return true;
            if (_jpegFormat != 0 && IsClipboardFormatAvailable(_jpegFormat)) return true;
            if (_imageJpegFormat != 0 && IsClipboardFormatAvailable(_imageJpegFormat)) return true;
        }
        catch { }
        return false;
    }

    static bool ShouldInterceptTarget(IntPtr hwnd)
    {
        if (!InScope(hwnd)) return false;
        return ClipboardHasImage();
    }

    static bool ClipboardHasImage()
    {
        try
        {
            System.Drawing.Bitmap bmp = (System.Drawing.Bitmap)System.Windows.Forms.Clipboard.GetImage();
            if (bmp != null) { bmp.Dispose(); return true; }
        }
        catch { }
        try
        {
            object png = System.Windows.Forms.Clipboard.GetData("PNG");
            if (png is System.IO.MemoryStream || png is byte[]) return true;
        }
        catch { }
        return ClipboardHasDib();
    }

    static bool ClipboardHasDib()
    {
        try
        {
            if (!OpenClipboard(IntPtr.Zero)) return false;
            try
            {
                return IsClipboardFormatAvailable(CF_DIBV5) || IsClipboardFormatAvailable(CF_DIB);
            }
            finally { CloseClipboard(); }
        }
        catch { return false; }
    }

    static System.Drawing.Bitmap GrabClipboardImage()
    {
        // 企业微信等来源只放 PNG 自定义格式，GetImage() 可能拿不到 → 先试 PNG。
        try
        {
            object png = System.Windows.Forms.Clipboard.GetData("PNG");
            System.IO.MemoryStream ms = png as System.IO.MemoryStream;
            if (ms != null && ms.Length > 0)
            {
                ms.Position = 0;
                var bmp = new System.Drawing.Bitmap(ms);
                return bmp;
            }
            byte[] bytes = png as byte[];
            if (bytes != null && bytes.Length > 0)
            {
                using (var s = new System.IO.MemoryStream(bytes))
                {
                    var bmp = new System.Drawing.Bitmap(s);
                    return bmp;
                }
            }
        }
        catch { }
        try
        {
            System.Drawing.Bitmap bmp = (System.Drawing.Bitmap)System.Windows.Forms.Clipboard.GetImage();
            if (bmp != null) return bmp;
        }
        catch { }
        // DIB 兜底：带掩码/非标准 DIB 头 GetImage() 可能返 null → 手工重建 BMP 解码。
        return BitmapFromClipboardDib();
    }

    // 仿 PasteDrop Python 的 get_dib_image_offset：处理 palette / BI_BITFIELDS 掩码偏移。
    static System.Drawing.Bitmap BitmapFromClipboardDib()
    {
        byte[] dib = null;
        try
        {
            if (OpenClipboard(IntPtr.Zero))
            {
                try
                {
                    uint[] formats = { CF_DIBV5, CF_DIB };
                    foreach (uint fmt in formats)
                    {
                        if (!IsClipboardFormatAvailable(fmt)) continue;
                        IntPtr hMem = GetClipboardData(fmt);
                        if (hMem == IntPtr.Zero) continue;
                        IntPtr ptr = GlobalLock(hMem);
                        if (ptr == IntPtr.Zero) continue;
                        try
                        {
                            int size = GlobalSize(hMem);
                            if (size <= 0) continue;
                            dib = new byte[size];
                            Marshal.Copy(ptr, dib, 0, size);
                            break;
                        }
                        finally { GlobalUnlock(hMem); }
                    }
                }
                finally { CloseClipboard(); }
            }
        }
        catch { return null; }

        if (dib == null || dib.Length < 16) return null;
        try
        {
            int headerSize = BitConverter.ToInt32(dib, 0);
            if (headerSize < 12 || headerSize > dib.Length) return null;
            short bitCount = BitConverter.ToInt16(dib, 14);
            int compression = BitConverter.ToInt32(dib, 16);
            int colorsUsed = 0;
            if (headerSize >= 36 && dib.Length >= 36)
                colorsUsed = BitConverter.ToInt32(dib, 32);

            int offset = headerSize;
            if (bitCount <= 8)
            {
                int paletteEntries = colorsUsed != 0 ? colorsUsed : (1 << bitCount);
                offset += paletteEntries * 4;
            }
            else if (compression == 3) // BI_BITFIELDS：跳过 12/16 字节 RGB 掩码
            {
                if (headerSize == 40) offset += 12;
                else if (headerSize >= 52) offset += 16;
            }
            if (offset < 0 || offset > dib.Length) return null;

            int fileSize = 14 + dib.Length;
            byte[] bmp = new byte[fileSize];
            bmp[0] = (byte)'B'; bmp[1] = (byte)'M';
            BitConverter.GetBytes(fileSize).CopyTo(bmp, 2);
            BitConverter.GetBytes((uint)14 + (uint)offset).CopyTo(bmp, 10);
            Array.Copy(dib, 0, bmp, 14, dib.Length);
            using (var ms = new System.IO.MemoryStream(bmp))
            {
                using (var image = new System.Drawing.Bitmap(ms))
                {
                    // Bitmap(Stream) 在流释放后仍引用流，深拷贝一份再返回，避免后续 Save 报 GDI+ 错误。
                    return new System.Drawing.Bitmap(image);
                }
            }
        }
        catch { return null; }
    }

    static string ResolveSaveDirectory(IntPtr fg)
    {
        IntPtr[] candidates = CollectCandidates(fg);
        for (int i = 0; i < candidates.Length; i++)
        {
            string cls = ClassName(candidates[i]);
            if (Array.IndexOf(DesktopClasses, cls) >= 0)
                return Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        }
        return GetExplorerFolder(candidates);
    }

    static IntPtr[] CollectCandidates(IntPtr fg)
    {
        IntPtr[] buf = new IntPtr[16];
        int n = 0;
        AddCandidate(buf, ref n, fg);
        AddCandidate(buf, ref n, GetForegroundWindow());
        IntPtr probe = fg != IntPtr.Zero ? fg : GetForegroundWindow();
        uint pid;
        uint tid = GetWindowThreadProcessId(probe, out pid);
        if (tid != 0)
        {
            GUITHREADINFO gti = new GUITHREADINFO();
            gti.cbSize = (uint)Marshal.SizeOf(typeof(GUITHREADINFO));
            if (GetGUIThreadInfo(tid, ref gti))
            {
                AddCandidate(buf, ref n, gti.hwndFocus);
                AddCandidate(buf, ref n, gti.hwndActive);
            }
        }
        IntPtr[] result = new IntPtr[n];
        Array.Copy(buf, result, n);
        return result;
    }

    static void AddCandidate(IntPtr[] buf, ref int n, IntPtr h)
    {
        if (h == IntPtr.Zero || n >= buf.Length) return;
        for (int i = 0; i < n; i++) if (buf[i] == h) return;
        buf[n++] = h;
        IntPtr root = GetAncestor(h, GA_ROOT);
        if (root == IntPtr.Zero || root == h || n >= buf.Length) return;
        for (int i = 0; i < n; i++) if (buf[i] == root) return;
        buf[n++] = root;
    }

    static string GetExplorerFolder(IntPtr[] candidates)
    {
        for (int attempt = 0; attempt < 8; attempt++)
        {
            string folder = GetExplorerFolderOnce(candidates);
            if (!string.IsNullOrEmpty(folder)) return folder;
            if (attempt < 7) Thread.Sleep(30);
        }
        return null;
    }

    static string GetExplorerFolderOnce(IntPtr[] candidates)
    {
        if (candidates == null || candidates.Length == 0) return null;

        for (int i = 0; i < candidates.Length; i++)
        {
            string fromOm = FolderFromHwnd(candidates[i]);
            if (IsFilesystemPath(fromOm)) return fromOm;
        }

        try
        {
            object shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
            object windows = shell.GetType().InvokeMember("Windows", System.Reflection.BindingFlags.InvokeMethod | System.Reflection.BindingFlags.GetProperty, null, shell, null);
            if (windows == null) return null;
            int count = 0;
            try
            {
                count = Convert.ToInt32(windows.GetType().InvokeMember("Count", System.Reflection.BindingFlags.GetProperty, null, windows, null));
            }
            catch { }
            DebugLine("shell windows count=" + count);
            for (int i = 0; i < count; i++)
            {
                object w = null;
                try
                {
                    w = windows.GetType().InvokeMember("Item", System.Reflection.BindingFlags.InvokeMethod | System.Reflection.BindingFlags.GetProperty, null, windows, new object[] { i });
                }
                catch { }
                if (w == null) continue;
                try
                {
                    object hwndValue = w.GetType().InvokeMember("HWND", System.Reflection.BindingFlags.GetProperty, null, w, null);
                    IntPtr hwnd = new IntPtr(Convert.ToInt64(hwndValue));
                    DebugLine("shell hwnd=" + hwnd + " loc=" + Convert.ToString(w.GetType().InvokeMember("LocationURL", System.Reflection.BindingFlags.GetProperty, null, w, null)));
                    if (hwnd == IntPtr.Zero) continue;
                    bool match = false;
                    for (int c = 0; c < candidates.Length; c++)
                    {
                        IntPtr cand = candidates[c];
                        if (cand == IntPtr.Zero) continue;
                        if (SameWindow(hwnd, cand) || IsChild(hwnd, cand) || IsChild(cand, hwnd) ||
                            SameWindow(GetAncestor(hwnd, GA_ROOT), GetAncestor(cand, GA_ROOT)))
                        {
                            match = true;
                            break;
                        }
                    }
                    if (!match) continue;
                    string pathText = FolderFromBrowser(w);
                    if (IsFilesystemPath(pathText)) return pathText;
                }
                catch { }
            }
        }
        catch (Exception ex)
        {
            DebugLine("shell windows failed " + ex.Message);
        }
        return null;
    }

    static string FolderFromHwnd(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return null;
        IntPtr root = GetAncestor(hwnd, GA_ROOT);
        IntPtr tab = FindWindowExW(root, IntPtr.Zero, "ShellTabWindowClass", null);
        IntPtr dui = FindWindowExW(root, IntPtr.Zero, "DUIViewWndClassName", null);
        IntPtr[] probes = { hwnd, root, tab, dui };
        Guid iid = new Guid("00020400-0000-0000-C000-000000000046");
        uint[] ids = { OBJID_NATIVEOM, OBJID_CLIENT };
        for (int i = 0; i < probes.Length; i++)
        {
            if (probes[i] == IntPtr.Zero) continue;
            for (int k = 0; k < ids.Length; k++)
            {
                object disp = null;
                Guid riid = iid;
                int hr = -1;
                try
                {
                    hr = AccessibleObjectFromWindow(probes[i], ids[k], ref riid, out disp);
                    if (hr != 0 || disp == null)
                    {
                        DebugLine("om miss hwnd=" + probes[i] + " id=" + ids[k].ToString("X") + " hr=" + hr);
                        continue;
                    }
                    string path = FolderFromBrowser(disp);
                    DebugLine("om hit hwnd=" + probes[i] + " path=" + path);
                    if (IsFilesystemPath(path)) return path;
                }
                catch (Exception ex)
                {
                    DebugLine("om throw hwnd=" + probes[i] + " " + ex.Message);
                }
            }
        }
        return null;
    }

    static string FolderFromBrowser(object w)
    {
        if (w == null) return null;
        try
        {
            object loc = w.GetType().InvokeMember("LocationURL", System.Reflection.BindingFlags.GetProperty, null, w, null);
            string local = ParseLocationUrl(Convert.ToString(loc));
            if (IsFilesystemPath(local)) return local;
        }
        catch { }
        try
        {
            object doc = w.GetType().InvokeMember("Document", System.Reflection.BindingFlags.GetProperty, null, w, null);
            if (doc == null) return null;
            object folder = doc.GetType().InvokeMember("Folder", System.Reflection.BindingFlags.GetProperty, null, doc, null);
            if (folder == null) return null;
            object self = folder.GetType().InvokeMember("Self", System.Reflection.BindingFlags.GetProperty, null, folder, null);
            if (self == null) return null;
            object path = self.GetType().InvokeMember("Path", System.Reflection.BindingFlags.GetProperty, null, self, null);
            string pathText = path == null ? null : Convert.ToString(path);
            if (IsFilesystemPath(pathText)) return pathText;
        }
        catch { }
        return null;
    }

    static bool SameWindow(IntPtr a, IntPtr b)
    {
        if (a == IntPtr.Zero || b == IntPtr.Zero) return false;
        if (a == b) return true;
        return unchecked((uint)a.ToInt64()) == unchecked((uint)b.ToInt64());
    }

    static string ParseLocationUrl(string locationUrl)
    {
        if (string.IsNullOrEmpty(locationUrl)) return null;
        try
        {
            var parsed = new Uri(locationUrl);
            if (parsed.Scheme != "file") return null;
            return Uri.UnescapeDataString(parsed.LocalPath);
        }
        catch { return null; }
    }

    static bool IsFilesystemPath(string dir)
    {
        if (string.IsNullOrEmpty(dir)) return false;
        if (dir.StartsWith("::")) return false;
        try
        {
            string full = Path.GetFullPath(dir);
            return full.Length >= 3 && full[1] == ':';
        }
        catch { return false; }
    }

    static System.Drawing.Bitmap ToPngSafe(System.Drawing.Bitmap src)
    {
        if (src == null) return null;
        if (src.PixelFormat == System.Drawing.Imaging.PixelFormat.Format32bppArgb)
            return src;
        var clone = new System.Drawing.Bitmap(src.Width, src.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var g = System.Drawing.Graphics.FromImage(clone))
            g.DrawImage(src, 0, 0, src.Width, src.Height);
        src.Dispose();
        return clone;
    }

    static void SendCtrlV()
    {
        var inputs = new INPUT[4];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].U.ki.wVk = (ushort)VK_CONTROL;
        inputs[0].U.ki.dwExtraInfo = INJECTED_MAGIC;
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].U.ki.wVk = (ushort)VK_V;
        inputs[1].U.ki.dwExtraInfo = INJECTED_MAGIC;
        inputs[2].type = INPUT_KEYBOARD;
        inputs[2].U.ki.wVk = (ushort)VK_V;
        inputs[2].U.ki.dwFlags = KEYEVENTF_KEYUP;
        inputs[2].U.ki.dwExtraInfo = INJECTED_MAGIC;
        inputs[3].type = INPUT_KEYBOARD;
        inputs[3].U.ki.wVk = (ushort)VK_CONTROL;
        inputs[3].U.ki.dwFlags = KEYEVENTF_KEYUP;
        inputs[3].U.ki.dwExtraInfo = INJECTED_MAGIC;
        uint sent = SendInput(4, inputs, Marshal.SizeOf(typeof(INPUT)));
        if (sent != 4) DebugLine("SendInput failed sent=" + sent + " size=" + Marshal.SizeOf(typeof(INPUT)) + " err=" + Marshal.GetLastWin32Error());
    }

    static void HandlePaste(IntPtr fg)
    {
        if (fg == IntPtr.Zero) fg = GetForegroundWindow();
        DebugLine("handle fg=" + fg + " cls=" + ClassName(fg) + " root=" + ClassName(GetAncestor(fg, GA_ROOT)) + " fmt=" + _saveFormat);
        string dir = ResolveSaveDirectory(fg);
        if (!IsFilesystemPath(dir))
        {
            DebugLine("resolve save dir failed fg=" + fg);
            SendCtrlV();
            return;
        }
        System.Drawing.Bitmap bmp = null;
        try
        {
            Directory.CreateDirectory(dir);
            string baseName = _namePrefix + " " + DateTime.Now.ToString("yyyy-MM-dd HH-mm-ss");
            byte[] pngBytes = FirstPngBytes();
            byte[] jpgBytes = FirstJpegBytes();
            string path = null;

            if (_saveFormat == "jpg")
            {
                if (jpgBytes != null) path = WriteBytes(dir, baseName, ".jpg", jpgBytes);
                else
                {
                    bmp = GrabBitmapRetry();
                    if (bmp != null) path = UniquePath(dir, baseName, ".jpg");
                    if (bmp != null && path != null) SaveJpeg(bmp, path, 95L);
                }
            }
            else if (_saveFormat == "png")
            {
                if (pngBytes != null) path = WriteBytes(dir, baseName, ".png", pngBytes);
                else
                {
                    bmp = GrabBitmapRetry();
                    if (bmp != null)
                    {
                        bmp = ToPngSafe(bmp);
                        path = UniquePath(dir, baseName, ".png");
                        bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
                    }
                }
            }
            else
            {
                // auto：有原始 PNG 就原样写（零再编码）；否则把位图无损存 PNG；再不行才用原始 JPEG。
                if (pngBytes != null) path = WriteBytes(dir, baseName, ".png", pngBytes);
                else
                {
                    bmp = GrabBitmapRetry();
                    if (bmp != null)
                    {
                        bmp = ToPngSafe(bmp);
                        path = UniquePath(dir, baseName, ".png");
                        bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
                    }
                    else if (jpgBytes != null) path = WriteBytes(dir, baseName, ".jpg", jpgBytes);
                }
            }

            if (string.IsNullOrEmpty(path) || !File.Exists(path))
            {
                DebugLine("save produced no file");
                SendCtrlV();
                return;
            }
            File.WriteAllText(_lastSavedFile, path, Encoding.UTF8);
            Console.Out.WriteLine("{\"op\":\"saved\"}");
            Console.Out.Flush();
            DebugLine("saved " + path);
            return;
        }
        catch (Exception ex)
        {
            DebugLine("save failed " + ex.Message);
        }
        finally { if (bmp != null) bmp.Dispose(); }
        SendCtrlV();
    }

    static System.Drawing.Bitmap GrabBitmapRetry()
    {
        System.Drawing.Bitmap bmp = null;
        for (int i = 0; i < 6 && bmp == null; i++)
        {
            try { bmp = GrabClipboardImage(); } catch { }
            if (bmp == null && i < 5) Thread.Sleep(40);
        }
        return bmp;
    }

    static string UniquePath(string dir, string baseName, string ext)
    {
        string path = Path.Combine(dir, baseName + ext);
        int seq = 1;
        while (File.Exists(path))
        {
            path = Path.Combine(dir, baseName + " (" + seq + ")" + ext);
            seq++;
        }
        return path;
    }

    static string WriteBytes(string dir, string baseName, string ext, byte[] bytes)
    {
        string path = UniquePath(dir, baseName, ext);
        File.WriteAllBytes(path, bytes);
        return path;
    }

    static bool LooksLikePng(byte[] b)
    {
        return b != null && b.Length > 8 && b[0] == 137 && b[1] == 80 && b[2] == 78 && b[3] == 71;
    }

    static bool LooksLikeJpeg(byte[] b)
    {
        return b != null && b.Length > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF;
    }

    static byte[] FirstPngBytes()
    {
        byte[] b = ReadNamedBytes("PNG");
        if (LooksLikePng(b)) return b;
        b = ReadFormatBytes(_pngFormat);
        if (LooksLikePng(b)) return b;
        b = ReadFormatBytes(_imagePngFormat);
        return LooksLikePng(b) ? b : null;
    }

    static byte[] FirstJpegBytes()
    {
        string[] names = { "JFIF", "JPEG", "image/jpeg" };
        for (int i = 0; i < names.Length; i++)
        {
            byte[] named = ReadNamedBytes(names[i]);
            if (LooksLikeJpeg(named)) return named;
        }
        uint[] fmts = { _jfifFormat, _jpegFormat, _imageJpegFormat };
        for (int i = 0; i < fmts.Length; i++)
        {
            byte[] raw = ReadFormatBytes(fmts[i]);
            if (LooksLikeJpeg(raw)) return raw;
        }
        return null;
    }

    static byte[] ReadNamedBytes(string name)
    {
        try
        {
            object data = System.Windows.Forms.Clipboard.GetData(name);
            System.IO.MemoryStream ms = data as System.IO.MemoryStream;
            if (ms != null && ms.Length > 0)
            {
                ms.Position = 0;
                return ms.ToArray();
            }
            return data as byte[];
        }
        catch { return null; }
    }

    static byte[] ReadFormatBytes(uint format)
    {
        if (format == 0) return null;
        try
        {
            if (!IsClipboardFormatAvailable(format)) return null;
            if (!OpenClipboard(IntPtr.Zero)) return null;
            try
            {
                IntPtr hMem = GetClipboardData(format);
                if (hMem == IntPtr.Zero) return null;
                IntPtr ptr = GlobalLock(hMem);
                if (ptr == IntPtr.Zero) return null;
                try
                {
                    int size = GlobalSize(hMem);
                    if (size <= 0) return null;
                    byte[] buf = new byte[size];
                    Marshal.Copy(ptr, buf, 0, size);
                    return buf;
                }
                finally { GlobalUnlock(hMem); }
            }
            finally { CloseClipboard(); }
        }
        catch { return null; }
    }

    static void SaveJpeg(System.Drawing.Bitmap bmp, string path, long quality)
    {
        System.Drawing.Imaging.ImageCodecInfo codec = null;
        System.Drawing.Imaging.ImageCodecInfo[] codecs = System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders();
        for (int i = 0; i < codecs.Length; i++)
        {
            if (codecs[i].FormatID == System.Drawing.Imaging.ImageFormat.Jpeg.Guid)
            {
                codec = codecs[i];
                break;
            }
        }
        if (codec == null)
        {
            bmp.Save(path, System.Drawing.Imaging.ImageFormat.Jpeg);
            return;
        }
        var ep = new System.Drawing.Imaging.EncoderParameters(1);
        ep.Param[0] = new System.Drawing.Imaging.EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
        bmp.Save(path, codec, ep);
    }
}
"@ -ReferencedAssemblies System.Windows.Forms,System.Drawing

$code = [CatracePasteHook]::Install($script:ShutdownFile, $script:LastSavedFile)
if ($code -ne 0) {
    [Console]::Out.WriteLine('{"op":"fatal","message":"hook install failed: ' + $code + '"}')
    [Console]::Out.Flush()
    exit 1
}

[Console]::Out.WriteLine('{"op":"ready"}')
[Console]::Out.Flush()

[CatracePasteHook]::Run()
[CatracePasteHook]::Uninstall()
[Console]::Out.WriteLine('{"op":"exit"}')
[Console]::Out.Flush()
exit 0
