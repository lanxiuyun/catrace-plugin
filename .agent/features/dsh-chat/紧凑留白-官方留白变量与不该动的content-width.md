# 紧凑留白开关：动哪几个官方留白变量、为什么偏偏不能动 content-width

设置页「小窗外观」顶部那个**独立开关**（`config.compactSpacing`，默认关，与 show* 标签互不影响）。
它把官方界面的留白收到小窗尺度——**不改官方渲染管线，只动官方自己的留白变量 + 少量内边距**。

## 官方留白是怎么来的（都是读安装包 CSS 得到的硬事实）

| 官方声明 | 位置 | 后果 |
|---|---|---|
| `.uPhUma_body { --dsh-composer-side-clearance: 16px }` | `dsh-client-ui-conversation/lib/client.js` | 下面两处都拿它算内边距 |
| `V0s2hW_scroll { padding: 16px calc(var(--dsh-composer-side-clearance) + 16px) }` | `dsh-client-ui-chat` | 对话滚动区**每侧 32px** |
| `.nY9qbq_root { padding: 8px calc(var(--dsh-composer-side-clearance) + 16px) 12px }` | `dsh-client-ui-approval` | 审批卡每侧也吃这 32px |

## 开关打开后（`gui-proxy.compactSurfaceRules()`）

| 项 | 官方 | 紧凑留白 |
|---|---|---|
| `--dsh-composer-side-clearance` | 16px（每侧 32px） | **0px** → 每侧 16px |
| 对话区 `[class*="_viewArea"] [class*="_scroll"]` 内边距 | 每侧 32px | **8px**（0.5rem） |
| `[class*="_composerSeat"]` | 有侧边留白 | 贴边 0.25rem |
| `[class*="_body"]` 消息块间距 | 16px | **10px**（0.625rem） |
| `[class*="_toBottomSlot"]`（回到底部浮层） | 跟着留白走 | 0.5rem |

**净效果（360px 窗口）**：正文可用宽度约 **296px → 344px（+16%）**，消息块之间的垂直节奏也更紧。
用户问过"怎么感觉没区别"——先确认开关是开的、反代已重建（见下），再看这个宽度差。

## 为什么**故意不动** `--dsh-chat-content-width`

官方默认是：

```css
--dsh-chat-content-width: var(--dsh-chat-user-width, clamp(680px, calc(var(--dsh-conversation-column-width, 0px) * .64), 920px));
```

两个原因：

1. **在 360px 窗口里它本来就不生效**：`clamp()` 最小值 680px，而容器只有 360px，`max-width` 永不触发 ⇒ 改成 `100%` 是纯粹的空操作；
2. **改成百分比有跑版风险**：它同时被这些地方消费——`V0s2hW_column{max-width}`、用户气泡
   `VnbZpq_userStack{max-width:min(calc(var(--dsh-chat-content-width,.702)),82%)}`、
   **宽表格** `IS3SeW_body .md-table-wide{--dsh-table-spare:max(0px, calc((100cqw - var(--dsh-chat-content-width))/2))}`、
   以及 `uPhUma_widthHandle{width:min(10px, calc((100% - var(--dsh-chat-content-width))/2 - 48px))}`。
   把 680px 换成 `100%` 会让 `calc(100cqw - 100%)` 变成非法表达式，那条声明整体失效 ⇒ **消息里的宽表格跑版**。

结论：收益为 0、风险不为 0，所以宁可不动。（orb 的 overlay 紧凑面确实设了 `content-width:100%`，
但那是因为它的文档只有 ChatView、没有列宽手柄与表格装订，见
[参考项目orb的悬浮窗怎么实现的-以及为什么本插件没做自绘外壳.md](参考项目orb的悬浮窗怎么实现的-以及为什么本插件没做自绘外壳.md)。）

## 怎么生效：进签名 → 重建反代 → 自动重开小窗

`compactSpacing` 进 `guiSignature()`（`runtime/lib/config.mjs`）。设置页开关 → `scheduleSave()` →
`plugin.config.set` + `applyConfig` RPC → sidecar 比对签名发现变了 → 关掉旧反代、按新配置重建 →
设置页 `reopenGuiSoon()`（~1 秒）重开小窗。**不需要** disable/enable 插件。

## 怎么确认它真的生效了（别靠肉眼猜）

- `guiStatus.compactSpacing`：当前反代是否按"紧凑留白开"构建；
- `guiStatus.cssBytes`：实际注入的 CSS 字节数（开/关应该差几十字节，选择器不同）；
- 设置页那个开关本身读的是 merge(存盘, sidecar `status.config`) ⇒ **刷新后仍是开的**，就说明存盘与侧车都收到了。

## 维护须知

- 规则里用的都是**语义后缀**（`[class*="_viewArea"] [class*="_scroll"]`、`_toBottomSlot`、`_body`），
  官方 class 带哈希、只有后缀稳定；这些后缀必须同时登记在 `runtime/lib/gui-classes.mjs` 的速查表里，
  否则 `gui-classes.test.mjs` 的"速查表不许漂移"会失败（它就是从 `gui-proxy.mjs` 里抽 `[class*="_x"]` 逐条比对的）。
- 新增紧凑规则时，**先读官方 CSS 确认默认值**：如果那条属性官方本来就没设（例如 `content-width` 之外的
  未知变量），写 `0` 可能反而"加上"一段留白，属于反向优化。
