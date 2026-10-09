# 「在 DSH 里时不弹小窗」——为什么最后是看**前台窗口**而不是看会话

用户需求一路演进（同一天四版），本文记的是**最终方案**与**为什么中间的方案都不行**。

## 一、四版演进（每一版都是用户实测逼出来的）

| 版本 | 做法 | 用户实测 |
|---|---|---|
| v1 | 读 DSH 客户端 localStorage 里的"当前会话"，**按会话整轮禁发** | ❌「一旦启用之后，好像再也不会弹出来卡片了」——用户看的往往正是**产生卡片的那条会话** |
| v2 | 同一个信号，改成"收掉现有卡 + 本轮静默（`markDismissed`）" | ✅ 能收掉；❌「有点慢」 |
| v3 | 信号源不动，把检测从"挂巡检间隔"改成 `fs.watch` 存储目录 + 120ms 去抖 | ✅ 我们这段 140ms；❌ **总延迟仍有 ~5 秒** |
| **v4** | **不监控会话**，改看**当前前台窗口是不是 DSH** | ✅ 毫秒级、跨平台、不碰 DSH 内部存储 |

**v3 为什么还是有 5 秒**（这段值得记住）：延迟不在插件里，而是
**Chromium 把 localStorage 提交到 LevelDB 时的合并/节流**。证据链：

1. 我们这段 140ms（毫秒探针实测 139/139/140/140/140/155ms），日志里每次都是同一秒内
   `会话变化 → 自动收掉一张卡 → close_reminder_window hiding`；
2. **DSH 客户端在你点击的同一个同步调用栈里就把值写好了**：官方
   `dsh-client-ui-workspace/README.zh.md` 明说 `openSession()` **同步**替换 mainView、不等 `reference.ready`；
   代码链路 `openSession → replaceMain → sessions.retain → selection.set → store 订阅 → localStorage.setItem`；
3. 探针盯着真实目录：**相邻两次写入的间隔全部 ≥5 秒**（18/6/12/9/6/6/5/7/12/18s）。

**结论**：只要信号源是那个文件，就永远有 ~5 秒下限。而"哪个会话被前台看着"这件事，
DSH 的 host 侧**没有**可查状态（`retainedBy` 是客户端本地算的），所以换信号源只能换成
"从渲染进程推"（写 DSH 插件）或**换问题**——v4 就是换问题：不问"你在看哪条会话"，
只问"你在不在 DSH 里"。

## 二、v4 怎么实现的

```
插件 sidecar ──每 500ms──▶ 宿主 activity.get
                              └─ 宿主**现查**一次前台窗口（active-win-pos-rs，亚毫秒级纯读）
                                 返回 { active, at, app, title }
        ◀── app='DSH Desktop' / title='DeepSeek Harness Desktop'
     ↓
lib/dsh-window.mjs 判据（纯字符串，跨平台）
     ↓ 命中
hideAllCards()：resolve 掉所有挂着的卡（状态卡 + 真 GUI 小窗卡）
     ↓ 在你仍处于 DSH 期间
publishNotice() 直接不发（不 markDismissed！）
     ↓ 你切走
republishTrackedCards()：按 currentAction() 把该显示的卡请回来
```

**判据**（`runtime/lib/dsh-window.mjs`，实测/源码抄回来的形态）：

- 进程名 `DSH Desktop`（含 `.exe` / 完整路径 / 大小写不敏感）；
- **窗口标题含 `DeepSeek Harness`** —— 这一条顺带覆盖 **web 版**：
  DSH 网页 `<title>` 是 `DeepSeek Harness`（`dsh-web-frontend/dist/index.html` 实测；
  `dsh-client-ui-layout` 把 `productTitle` 定成这个，开会话后 `document.title` 变成
  `"<会话标题> — DeepSeek Harness"`），而浏览器窗口标题是 `"<标签页标题> - Google Chrome"`（实测）。
  DSH 开在后台标签页时标题不是它 → **正确地不命中**。

**信号为什么让宿主现查**（而不是读宿主已有的 1s 采样快照）：宿主本来就每秒采样前台窗口做行为统计，
但那 1s 周期会让"切到 DSH"最坏等 1 秒；`get_active_window()` 本身是亚毫秒级纯读，
所以 `activity.get` 直接现查一次 —— 延迟≈0，也不影响统计的采样密度。

## 三、两个必须记住的坑

1. **条件必须"会自己解除"。** v1 的病根是条件（"你正看着这条会话"）不会自己变，于是永久静默。
   前台窗口这条你一切走就解除，而且**切走时必须主动 `republishTrackedCards()`** 把卡请回来 ——
   少了这一步，就等于 v1 换了个壳。
2. **收卡时不要 `markDismissed`。** 那是"本轮静默"（要等下一个 `turn/start` 才解除），
   会把"你切走就回来"变成"你切走也不回来"。`plugin-contract.test.mjs` 有一条反面断言锁住它。

另外仍然保留 v2 学到的机制：**收卡必须按 `eventId`**（宿主的 `{op:'resolve', eventId}`，只允许解析本插件自己的事件），
而 eventId 来自 publish 带 `requestId` 时宿主回的 `result.eventId`；宿主在 `bus.resolve()` 之后还会**回推一条
`resolved`**，那条要按"我们自己造成的"吞掉（`selfResolved` + 10s 窗口），不能当成用户按了 ×。

## 四、平台与边界

- 判据是纯字符串 → Windows / macOS 同一套；Linux 取决于 `active-win-pos-rs` 的后端（X11 可用，
  Wayland 大概率 `Err` → 我们按"读不到"处理，功能静默失效）。宿主 `window_manager` 目前只有
  `windows.rs` / `macos.rs`，所以实际支持的平台就是这两个。
- **终端里跑的 dsh CLI 有意不认**：前台只会看到 `WindowsTerminal.exe` / `Code.exe` / `pwsh.exe`，
  判准得看窗口标题或进程树，而"终端里 dsh 开在别的标签页"会被误判成你在看 DSH。
- 读不到前台窗口（老宿主没这两个字段 / 无权限 / Wayland）→ 静默不生效，绝不影响其它行为；设置页可关。

## 五、护栏

- `runtime/test/dsh-window.test.mjs`：桌面版进程名（含 `.exe`/路径/大小写）、浏览器 DSH 标签页标题命中、
  别的标签页不命中、终端不命中、编辑器里零散 `dsh` 字样不命中、脏值/空值不抛。
- `runtime/test/main.test.mjs`：
  - 「前台是 DSH 就收卡且不再弹，切走后把卡请回来」（含"在 DSH 里推新回合也不弹"）；
  - 「浏览器里开着 DSH 网页也算，并且响应不等巡检间隔」（**把巡检间隔设成 30 秒**，断言 <1.8s）。
- `runtime/test/plugin-contract.test.mjs`：信号必须来自 `activity.get`、必须用 `dsh-window.mjs` 判、
  publish 必须拿 `result.eventId`、必须发 `resolve`、**切走必须 `republishTrackedCards()`**、
  以及反面断言「`hideCardsForSession` 不许 `markDismissed`」。
