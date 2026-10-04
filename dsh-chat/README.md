# DSH 对话小窗（dsh-chat）

在 Catrace 的小窗里**看** DeepSeek Harness（DSH）的对话，也能直接**问** DSH。

- **镜像**：读取 DSH 的会话日志（`$DSH_HOME/sessions/**/session.v4.jsonl.zstd`），按间隔轮询，
  所以你在 DSH 主窗口里说的话，小窗里会跟着出现——包括正在跑的那一轮。
- **对话**：小窗底部输入框发出的消息，走 DeepSeek Harness 官方 stdio SDK（`dsh --profile sdk`），
  新会话同样落进 DSH 会话库，之后可以在 DSH 主窗口继续。

> **信任提示：启用即信任本机代码。** 本插件带 sidecar（`runtime/main.mjs`），会以你的身份读
> DSH 的会话日志目录，并在你点击「发送」时拉起 `dsh --profile sdk` 子进程。不联网、不上传任何数据。

## 文件

```
dsh-chat/
  manifest.json          插件清单（main / settings / sidecar）
  ui.mjs                 小窗卡片（sticky Toast 卡）
  settings.mjs           插件详情页（状态 / 小窗 / 会话 / 对话设置）
  runtime/main.mjs       sidecar 入口：JSON Lines v1 协议 + RPC
  runtime/lib/           纯函数层（可单测）
    zstd-frames.mjs       多帧 zstd 解压（DSH 日志是 200+ 个 zstd 帧拼接的）
    session-log.mjs       会话日志 → 转录视图模型
    session-store.mjs     扫描 / 读取 / 最近会话
    sdk-client.mjs        dsh --profile sdk 的 stdio JSON-RPC 客户端
    spawn-plan.mjs        跨平台命令解析（Windows 的 dsh.cmd）
    config.mjs            配置默认值与钳制
  runtime/test/           node:test 单测与 sidecar 集成测
```

## 架构（数据怎么流）

```
DSH 会话日志（多帧 zstd JSONL）──读──┐
                                     ├── sidecar (runtime/main.mjs) ──┬── stdio JSON Lines  ⇄ 设置页（主窗 plugin.sidecar.request）
dsh --profile sdk（stdio JSON-RPC）──写──┘                             └── 本机 HTTP 127.0.0.1:<port> + token ⇄ 小窗卡片（fetch）
```

- 卡片跑在 `reminder-toast` 窗，**宿主只放行 `main` 窗调 `plugin.sidecar.request`**，所以卡片一律走
  sidecar 的本机 HTTP 桥；端口与一次性 token 由 sidecar 在 publish 的事件 payload 里下发。
- 端口默认 `23457`，被占用时自动退到系统分配端口（卡片从 payload 取端口，不受影响）。
- 日志读取对「尾部还没写完的帧」容错：DSH 正在跑的会话也能实时镜像，只会提示「显示的是已落盘部分」。
- 卡片用 `payload.toastStyle: 'standalone'` 接管外壳（宿主卡槽固定 **22.5rem**，卡片必须
  `width: 100% + box-sizing: border-box`，否则右边会被 `.toast-stack` 的 `overflow-x: hidden` 裁掉）。

## 两种小窗模式

| 模式 | 是什么 | 怎么开 | 依赖 |
|---|---|---|---|
| **真 GUI（A2）** | 小窗 iframe 里就是**官方界面**：对话流、`/` 指令面板、`@` 文件与对话引用、模型/思考强度、权限芯片、审批与提问卡、附件——全是原生的，我们一行 UI 都没重写 | 设置页选一条会话 → **小窗打开（真 GUI）** | 正在运行的 DSH Desktop + `~/.dsh/.credentials.yaml` |
| **镜像卡** | 自己画的消息流（只读镜像 + 走 SDK 提问） | **打开镜像卡** | 只要能读会话日志 |

### 真 GUI 为什么要 sidecar 反代

直接 `iframe src="http://127.0.0.1:43120/"` 必然 401：webview 的 cookie 罐里没有 DSH 票据，
而票据是 `HttpOnly` + 绑定 host:port，页内 JS 写不了；唯一能换 cookie 的 `?token=` 在桌面版拿不到
（`cordis.patch.yml` 里 `printUrl: false`，token 只在 Host 进程内存里）。

