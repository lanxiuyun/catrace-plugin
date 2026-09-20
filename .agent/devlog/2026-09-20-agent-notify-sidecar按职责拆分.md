# 2026-09-20 agent-notify sidecar 按职责拆分

## 会话目标

`main.mjs` / `hooks.mjs` 过大，按职责拆开且行为不变。

## 完成项

- sidecar 拆出 constants / hook-data / pid-chain / permission / hooks/*
- 单测覆盖 normalize、elicitation、pid-chain 捕获
- `ui.mjs` 因 Blob 加载保持单文件，只去掉重复 CSS

## 待开发

- 无。改完需用户 reload sidecar 验证

## 关键文件变更

| 文件 | 变更 |
|------|------|
| `agent-notify/runtime/main.mjs` | 只留编排 |
| `agent-notify/runtime/hooks/*.mjs` | 五家 Agent 安装器 |
