# 2026-09-14 agent-notify 前往会话：进程链捕获 + 宿主窗口聚焦 API

## 背景

「前往会话」按钮自 cdca984 起是纯装饰 span，两份旧 devlog 写的「点击冒泡宿主跳转」从未实现。本次用 grill-me 收敛交互后落地：hook 侧捕进程链、sidecar 缓存、宿主新 plugin API 前置窗口。

## 拍板结论（一轮问答）

跳转=聚焦会话窗口；接受窗口级精度；失败=按钮文案 2s+beep；只有按钮触发（不做整卡冒泡）；成功后自动关卡；Windows 先行（#[cfg] 隔离 + 降级）。

## 实现要点

- **宿主**（Catrace 主仓 `feat/externalize-agent-notify`）：
  - `plugin_api/window.rs` 新增 `plugin_api_window_focus_external`，lib.rs 注册；
  - `window_manager/windows.rs` 新增 `focus_external_pid_chain`：AttachConsole 取控制台窗口（conhost 是 shell 子进程，祖先匹配够不着）→ 祖先属主 EnumWindows 匹配（Electron/WT），最小化先还原，前置复用 force_foreground_window；
  - `Cargo.toml` 加 `Win32_System_Console` feature；`pluginApi.ts` 加 `window.focusExternal`。
- **插件**（catrace-plugin 仓库）：
  - `hook.cjs` 注入 `catrace_hook_pid` / `catrace_hook_ppid`；
  - `main.mjs`：normalize 加 `hookPpid`；`ensurePidChain` 首事件爬链（PowerShell/ps 快照）按会话缓存 + 30s 失败负缓存 + 500 容量淘汰；`handleState` 缓存命中直接带 `entry.pidChain`，未命中异步补、不重发卡片；
  - `ui.mjs`：按钮 span→button，`gotoSession()` 调 `plugin.window.focusExternal`，成功 emit close，失败文案 2s + beep；正文点击注释改为「跳转只认按钮」。

## 设计取舍记录

- 链必须在 hook 事件时爬：hook 的直接父可能是 `cmd /c` 短命包装，点击时再爬链已断。
- 缓存不落盘：sidecar 重启丢缓存后下一个 hook 事件自愈重爬。
- 链就绪前发布的卡片不重发：极小窗口期点按钮会看到失败文案，属预期。

## 待验证（用户真机）

1. conhost 跑 claude/zcode：Stop 卡点按钮 → 对应控制台窗口置前，最小化能还原；
2. ZCode 桌面版会话：点按钮 → ZCode 主窗口置前；
3. 链缺失/窗口已关：按钮文案 2s「未能定位终端窗口」+ beep，卡片保留；
4. 成功后卡片自动关闭；
5. `pnpm tauri dev` 下 AttachConsole 的 FreeConsole 副作用是否影响 dev 日志输出（预期无感）。

## 文档

- 新 feature：`features/agent-notify/前往会话-进程链捕获与窗口聚焦.md`
- `HOOK_DATA_NORMALIZATION.md`：CatraceHookData 加 `hookPpid`/`pidChain`，hook 注入字段，顺手把过期的「会话标题读取 transcript」步骤修正为三级来源现状
- `toast卡观感-…md`：废弃「冒泡到宿主」表述
