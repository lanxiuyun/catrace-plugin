# Agent 通知（agent-notify）

把原来宿主内置的 Agent 通知做成外置插件。启用后 sidecar 监听 `127.0.0.1:23456`：

- `POST /state`：会话状态 → 右下角小窗
- `POST /permission`：阻塞式权限审批（Claude http hook）

设置里可给 Claude / Codex / Gemini / Kimi 安装 hook。默认关闭。启用 = 信任本目录代码（含 sidecar）。需要本机 Node.js。

旧内置配置键 `plugin_config:agent` **不会**自动迁过来，请重新装 hook。

## 代码结构

- `ui.mjs` / `settings.mjs`：宿主按单文件 Blob 加载，不能 `import` 兄弟模块
- `runtime/main.mjs`：sidecar 入口（HTTP + JSONL）
- `runtime/hook-data.mjs`：hook JSON → CatraceHookData
- `runtime/pid-chain.mjs`：会话进程链捕获
- `runtime/permission.mjs`：权限审批 / elicitation
- `runtime/focus-windows.mjs`：前往会话窗口聚焦
- `runtime/hooks/`：各 Agent 的 hook 安装器
- `runtime/hook.cjs`：Agent 侧 hook 脚本
- `runtime/sound.mjs`：提示音模式解析
- `assets/agent-notify.wav`：内置提示音
