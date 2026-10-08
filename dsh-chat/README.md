# DSH 对话小窗（dsh-chat）

DSH（DeepSeek Harness）干活时，Catrace 右下角弹一张**可折叠状态卡**；点正文，**同一张卡原地展开成 DSH 官方界面**（GUI iframe）——对话流、`/` 指令、`@` 文件、审批全是原生的，本插件一行 UI 都不重写。

- **状态卡**：sidecar 轮询 DSH 会话日志（`$DSH_HOME/sessions/**/session.v4.jsonl.zstd`），DSH 开始干活 → 「进行中」，
  DSH 在等你 → 「等你审批 / 等你回答 / 计划待审」并自动展开，完成 → 「已完成」自动收。
- **官方界面**：sidecar 发现正在运行的 DSH Desktop → 用本地凭据自签 cookie → 起同源反向代理 → 状态卡/设置页把 iframe 指到代理上。

> 0.3.0 起大幅瘦身：0.2.x 的**镜像消息流**与 **SDK 提问**（`dsh --profile sdk`）已整链移除，
> 打算以更好的形态在下一个大版本回来（git 历史里都在）。设置面板从 ~30 个控件收敛到 ~10 个。

> **信任提示：启用即信任本机代码。** 本插件带 sidecar（`runtime/main.mjs`），会以你的身份读
> DSH 的会话日志目录与 `~/.dsh` 凭据。不联网、不上传任何数据。

## 文件

```
dsh-chat/
  manifest.json          插件清单（main / settings / sidecar）
  ui.mjs                 卡片：GUI 小窗（dsh-chat.window）+ 可展开状态卡（dsh-chat.notice）
  settings.mjs           插件详情页（运行状态 / 状态通知 / 小窗外观）
  runtime/main.mjs       sidecar 入口：JSON Lines v1 协议 + RPC + 本机 HTTP 桥
  runtime/lib/
    zstd-frames.mjs       多帧 zstd 解压（DSH 日志是 200+ 个 zstd 帧拼接的）
    session-log.mjs       会话日志 → 转录视图模型
    session-store.mjs     扫描 / 读取 / 最近会话
    inspector.mjs         状态巡检纯逻辑（回合流转 → 发布动作）
    dsh-gui.mjs           cookie 自签 / 凭据解析 / host 探活
    gui-proxy.mjs         同源反向代理 + 去装饰 CSS
    gui-classes.mjs       官方 class 速查表（自定义 CSS 的索引）
    config.mjs            配置默认值与钳制
  runtime/test/           node:test 单测与 sidecar 端到端测（假 DSH host）
```

## 架构（数据怎么流）

```
DSH 会话日志（多帧 zstd JSONL）──读──┐
                                      ├── sidecar (runtime/main.mjs) ──┬── stdio JSON Lines  ⇄ 设置页（主窗 plugin.sidecar.request）
DSH Desktop（本机 web 服务）──反代──┘                                 └── 本机 HTTP 127.0.0.1:<port> + token ⇄ 卡片（fetch）
```

- 卡片跑在 `reminder-toast` 窗，**宿主只放行 `main` 窗调 `plugin.sidecar.request`**，所以卡片一律走
  sidecar 的本机 HTTP 桥；端口与一次性 token 由 sidecar 在 publish 的事件 payload 里下发。
- 端口默认 `23457`，被占用时自动退到系统分配端口（卡片从 payload 取端口，不受影响）。
- GUI 反代默认 `23458`（`guiPort`），固定端口是为了 iframe 的 origin 稳定（页面 localStorage 可复用）。
- 日志读取对「尾部还没写完的帧」容错：DSH 正在跑的会话也能实时解析。
- 卡片用 `payload.toastStyle: 'standalone'` 接管外壳（宿主卡槽固定 **22.5rem**，卡片必须
  `width: 100% + box-sizing: border-box`，否则右边会被 `.toast-stack` 的 `overflow-x: hidden` 裁掉）。

## 状态通知卡（核心交互）