所以 sidecar 起一个**同源反向代理**（默认 `127.0.0.1:23458`）：

1. 读 `~/.dsh/.credentials.yaml` 里 `client-connection/browser-session` 的 32 字节密钥，
   按官方格式自签 cookie：`dsh-auth-<b64url(sha256(authority))> = v1.<b64url(payload)>.<b64url(hmac-sha256(body))>`
   （注意 HMAC 覆盖的是 **base64url 后的 body 字符串**）；
2. 探测正在运行的 host（`43120` 起、按桌面自身的 +1..+32 漂移区间逐个探活，**端口一变 cookie 名就变**，
   所以不能写死）；
3. 转发时只改三个头：`Host` → 目标 authority、`Cookie` → 自签票据、**删掉 `Origin`**
   （信任栅栏在鉴权之前：`Host` 必须回环、`Origin` 缺省或等于 Host、`sec-fetch-site: cross-site` 一律 403）；
4. 首屏 HTML 里注入一段脚本，把 `localStorage['dsh.sessions.current']` 设成要显示的那条会话
   （客户端就是靠这个键决定显示哪条；**不写就落到"选择工作区"引导页**）。

好消息：rc.2 的 SPA 全部用**文档相对 URL**（`api/session/list`、WS 走 `document.baseURI`），
且 `<base href="./">` 是宿主自己插的，所以 HTML **一个字节都不用改写**，透传即可。

### 小窗里显示哪些元素（标签云）

**机制**：不是改 DSH 代码，而是反代在**首屏 HTML** 里注入一段"用户样式"（`<style>`）+ 一段会话预选脚本。
选择器一律用**语义后缀**（`[class*="_tabs"]`），因为官方 class 带 CSS Module 哈希、每次构建都会变。

设置页「小窗里显示哪些元素」是一排**标签**：**点亮 = 该元素在小窗里显示**，点一下切换，鼠标悬停出说明。
配置里也是这个语义（`showXxx: true` = 显示），反代按 `!showXxx` 生成隐藏规则（`cropFlagsFor()`）。

| 标签 | 默认 | 显示的是什么 | 实现（隐藏时） |
|---|---|---|---|
| 左栏图标 | 关 | 左侧 56px 图标栏 | **把 grid 轨道归零**（`grid-template-columns: 0 minmax(0,1fr) 0` + 左栏留在第一轨 + 中间列钉第二轨）。**绝不能对左栏用 `display:none`**——中间列会自动落到 56px 那一轨，输入框立刻变成 22px（实测） |
| 官方顶栏 | 关 | 顶栏整条（会话标题、子智能体提示、对话/轨迹标签、右侧图标） | `[class*="_header"]:has([class*="_tabs"]) { display:none }`——`:has` 限定"含标签页的那条"，避免误伤消息里的 `_header`（文件变更块）。隐藏时会话标题由卡片那一行显示 |
| 　└ 对话/轨迹 标签 | 关 | 顶栏里的两个页签 | `[class*="_tabs"]`（顶栏关掉时该标签是灰的，没有意义） |
| 　└ 顶栏右侧图标 | 关 | 文件夹下拉、更多操作「…」、面板开关（整组） | `[class*="_headerUtilities"], [class*="_headerCorner"]` |
| 　└ 「…」更多操作 | **开** | 只控制图标簇里的「…」（需先点亮上一项） | `[class*="_moreButton"]` |
| 　└ 面板开关 | **开** | 只控制最右那个"打开右侧边栏"按钮（需先点亮上一项） | `[class*="_headerCorner"]` |
| 　└ 官方标题 | 关 | 官方标题（面包屑） | `[class*="_header"] [class*="_crumb"]`（限定在 header 内，避免误伤别处的面包屑） |
| 　└ 子智能体/后台任务 | **开** | 「N 个子智能体」「N 个后台任务运行中」 | `[class*="_headerActions"]` |
| 输入区状态条 | 关 | tok/s、缓存命中、费用、上下文占比 | `[class*="_dock"], .cm-stat-dock` |
| 消息操作行 | 关 | 每条消息的复制/点赞/分享/时间 + 「本轮费用」 | `[class*="_actions"]`（小写，区分大小写所以不会命中 `headerActions`）+ `.cm-note` |
| 顶栏文字标签 | 关 | **反向**开关：点亮后**强制显示**官方在窄宽下折叠掉的文字 | 官方用容器查询折叠（下面单独说），这里用一条 `!important` 盖回来 |

