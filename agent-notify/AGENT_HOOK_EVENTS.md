# Agent Hook 事件对照表

> 来源：`D:\workspace\clawd-on-desk` 项目源码（`agents/`、`hooks/`、`docs/guides/state-mapping.md`）。
> 用途：记录各 AI agent 能向 Catrace `agent-notify` 插件发送的 hook 事件，供后续新增/维护 Agent 时参考。
>
> 宿主侧已有更详细的接入实现分析：`.agent/reference/agent-hook-integration-per-agent-claude-code-codex-gemini-kimi-opencode-openclaw-hermes.md`

## 共享事件词汇

clawd-on-desk 把各 agent 的原生事件名归一化成下面这套共享事件：

| 共享事件 | 含义 |
|---|---|
| `SessionStart` | 会话开始 |
| `UserPromptSubmit` | 用户提交 prompt，开始思考 |
| `PreToolUse` | 调用工具前 |
| `PostToolUse` | 调用工具后（成功） |
| `PostToolUseFailure` | 调用工具失败 |
| `Stop` | 任务正常完成 |
| `StopFailure` | 任务异常 / 中断 |
| `Notification` | 需要用户注意的提示 |
| `PermissionRequest` | 权限审批请求 |

> 扩展事件（如 `SessionEnd`、`SubagentStart`、`SubagentStop`、`PreCompact`、`PostCompact`）在 Catrace 中通常映射为上面的共享事件，或仅作记录不切换状态。

## 各 Agent 支持情况一览