- **折叠态**：鲸鱼徽标 + 会话标题 + 状态 chip + 项目路径 + 最新输出（3 行渐隐）。header 纯展示。
- **展开态**：点正文，**同一张卡原地长高**（30rem），正文区换成官方 GUI iframe；header 出现「收起」。
  展开期间卡片调 `POST /notice/view {expanded:true}`，sidecar 把该会话置为**展开持有**——
  完成也不自动收（用户正在看）；收起时 `expanded:false`，按当前状态补发并恢复停留计时。
- **等你处理**（chip 按原因换字，都带 `autoExpand:true`，卡片看到标记后**自动展开**官方界面）：
  - 「等你审批」← `approval/asked` 落盘且还没有 `approval/decided`；
  - 「等你回答」← 工具 `ask_user_question` 有 `tool/call` 没 `tool/result`（DSH 在等你答题）；
  - 「计划待审」← 工具 `exit_plan_mode` 同上（DSH 在等你批计划）。
  为什么不能只认审批事件：审批只在真弹审批时才有，DSH 常态是 `approval/policy: never`，
  或者 `ask` 但工具压根不需要越权 —— 只认审批的话卡片会一直停在「进行中」。
- **生命周期**由 sidecar 巡检驱动：同 `dedupeKey`（`dsh-chat.notice:<sessionId>`）原地刷新；× = 本轮静默，新回合解除。
- 设置页可以发「进行中 / 已完成 / 等你审批」**测试卡**，不开 DSH 也能看手感。

## 官方界面为什么要 sidecar 反代

直接 `iframe src="http://127.0.0.1:43120/"` 必然 401：webview 的 cookie 罐里没有 DSH 票据，
而票据是 `HttpOnly` + 绑定 host:port，页内 JS 写不了；唯一能换 cookie 的 `?token=` 在桌面版拿不到
（`cordis.patch.yml` 里 `printUrl: false`，token 只在 Host 进程内存里）。

所以 sidecar 起一个**同源反向代理**（`guiPort`，默认 23458）：

1. 读 `~/.dsh/.credentials.yaml` 里 `client-connection/browser-session` 的 32 字节密钥，
   按官方格式自签 cookie：`dsh-auth-<b64url(sha256(authority))> = v1.<b64url(payload)>.<b64url(hmac-sha256(body))>`
   （注意 HMAC 覆盖的是 **base64url 后的 body 字符串**）；
2. 探测正在运行的 host（`43120` 起、按桌面自身的 +1..+32 漂移区间逐个探活，**端口一变 cookie 名就变**，
   所以不能写死）；
3. 转发时只改三个头：`Host` → 目标 authority、`Cookie` → 自签票据、**删掉 `Origin`**
   （信任栅栏在鉴权之前：`Host` 必须回环、`Origin` 缺省或等于 Host、`sec-fetch-site: cross-site` 一律 403）；
4. 首屏 HTML 里注入一段脚本，把 `localStorage['dsh.sessions.current']` 设成要显示的那条会话
   （客户端就是靠这个键决定显示哪条；**不写就落到"选择工作区"引导页**）。
5. **票据会过期，反代自己换**：自签 cookie 的寿命写死 **7 天**（宿主只要求"跨度 ≤ 它自己的
   `cookieMaxAgeDays`"，而桌面版恒为默认 **30 天** —— 没有这个开关，所以 7 天不会越界）。
   小窗是常驻卡片，因此反代**吃到 401** 时会重读 `~/.dsh/.credentials.yaml` 换一张新票并重放
   （票过期、凭据被 DSH 重置都走这条）；换不到就把上游那行 401 原文透传，绝不打转。
   只对**没有请求体**的请求重放——带 body 的上传绝不重放，宁可那一次失败。
   设置页「运行环境」会写「小窗票据 7 天」。
   **不做"到期前主动换票"**：票有 7 天，主动换只是省掉每 7 天一次的"401→换票→重放"往返，
   不值得多一套到期判断 + 每个请求多读一次票（2026-10-08 用户拍板）。

好消息：rc.2 的 SPA 全部用**文档相对 URL**（`api/session/list`、WS 走 `document.baseURI`），
且 `<base href="./">` 是宿主自己插的，所以 HTML **一个字节都不用改写**，透传即可。
查询串按**字节透传**（插件 bundle 的 `??a,b&rev=` 一经 URLSearchParams 重编码就全 404，实测踩过）。

