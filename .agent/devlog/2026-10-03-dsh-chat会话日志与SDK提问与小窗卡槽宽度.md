# dsh-chat 首版：会话日志多帧 zstd + SDK 提问 + 小窗卡槽宽度

日期：2026-10-03　插件：`tools/plugin-demo/dsh-chat/`

## 做了什么

把 DSH 的对话搬进 Catrace 常驻小窗：**看**走会话日志（`$DSH_HOME/sessions/**/session.v4.jsonl.zstd`），
**问**走官方 `dsh --profile sdk`（stdio JSON-RPC）。设置页给状态/会话列表/转录预览/对话配置，
小窗卡片给消息流 + 输入框。

## 三个值得记下来的点

1. **DSH 会话日志是多帧 zstd 拼接**：实测 2.1MB / 242 帧，`zlib.zstdDecompressSync` 只解第一帧，
   必须自己按 RFC 8878 的帧头/块头走边界（`runtime/lib/zstd-frames.mjs`）。而且 DSH 边写我们边读，
   尾部常有半个帧 → 加了 `decodeZstdDetailed(buf, {tolerant:true})`，只解到最后一个完整帧并回报
   `tailTruncated`。第一版没做这个容错，`readSession` 对正在写的会话直接返回 null（实时镜像每轮轮询都空手）。
2. **Toast 卡片调不到 sidecar**：宿主 `plugin_sidecar_request` 只放行 `main` 窗（`plugin_sidecar.rs`）。
   卡片改走 sidecar 自起的本机 HTTP 桥（`127.0.0.1` + 一次性 token，端口随 payload 下发），
   沿用 `agent-notify` 已验证的 CORS 写法。
3. **小窗尺寸是宿主定的**：`.toast-root` 24.5rem → `.toast-stack` 内容宽 22.5rem → `.toast-card` 22.5rem、
   `overflow-x: hidden`。第一版卡片写死 `width: 24rem` 又不传 `payload.toastStyle:'standalone'`，
   用户一眼就看出「窗口显示不完全」：右边被裁 + 套在宿主白卡里（可用宽只剩 21rem）。
   修法：`width:100% + box-sizing:border-box` + `toastStyle:'standalone'`，并把数字写进
   `plugin-contract.test.mjs` 的回归用例。

## 怎么验的

- `node --test "runtime/test/*.test.mjs"` → 90 项全过（本机 `node --test <目录>` 会报
  `Cannot find module`，必须用 glob 或显式文件列表）。
- 真实 `~/.dsh` 端到端：列 20 个会话 → 镜像正在跑的会话 → 发真实提示词 → 1.5s 从日志读回回复 →
  新会话进入会话库。
- 布局：`e2e-temp/dsh-chat-card-measure.mjs`（Playwright + 从 `ReminderToast.vue` 抽出的真实样式）
  量出卡片 360px、栈横向溢出 0、输入区完整可见；对照「写死 24rem」复现 18px 溢出 + 右侧被裁。

## 顺带修的两处

- 注入的 Vue 运行时**没有 `nextTick`**（白名单只有 h/ref/computed/watch/markRaw/onMounted/onBeforeUnmount），
  改用宏任务等一次渲染；并加了静态检查防止再犯。
- 样式注入不能「有就跳过」：Toast 窗跨挂载复用同一个 document，改了 `ui.mjs` 老样式会一直生效，
  所以 `ensureStyle()` 发现内容不同就覆盖。
