# 2026-09-18 AskUserQuestion 可交互审批与调试卡片

## 会话目标

按 clawd 把权限卡分成工具允许/拒绝和 AskUserQuestion 逐题回答，并方便在设置页预览。

## 完成项

- 问答卡：可点选项、无标题 textarea、点 Other 立刻清预设、多题进度在右下角按钮左侧
- sidecar `/permission-decide` + `updatedInput`；Toast 不能 sidecar.request
- 设置页最底部「调试卡片」，fixture 在 `preview-cards.mjs`

## 待开发

- 真机确认刷新 sidecar 后提交不再 404

## 关键文件变更

| 文件 | 变更 |
|------|------|
| `agent-notify/ui.mjs` | 问答交互与权限卡观感 |
| `agent-notify/runtime/main.mjs` | decide 路由与 testCard 注入 |
| `agent-notify/runtime/preview-cards.mjs` | 调试卡 fixture |
| `agent-notify/settings.mjs` | 底部调试卡片按钮 |