## 小窗里显示哪些元素（标签云）

**机制**：不是改 DSH 代码，而是反代在**首屏 HTML** 里注入一段"用户样式"（`<style>`）+ 会话预选脚本。
选择器一律用**语义后缀**（`[class*="_tabs"]`），因为官方 class 带 CSS Module 哈希、每次构建都会变。

设置页「小窗外观」是一排**标签**：**点亮 = 该元素在小窗里显示**，配置里也是这个语义（`showXxx: true`），
反代按 `!showXxx` 生成隐藏规则（`cropFlagsFor()`）。顶栏的子项**在父项点亮后才出现**（不是置灰）。

| 标签 | 默认 | 显示的是什么 | 实现（隐藏时） |
|---|---|---|---|
| 左侧栏 | 关 | 左侧 56px 图标栏 | **把 grid 轨道归零**（`grid-template-columns: 0 minmax(0,1fr) 0` + 左栏留第一轨 + 中间列钉第二轨）。**绝不能对左栏用 `display:none`**——中间列会自动落到 56px 那一轨，输入框立刻变成 22px（实测） |
| 官方顶栏 | 关 | 顶栏整条（会话标题、标签页、右侧图标） | `[class*="_header"]:has([class*="_tabs"]) { display:none }`——`:has` 限定"含标签页的那条"，避免误伤消息里的 `_header`（文件变更块）。隐藏时会话标题由卡片那一行显示 |
| 输入区状态条 | 关 | tok/s、缓存命中、费用、上下文占比 | `[class*="_dock"], .cm-stat-dock` |
| 消息操作行 | 关 | 每条消息的复制/点赞/分享/时间 + 「本轮费用」 | `[class*="_actions"]`（小写，区分大小写所以不会命中 `headerActions`）+ `.cm-note` |
| 　└ 对话/轨迹 标签 | 关 | 顶栏里的两个页签 | `[class*="_tabs"]`（顶栏关掉时该标签没意义） |
| 　└ 官方标题 | 关 | 官方标题（面包屑） | `[class*="_header"] [class*="_crumb"]`（限定在 header 内，避免误伤别处的面包屑） |
| 　└ 子智能体/后台任务 | **开** | 「N 个子智能体」「N 个后台任务运行中」 | `[class*="_headerActions"]` |
| 　└ 顶栏右侧图标 | 关 | 文件夹下拉、「…」、面板开关（整组） | `[class*="_headerUtilities"], [class*="_headerCorner"]` |
| 　└ 强制文字标签 | 关 | **反向**开关：点亮后**强制显示**官方在窄宽下折叠掉的文字 | 一条 `!important` 盖回官方的容器查询（见下） |
| 　　└ 「…」更多操作 | **开** | 图标簇里那颗「…」（需先点亮「顶栏右侧图标」） | `[class*="_moreButton"]` |
| 　　└ 面板开关 | **开** | 最右那颗"打开右侧边栏"按钮（同上） | `[class*="_headerCorner"]` |

「全部显示 / 恢复推荐」两个小按钮在卡头，一键切换全部或回到推荐默认（顶栏整条隐藏、其余按需）。

### 紧凑留白（独立开关）

小窗就 360px 宽，官方留白没有存在的理由，所以「小窗外观」卡顶部有一个 **紧凑留白** 开关（默认关）：

| 项 | 官方 | 紧凑留白 |
|---|---|---|
| `--dsh-composer-side-clearance` | **16px** → 滚动区/审批卡每侧 `16+16` = **32px** | **0** → 每侧 16px（360px 下多出约 **16px/侧**） |
| 对话区滚动内边距 | 每侧 32px | **8px** |
| 输入框 | 有侧边留白 | 贴边（0.25rem） |
| 消息块间距 | 16px | **10px** |

`--dsh-chat-content-width` **故意不动**：官方默认最小 **680px**，在 360px 里本来就不生效；
且被消息里宽表格的 `calc((100cqw - content-width)/2)` 用到，改成百分比会让表格跑版。

