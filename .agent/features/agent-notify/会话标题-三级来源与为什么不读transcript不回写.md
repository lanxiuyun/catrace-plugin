# 会话标题：三级来源，以及为什么不读 transcript、不回写

`agent-notify/runtime/main.mjs` 的会话标题决策记录。卡片标题要的是**稳定的身份**，不是对话内容。

## 现行三级优先级（`deriveSessionTitle`）

1. **payload `session_title` / `sessionTitle`**（pinned）——用户用 `--name` / `/rename` 显式命名，或宿主自动命名后流入。pinned 条目不会被下面两级覆盖（官方文档原话：hook 要先查 `session_title`，避免覆盖用户显式设置的标题）。
2. **缓存命中**——`agent-notify/runtime/cache/session-titles.json`，key 为 `${agentId}:${sessionId}`，TTL 7 天；文件已进插件 .gitignore（运行时产物）。
3. **UserPromptSubmit 首条 `prompt` 填空**（非 pinned）——第一条用户输入给会话定名，之后不随 prompt 变化；Claude 与 ZCode 的 UserPromptSubmit payload 都实测带 `prompt` 字段。
4. 兜底：`projectName(cwd)`（cwd 末段）→ `'AI 助手'`。

显示层防复读：标题 == prompt 摘要时 body 清空回落固定文案；项目 chip 与标题同名时不渲染（`ui.mjs`）。

> ⚠️ 待确认：另一会话记录「用户否决 prompt 当标题、已移除填空」，与本仓库已提交代码（3b0c8fe）冲突。动标题逻辑前先和用户对齐。

## 为什么不读 transcript（两条路都是死的）

- **Claude**：官方文档明确警告 transcript 是异步落盘，hook 触发时可能还没有当前轮内容；要最终回复文本应该用 Stop 事件的 `last_assistant_message`，别读 transcript。
- **ZCode**：结构死路。hook payload 的 `transcript_path` 指向一次性临时目录 `Temp\zcode-claude-hook-*`，里面只有 0 字节的 transcript.jsonl、没有 metadata.json，事后整个目录删除；ZCode 真实会话元数据在 `~/.zcode/cli/db/db.sqlite`，插件不该去读第三方应用的私有库。

## 为什么不回写 Claude 的 `sessionTitle`（只读不写）

Claude 允许 hook 通过输出 JSON 的 `hookSpecificOutput.sessionTitle` 给会话命名，但：

- **async command hook 的输出只有 `additionalContext` / `systemMessage` 会被投递**，`sessionTitle` 属于决策字段，async 下直接无效。要回写必须把 UserPromptSubmit 改成同步 hook → 每条 prompt 前多一次 node 启动延迟（Windows 200-400ms）。
- 换 **HTTP hook** 天然同步，但「连接失败 = non-blocking error」会在 transcript 报错——插件离线时用户每发一条 prompt 都看到 hook error 噪声，健壮性倒退。
- 收益只有「`/resume` 列表同步显示插件侧标题」，对通知插件不值。**结论：只读**。原生/显式命名的标题会自动经 `session_title` 流入，卡片标题最终与 Claude 原生对齐。

## 改这块时注意

- pinned 标记存在缓存条目里（`{title, ts, pinned}`），`loadTitleCache` 会带上；老缓存没有 pinned 字段按非 pinned 处理。
- 会话标题一进缓存就冻结 7 天；要强制刷新可以删 `agent-notify/runtime/cache/session-titles.json`。
- 别把对话原文（prompt / assistant 回复）当身份性文案塞进标题——通知标题要稳定，聊天记录式标题已被质疑过一次。
