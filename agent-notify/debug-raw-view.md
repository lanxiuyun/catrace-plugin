# Agent 通知调试字段视图

Agent 通知外置插件的调试区用于观察 Agent hook 实际传来的 stdin，不应把宿主事件信封误当成 hook 原文。

## 两种视图

设置页提供三档：

- **关闭**：卡片只显示正常的 Agent 通知内容。
- **常用**：对 raw 数据做展示层过滤和排序，去掉重复的 camelCase / snake_case、空字段和重复回复字段；重要字段放前面，例如 `event`、`last_assistant_message`、`cwd`、`session_id`、`timestamp`、`permission_mode`、`state`、`tool_call_count`、`transcript_path`、`turn_id`、`trace_id`。
- **原始**：显示 hook stdin 原文，不清洗、不补字段、不改 key 名。这个视图才用于核对 Agent 实际发送了什么。

复制按钮复制当前选中的视图；卡片内支持切换「常用 / 原始」。

## 关键边界

`runtime/hook.cjs` 只负责读取 stdin 并原样 POST 到 sidecar。不要在 hook 脚本里把 camelCase 转 snake_case、删除空值、合并 `responsePreview` / `responseText` / `last_assistant_message`，否则调试数据已经不是 raw。

sidecar 可以从 raw 中提取 `event`、`session_id` 等字段用于路由和按 session 去重，但这些字段不要回写成调试 raw 的替代品。每个 `session_id` 仍只维护一张状态卡，事件通过相同 dedupe key 原地更新。

## UI 约束

- JSON 长文本按字段分行展示，不要把整个对象塞进一块连续的 `<pre>`，否则长回复会挤压其他字段。
- key 与 value 分色，value 使用 `white-space: pre-wrap` 和 `word-break: break-word`。
- 宿主全局样式默认禁止文本选择；调试字段容器及所有子元素必须显式设置：

```css
-webkit-user-select: text !important;
user-select: text !important;
pointer-events: auto !important;
```

- 调试滚动区使用稳定的细滚动条，复制按钮放在独立 toolbar，避免覆盖 JSON 内容。

## 外置插件约束

外置 `ui.mjs` 通过 Blob URL 加载，不能直接 `import` 第三方 JSON viewer。除非宿主专门注入 runtime 或把依赖打包进插件，否则优先使用插件内的轻量 render + CSS 实现。
