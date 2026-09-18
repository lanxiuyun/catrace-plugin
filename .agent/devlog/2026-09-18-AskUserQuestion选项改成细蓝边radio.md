# 2026-09-18 AskUserQuestion 选项改成细蓝边 radio

## 会话目标

选项观感对齐参考图，但用蓝色细边，不要紫色粗框。

## 完成项

- 左侧 radio，标题在上、描述在下
- 选中 `#2563eb` 1px + 浅蓝底；hover 浅蓝
- footer 分割线加 `margin-top`，避免贴着 textarea

## 待开发

- 无

## 关键文件变更

| 文件 | 变更 |
|------|------|
| `agent-notify/ui.mjs` | option-radio / copy 布局与蓝色选中、hover、footer 间距 |
