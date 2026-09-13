# Agent 通知插件（agent-notify）

接收 AI agent（Claude Code / Codex / ZCode / Gemini / Kimi）hook 推送的状态事件，经本地 HTTP(23456) 归一化后按事件策略弹 Catrace toast 卡；Claude/ZCode 的 **PermissionRequest** 走阻塞 `/permission` 真审批（Toast 上允许/拒绝）。

## 涉及文件

- `agent-notify/runtime/main.mjs` — sidecar 主进程：HTTP(23456) /state·/permission、payload 归一化（`normalizeHookData`）、会话标题缓存（`deriveSessionTitle`）、事件策略与 sticky 管理
- `agent-notify/runtime/hook.cjs` — hook 命令脚本（各 agent settings 里配的就是它）：读 stdin、Gemini 事件别名归一、转发 `/state` 或阻塞 `/permission`
- `agent-notify/runtime/hooks.mjs` — 五家 agent 的 hook 安装/卸载/检测器（`installAgent` / `uninstallAgent` / `isInstalled`）
- `agent-notify/ui.mjs` — 卡片渲染：agent 徽章品牌图标、chip 行、`bodyPreview`、调试字段面板
- `agent-notify/settings.mjs` — 设置页：启停开关、每 agent 安装状态、事件策略、调试视图
- 协议与字段差异的完整说明：[../agent-notify/AGENT_HOOK_EVENTS.md](../../agent-notify/AGENT_HOOK_EVENTS.md)、[../agent-notify/HOOK_DATA_NORMALIZATION.md](../../agent-notify/HOOK_DATA_NORMALIZATION.md)

宿主侧（junction 挂载、插件目录约定、toast 窗口机制）见 Catrace 主仓 `.agent/`（features/agent-notification、architecture/desktop-event-os）。

## 子文档

- [会话标题-三级来源与为什么不读transcript不回写.md](会话标题-三级来源与为什么不读transcript不回写.md) — **标题策略与只读不回写的取舍**
- [toast卡观感-agent徽章品牌图标与body展开滚动.md](toast卡观感-agent徽章品牌图标与body展开滚动.md) — **徽章图标资产来源与换法、body 3行折叠/10行滚动**

## 开发流程

改代码 → 用户重载插件实际验证 → 确认后 commit（本仓库）→ 主仓更新 submodule 指针（分开提交，默认不 push）。