### 紧凑留白（独立开关）

设置页「小窗外观」顶部还有一个 **紧凑留白** 开关（默认关，与上面的标签互不影响）：

| 项 | 官方 | 紧凑留白 |
|---|---|---|
| `--dsh-composer-side-clearance` | **16px** → 滚动区/审批卡每侧 `16+16` = **32px** | **0** → 每侧 16px（360px 下多出约 **16px/侧**） |
| 对话区滚动内边距 | 每侧 32px | **8px** |
| 输入框 | 有侧边留白 | 贴边（0.25rem） |
| 消息块间距 | 16px | **10px** |

`--dsh-chat-content-width` **故意不动**：官方默认 `var(--dsh-chat-user-width, clamp(680px, …*0.64, 920px))` 最小 **680px**，
在 360px 里本来就不生效；且被消息里宽表格的 `calc((100cqw - content-width)/2)` 用到，改成百分比会让表格跑版。

**为什么"只隐藏"会难看（以及怎么修的）**：官方顶栏是 `[_titleCluster][_headerActions][_headerUtilities][_headerCorner]` 的 flex 行，
其中 `_titleCluster{flex:1}` 会吃掉所有剩余空间。我们把官方标题藏掉后，这个空列依然占着地方 →
剩下的 chips 被挤在中间、和右边的图标之间留一条空隙，行高还撑着 → 观感很散。
所以**部分隐藏时会自动"整理顶栏"**（可以理解为隐藏的配套排版）：

```css
[class*="_titleRow"] { align-items: center !important; gap: 0.5rem !important; }
[class*="_titleRow"] [class*="_titleCluster"] { flex: 0 0 auto !important; min-width: 0 !important; }  /* 空列不再抢空间 */
[class*="_header"] { min-height: 0 !important; padding-top: 0.3rem !important; padding-bottom: 0.3rem !important; }
[class*="_titleRow"] > [class*="_headerUtilities"] { margin-left: auto !important; }  /* 动作图标贴右 */
[class*="_titleRow"] > [class*="_headerCorner"] { margin-left: 0 !important; }        /* 只给一个 auto，否则空隙被平分 */
```

- 只在**确实藏了东西**时才注入这些规则：全都显示时不动官方排版；四项全藏时干脆**整条隐藏**（不留空行）。
- 图标组整体隐藏时，改由 `_headerCorner` 贴右（同样只给一个 auto）。

**为什么小窗顶栏里东西比主窗口少**：官方在窄宽下**自己**折叠，跟我们的裁剪无关。实测源码里的规则：

| 元素 | 官方规则（`client.js` 原文） |
|---|---|
| 智能体团队 | `@container (width<=480px){ .vhh34W_triggerLabel{display:none} }` |
| 标准模式（权限预设） | `@container (width<=460px){ .T8U3jW_trigger:has(.T8U3jW_triggerIcon) .T8U3jW_triggerLabel{display:none} }` |
| 智能体预设 | `@container (width<=540px){ .uglhVW_label{display:none} }` |
| 费用明细 | 不在顶栏，在「输入区状态条」（`cm-stat-dock`）里 → 点亮「输入区状态条」才看得到 |

这些 `display:none` 都**没有 `!important`**，所以点亮「顶栏文字标签」就能把文字要回来（可能有点挤）。

**为什么顶栏默认整条隐藏，而不是"只显示标签页/图标"**：把标题与右侧图标藏掉后，剩下的
「N 个子智能体 / N 个后台任务运行中」在 360px 下会塌成一个孤零零的图标，而顶栏容器仍撑着高度 →
顶部出现一条又高又空的带子，比整条隐藏更难看（实测对比过）。
- 点标签后 **~1 秒自动重开小窗**（CSS 是反代启动时注入的，sidecar 检测到显示项变化会关掉旧代理并用新配置重建）。

### 想自己写排版？设置页有「自定义样式（CSS）」

设置页「**小窗外观**」卡片底部有一块 **自定义样式（CSS）**：全宽等宽字体输入框，内容会**追加在反代注入样式的最后**，
所以能覆盖我们上面的规则；旁边有「插入示例」「清空」，改完自动重开小窗。例：