**「整理顶栏」是隐藏的配套排版**：官方顶栏是 `[_titleCluster][_headerActions][_headerUtilities][_headerCorner]` 的 flex 行，
其中 `_titleCluster{flex:1}` 吃掉剩余空间——标题藏掉后这个空列仍占地方，剩下的 chips 被挤在中间、留一条空隙。
所以**部分隐藏时会自动**收窄空列 + 让图标组自己贴右（只给一个 auto 外边距，否则空隙被平分）。
**顶栏子项全被藏时干脆整条隐藏**（不留一条空行）；行高收紧（`min-height: 0`）则无条件生效。

**官方在窄宽下自己折叠顶栏文字**（与我们的裁剪无关，实测源码）：智能体团队 `@container (width<=480px)`、
标准模式 `<=460px`、智能体预设 `<=540px` 把文字折叠成图标。这些 `display:none` 都没有 `!important`，
所以点亮「强制文字标签」就能用一条 `!important` 把它们要回来（可能有点挤）。

### 想自己写排版？设置页有「自定义样式（CSS）」

「**小窗外观**」卡片底部有一块**默认折叠**的「自定义样式（CSS）与 class 速查」：内容**追加在反代注入样式的最后**，
所以能覆盖内置规则；旁边有「插入示例」「清空」，改完在下次展开状态卡时生效。例：

```css
[class*="_headerCorner"] { display: none !important; }   /* 去掉面板开关 */
[class*="_moreButton"]  { display: none !important; }    /* 去掉「…」 */
[class*="_header"]      { padding: 0 !important; }       /* 顶栏再压扁一点 */
```

**不知道改哪个？** 折叠区里有一张 **class 速查表**：按「整体布局 / 官方顶栏 / 左栏内部 / 对话区与输入框 /
消息与费用」分组，逐行给出**选择器 + 一句说明 + 「插入」按钮**（点一下就把规则骨架写进输入框）。
清单在 `runtime/lib/gui-classes.mjs`，并有测试锁住"不许与实现漂移"（`buildCropCss` 用到的语义后缀必须在表里）。

版式上的两个实现约束（宿主/Naive 的脾气，改 UI 前先看）：
- `NTag` 在 `checkable` 时**忽略 `bordered`**（边框层条件是 `!checkable`），未选中就是透明底 → chip 的"描边"
  由我们自己的 `.dsh-chat-settings__chip` 画。
- 宿主的 `SettingRow` 只有 `title`/`desc` + 默认 slot，slot 落在**右列**，**没有整行模式** → 全宽内容要自造块
  （`.dsh-chat-settings__block`）。

### 改设置要不要重启插件？

**改设置一律不用重启插件**；只有**改了插件代码**才需要点插件页的「刷新」。

| 你改的东西 | 怎么生效 | 要重启插件吗 |
|---|---|---|
| 显示哪些元素（标签云）/ 紧凑留白 / 自定义 CSS | 保存 → 设置页**主动把配置推给 sidecar**（`applyConfig`）→ sidecar 关掉旧反代 → 状态卡**下次展开**时重新取地址，即用新样式（收起时要清 iframe 地址，见 `ui.mjs` 的 `collapse()`） | 否 |
| 小窗页面端口（`guiPort`） | 同上（下次展开用新端口重建反代） | 否 |
| 状态卡端口（`httpPort`） | sidecar 自动重绑数据通道；新发布的卡片自动带新端口 | 否 |
| 检查间隔 / 完成后停留 | applyConfig 后状态巡检循环即时重启/同步 | 否 |
| dshHome | 每次使用时读 config，即时生效 | 否 |
| **我改了插件源码**（`main.mjs` / `ui.mjs` / `settings.mjs`） | 侧车是长驻 Node 子进程、卡片/设置是已经 import 进 webview 的模块，都跑着**旧代码** | **是**（插件页「刷新」；不行就关掉插件再打开） |

**怎么知道自己踩到了这一条**：设置页顶部会出现一条橙色提示「插件侧车（runtime）还在运行旧代码…」——
`settings.mjs` 与 `runtime/main.mjs` 各有一个 `CONTRACT_VERSION`（改动/新增 RPC 时两边一起 +1），
`status` 会把它报回来，不一致就提示。

