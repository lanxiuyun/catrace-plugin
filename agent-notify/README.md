# Agent 通知（agent-notify）

把原来宿主内置的 Agent 通知做成外置插件。启用后 sidecar 监听 `127.0.0.1:23456`：

- `POST /state`：会话状态 → 右下角小窗
- `POST /permission`：阻塞式权限审批（Claude http hook）

设置里可给 Claude / Codex / Gemini / Kimi 安装 hook。默认关闭。启用 = 信任本目录代码（含 sidecar）。需要本机 Node.js。

旧内置配置键 `plugin_config:agent` **不会**自动迁过来，请重新装 hook。
