# Hook 原始数据统一转换为 CatraceHookData 与会话标题缓存

## 为什么需要这一层

Claude Code、ZCode、Codex、Gemini、Kimi 的 hook 都通过 stdin 发送 JSON，但字段命名和事件名并不一致。UI 如果直接读取 `last_assistant_message`、`responsePreview`、`tool_name` 等 Agent 原始字段，每新增一种 Agent 就要继续堆兼容分支。

`agent-notify` 现在采用两层数据模型：

```text
hook_raw_data（Agent 原始 JSON）
  → runtime/hook.cjs 注入 agentId 并转发
  → runtime/main.mjs normalizeHookData()
  → CatraceHookData（插件内部统一结构）
  → event.payload.entry
  → runtime/ui.mjs
```

## CatraceHookData 字段

```js
{
  agentId: 'claude' | 'zcode' | 'codex' | 'gemini' | 'kimi' | 'unknown',
  event: string,
  sessionId: string,
  sessionTitle: string,
  projectName: string,
  cwd: string,
  timestamp: string,
  message: string,
  permission?: {
    toolName: string,
    toolInput: unknown,
  },
  raw: object,
}
```

字段约定：

- `event` 是归一化后的共享事件名。Gemini 的 `BeforeAgent`、`AfterAgent`、`BeforeTool`、`AfterTool` 分别转为 `UserPromptSubmit`、`Stop`、`PreToolUse`、`PostToolUse`。
- `sessionId` 同时兼容 `session_id` 和 `sessionId`；缺失时使用 `unknown`。
- `projectName` 是 `cwd` 的最后一级目录名，供卡片项目标签使用。
- `message` 按优先级从 `last_assistant_message`、`lastAssistantMessage`、`responsePreview`、`response_preview`、`responseText`、`response_text`、`prompt` 取第一个非空字符串。
- `permission` 统一 Claude/ZCode/Codex 的 `tool_name`/`toolName` 与 `tool_input`/`toolInput`。
- `raw` 只作为调试视图数据保留，不应成为普通 UI 的业务数据来源。

## Agent ID 的传递

安装器在 command hook 命令末尾加入参数，例如：

```text
& "node" ".../hook.cjs" --agent=zcode
```

`runtime/hook.cjs` 同时支持：

- `--agent=<id>` 命令参数
- `CATRACE_AGENT_ID` 环境变量
- 没有标识时回退 `unknown`

权限 HTTP hook 通过 URL 查询参数传递标识：

```text
http://127.0.0.1:23456/permission?agent=claude
```

旧版本已经安装的 hook 可能没有 Agent 标识；这不影响状态通知，只会让归一化层使用 `unknown`，重新安装即可获得完整标识。

## 会话标题获取顺序

`deriveSessionTitle()` 按以下顺序获取标题：

1. payload 的 `session_title` 或 `sessionTitle`；
2. 会话标题缓存；
3. ZCode transcript 同目录的 `metadata.json` 中的 `description` 或 `prompt`；
4. Codex transcript 前 80 行中第一条用户消息；
5. 没有可用标题时返回空字符串，由 UI 回退到 `projectName`。

标题会经过空白折叠，并限制为 120 个字符，避免把整段 prompt 直接放进标题。

## 缓存规则

缓存由 sidecar 自己维护，不使用 `plugin.storage`：

```text
tools/plugin-demo/agent-notify/runtime/cache/session-titles.json
```

缓存 key 是 `${agentId}:${sessionId}`，值为：

```json
{
  "zcode:sess_xxx": {
    "title": "本次会话标题",
    "ts": 1780000000000
  }
}
```

- sidecar 启动时加载缓存。
- 同一会话只尝试读取 transcript 一次，避免每次 hook 都读文件。
- 标题缓存有效期为 7 天。
- 保存缓存时清理过期条目。
- transcript 解析失败必须静默回退，不得阻塞或影响 Agent 主流程。

## 权限事件链路

权限 hook 和普通状态 hook 共用 `hook.cjs`，但行为不同：

```text
PermissionRequest
  → POST /permission（长超时）
  → normalizeHookData()
  → pendingPerm 保存 HTTP response
  → 发布 permission Toast
  → 用户点击允许/拒绝
  → sidecar 将 hookSpecificOutput 决策 JSON 写回 stdout
```

普通状态事件仍然走 `/state` 的短超时、失败静默路径。不能把权限请求当作普通异步状态事件，否则 Agent 会在没有决策时继续或挂死。

## 新增 Agent 时的修改点

1. 在 `runtime/hooks.mjs` 为安装器传入稳定的 Agent ID。
2. 如果原生事件名不同，在 `runtime/main.mjs` 的 `EVENT_ALIASES` 增加映射。
3. 在 `normalizeHookData()` 增加该 Agent 特有的标题或用户消息来源，仅在原始字段无法复用时添加。
4. 如果 transcript 格式不同，新增小范围解析分支，并保留失败回退。
5. UI 只读取 `CatraceHookData`，不要新增 Agent-specific 字段判断。
6. 如果权限响应格式不同，单独处理响应序列化；不要破坏共享的 `/permission` 挂起生命周期。

## 相关代码

- `tools/plugin-demo/agent-notify/runtime/hook.cjs` — 读取 stdin、注入 Agent ID、区分状态/权限转发。
- `tools/plugin-demo/agent-notify/runtime/hooks.mjs` — 各 Agent 安装规格和事件配置。
- `tools/plugin-demo/agent-notify/runtime/main.mjs` — 归一化、标题解析/缓存、状态与权限发布。
- `tools/plugin-demo/agent-notify/ui.mjs` — 只消费统一 entry，raw 仅用于调试字段。
- `tools/plugin-demo/agent-notify/AGENT_HOOK_EVENTS.md` — 各 Agent hook 事件速查表。
- [hook-install-development-guide.md](hook-install-development-guide.md) — 安装器和平台命令约定。