**「改了没区别 / 插件重启后设置还原」的根因（踩过三次）**：`settings.mjs` 的 `compose()` 早先只把
登记清单里的键写回保存对象，于是**没登记的键**（`compactSpacing`、`customCss`）每次保存都被
`{...DEFAULTS}` 抹回默认值。现在 `compose()` 与 `loadConfig()` 都**遍历 `DEFAULTS` 全键、按默认值类型处理**，
新增配置键不用再登记；`ui-render.test.mjs` 里有一条通用护栏：保存对象必须包含 `DEFAULTS` 的每一个键。

**注意一个宿主缺口（本插件已自行绕过）**：宿主的 `set_plugin_config`（`src-tauri/src/plugins.rs`）
只写 store + 给前端发 `catrace:plugin-config-changed`，**不会**把新配置推给正在运行的 sidecar
（`{op:'config'}` 只在 sidecar 启动时发一次，见 `src-tauri/src/plugin_sidecar.rs`）。
所以设置页在 `plugin.config.set()` 之后必须自己 `plugin.sidecar.request('applyConfig', {config})` 推一次，
否则改了设置必须 disable/enable 插件才生效（用户实测反馈过）。
若以后宿主补上"配置变更即通知 sidecar"，这段 push 可以留着（幂等）。

### 真 GUI 模式的边界（都实测过）

- **不能给 iframe 加 `sandbox`**：那会变成 opaque origin，`Origin: null` 直接 403。
- 关掉 DSH 主窗**不会**停服务（托盘常驻，host 子进程还活着）；**退出托盘/退出应用**才会。
- 若在 DSH 设置里关掉「普通浏览器访问」或离开 compatibility 模式 → 全链路 403（实时生效）。
- 端口漂移（DSH 换了端口）、关掉浏览器访问、凭据被重置都会让复用失效；展开状态卡时会当场报错
  （设置页「最近一次错误」也会带出原因）。
- **「票据过期」不再是失效场景**：票寿命写死 7 天，反代吃到 401 会换一张重放（见上面第 5 条）。
  0.3.1 及更早的版本没有这一步 —— 小窗开着超过 1 小时就会整片变成一行 `dsh web authentication required`（已修）。

## 安装

1. Catrace → 插件页 → **打开插件目录**，把 `dsh-chat/` 整个目录放进去。
2. 插件页里启用 **DSH 对话小窗**（默认不自动启用）。
3. DSH 桌面版 → **「设置浏览器访问」→ 打开「允许在浏览器中打开」**（见下）；然后等右下角状态卡弹出时，点正文展开官方界面（也可在设置页「状态通知」发一张测试卡先试）。

开发态下，本仓库 `tools/plugin-demo/` 会在 debug 构建里 junction 到 `app_data/plugins/`，改完直接刷新即可。

## 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| Node | **≥ 22.15**（建议 22.20+ / 24.x） | 需要 `zlib.zstdDecompressSync` 解压 DSH 会话日志；Catrace 便携 Node 是 v22.20.0，满足 |
| DSH | DSH Desktop **正在运行** + 「允许在浏览器中打开」 | 状态卡只需要能读会话日志；展开官方界面才需要桌面版在线 |

### 官方界面的前置条件：DSH 桌面版要允许浏览器访问

「官方界面」是本插件 sidecar 用 HTTP/WS 访问 DSH 桌面版的本机 web 服务再转给 iframe 的。
DSH 桌面版为此加了一道**渲染器准入**栅栏（`desktop-browser-access`）：

- 每个 Desktop 代次会随机生成一个 32 字节 token，只注入 **Electron 渲染器**的网络会话（请求头 `x-dsh-desktop-renderer`）；
- 非渲染器进程（就是我们）拿不到这个 token，会被 `rejectBrowserRequest()` 以 **403 + 纯文本 `forbidden`** 拒掉；
- 唯一出路：在 DSH 桌面版 → **「设置浏览器访问」→ 打开「允许在浏览器中打开」**（设备范围选"只有这台电脑上的浏览器"）。
  桌面版自己的提示是 *"浏览器访问仅在兼容模式下可用"*，所以可能要把该 Profile 切成**兼容模式**（会重启应用）。

