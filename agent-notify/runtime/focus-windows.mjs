import { execFile } from 'node:child_process'

const MAX_PID_COUNT = 20
const FOCUS_TIMEOUT_MS = 8_000

export function normalizePidChain(pidChain) {
  return [...new Set((Array.isArray(pidChain) ? pidChain : [])
    .map((pid) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && pid > 1))]
    .slice(0, MAX_PID_COUNT)
}

function execFileText(file, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      resolve({ error, stdout: String(stdout || '') })
    })
  })
}

export function buildWindowsFocusScript(pidChain) {
  const pids = normalizePidChain(pidChain)
  if (!pids.length) return ''
  return `
$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class CatraceSessionFocus {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr data);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr data);

  public static IntPtr[] FindTopLevelWindows(uint[] targetPids) {
    var wanted = new HashSet<uint>(targetPids ?? new uint[0]);
    var found = new List<IntPtr>();
    EnumWindows((hWnd, data) => {
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      if (!wanted.Contains(pid)) return true;
      bool hasTitle = GetWindowTextLength(hWnd) > 0;
      bool hasOwner = GetWindow(hWnd, 4) != IntPtr.Zero;
      var className = new StringBuilder(256);
      GetClassName(hWnd, className, className.Capacity);
      bool isInternal = String.Equals(className.ToString(), "OleDdeWndClass", StringComparison.OrdinalIgnoreCase);
      if (hasTitle && !hasOwner && !isInternal) found.Add(hWnd);
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }

  public static IntPtr FindConsoleWindow(uint pid) {
    FreeConsole();
    if (!AttachConsole(pid)) return IntPtr.Zero;
    IntPtr hWnd = GetConsoleWindow();
    FreeConsole();
    return hWnd;
  }

  public static bool Restore(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
    ShowWindow(hWnd, 5);
    ShowWindow(hWnd, 9);
    System.Threading.Thread.Sleep(120);
    return IsWindowVisible(hWnd);
  }

  public static void TryForeground(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return;
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(hWnd);
  }
}
'@
Add-Type $source -ErrorAction SilentlyContinue

$seedPids = @(${pids.join(',')})
$processes = @{}
try {
  Get-CimInstance Win32_Process -Property ProcessId,Name | ForEach-Object {
    $processes[[int]$_.ProcessId] = $_
  }
} catch {}

$appPids = New-Object System.Collections.Generic.List[uint32]
$terminalPids = New-Object System.Collections.Generic.List[uint32]
$consolePids = New-Object System.Collections.Generic.List[uint32]
$otherPids = New-Object System.Collections.Generic.List[uint32]
foreach ($candidatePid in $seedPids) {
  if (-not $processes.ContainsKey($candidatePid)) { continue }
  $name = [string]$processes[$candidatePid].Name
  if ($name -match '^(ZCode|Codex|Claude|Code|Cursor|Trae|Windsurf|Kiro)(\.exe)?$') {
    $appPids.Add([uint32]$candidatePid)
  } elseif ($name -match '^(WindowsTerminal|wezterm-gui|alacritty|kitty|Tabby|Wave)(\.exe)?$') {
    $terminalPids.Add([uint32]$candidatePid)
  } elseif ($name -match '^(conhost|pwsh|powershell|cmd)(\.exe)?$') {
    $consolePids.Add([uint32]$candidatePid)
  } elseif ($name -notmatch '^(explorer|svchost|services|wininit|winlogon|csrss|System|node)(\.exe)?$') {
    $otherPids.Add([uint32]$candidatePid)
  }
}

function Get-UniqueWindows([IntPtr[]]$windows) {
  $seen = @{}
  $result = New-Object System.Collections.Generic.List[IntPtr]
  foreach ($window in $windows) {
    $key = [string]$window.ToInt64()
    if ($window -ne [IntPtr]::Zero -and -not $seen.ContainsKey($key)) {
      $seen[$key] = $true
      $result.Add($window)
    }
  }
  return $result.ToArray()
}

$category = 'none'
$windows = @()
if ($appPids.Count -gt 0) {
  $windows = [CatraceSessionFocus]::FindTopLevelWindows($appPids.ToArray())
  if ($windows.Count -gt 0) { $category = 'app' }
}
if ($windows.Count -eq 0 -and $terminalPids.Count -gt 0) {
  $windows = [CatraceSessionFocus]::FindTopLevelWindows($terminalPids.ToArray())
  if ($windows.Count -gt 0) { $category = 'terminal' }
}
if ($windows.Count -eq 0 -and $consolePids.Count -gt 0) {
  $consoleWindows = New-Object System.Collections.Generic.List[IntPtr]
  foreach ($consolePid in $consolePids) {
    $consoleWindow = [CatraceSessionFocus]::FindConsoleWindow($consolePid)
    if ($consoleWindow -ne [IntPtr]::Zero) { $consoleWindows.Add($consoleWindow) }
  }
  $windows = $consoleWindows.ToArray()
  if ($windows.Count -gt 0) { $category = 'console' }
}
if ($windows.Count -eq 0 -and $otherPids.Count -gt 0) {
  $windows = [CatraceSessionFocus]::FindTopLevelWindows($otherPids.ToArray())
  if ($windows.Count -gt 0) { $category = 'other' }
}

$windows = Get-UniqueWindows $windows
$restored = 0
$firstRestored = [IntPtr]::Zero
foreach ($window in $windows) {
  if ([CatraceSessionFocus]::Restore($window)) {
    $restored++
    if ($firstRestored -eq [IntPtr]::Zero) { $firstRestored = $window }
  }
}
if ($firstRestored -ne [IntPtr]::Zero) {
  [CatraceSessionFocus]::TryForeground($firstRestored)
}

[ordered]@{
  ok = $restored -gt 0
  category = $category
  restored = $restored
  candidates = $windows.Count
} | ConvertTo-Json -Compress
`
}

export function parseWindowsFocusResult(output) {
  const line = String(output || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean).at(-1)
  if (!line) return { ok: false, category: 'none', restored: 0, candidates: 0 }
  try {
    const result = JSON.parse(line)
    return {
      ok: result.ok === true,
      category: String(result.category || 'none'),
      restored: Number(result.restored) || 0,
      candidates: Number(result.candidates) || 0,
    }
  } catch {
    return { ok: false, category: 'none', restored: 0, candidates: 0 }
  }
}

export async function focusExternalWindow(pidChain) {
  const pids = normalizePidChain(pidChain)
  if (process.platform !== 'win32' || !pids.length) {
    return { ok: false, category: 'none', restored: 0, candidates: 0, inputPids: pids }
  }
  const script = buildWindowsFocusScript(pids)
  const { error, stdout } = await execFileText(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    FOCUS_TIMEOUT_MS,
  )
  return {
    ...parseWindowsFocusResult(stdout),
    inputPids: pids,
    error: error ? String(error.message || error) : null,
  }
}
