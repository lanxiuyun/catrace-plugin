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
    public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const int INPUT_KEYBOARD = 1;
    public const uint CF_DIB = 3;
    public const uint CF_DIBV5 = 17;
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

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT
    {
        public uint type;
        public KEYBDINPUT ki;
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
    static volatile bool _vKeyUpSeen = true;

    static readonly string[] DesktopClasses = { "Progman", "WorkerW", "SHELLDLL_DefView", "SysListView32" };
    static readonly string[] ExplorerClasses = { "CabinetWClass", "ExploreWClass" };

    public static int Install(string shutdownFile, string lastSavedFile)
    {
        _shutdownFile = shutdownFile;
        _lastSavedFile = lastSavedFile;
        _scope = (Environment.GetEnvironmentVariable("CATRACE_PD_SAVE_SCOPE") ?? "both").Trim().ToLowerInvariant();
        if (_scope != "desktop" && _scope != "explorer") _scope = "both";
        _namePrefix = Environment.GetEnvironmentVariable("CATRACE_PD_NAME_PREFIX");
        if (string.IsNullOrWhiteSpace(_namePrefix)) _namePrefix = "Pasted Image";
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
                // 低级键盘 hook 必须瞬间返回。这里不读剪贴板、不跑 COM、不写日志。
                // 把 Ctrl+V 交给消息循环；消息循环再判断目标窗口/图片并决定是否补发 Ctrl+V。
                // 按住 Ctrl 自动重复（WM_KEYDOWN 连续触发无 KeyUp）用 _vKeyUpSeen 抑制。
                if (!_vKeyUpSeen)
                    return CallNextHookEx(_hook, nCode, wParam, lParam);
                _vKeyUpSeen = false;

                IntPtr fg = GetForegroundWindow();
                if (InScope(fg))
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
        // PasteDrop 源码同样以 explorer.exe + root CabinetWClass 判定。
        // 某些 Windows 11 XAML 子层前台 hwnd/root 不稳定，进程名作为兜底。
        return ProcessNameOf(hwnd) == "explorer.exe" &&
            (ClassName(root) == "CabinetWClass" ||
             ClassName(hwnd) == "CabinetWClass" ||
             HasAncestorClass(hwnd, ExplorerClasses));
    }

    static bool IsDesktopForeground(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || ProcessNameOf(hwnd) != "explorer.exe") return false;
        string cls = ClassName(hwnd);
        return Array.IndexOf(DesktopClasses, cls) >= 0 &&
            (cls == "Progman" || cls == "WorkerW" || HasAncestorClass(hwnd, DesktopClasses));
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
        if (IsDesktopForeground(fg))
            return Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        if (IsExplorerForeground(fg))
            return GetExplorerFolder(fg);
        return null;
    }

    static string GetExplorerFolder(IntPtr fg)
    {
        // 资源管理器窗口（CabinetWClass）在 Shell.Application.Windows() 里的 HWND 与
        // GetForegroundWindow() 不是同一句柄——按 HWND 精确匹配会落空。
        // 策略：枚举所有资源管理器窗口，挑出与前台「同 root 祖先」的窗口拿它的路径。
        //（catrace-com-diag 实测：4 个 explorer 窗口 hwnd 各异，无一个等于 fg/root）
        IntPtr root = fg == IntPtr.Zero ? IntPtr.Zero : GetAncestor(fg, GA_ROOT);
        for (int attempt = 0; attempt < 3; attempt++)
        {
            string folder = GetExplorerFolderOnce(root);
            if (!string.IsNullOrEmpty(folder)) return folder;
            if (attempt < 2) Thread.Sleep(30);
        }
        return null;
    }

    static string GetExplorerFolderOnce(IntPtr root)
    {
        if (root == IntPtr.Zero) return null;
        try
        {
            object shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
            object windows = shell.GetType().InvokeMember("Windows", System.Reflection.BindingFlags.GetProperty, null, shell, null);
            System.Collections.IEnumerable enumerable = windows as System.Collections.IEnumerable;
            if (enumerable == null) return null;
            foreach (object w in enumerable)
            {
                if (w == null) continue;
                try
                {
                    object hwndValue = w.GetType().InvokeMember("HWND", System.Reflection.BindingFlags.GetProperty, null, w, null);
                    IntPtr hwnd = new IntPtr(Convert.ToInt64(hwndValue));
                    if (hwnd == IntPtr.Zero) continue;
                    // 1) 前台/root 祖先链上的窗口（拿当前文件夹）；
                    // 2) 与前台/root 有 IsChild 关系的窗口。
                    bool match =
                        hwnd == root ||
                        IsChild(hwnd, root) ||
                        IsChild(root, hwnd) ||
                        GetAncestor(hwnd, GA_ROOT) == root;
                    if (!match) continue;
                    object doc = w.GetType().InvokeMember("Document", System.Reflection.BindingFlags.GetProperty, null, w, null);
                    if (doc == null) continue;
                    object folder = doc.GetType().InvokeMember("Folder", System.Reflection.BindingFlags.GetProperty, null, doc, null);
                    if (folder == null) continue;
                    object self = folder.GetType().InvokeMember("Self", System.Reflection.BindingFlags.GetProperty, null, folder, null);
                    if (self == null) continue;
                    object path = self.GetType().InvokeMember("Path", System.Reflection.BindingFlags.GetProperty, null, self, null);
                    if (path != null && !string.IsNullOrEmpty(Convert.ToString(path))) return Convert.ToString(path);
                    // 兜底：Path 为空时解析 LocationURL（仅 file: scheme），对齐 PasteDrop。
                    object loc = w.GetType().InvokeMember("LocationURL", System.Reflection.BindingFlags.GetProperty, null, w, null);
                    string local = ParseLocationUrl(Convert.ToString(loc));
                    if (local != null) return local;
                }
                catch { }
            }
        }
        catch { }
        return null;
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

    static void SendCtrlV()
    {
        // 对齐 PasteDrop 用 SendInput（keybd_event 无返回值、不报错，可靠性更差）。
        var inputs = new INPUT[4];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].ki.wVk = (ushort)VK_CONTROL;
        inputs[0].ki.dwExtraInfo = INJECTED_MAGIC;
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].ki.wVk = (ushort)VK_V;
        inputs[1].ki.dwExtraInfo = INJECTED_MAGIC;
        inputs[2].type = INPUT_KEYBOARD;
        inputs[2].ki.wVk = (ushort)VK_V;
        inputs[2].ki.dwFlags = KEYEVENTF_KEYUP;
        inputs[2].ki.dwExtraInfo = INJECTED_MAGIC;
        inputs[3].type = INPUT_KEYBOARD;
        inputs[3].ki.wVk = (ushort)VK_CONTROL;
        inputs[3].ki.dwFlags = KEYEVENTF_KEYUP;
        inputs[3].ki.dwExtraInfo = INJECTED_MAGIC;
        SendInput(4, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    static void HandlePaste(IntPtr fg)
    {
        if (fg == IntPtr.Zero) { SendCtrlV(); return; }
        string dir = ResolveSaveDirectory(fg);
        if (string.IsNullOrEmpty(dir)) { SendCtrlV(); return; }
        System.Drawing.Bitmap bmp = null;
        try { bmp = GrabClipboardImage(); } catch { }
        if (bmp == null) { SendCtrlV(); return; }
        try
        {
            Directory.CreateDirectory(dir);
            string baseName = _namePrefix + " " + DateTime.Now.ToString("yyyy-MM-dd HH-mm-ss");
            string path = Path.Combine(dir, baseName + ".png");
            int seq = 1;
            while (File.Exists(path))
            {
                path = Path.Combine(dir, baseName + " (" + seq + ").png");
                seq++;
            }
            bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
            // 只把路径写进文件（可能含中文），Node 端补全其余字段。
            File.WriteAllText(_lastSavedFile, path, Encoding.UTF8);
            Console.Out.WriteLine("{\"op\":\"saved\"}");
            Console.Out.Flush();
            return;
        }
        catch { }
        finally { if (bmp != null) bmp.Dispose(); }
        // 保存失败：图片没存也没粘贴，补发 Ctrl+V 走原生粘贴（对齐 PasteDrop）。
        SendCtrlV();
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