| Agent | 状态事件（共享词汇） | `PermissionRequest` | 接入方式 |
|---|---|---|---|
| **Claude Code** | 全部 8 个 + `SessionEnd`/`SubagentStart`/`SubagentStop`/`PreCompact`/`PostCompact`（版本门控） | ✅ 阻塞 HTTP hook | 命令 hook |
| **ZCode** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`Stop` | ✅ 阻塞 config hook | 配置文件 hook |
| **Codex CLI** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop` | ✅ 官方阻塞 hook | 命令 hook |
| **Kimi CLI** | 全部 8 个 + `SessionEnd`/`SubagentStart`/`SubagentStop`/`PreCompact`/`PostCompact` | ✅ Kimi Code 原生支持；legacy 用 `PreToolUse` 启发式 | 命令 hook（TOML） |
| **Gemini CLI** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop`/`Notification` | ❌ | 命令 hook（事件名需映射） |
| **Copilot CLI** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop`/`SubagentStart`/`SubagentStop`/`PreCompact` | ✅ `permissionRequest` | 命令 hook |
| **CodeBuddy** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop`/`Notification`/`PreCompact` | ✅ HTTP 权限 hook | 命令 hook |
| **Qwen Code** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop`/`Notification` | ✅ 阻塞命令 hook | 命令 hook |
| **OpenCode** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`Stop`/`StopFailure`/`SessionEnd` | ✅ `permission.asked` 插件事件 | 进程内插件 |
| **MiMo Code** | 同 OpenCode | ✅ 同 OpenCode | 进程内插件 |
| **Cursor Agent** | `SessionStart`/`SessionEnd`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`Stop`/`SubagentStart`/`SubagentStop`/`PreCompact` | ❌ | 命令 hook |
| **Kiro CLI** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop` | ❌ | 命令 hook |
| **TraeCode** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop`/`Notification` | ❌ | 命令 hook |
| **CodeWhale** | `SessionStart`/`SessionEnd`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`PreCompact`/`StopFailure` | ❌ | 命令 hook |
| **Pi** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`Stop`/`PreCompact`/`PostCompact`/`SessionEnd` | ❌ | 扩展（Extension） |
| **OpenClaw** | `SessionStart`/`UserPromptSubmit`/`Stop`/`PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`PreCompact`/`PostCompact`/`SessionEnd` | ❌ | 进程内插件 |
| **Hermes Agent** | `SessionStart`/`UserPromptSubmit`/`Stop`/`PreToolUse`/`PostToolUse`/`SessionEnd` | ⚠️ 可选（`CLAWD_HERMES_PERMISSION_TOOLS`） | Python 插件 |
| **Antigravity CLI** | `PreInvocation`/`PostToolUse`/`PostInvocation`/`Stop` | ❌ | 命令 hook |
| **Reasonix** | `SessionStart`/`SessionEnd`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop`/`SubagentStop`/`Notification`/`PreCompact` | ❌ | 命令 hook |
| **DeepSeek Harness** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`Stop`/`StopFailure`/`SessionEnd` | ✅ `approval/request` 阻塞瀑布 | 进程内插件 |
| **Qoder** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`Stop`/`Notification`/`SessionEnd` | ⚠️ 仅观测（hook 返回 `{}`） | 命令 hook |
| **QoderWork** | 同 Qoder | ⚠️ 仅观测 | 命令 hook |
| **QwenWork** | 同 Qoder | ⚠️ 仅观测 | 命令 hook |
| **WorkBuddy** | `SessionStart`/`SessionEnd`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop`/`Notification`/`PreCompact` | ❌（仅通知） | 命令 hook |
| **Custom HTTP** | 建议：`SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`SubagentStart`/`PostToolUseFailure`/`Stop`/`Notification`/`SessionEnd` | ❌ | 用户自己 POST `/state` |

## Catrace `agent-notify` 当前接入的 5 个 Agent

| Agent | 已安装状态事件 | `PermissionRequest` | 说明 |
|---|---|---|---|
| **Claude Code** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`Stop` | ✅ | 6 个共享状态 + HTTP 权限 hook |
| **ZCode** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`Stop` | ✅ | 6 个共享状态 + config 权限 hook |
| **Codex** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop` | ✅ | 5 个状态事件 + command 权限 hook（timeout 600s） |
| **Gemini** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop`/`Notification` | ❌ | Gemini 原生事件名不同，hook 脚本内做映射 |
| **Kimi** | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`Stop` | ❌ | 旧 Kimi 无原生权限事件；Kimi Code 有，但当前插件未启用 |

## 关键结论

1. **7 标准 hook**：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`Stop`。Claude Code 与 ZCode 的安装结果最贴近这套标准。
2. **Codex 官方 hook 没有 `PostToolUseFailure`**，因此 Codex 只有 5 个状态事件 + `PermissionRequest`。
3. **Kimi 事件最全**（legacy 13 个），但 schema 严格、分新旧两代，权限事件支持情况不同。
4. **Gemini 事件名完全不同**，需要在 hook 脚本里做映射表（`BeforeAgent` → `UserPromptSubmit`，`BeforeTool` → `PreToolUse` 等）。
5. **B 派 Agent**（OpenCode、OpenClaw、Hermes 等）不写配置文件，而是写进程内插件，接入方式与命令 hook 完全不同。
6. **`StopFailure` / `Notification`** 目前没有 Agent 默认安装；`agent-notify` 运行时还保留识别，主要是为了兼容旧配置或用户手动配置。

- `CatraceHookData` 归一化、Agent ID 传递和会话标题缓存：见 [HOOK_DATA_NORMALIZATION.md](HOOK_DATA_NORMALIZATION.md)。

## CatraceHookData 归一化层

`runtime/main.mjs` 会把 hook 收到的 `hook_raw_data` 转换成插件内部维护的 `CatraceHookData`，UI 不直接依赖各 Agent 的字段差异：

```js
{
  agentId, event, sessionId, sessionTitle, projectName, cwd,
  timestamp, message, permission, raw
}
```

- `message` 统一从 `last_assistant_message`、`responsePreview`、`responseText`、`prompt` 等字段取值。
- `permission.toolName` / `permission.toolInput` 统一 Claude、ZCode、Codex 的权限字段。
- `raw` 仅用于调试视图，保留原始 hook JSON。
- `sessionTitle` 优先使用 Agent 直接提供的字段；缺失时按 Agent 读取 transcript / metadata，并写入 `runtime/cache/session-titles.json`。
- 标题缓存保留 7 天，过期条目在保存时清理。
