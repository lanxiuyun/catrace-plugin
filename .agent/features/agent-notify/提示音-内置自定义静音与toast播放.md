# Agent 通知提示音

迁移前内置面板有「内置 / 自定义 / 静音」和音量。外置 `agent-notify` 时漏了；Toast 宿主也不再播 `agent-notify.wav`。

## 配置（`plugin.config`）

| 字段 | 默认 | 含义 |
|---|---|---|
| `soundMode` | `builtin` | `builtin` / `custom` / `muted` |
| `soundPath` | `""` | 自定义文件绝对路径 |
| `soundVolume` | `1` | `0–1` |

旧键 `plugin_config:agent` **不迁**。用户需在插件设置里重选。

## 播放

- 内置文件：`assets/agent-notify.wav`（与 3854c1e 删除的宿主资源同一份）
- sidecar 每次真正弹出卡片时在 payload 里带 `soundNonce`；关卡（`gone`）不带
- `ui.mjs` 看 `soundNonce` 变化，用 `plugin.audio.play`（跟当前系统默认输出设备）
- 静音或自定义路径为空：不播

解析逻辑：`runtime/sound.mjs`（设置页预览也走同一规则）。
