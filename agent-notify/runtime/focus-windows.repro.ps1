# Red/green loop for: "前往会话" restores Codex's hidden transparent overlay.
# Creates a dummy visible main window + a hidden titled overlay matching
# CodexComputerUseSwiftOverlay (no owner, has title, WS_EX_TRANSPARENT).
# Applies the production candidate filter + Restore (iconic-only SW_RESTORE).
# Exit 1 if the overlay becomes visible.

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class Repro {
  public delegate IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr data);

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern ushort RegisterClassW(ref WNDCLASS wc);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CreateWindowExW(int ex, string cls, string title, int style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetLayeredWindowAttributes(IntPtr hWnd, out uint key, out byte alpha, out uint flags);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandleW(string name);
  [DllImport("user32.dll")] static extern IntPtr DefWindowProcW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct WNDCLASS {
    public int style;
    public WndProc lpfnWndProc;
    public int cbClsExtra;
    public int cbWndExtra;
    public IntPtr hInstance;
    public IntPtr hIcon;
    public IntPtr hCursor;
    public IntPtr hbrBackground;
    public string lpszMenuName;
    public string lpszClassName;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  const int WS_OVERLAPPEDWINDOW = 0x00CF0000;
  const int WS_POPUP = unchecked((int)0x80000000);
  const int GWL_EXSTYLE = -20;
  const int WS_EX_TRANSPARENT = 0x00000020;
  const int WS_EX_TOOLWINDOW = 0x00000080;
  const int WS_EX_APPWINDOW = 0x00040000;
  const int WS_EX_NOACTIVATE = 0x08000000;
  const int WS_EX_LAYERED = 0x00080000;
  const int WS_EX_TOPMOST = 0x00000008;
  const int SW_RESTORE = 9;
  static WndProc keepAlive;

  static IntPtr Wnd(IntPtr h, uint m, IntPtr w, IntPtr l) { return DefWindowProcW(h, m, w, l); }

  public static IntPtr[] CreatePair() {
    keepAlive = Wnd;
    var inst = GetModuleHandleW(null);
    var wc = new WNDCLASS();
    wc.lpfnWndProc = keepAlive;
    wc.hInstance = inst;
    wc.lpszClassName = "CatraceFocusReproMain";
    RegisterClassW(ref wc);
    wc.lpszClassName = "CodexComputerUseSwiftOverlay";
    RegisterClassW(ref wc);

    IntPtr main = CreateWindowExW(0, "CatraceFocusReproMain", "ChatGPT", WS_OVERLAPPEDWINDOW, 40, 40, 400, 300, IntPtr.Zero, IntPtr.Zero, inst, IntPtr.Zero);
    ShowWindow(main, 5);

    int overlayEx = WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED | WS_EX_TOPMOST;
    IntPtr overlay = CreateWindowExW(overlayEx, "CodexComputerUseSwiftOverlay", "ChatGPT is using your computer. Esc to cancel", WS_POPUP, 0, 0, 800, 600, IntPtr.Zero, IntPtr.Zero, inst, IntPtr.Zero);
    return new IntPtr[] { main, overlay };
  }

  static bool IsBlockedClass(string className) {
    if (String.Equals(className, "OleDdeWndClass", StringComparison.OrdinalIgnoreCase)) return true;
    if (String.Equals(className, "CodexComputerUseSwiftOverlay", StringComparison.OrdinalIgnoreCase)) return true;
    if (String.Equals(className, "Chrome_StatusTrayWindow", StringComparison.OrdinalIgnoreCase)) return true;
    if (String.Equals(className, "OwlElectron_NotifyIconHostWindow", StringComparison.OrdinalIgnoreCase)) return true;
    if (String.Equals(className, "Base_PowerMessageWindow", StringComparison.OrdinalIgnoreCase)) return true;
    return className.IndexOf("Overlay", StringComparison.OrdinalIgnoreCase) >= 0;
  }

  static bool IsCandidate(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
    if (GetWindow(hWnd, 4) != IntPtr.Zero) return false;
    if (GetWindowTextLength(hWnd) <= 0) return false;
    bool iconic = IsIconic(hWnd);
    bool visible = IsWindowVisible(hWnd);
    if (!visible && !iconic) return false;
    var className = new StringBuilder(256);
    GetClassName(hWnd, className, className.Capacity);
    if (IsBlockedClass(className.ToString())) return false;
    int ex = GetWindowLong(hWnd, GWL_EXSTYLE);
    if ((ex & WS_EX_TRANSPARENT) != 0) return false;
    if ((ex & WS_EX_NOACTIVATE) != 0 && (ex & WS_EX_APPWINDOW) == 0) return false;
    if ((ex & WS_EX_TOOLWINDOW) != 0 && (ex & WS_EX_APPWINDOW) == 0) return false;
    if ((ex & WS_EX_LAYERED) != 0) {
      uint key, flags; byte alpha;
      if (GetLayeredWindowAttributes(hWnd, out key, out alpha, out flags) && alpha == 0) return false;
    }
    if (!iconic) {
      RECT rect;
      if (!GetWindowRect(hWnd, out rect)) return false;
      if ((rect.Right - rect.Left) < 80 || (rect.Bottom - rect.Top) < 80) return false;
    }
    return true;
  }

  public static IntPtr[] FindTopLevelWindows(uint[] targetPids) {
    var wanted = new HashSet<uint>(targetPids ?? new uint[0]);
    var found = new List<IntPtr>();
    EnumWindows((hWnd, data) => {
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      if (!wanted.Contains(pid)) return true;
      if (IsCandidate(hWnd)) found.Add(hWnd);
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }

  public static bool Restore(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
    if (IsIconic(hWnd)) {
      ShowWindow(hWnd, SW_RESTORE);
      System.Threading.Thread.Sleep(120);
    }
    return IsWindowVisible(hWnd);
  }
}
'@

$pair = [Repro]::CreatePair()
$main = $pair[0]
$overlay = $pair[1]
$procId = [Diagnostics.Process]::GetCurrentProcess().Id
$beforeMain = [Repro]::IsWindowVisible($main)
$beforeOverlay = [Repro]::IsWindowVisible($overlay)
$candidates = [Repro]::FindTopLevelWindows(@([uint32]$procId))
$selectedOverlay = $false
foreach ($w in $candidates) {
  if ($w -eq $overlay) { $selectedOverlay = $true }
  [void][Repro]::Restore($w)
}
$afterOverlay = [Repro]::IsWindowVisible($overlay)
$result = [ordered]@{
  pid = $procId
  mainHwnd = ('0x{0:X}' -f $main.ToInt64())
  overlayHwnd = ('0x{0:X}' -f $overlay.ToInt64())
  candidateCount = $candidates.Length
  beforeMainVisible = $beforeMain
  beforeOverlayVisible = $beforeOverlay
  afterOverlayVisible = $afterOverlay
  selectedOverlay = $selectedOverlay
  bug = ($afterOverlay -eq $true -or $selectedOverlay -eq $true)
}
$result | ConvertTo-Json -Compress
[Repro]::DestroyWindow($main) | Out-Null
[Repro]::DestroyWindow($overlay) | Out-Null
if ($result.bug) { exit 1 }
exit 0