没开这个开关时，展开会失败并明确报 **403 forbidden + 该怎么做**（而不是含糊的"没找到 host"）；
状态卡本身照常工作（它只读会话日志）。

## 用法

### 状态卡

- 折叠：徽标 + 标题 + 状态 chip + 最新输出；点正文原地展开。
- 展开：官方界面（iframe）+「收起」；DSH 在等你（审批 / 提问 / 计划待审）时自动展开。
- × = 本轮静默；完成卡停留 `noticeDoneHoldMs` 后自动收。

### 设置页

三个分区，所有字段都是**即时保存**（改完 0.5s 落盘，弹出「已保存」通知，与其他插件一致）；
没有实际改动的操作（比如点进输入框再点走）**不会**误报已保存、也不会写盘。
行排版是插件自造的（`field`：标题在左、控件在右、说明整行在下）——不用宿主 `SettingRow`，
因为它给右侧控件只保证约 4rem 的余量，说明一长就会把输入框压成「23…」（实测）。

- **运行状态**：每隔几秒自动刷新（页面隐藏时暂停），也可以点卡头「刷新」。
  两个端口按"用它的东西"命名——「状态卡端口」（状态卡跟后台通话的数据通道，
  被占用会自动换，换掉时描述里直接写"现在实际在用 N"）、「小窗页面端口」
  （小窗里官方页面挂的端口，没冲突别改）；还有 DSH 数据目录（可改，留空自动找 ~/.dsh）、
  运行环境（Node / zstd 标签）、最近一次错误。
  不展示"服务/反代是否在运行"这类恒真状态行（能看到本页就说明在运行）——
  展开失败时**状态卡自己**会显示错误与「重试」，底部的「最近一次错误」也会带出原因。
- **状态通知**：卡头右侧是总开关（关掉时下面整块不渲染）；展开后是检查间隔（500–30000ms）、
  完成后停留（3s–10min）、测试卡。
- **小窗外观**：紧凑留白开关 + 11 个显示开关（顶栏子项在父项点亮后出现）+ 折叠的自定义 CSS / class 速查。

## 能力边界（务必知道）

1. **本插件不替代 DSH。** 提问、审批、模型选择都在官方界面里完成；插件只负责
   「干活了告诉你 + 一键到官方界面」，并顺手把官方界面裁剪成适合小窗的样子。
2. **状态卡只读会话日志**，不依赖 DSH Desktop 在线；**展开官方界面**依赖桌面版在线 + 浏览器访问许可。
3. **日志是唯一数据源。** DSH 正在写时会有一个写了一半的 zstd 帧，插件做容错解码。
4. **格式版本。** 会话日志为 `session.v4.jsonl.zstd`；DSH 大版本升级可能改动事件结构，
   遇到不认识的字段/事件类型插件会跳过而不报错（见 `runtime/lib/session-log.mjs`）。
5. **sidecar 重启后端口/口令会变。** 卡片里若提示「本机 HTTP 桥连不上」，收起再展开一次状态卡即可
   （新卡片会带新端口与口令）。
6. **镜像消息流 / SDK 提问已移除（0.3.0）。** 0.2.x 发布的旧镜像卡会显示"请重开"提示；
   该能力计划在下一个大版本以更好的形态回归。

## 测试

```powershell
cd D:\workspace\Catrace\tools\plugin-demo\dsh-chat
node --test "runtime/test/*.test.mjs"
```

> 注意：本机 Node v24 下 `node --test runtime/test/`（带目录参数）会把目录当脚本入口而报
> `Cannot find module`，用上面的 glob 或显式文件名列表。

覆盖：多帧 zstd 切分与**尾部半个帧的容错**、会话日志 → 转录、状态巡检的回合流转/展开持有/×静默、
配置钳制与 0.2.x 遗留键丢弃、cookie 自签算法、**假 DSH host 的端到端**（探活/反代/注入/WS 升级）、
sidecar RPC 与**本机 HTTP 桥**端到端（临时 DSH_HOME 夹具）、UI/设置页渲染冒烟、插件合同静态检查
（白名单组件 / Toast 不许调 sidecar.request / events 白名单 / 契约版本一致）。