```css
[class*="_headerCorner"] { display: none !important; }   /* 去掉面板开关 */
[class*="_moreButton"]  { display: none !important; }    /* 去掉「…」 */
[class*="_header"]      { padding: 0 !important; }        /* 顶栏再压扁一点 */
```

规则：选择器要用**语义后缀**（`[class*="_moreButton"]`），因为官方 class 带 CSS Module 哈希、每次构建都会变；
`</style>` 会被转义，写不进脚本。

**不知道改哪个？** 输入框下面有一张折叠的 **「可改的 class 速查（35 个选择器）」**：按「整体布局 / 官方顶栏 /
左栏内部 / 对话区与输入框 / 消息与费用」分组，逐行给出**选择器 + 一句说明 + 「插入」按钮**（点一下就把
`选择器 {\n  \n}` 骨架写进输入框，你只填属性）。
清单在 `runtime/lib/gui-classes.mjs`，**每一项都用 360px 实测 DOM 核对过**能命中；并有测试锁住"不许与实现漂移"
（`buildCropCss` 里用到的每个语义后缀都必须出现在速查表里）。

版式上的两个实现约束（宿主/Naive 的脾气，改 UI 前先看）：
- `NTag` 在 `checkable` 时**忽略 `bordered`**（边框层条件是 `!checkable`），未选中就是透明底 → 所以 chip 的"描边"
  由我们自己的 `.dsh-chat-settings__chip`（`box-shadow: inset 0 0 0 1px …`）画。
- 宿主的 `SettingRow` 只有 `title`/`desc` + 默认 slot，slot 落在**右列**，**没有整行模式** → 全宽内容要自造块
  （`.dsh-chat-settings__block`）。

### 顶栏行高

`_titleRow` 与 `_headerLeading` 官方各有 **30px 的 `min-height`**，加上上下内边距就是那条"高头"。所以
**只要顶栏可见就自动收紧行高**（`min-height: 0` + `padding: 0.125rem/0.25rem`）——与是否隐藏其余元素无关；
而"空标题列收窄 / 图标贴右"这类**改排列**的规则只在确实藏了东西时才注入（避免没藏东西也动官方布局）。

### 改设置要不要重启插件？

**改设置一律不用重启插件**；只有**改了插件代码**才需要点插件页的「刷新」。

| 你改的东西 | 怎么生效 | 要重启插件吗 |
|---|---|---|
| 显示哪些元素（标签云） | 保存 → 设置页**主动把配置推给 sidecar**（`applyConfig`）→ sidecar 关掉旧反代 → 设置页自动重开小窗（~1s） | 否 |
| **紧凑留白** | 同上（它也在反代签名里，切了会重建反代并自动重开小窗） | 否 |
| GUI 代理端口 | 同上（自动重开小窗） | 否 |
| 本机端口 | sidecar 自动重绑 HTTP 桥 + 自动重新发布卡片（拿新端口） | 否 |
| 显示条数 / 轮询间隔 | 卡片每轮从 `status.config` 读生效配置，**下一轮就变** | 否 |
| dsh 命令 / 目录 / 模型 / 权限等 | sidecar 每次调用时读 config，即时生效 | 否 |
| **我改了插件源码**（`main.mjs` / `ui.mjs` / `settings.mjs`） | 侧车是长驻 Node 子进程、卡片/设置是已经 import 进 webview 的模块，都跑着**旧代码** | **是**（插件页「刷新」；不行就关掉插件再打开） |

**怎么知道自己踩到了这一条**：设置页顶部会出现一条橙色提示「插件侧车（runtime）还在运行旧代码…」——
`settings.mjs` 与 `runtime/main.mjs` 各有一个 `CONTRACT_VERSION`（改动/新增 RPC 时两边一起 +1），
`status` 会把它报回来，不一致就提示。

**「改了没区别 / 插件重启后设置还原」的根因（踩过三次）**：`settings.mjs` 的 `compose()` 早先只把
`SHOW_KEYS` 里的键写回保存对象，于是**没登记进列表的键**（`compactSpacing`、`customCss`）每次保存都被
`{...DEFAULTS}` 抹回默认值 —— 界面点了没效果，重启当然还原。
现在 `compose()` 与 `loadConfig()` 都**遍历 `DEFAULTS` 全键、按默认值类型处理**，新增配置键不用再登记；
`ui-render.test.mjs` 里有一条通用护栏：保存对象必须包含 `DEFAULTS` 的每一个键（新增键忘了处理会立刻失败）。

