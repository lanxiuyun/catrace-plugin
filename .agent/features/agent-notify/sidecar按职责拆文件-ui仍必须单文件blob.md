# sidecar 按职责拆文件，Toast UI 仍必须单文件 Blob

宿主用 Blob 加载 `ui.mjs` / `settings.mjs`，**不能 `import` 兄弟模块**。sidecar 是 Node 读磁盘，可以拆 ESM。

## 现行结构

| 文件 | 职责 |
|------|------|
| `runtime/main.mjs` | HTTP + JSONL 编排 |
| `runtime/constants.mjs` | 事件名、默认 mode |
| `runtime/hook-data.mjs` | hook JSON → CatraceHookData、标题缓存 |
| `runtime/pid-chain.mjs` | 会话进程链 |
| `runtime/permission.mjs` | 权限 / elicitation |
| `runtime/focus-windows.mjs` | `/focus` 窗口聚焦 |
| `runtime/preview-cards.mjs` | 设置页调试卡 fixture |
| `runtime/hooks.mjs` + `runtime/hooks/*.mjs` | 各 Agent 安装器 |
| `runtime/hook.cjs` | Agent 侧 hook 脚本 |
| `ui.mjs` | 会话卡 + 权限卡，单文件 |

## 不要做的

- 不要把 `ui.mjs` 拆成 `import './foo.mjs'`，Toast 会加载失败
- 不要为了拆 UI 去改宿主 Blob 加载，除非先做打包
- 改 sidecar 后必须 **reload sidecar**（刷新卡片不等于重启 Node）
