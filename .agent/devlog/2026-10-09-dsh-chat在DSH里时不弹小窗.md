# 2026-10-09 dsh-chat「在 DSH 里时不弹小窗」（同一天四版才收敛）

## 需求

用户：「如果我想让点击到 DSH 的会话时候，如果那个小窗的会话存在，那么那个小窗就自动隐藏」。

## 四版演进（每版都由用户实测反馈推动）

| 版本 | 做法 | 结果 |
|---|---|---|
| v1 | 读 DSH 客户端 localStorage 的"当前会话"，**按会话整轮禁发** | ❌「启用之后好像再也不会弹出来卡片了」（用户看的正是产生卡的那条会话） |
| v2 | 同信号，改成"收掉现有卡 + 本轮静默" | ✅ 能收；❌「有点慢」 |
| v3 | 焦点检测改 `fs.watch` 存储目录 + 120ms 去抖 | 我们这段 140ms，但**总延迟仍 ~5 秒** |
| **v4** | **不监控会话**，改看**前台窗口是不是 DSH**（用户自己提的方案） | ✅ 毫秒级、跨平台、不碰 DSH 内部存储 |

**5 秒的真凶**（v3 查清）：Chromium 把 localStorage 提交到 LevelDB 时做合并/节流（探针实测相邻写入间隔全部 ≥5 秒），
而 DSH 客户端在你点击的**同一个同步调用栈**里就写好了值（官方 README + 代码链路）。所以"读文件"这条路有物理下限。

**v4 的做法**：插件每 500ms 问宿主 `activity.get` → 宿主**现查**一次前台窗口（`active-win-pos-rs`，亚毫秒纯读）
返回 `app`/`title` → 插件用纯字符串判据（`runtime/lib/dsh-window.mjs`）判断：进程名 `DSH Desktop`，
或标题含 `DeepSeek Harness`（后者顺带覆盖**浏览器里的 DSH 网页**——网页 `<title>` 就是这个，
浏览器窗口标题是 `"<标签页标题> - Google Chrome"`）。命中 → 收掉所有卡 + 期间不弹；**切走 → `republishTrackedCards()` 把卡请回来**。

## 两个坑（都写进了护栏）

1. **条件必须会自己解除**：v1 的病根是"你正看着这条会话"这个条件不会变 → 永久静默。
   所以 v4 切走时必须主动 `republishTrackedCards()`，否则等于 v1 换壳。
2. **收卡不许 `markDismissed`**：那是"本轮静默"（要等 `turn/start` 才解除），会把"切走就回来"变成"切走也不回来"。
   `plugin-contract.test.mjs` 有反面断言锁住。

保留的旧机制：收卡按 `eventId`（`{op:'resolve'}`，宿主只允许解析本插件自己的事件），
eventId 来自 publish 的 `requestId` 回话；宿主 `bus.resolve()` 后会**回推一条 `resolved`**，
那条是"我们自己造成的"（`selfResolved` + 10s 窗口吞掉），不能当成用户按了 ×。

## 依赖（宿主侧）

需要宿主 `activity.get` 多回 `app`/`title`（宿主 `signal.rs::active_window_info()` 现查 + `activity_payload()`
把字段拼进响应，含单测）。老宿主只回 `{active, at}` → 插件读不到 → 该功能静默失效，其余行为不受影响。
跨平台：判据纯字符串，Windows/macOS 同一套；Linux 取决于 `active-win-pos-rs` 后端（X11 可用，Wayland 读不到）。

**有意不做**：终端里的 dsh CLI（前台只见 `WindowsTerminal.exe`/`Code.exe`，判准会误伤别的标签页）。

## 验证

- `node --test "runtime/test/*.test.mjs"` → **127/127 通过**，新增：
  - `dsh-window.test.mjs` 6 条（桌面版进程名 / 浏览器标题命中 / 别的标签页不命中 / 终端不命中 /
    编辑器里零散 `dsh` 不命中 / 脏值不抛）；
  - `main.test.mjs` 2 条端到端（前台是 DSH → 收卡 + 期间不弹 → 切走把卡请回来；
    浏览器场景 + **把巡检间隔设成 30 秒**仍要求 <1.8s）。
- 宿主侧：`cargo check` 通过；`activity_payload` 与 `active_window_info` 两条单测通过。
- 版本 `2026.10.09.5`。