**注意一个宿主缺口（本插件已自行绕过）**：宿主的 `set_plugin_config`（`src-tauri/src/plugins.rs`）
只写 store + 给前端发 `catrace:plugin-config-changed`，**不会**把新配置推给正在运行的 sidecar
（`{op:'config'}` 只在 sidecar 启动时发一次，见 `src-tauri/src/plugin_sidecar.rs`）。
所以设置页在 `plugin.config.set()` 之后必须自己 `plugin.sidecar.request('applyConfig', {config})` 推一次，
否则改了设置必须 disable/enable 插件才生效（用户实测反馈过）。
若以后宿主补上"配置变更即通知 sidecar"，这段 push 可以留着（幂等）。

宿主加载插件的实现（`src/plugins/loadExternalPlugins.ts`）：读 `ui.mjs`/`settings.mjs` 源码 → 包一层
`const plugin = globalThis.__CATRACE_CREATE_PLUGIN_API__('<id>')` → Blob URL → `import()`。
模块只 import 一次，所以要换代码就得让宿主重新加载插件（「刷新」按钮）——这是宿主机制，不是本插件的设计。

### 真 GUI 模式的边界（都实测过）

- **不能给 iframe 加 `sandbox`**：那会变成 opaque origin，`Origin: null` 直接 403。
- **不要裁剪官方布局**：试过用 CSS 藏侧栏，会把 composer 挤成 49px（官方在 360px 下自带窄模式：
  56px 图标栏 + 对话 + 完整输入框，已经够用）。
- 关掉 DSH 主窗**不会**停服务（托盘常驻，host 子进程还活着）；**退出托盘/退出应用**才会。
- 若在 DSH 设置里关掉「普通浏览器访问」或离开 compatibility 模式 → 全链路 403（实时生效）。
- 端口漂移、cookie 30 天过期、凭据重置都会让复用失效；设置页的「GUI 复用状态」会显示原因。

## 安装

1. Catrace → 插件页 → **打开插件目录**，把 `dsh-chat/` 整个目录放进去。
2. 插件页里启用 **DSH 对话小窗**（默认不自动启用）。
3. 进插件详情页：确认「运行状态」里 dsh 命令可测、能看到会话列表；点 **打开小窗**。

开发态下，本仓库 `tools/plugin-demo/` 会在 debug 构建里 junction 到 `app_data/plugins/`，改完直接刷新即可。

## 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| Node | **≥ 22.15**（建议 22.20+ / 24.x） | 需要 `zlib.zstdDecompressSync` 解压 DSH 会话日志；Catrace 便携 Node 是 v22.20.0，满足 |
| DSH | 装了 `dsh` 命令（`dsh --version` 可用） | 只有「提问」功能需要；只看历史不需要 |
| 平台 | Windows / macOS | 命令解析对 Windows 的 `dsh.cmd` 做了处理 |

「运行状态」里 Node 不合格会直接标红。

### 「真 GUI」模式的前置条件：DSH 桌面版要允许浏览器访问

「真 GUI（反代官方界面）」是从本插件 sidecar 里**用 HTTP/WS 去访问 DSH 桌面版的本机 web 服务**再转给 iframe 的。
DSH 桌面版为此加了一道**渲染器准入**栅栏（`desktop-browser-access`）：

- 每个 Desktop 代次会随机生成一个 32 字节 token，只注入 **Electron 渲染器**的网络会话（请求头 `x-dsh-desktop-renderer`）；
- 非渲染器进程（就是我们）拿不到这个 token，会被 `rejectBrowserRequest()` 以 **403 + 纯文本 `forbidden`** 拒掉；
- 唯一出路：在 DSH 桌面版 → **「设置浏览器访问」→ 打开「允许在浏览器中打开」**（设备范围选"只有这台电脑上的浏览器"）。
  桌面版自己的提示是 *"浏览器访问仅在兼容模式下可用"*，所以可能要把该 Profile 切成**兼容模式**（会重启应用）。

