# 2026-09-20 agent-notify：Codex 前往会话不再 SW_SHOW 透明 overlay

## 背景

用户反馈：Codex App 已在前台时点「前往会话」，Windows 上出现关不掉的透明窗，随 Codex 退出才消失。

## 排查

本机枚举 `ChatGPT.exe` / `codex-computer-use-swift` 顶层窗：除可见主窗外，还有隐藏的 `CodexComputerUseSwiftOverlay`（全屏、有标题、`WS_EX_TRANSPARENT`）和隐藏 `Chrome_WidgetWin_1` ghost。旧过滤器会把它们当候选并 `SW_SHOW`。

合成 harness 先红：可见主窗 + 隐藏 overlay → 旧 Restore 后 overlay 变可见。

## 改动

- `focus-windows.mjs`：`isFocusableAppWindow` / `selectFocusWindows`；Win32 脚本同步过滤；Restore 只 `SW_RESTORE` 最小化窗
- App 进程名补 `ChatGPT`
- 单测覆盖本机 dump；`focus-windows.repro.ps1` 作为 Win32 红绿环

## 待用户验证

重载 agent-notify sidecar 后：Codex 前台点「前往会话」不再出透明窗；最小化 Codex 仍能还原主窗。
