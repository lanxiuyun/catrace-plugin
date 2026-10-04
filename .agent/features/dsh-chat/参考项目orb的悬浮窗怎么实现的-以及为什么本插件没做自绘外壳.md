# 参考项目 orb 的悬浮窗是怎么实现的——以及为什么本插件最终没做自绘外壳

调研对象：[deepseek-harness-orb](https://github.com/mini-yifan/deepseek-harness-orb)（本地克隆在
`D:\workspace\_research\deepseek-harness-orb`，HEAD `51f0976`）。结论先行：**它的窗口是它自己 fork 的 Electron 桌面端造的，
它的"紧凑面"只有 38 行 CSS，看起来更好的真正原因是外壳自绘**。本插件在 Catrace 的插件沙箱里做不到前两者，
做了一版自绘外壳后用户看效果决定不做（代码留在插件仓库 `orb` 分支）。

## 它的四层结构

| 层 | 实现 | 证据 |
|---|---|---|
| **窗口** | 独立 Electron `BrowserWindow`：`frame:false, transparent:true, alwaysOnTop:true, skipTaskbar:true, hasShadow:false, resizable:false, roundedCorners:false`；win32 `setAlwaysOnTop(true,'screen-saver')`，macOS `type:'panel'` + `setVisibleOnAllWorkspaces(visibleOnFullScreen)` | `apps/desktop/src/floating-window.ts:611,641` |
| **壳页（自绘）** | `dsh-app://shell/floating.html`：球 + 面板 + **自己的输入条** `<div id="prompt" contenteditable>` + History/New/Stop + 权限选择器 + question 卡 | `apps/desktop/renderer/floating.html:87`、`floating.js`（50KB） |
| **对话记录** | iframe 装官方 Web bundle 的专属面：`dsh-app://app/index.html?surface=overlay` | `floating.js:34,588` |
| **数据** | 壳页自己 `fetch('dsh-app://app/api/session/prompt')`；iframe 走正常客户端 runtime；Electron IPC（`contextBridge` 暴露 `window.dshDesktop.floating.*`）只管几何/会话 id/模型/权限/主题；postMessage **只传三帧** `dsh.overlay.session` / `ready` / `theme`，且 targetOrigin 双向锁死 | `floating.js:17,572,736,1390` |

**关键认知**：它的小窗里**从来没有官方顶栏、官方输入框、官方状态条**——那些在官方客户端里由别的插件挂载，
而 `?surface=overlay` 这个面只挂 ChatView。我这边一直在做的是"把官方整套界面塞进小窗再一个个藏掉"，
方向不同，所以怎么调都像"残缺的官方界面"。

## 它的"紧凑面"只有 38 行 CSS

`packages/client/ui-overlay-chat/src/client/OverlayChatRoot.module.css` 全文 38 行，核心：

```css
.shell {
  height: 100%; overflow: auto;
  --dsh-chat-content-width: 100%;
  --dsh-composer-side-clearance: 0px;
}
.shell [data-chat-turn-rail] { display: none; }
body { background: var(--dsw-alias-bg-base); }
```

逐条对照本插件（360px 窗口下）：

| orb 做的 | 我们 |
|---|---|
| `--dsh-composer-side-clearance: 0px` | ✅ 做了（就是「紧凑留白」开关，见 [紧凑留白-官方留白变量与不该动的content-width.md](紧凑留白-官方留白变量与不该动的content-width.md)） |
| `--dsh-chat-content-width: 100%` | ⛔ 故意不做（官方默认最小 680px，在 360px 下不生效；且被宽表格 calc 消费，改百分比会跑版） |
| 隐藏 turn rail | ✅ 天然等价：官方 `@container (width<=900px){ .PvW7sq_frame{display:none} }`，360px 下它自己就不显示 |
| 不挂 AppFrame / 模式选择器 | ✅ 等价实现：左栏 grid 轨道归零 + 顶栏隐藏（他是"不挂载"，我们是"藏起来"） |

**所以"紧凑面"本身两边几乎没差别**，用户自己也验证了这一点（"orb 这个我看了一下，似乎和显示官方的也一样"）。

## 我们做过的自绘外壳（`shell` 形态）与它的下场

在 `guiSurface: 'shell'` 下实现过一版：官方只当对话记录（CSS 藏掉官方输入卡，**但不整块藏 `_composerSeat`/`_composerStack`**——
审批卡可能挂在那一带，藏了就没法应答），顶栏与输入条由卡片自绘，发送/停止走官方 HTTP API：

```ts
session/prompt { request: { requestId, sessionId, mode:'queue'|'steer', content:[{type:'text',text}] } }
session/cancel { request: { sessionId } }
```

（这两个方法的参数结构是从安装包 `dsh-api-session-controller/lib/typert.host.js` 的 zodschema 读出来的，不是猜的；
rc.2 里 `session/prompt`、`session/cancel` 都在，`?surface=overlay` 则**零命中**。）

**用户看过后的结论**：视觉上与"官方界面"几乎一样，**不值得做**；于是回退到 `orb` 分支（`feat/dsh-chat-small-window` 上不保留）。
判断依据是前面那条认知：orb 的观感优势来自**窗口形态**（72px 球 → 320×420 贴边面板、透明置顶、可拖拽）
与**自绘输入条**，而不是"官方 UI 的某个紧凑变体"。

## 本插件的硬边界（想重做前先看这条）

- **自建窗口做不到**：宿主插件 API 里与窗口相关的只有 `plugin_api_window_show_main` / `plugin_api_window_hide_main`
  （`src-tauri/src/plugin_api/`），没有"建一个透明置顶小窗/球"的能力。Catrace 的 Toast 卡片几何是宿主编排的
  （见 [README.md](README.md) 的「小窗卡片的两个硬约束」）。
- **`?surface=overlay` 做不到**：那是 orb 往官方客户端里加的客户端插件（占 `'root'` 槽、跳过 AppFrame），
  rc.2 里没有这个面，也不认 `?surface=` 参数——要等价就得 fork DSH。
- 真要在 Catrace 里复刻 orb 的观感，路径是**宿主给插件一个"悬浮窗/球"能力**，而不是在插件里继续堆 CSS。
