# NapCat QQ

Catrace 外部插件：连本机 NapCat OneBot，把某个好友/群做成 **迷你 QQ 对话窗**（对方一句、你一句，同一张卡里刷历史）。不是快捷回复条。

不内置 QQ 协议。本机（或远程那台机器）必须有 **QQ NT + NapCat 已登录**。

## 依赖

1. 官方 QQ NT，或 NapCat OneKey（内置无头 QQ，任务管理器里仍有 QQ 进程）。
2. NapCat 已登录。WebUI 默认 `6099`（`?token=`），**不要把 6099 当 OneBot 口**。
3. OneBot HTTP 示例 `3000`、正向 WS `3001`，上报 `array`。
4. sidecar 用 Node（建议 22，有全局 `WebSocket`）。

`D:\NapCat.Shell` 这种完整 Shell.zip 还要另装官方 QQ，再跑 `launcher-user.bat`（不要管理员版除非必要）。不要塞进 Catrace 目录。

## 配置（插件设置页）

| 项 | 默认 | 说明 |
|---|---|---|
| `httpBase` | `http://127.0.0.1:3000` | OneBot HTTP，发消息 / get_login_info |
| `wsUrl` | `ws://127.0.0.1:3001` | 正向 WS，收消息 |
| `token` | 空 | 与 NapCat OneBot token 一致 |
| `cardDurationSec` | `0` | `0` = sticky |

同一 `chatType+chatId` 用固定 `dedupeKey` 更新同一张卡。首次会拉 `get_friend_msg_history` / `get_group_msg_history`（约 20 条）。你发的气泡靠右，对方靠左。

宿主禁止 Toast 窗调 `plugin.sidecar.request`。卡内发送：

1. `plugin.storage` 的 `outbox` 数组（sidecar 约 400ms 捞一次）
2. 同时 `emit('action','reply',{ text, chatType, chatId })`（宿主 resolve payload）

`chatId` 为 `10000` 或 `test` 时 dry-run，不真发 QQ。

## 数据流

```
QQ NT + NapCat
  → WS message / HTTP
  → sidecar runtime/main.mjs
  → publish napcat-qq.message
  → Toast ui.mjs
  → storage outbox / resolved
  → HTTP send_private_msg | send_group_msg
```