没开这个开关时，「真 GUI」会失败并明确报 **403 forbidden + 该怎么做**（而不是含糊的"没找到 host"）。
此时**镜像卡 / SDK 提问仍然可用**：那条路是 sidecar 自己起 `dsh --profile sdk` 子进程，不经过桌面版的栅栏。

## 用法

### 小窗

- 顶栏：会话标题（超长省略）、`镜像/对话` 标记、刷新、停止、关闭；下面一行是工作目录 + 最后更新时间。
- 正文：用户消息在右、DSH 在左；`思考` 与**连续的工具调用**都折叠成一行（`▸ 6 个工具调用（1 个失败）`），
  展开才看明细——DSH 一轮里几十次工具调用不会再把对话冲成「工具墙」。
- 底栏：输入框 + 发送（**Enter 发送，Shift+Enter 换行**），下面一行是模型/状态与「镜像哪条会话」。
  - 发送后小窗切到「对话」模式，显示的是 SDK 新建的那个会话；
  - 「■」停止会结束 SDK 子进程（已落盘的消息仍在会话里）。

长文本（绝对路径、长 JSON、长 URL）一律换行或省略，不会出现横向滚动条。

Toast 窗默认不抢焦点：第一次点卡片会先激活窗口，插件已做「点击后自动补焦点」。

### 设置页

四个分区，所有字段都是**即时保存**（改完 0.5s 落盘，右上角显示「已保存」）：

- **运行状态**：DSH 主目录、dsh 命令（可点「测试」跑 `dsh --version`）、会话数、当前镜像、Node/zstd/端口。
- **小窗**：打开小窗、标题、显示条数（6–200）、轮询间隔（500–30000ms）、本机端口（0=系统分配）、启用即弹出。
- **DSH 会话**：列出本机所有 DSH 会话（标题/时间/工作目录），点开看转录，可「固定到小窗」或「跟随最新」。
- **对话**：dsh 命令、profile、provider、model、思考强度、最大输出、工作目录、权限补丁、DSH 主目录。

## 能力边界（务必知道）

1. **只读镜像 ≠ 接管会话。** SDK 协议没有「列出会话 / 读历史 / 接续已有会话」的方法
   （`initialize` + `session/prompt` + `shutdown`，会话由 `agents.create` 新建），所以：
   - 已有会话（含 DSH 主窗口里正在聊的那个）小窗只能**看**；
   - 小窗的输入框发出去的是**一个新会话**，不会接续所选会话。
2. **没有审批通道。** SDK 不提供 `approval/request` 应答能力，工具调用按 profile 默认策略
   （`workspace-write` / `ask`）处理；需要完全访问请用「权限补丁」传 `dsh --patch` 覆盖，
   或改在 DSH 主窗口里聊。
3. **日志是唯一数据源。** DSH 正在写时会有一个写了一半的 zstd 帧，插件做容错解码，
   会提示「日志正在写入，显示的是已落盘部分」。
4. **格式版本。** 会话日志为 `session.v4.jsonl.zstd`；DSH 大版本升级可能改动事件结构，
   遇到不认识的字段/事件类型插件会跳过而不报错（见 `runtime/lib/session-log.mjs`）。
5. **sidecar 重启后端口/口令会变。** 小窗卡片里若提示「本机 HTTP 桥连不上」，到插件详情页
   重新点一次「打开小窗」即可（会带着新端口与口令重发卡片）。

## 测试

```powershell
cd D:\workspace\Catrace\tools\plugin-demo\dsh-chat
node --test "runtime/test/*.test.mjs"
```

> 注意：本机 Node v24 下 `node --test runtime/test/`（带目录参数）会把目录当脚本入口而报
> `Cannot find module`，用上面的 glob 或显式文件名列表。

覆盖：多帧 zstd 切分与**尾部半个帧的容错**、会话日志 → 转录（含 `<system-reminder>` 注入过滤、
思考/工具块）、会话库扫描与标题回退、配置钳制、Windows `dsh.cmd` 命令解析、SDK 客户端行分帧与
协议往返、sidecar RPC 与**本机 HTTP 桥**端到端（临时 DSH_HOME 夹具）、插件合同静态检查
（白名单组件 / Toast 不许调 sidecar.request / events 白名单）。
