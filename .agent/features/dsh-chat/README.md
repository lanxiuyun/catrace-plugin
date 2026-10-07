# DSH 对话小窗（dsh-chat）

在 Catrace 小窗里看 DeepSeek Harness（DSH）的对话，并能直接向 DSH 提问。本文写「为什么这样做」，
使用方式见插件目录 `dsh-chat/README.md`。

## 子文档

- [参考项目orb的悬浮窗怎么实现的-以及为什么本插件没做自绘外壳.md](参考项目orb的悬浮窗怎么实现的-以及为什么本插件没做自绘外壳.md)
  — 别人的小窗是四层结构（自建窗口/自绘壳页/官方对话记录/直连 API）；我们做不到哪两层、试过什么、结论
- [紧凑留白-官方留白变量与不该动的content-width.md](紧凑留白-官方留白变量与不该动的content-width.md)
  — 官方留白出自哪个声明、开关改哪几条、为什么不能动 `content-width`、怎么确认真的生效
- [设置改了没反应或插件重启还原-compose漏键踩了三次.md](设置改了没反应或插件重启还原-compose漏键踩了三次.md)
  — 本插件最高频困惑源的根因与护栏（`compose()` 只写回登记过的键）

## 需求边界

- 目标：把 DSH 的对话搬进 Catrace 的一个常驻小窗（Toast sticky 卡）——**能看**（含正在跑的那一轮），
  并且**能问**（发出的消息要真的进 DSH 的会话库，之后能在 DSH 主窗口接着聊）。
- 非目标：接管/续写已有会话、在卡片里做审批、把 Catrace 变成 DSH 的第二个完整 GUI。

## 技术原理：能拿到 DSH 数据的四条路，为什么选这两条

调研了两个参考项目（dashi-taskboard 的 AI 对话小窗、deepseek-harness-orb 的悬浮球）。

| 通路 | 能读历史 | 能提问 | 审批 | 代价 | 结论 |
|---|---|---|---|---|---|
| 会话日志 `$DSH_HOME/sessions/**/session.v4.jsonl.zstd` | ✅ 全量 | ❌ | ❌ | 零依赖，只要 Node | **用于「看」** |
| `dsh --profile sdk`（stdio JSON-RPC） | ❌ | ✅ | ❌ | 起一个 harness 子进程 | **用于「问」** |
| `dsh --profile web`（HTTP `/api/*` + WS `remote.mux`） | ✅ | ✅ | ✅ | 要起完整 web 宿主 + token→cookie 握手，重 | 本期不做（见「以后要接的话」） |
| CDP 注入注入宿主界面 | — | — | — | 只服务于「把 SPA 塞进别的 App」 | 与本站无关 |

关键事实（都在本机 DSH 0.1.7-rc.2 上核对过）：

1. **会话日志是多帧 zstd 拼接**：一个 2.1 MB 的日志里有 200+ 个独立 zstd 帧（DSH 每追加一段写一帧）。
   Node 的 `zlib.zstdDecompressSync` 只解**第一帧**，必须自己按帧边界切开再逐帧解压拼接
   （`runtime/lib/zstd-frames.mjs`）。帧头/块头按 RFC 8878 走：magic → FHD → window/dict/FCS → 数据块。
2. **日志随时可能被读到中间态**：DSH 正在写时尾部会留半个帧。严格解压会让「镜像正在跑的会话」
   每次轮询都失败，所以 `decodeZstdDetailed(buf, {tolerant:true})` 只解到最后一个完整帧，
   返回 `tailTruncated` 供 UI 提示。**严格模式仍是默认**，避免把真损坏当正常。
3. **SDK 协议只有 3 个方法**（`initialize` / `session/prompt` / `shutdown`）**和 4 个通知**
   （`session.event` / `session.status` / `subagent.started` / `subagent.finished`）。
   没有列会话、没有读历史、没有 resume、**没有审批应答**：
   `dsh-sdk-jsonrpc-server` 内部只调 `agents.create()`（新建），不会 `agents.resume()`。
   所以小窗输入框发出去的一定是**新会话**，已有会话只能只读镜像——这点必须在小窗里写清楚，别装作能接续。
4. **`dsh` 在 Windows 上是 `dsh.cmd`**，Node 不能直接 spawn `.cmd`；且真实路径含空格
   （`...\Roaming\DSH Desktop\host-commands\...\bin\dsh.cmd`）。`runtime/lib/spawn-plan.mjs` 里
   `.cmd/.bat` 走 `cmd.exe /d /s /c "<命令>" <参数>`，并且**要给整条命令行再套一层引号**：
   `/s` 会把 `/c` 之后的第一个和最后一个引号剥掉，不套外层就会把 `C:\Program Files\...` 拆坏。
   代码里永不使用 `shell: true`。

## 两条通路分别给谁用（这是本插件最容易踩的坑）

宿主 `plugin_sidecar_request` **只允许 `window.label() === "main"`**（见宿主 `src-tauri/src/plugin_sidecar.rs`）。
也就是说：

- 设置页（主窗）→ 可以直接 `plugin.sidecar.request(...)`；
- **小窗卡片（`reminder-toast` 窗）→ 调不了**，只能走 sidecar 自己起的本机 HTTP 桥。

`plugin_api_*`（含 `events.publish`）走的是另一套检查（`require_plugin_api` 放行 `main` 与 `reminder-toast`），
所以卡片能收事件，但调不到 sidecar。本插件的做法：

- sidecar `http.createServer` 绑 `127.0.0.1`（默认 23457，占用则退系统分配端口）；
- 每个进程随机一个 token，通过 publish 的事件 payload 下发给卡片；没有 token 一律 403；
- CORS 全开（`Access-Control-Allow-Origin: *`）以免 blob 加载的卡片 fetch 被拦
  （沿用 `agent-notify` 已验证的写法）。

## 小窗卡片的两个硬约束（Host 侧）

小窗卡片的尺寸**不是自由发挥**，宿主 Toast 的几何是写死的：

| 约束 | 值 | 出处 |
|---|---|---|
| 窗口宽 | `24.5rem`（392px） | `.toast-root { width: 24.5rem }`（22.5rem 卡片 + 两侧各 1rem 阴影出血） |
| 卡片栈内容宽 | `22.5rem`（360px）= 392 − 1rem(左 padding) − 0.375rem(右 padding) − 10px(scrollbar gutter) | `.toast-stack` + `scrollbar-gutter: stable` |
| 卡片宽 | `22.5rem` 且 `box-sizing: border-box` | `.toast-card { width: 22.5rem }` |
| 卡片横向溢出 | `overflow-x: hidden` 直接裁掉 | `.toast-stack` |

所以插件卡片必须 **`width: 100%` + `border-box`**，写死成 `24rem`（384px）会超出 8px 以上、右边被裁
——这正是「窗口显示不完全」的原因。回归用例已把这个数字锁进 `plugin-contract.test.mjs`。

另外要传 `payload.toastStyle: 'standalone'`：宿主据此给 `.toast-card` 加 `.toast-card-standalone`
（去掉自己的白底、`padding: 0.75rem`、圆角、border、shadow）。不传的话卡片被套在宿主默认白卡里，
可用宽度只剩 `22.5 − 0.75×2 = 21rem`（336px），还会出现「卡中卡」的双层外壳。

量法（改尺寸时别靠眼睛猜）：`e2e-temp/dsh-chat-card-measure.mjs` 直接把 `ui.mjs` 放进从
`ReminderToast.vue` 抽出的真实 Toast 样式里量宽度/溢出/底部可见性，并带两个对照用例
（不传 standalone → 336px；写死 24rem → 溢出 18px 且右侧被裁）。

## 卡片可读性 / 设置页可编辑性（都是踩过的坑）

1. **受控输入必须接 `onUpdate:value`**。设置页第一版用 `value` + `onChange`：Naive 的 NInput 有 `value`
   就是受控，不接 update 就等于「打字打不进去」——用户的原话是「设置完全没办法调整」。
   现在：文本字段 `onUpdate:value` 写回本地表单 → 500ms debounce → `plugin.config.set(整包)`；
   数值字段先存**字符串**，失焦/保存时再钳制（边打字边钳制会把「12」变「6」）。
2. **`overflow-y: auto` 会隐式把 `overflow-x` 也算成 `auto`**。第一版消息区只写了 `overflow-y: auto`，
   于是任何不可断的长文本（工具参数里的绝对路径、长 JSON、长 URL）都会顶出一条横向滚动条
   （用户截图里那条长横线）。现在所有滚动容器显式 `overflow-x: hidden` + `overflow-wrap: anywhere`，
   工具参数用 `direction: rtl` 的省略号保留尾部文件名。
3. **工具调用要折叠成组**。DSH 一轮里可能有几十个 `tool/call` + `tool/result`，逐条铺开会把对话冲成
   「工具墙」（用户截图就是这种观感）。现在连续 tool item 合成一个 `▸ N 个工具调用（x 个失败）`，
   展开才看明细；工具名与操作对象从 assistant 的 `tool-call` 块按 callId 关联过来。
4. **底部状态行只留一行**。模型名 + 更新时间 + 会话选择挤在一行时，`deepseek-account/deepseek-flash`
   会折成三行、把输入区顶高。现在状态行 `nowrap + ellipsis`，会话选择固定 8.5rem。
5. **卡片高度 30rem**（480px）+ 栈 padding 32px = 512px 窗口；`.toast-card-plugin` 的 `max-height: none`
   保证不被 37.5rem 通用上限卡住。

量法：`e2e-temp/dsh-chat-ui-measure.mjs`（Playwright）把真实 `ui.mjs` / `settings.mjs` 塞进
宿主真实 Toast 样式与 `SettingRow` 样式里，夹具全是不可断的长路径/长 JSON，断言：
卡片 360px、各容器 `scrollWidth - clientWidth === 0`、工具折叠成组、设置页 20 行 12 个输入控件，
并且**真的在浏览器里打字**验证「改设置会落盘、越界数值被钳制」。

## A2：把官方 GUI 原样搬进小窗（同源反代）

用户要求「小窗里和原生一模一样」。**官方没有紧凑面**（`dsh-client-ui-overlay-chat` 是 orb fork 自己加的包，
已装 rc.2 里连 `?surface=` 这个参数都不认；即便在 fork 里，它的 postMessage 桥被 `dsh-app://shell`
硬锁，第三方 http 页面驱动不了）。所以走「把整块官方 GUI 搬进来」：

```
小窗卡片 iframe  →  sidecar 同源反代（127.0.0.1:23458）  →  正在运行的 DSH host（127.0.0.1:43120）
                        ├ 自签 cookie（读 ~/.dsh/.credentials.yaml）
                        ├ 改写 Host / Cookie / 删 Origin
                        └ 首屏注入 localStorage['dsh.sessions.current'] = 目标会话
```

为什么必须反代：直接 iframe 官方地址必 401（webview 没有票据、HttpOnly 写不了、`?token=` 桌面版拿不到）。
反代让它同源，cookie 由服务端贴，SPA 的相对 URL 与 WS 自然落在代理源上。

实测数据（360×480）：目标会话对话可见、`contenteditable` 输入框带 `/ 调用指令` 与 `@ 文件或对话` 提示、
`/api/*` 全部 200、`ws://…/api/remote.mux` 已连、控制台零错误。

### 三个必须记住的坑（都踩过）

1. **WS 升级不能剥 `connection` / `upgrade`**。我第一版在 upgrade 分支复用了"剥逐跳头"的逻辑，
   结果上游只当普通请求回响应，握手根本不成立 —— 单元测试抓到了。upgrade 分支只剥其余逐跳头。
2. **不能用 `new URL(...).searchParams` 处理查询串**。客户端的插件 bundle URL 是
   `/plugins/??@scope/a/client.js,@scope/b/client.js&rev=hash`，`URLSearchParams` 一轮往返会把
   `@` `,` `??` 重新编码 → 全部 404、客户端报 "HTML did not preload …"。
   必须**按字符串**删掉我们自己的 `dshw-session` 参数，其余字节保真。
3. **iframe 不能加 `sandbox`**（opaque origin → 403）；**也别用 CSS 裁官方布局**（会把 composer 挤成 49px；
   官方在窄宽度下自带 56px 图标栏的窄模式，够用）。

### 去装饰：隐藏左栏必须"轨道归零"，不能 display:none

官方布局是 CSS grid：`_1qAH1q_frame { display:grid; grid-template-columns: 56px 304px 0px }`
（左栏 / 中间列 / 右栏）。对左栏用 `display:none` 会**让中间列自动落到第一轨**（56px），
输入框宽度从 261px 掉到 **22px** —— 而且 React 会把测量值缓存，去掉样式也不恢复，必须刷新页面。
正确做法（已实测，输入框回到 317px、无横向溢出、正文无损）：

```css
[class*="_sidebarCol"] { grid-column: 1 !important; visibility: hidden !important; overflow: hidden !important; }
[class*="_centerCol"]   { grid-column: 2 !important; }
[class*="_frame"]       { grid-template-columns: 0 minmax(0, 1fr) 0 !important; }
```

其余装饰项用 `display:none` 是安全的（逐项量过：输入框宽度不变、正文字数不减），但**藏在"整条容器"这一层**：

```css
/* 默认：整条官方顶栏隐藏（:has 限定"含标签页的那条"，别误伤消息里的 _header） */
[class*="_header"]:has([class*="_tabs"]) { display: none !important; }
/* 关掉上面的总开关后，才注入下面这些细粒度规则 */
[class*="_tabs"] { display: none !important; }                                  /* 对话 / 轨迹 */
[class*="_headerUtilities"], [class*="_headerCorner"] { display: none !important; } /* 右侧图标簇 */
[class*="_header"] [class*="_crumb"] { display: none !important; }              /* 官方标题（面包屑） */
[class*="_headerActions"] { display: none !important; }                         /* chips，默认关 */
/* 消息操作行（复制/点赞/分享/时间）+ 本轮费用；_actions 区分大小写，不会命中 headerActions */
[class*="_actions"] { display: none !important; }
.cm-note { display: none !important; }
```

官方顶栏结构（360px 实测，`class*= 语义后缀`）：`_header` ⊃ `_titleRow`（`_titleCluster`⊃`_crumb` 标题 /
`_headerActions` chips / `_headerUtilities`+`_headerCorner` 右侧图标）+ `_tabs`（对话、轨迹）。
**只藏子元素会踩坑**：标题与右侧图标藏掉后，chips 在 360px 下塌成一个孤零零的图标，而 `_header` 仍撑着
高度 → 顶部一条又高又空的带子（用户截图反馈"header 怎么这么高、按钮都不见了"）。所以**默认整条隐藏**，
标题交给卡片那一行（`openGui` 在 payload 里带 `guiTitle`）；要保留 chips 才关总开关走细粒度。

### 已知隐患：新客户端可能落在"选择工作区"（待修）

新开一个浏览器客户端（新 origin）时，客户端启动会读 `localStorage['dsh.sessions.current']`（`uiWorkspace`
的 `selection` 持久化快照）并走 `restoreSelection` → `sessions.retain(...)`；实测会报
`Sidebar Session opening failed: Error: Session reference "…" is released`，随后 `clearMain()` 把该键清成 `{}`，
落到「选择工作区 / 选择一个工作区开始」。

已确认的边界：
- **不是某条会话的问题**：正在运行的会话与旧会话都失败；换 origin、换端口都一样。
- **不是"时机早"能解决的**：注入脚本本来就在应用 bundle 之前写好了选择；客户端确实尝试打开了
  （日志里有 opening failed），是**打开后立刻被 release**。
- **补写 / 合成 storage 事件 / 重载 都无效**（试过一版自愈注入：重载后仍然被 release，只是多刷几条错误日志）
  → 所以注入脚本里**不要再加自愈或重载**。
- 客户端侧成因：`uiWorkspace` 的 `lifetime` 是一个构造函数里创建的共享 AbortController，
  `ctx.effect` 的 cleanup 会 `lifetime.abort()`；一旦该插件被 reload/重复挂载，此后每次
  `replaceMain` 都会看到 `signal.aborted` → `reference.release()` → `clearMain()` → 选择被清空。
  也符合 `clearArchivedCurrent()`（当前选择被判定为 archived 时会清空）这条路径。
- **影响面**：长期开着的小窗不受影响（它已经进过会话）；只有**新打开**的小窗可能落在选择页，
  此时点右上「选择工作区」→ 选工作区即可进入。
- 也正因如此，headless 新开 origin 的自动化验证在这台机器上暂时跑不通（落不到会话里）——
  后续要么用"已进过会话的持久 origin"，要么先修客户端侧。

### 宿主不会把配置推给运行中的 sidecar（本插件自行绕过）

`set_plugin_config`（`src-tauri/src/plugins.rs`）只写 store + 给前端发 `catrace:plugin-config-changed`；
`{op:'config'}` 只在 **sidecar 启动时**发一次（`src-tauri/src/plugin_sidecar.rs`）。
后果：设置页保存后，sidecar 的 `config` 还是旧的 → 反代仍是旧 CSS → 重开小窗也复用旧代理 →
**必须 disable/enable 插件才生效**（用户实测反馈）。
修法（插件侧，无需改宿主）：设置页跑在主窗口、`plugin.sidecar.request` 可用，保存后自己
`call('applyConfig', { config })` → sidecar `applyConfig()` → 签名变化即关旧反代 → 设置页自动重开小窗。
回归：`ui-render.test.mjs` 断言保存后确实调了 `applyConfig` 且带上全部显示项；`main.test.mjs` 断言
`applyConfig` 立即改变 `status.config` 与 `guiStatus.crop`。

### 官方自己会按宽度折叠顶栏（不是我们的裁剪）

用户问过「主窗口顶栏东西很多，小窗里怎么就剩智能体和后台任务」。查源码得到确切规则（`client.js` 原文）：

| 元素 | 官方规则 |
|---|---|
| 智能体团队 | `@container (width<=480px){ .vhh34W_triggerLabel{display:none} }` |
| 标准模式（权限预设） | `@container (width<=460px){ .T8U3jW_trigger:has(.T8U3jW_triggerIcon) .T8U3jW_triggerLabel{display:none} }` |
| 智能体预设 | `@container (width<=540px){ .uglhVW_label{display:none} }` |
| 费用明细 | 不在顶栏，在输入区状态条（`cm-stat-dock`） |

`_titleRow` 是 `container-type: inline-size`，所以这些 `@container` 按**对话区宽度**生效（360px 小窗全中）。
这些 `display:none` **都没有 `!important`** ⇒ 一条 `!important` 就能盖回来（顺序无关），
所以给了个反向开关 `showHeaderLabels`（`forceLabelsFor()` → `buildCropCss({forceLabels:true})`，
选择器 `[class*="_titleRow"] [class*="_triggerLabel"], [class*="_titleRow"] [class*="_label"]`）。
注意这是"**显示型**"开关（true = 显示），但**不参与** `cropFlagsFor()` 的取反映射（故 `CROP_MAPPED_KEYS` 少它一个），
只参与 `SHOW_KEYS`/`guiSignature`。

### 设置页：显示项用「标签云」，语义是 true = 显示

配置键 `showRail/showHeader/showTabs/showHeaderIcons/showHeaderTitle/showHeaderChips/showComposerStatus/showMessageMeta`
（true = 在小窗里显示该元素），反代用 `cropFlagsFor(config)` 取反生成隐藏规则。
设置页把它们渲染成一排**可点标签**（`NTag checkable` + `NTooltip`）：点亮 = 显示，点一下切换，悬停出说明；
「官方顶栏」关掉时它的四个子标签自动变灰（禁用），免得用户点了没反应。
清单只有一处真相（`config.mjs` 的 `SHOW_KEYS`）：设置页渲染/保存、`cropFlagsFor`、`guiSignature` 都从它取，
并有测试锁住"任一开关都必须改变反代签名"（漏一个就是"设置没用"这类 bug）。

### 设置页两个致命坑（都踩过，务必有回归）

1. **保存对象必须真的带上开关值**。`compose()` 原来是 `{ ...DEFAULTS }` 再逐键覆盖已知字段；
   新加的布尔开关如果没被显式写回，保存出去的永远是**默认值**，用户点开关等于没点
   （症状：用户反馈「设置没用」）。现在有统一的 `SHOW_KEYS` 清单，`compose()` 与加载都必须遍历它，
   `ui-render.test.mjs` 里有一条功能测试：真渲染设置页 → 先点亮「官方顶栏」让子项可用 → 把所有标签
   点成关闭 → 断言保存对象里这 8 个键都是 `false`。
2. **界面要读 sidecar 的生效配置**。`loadConfig()` 现在优先用 `status.config`（sidecar `normalizeConfig`
   之后的结果），因为本地存盘里很可能缺键；只读存盘会把开关显示成「关」而实际生效的是默认「开」。

另外：`plugin` 是**宿主注入的模块级变量**（宿主在源码前插
`const plugin = globalThis.__CATRACE_CREATE_PLUGIN_API__('<id>')`，见 `tools/plugin-demo/develop.md`），
插件里不能自己定义、也不要 import 宿主模块。测试要验证配置读写，必须照宿主的方式注入这行前奏
（`loadWithHostPrelude`），否则模块里 `plugin` 未定义，测出来的只是假象。

去装饰开关改完是**自动重开小窗**的（CSS 在反代启动时注入），不用用户手动再点一次。

### 「整理顶栏」：隐藏必须配排版，否则一定难看

官方顶栏 = flex 行 `[_titleCluster][_headerActions][_headerUtilities][_headerCorner]`，且
`_titleCluster{flex:1}`。把官方标题藏掉后，这个空列**照样吃掉剩余空间** → 剩下的 chips 被挤在中间、
右边图标之间留一条空隙、行高还撑着（用户原话："隐藏一些东西的话，就会很丑"）。
所以 `buildCropCss` 在**部分隐藏**时额外注入排版规则（`tidyHeaderRules`，可 `tidy:false` 关掉）：

| 规则 | 作用 |
|---|---|
| `_titleCluster { flex: 0 0 auto }` | 空标题列不再抢空间 |
| `_headerUtilities { margin-left: auto }` + `_headerCorner { margin-left: 0 }` | 动作图标贴右；**只给一个 auto**，否则多个 auto 会平分空隙反而更散 |
| `_header { min-height: 0; padding: .3rem 0 }` | 去掉多余留白 |
| `_titleRow { gap: .5rem }` | 统一间距 |

两条纪律：**只有确实藏了东西才注入**（全都显示时不动官方排版）；**四项全藏就整条隐藏**（不留空行）。

### 验证手法：headless 别用"桌面正在持有的那条会话"

新 origin 的客户端要 `sessions.retain`，而**桌面客户端正持有的那条会话**（例如当前这轮对话）会失败并
落到「选择工作区」。换一条久未打开的旧会话就正常。踩过的坑：连续多次用同一条会话跑 headless，
前一次没干净退出的客户端会让后一次也失败——每条会话一次、跑完就关。

### 设置页（「小窗外观」卡片）的版式约定

按用户确认的设计稿实现，踩过的坑与结论：

| 点 | 约定 | 依据 |
|---|---|---|
| 分组 | 主组 4 项 + 「**顶栏内部：**」+ 「**顶栏右侧图标内部：**」两个分组小标题；**不用 `└` 前缀**（显丑） | 用户明确否掉前缀符号 |
| 依赖 | 父项未点亮时子组**直接不渲染**（不是置灰、也不是禁用） | Naive 的 `disabled` NTag **不触发** `onUpdate:checked`；不渲染最省事且没有"点了没反应" |
| chip 描边 | 未选中 = 自绘紫调描边 + 淡紫底（`:not(.is-on)`），选中 = 主题色实底 | `NTag` 在 `checkable` 时**忽略 `bordered`**（边框层条件 `!checkable`），底层 `--n-color-checkable` 就是 `#0000` |
| 说明 | 卡片顶部一句总说明；每项细节进 `NTooltip`（机制：Popover 把 hover handler 直接挂 trigger VNode，disabled 也能弹） | 行里只放 chip，避免"标签+后缀说明"糊成一片 |
| 全宽块 | 「自定义样式（CSS）」自造 `.dsh-chat-settings__block`（标题 + 说明 + 全宽等宽 textarea + 插入示例/清空 + **class 速查表**） | 宿主 `SettingRow` 只有 `title`/`desc`+默认 slot，slot 在**右列**、**无整行模式** |
| class 速查 | `runtime/lib/gui-classes.mjs` 里 5 组 35 个选择器（布局/顶栏/左栏/对话区/消息与费用），每行「插入」按钮写入规则骨架；由 sidecar `guiClasses` RPC 供给 | 用户原话：「应该将所有的样式 class 都列出来一下，否则改的人都不知道应该怎么改」 |
| 速查表不许漂移 | 测试从 `gui-proxy.mjs` 里抽出所有 `[class*="_x"]` 语义名，逐个断言在速查表里能查到（含 `[class*="_titleRow"] [class*="_label"]` 这种两段式，要 matchAll 全收） | 这条测试当场抓出漏掉的 `_label` |
| 取不到数据要说话 | 速查表 RPC 失败时**把原因显示出来**（"多半是插件在跑旧代码"），不要静默不渲染 | 第一次上线时就踩了：sidecar 是旧的、`guiClasses` 不存在，界面什么都不显示，用户以为没做 |
| 契约版本自检 | `runtime/main.mjs` 与 `settings.mjs` 各有一个 `CONTRACT_VERSION`（**改/加 RPC 方法时两边一起 +1**）；`status` 报出该值，不一致就在设置页顶部显示「侧车在跑旧代码，关掉再打开」 | 这是本插件最高频的困惑源（改代码后不重开插件） |
| chip 间距 | `.dsh-chat-settings__tags` **只允许一条规则**（`gap: .5rem`）。曾经写了两条，后面那条 `gap: 0 0` 把前面盖掉 → chip 挤成一坨、看着像句子 | 用户反馈"你不来点 gap 之类的？" |
| 多行输入 | 必须 `NInput + type:'textarea'`；**naive-ui 里没有 `NInput.Textarea`**（只有 NInput/NInputGroup/NInputGroupLabel），写错会静默掉进兜底分支（连 placeholder 都丢，显示成"请输入"） | 实测 node_modules/naive-ui/es/input/index.mjs |
| 断言 | 查"源码里不许出现某写法的"这类断言，**先剥注释**或匹配实际调用（`h(NInput.Textarea`），否则会被自己的注释命中（踩过三次） | — |
| 快捷操作 | 卡头右侧「全部显示」「恢复推荐」（`恢复推荐` = 回到 `DEFAULTS`） | 11 项手点太累 |
| 文案 | 描述里**不写 markdown**（宿主 `card()` 不渲染 md，`**x**` 会原样显示成星号） | 上一版就是这么丑的 |

### 自定义 CSS：把排版权交给用户

设置页「小窗里显示哪些元素」卡片底部有 **自定义 CSS** 输入框（`config.customCss`），内容追加到反代注入样式的
**最后**（`buildCropCss` 里 `rules.push(extra)`），所以能覆盖我们的规则；注入时 `escapeStyleText()`
转义 `</style>` 防提前闭合；`guiSignature()` 把它算进签名，所以改完会重建反代 + 自动重开小窗。
用户问过"我不能自己写排版么"——这就是答案：不必等我改代码。选择器仍必须用语义后缀（官方 class 带哈希）。

### 顶栏行高：收紧行高与"改排列"分开

官方 `_titleRow` / `_headerLeading` 各有 **30px `min-height`** ⇒ 顶栏天生偏高（用户反馈"header 高度太高"）。
所以 `tidyHeaderRules()` 分两档：
- **行高收紧**（`min-height: 0` + `padding: .125rem/.25rem`）→ **只要顶栏可见就注入**；
- **改排列**（空标题列 `flex: 0 0 auto`、图标贴右的 auto 外边距）→ 只在**确实藏了东西**时才注入
  （没藏东西就别动官方布局；`hidesSomething` 判断，含 `headerMore`/`headerPanel`）。

### 「…」与面板开关可以单独藏

整组 `showHeaderIcons` 之外，另给了 `showHeaderMore`（`[class*="_moreButton"]`）与
`showHeaderPanel`（`[class*="_headerCorner"]`）两个细项，默认**显示**；用户想留文件夹下拉、只去掉这两颗按钮时，
把它们点灰即可。标签云支持 `needs` 依赖：这两项的 `needs: ['showHeader','showHeaderIcons']`，
依赖没点亮就置灰并在 tip 里说明要先点亮谁。

### 紧凑留白（独立开关，`compactSpacing`）

设置页「小窗外观」顶部一个开关，默认关；把官方留白变量与滚动区/输入框/消息间距收到小窗尺度
（360px 下正文宽度约 296 → 344px）。**动哪几个变量、为什么偏偏不能动 `--dsh-chat-content-width`、怎么确认真的生效**：
[紧凑留白-官方留白变量与不该动的content-width.md](紧凑留白-官方留白变量与不该动的content-width.md)。

### 「真 GUI」打不开的 403 forbidden：桌面版渲染器准入（2026-10-05 排查）

**现象**：点「小窗打开（真 GUI）」弹「没找到正在运行的 DSH host…」；实测宿主在 43120 正常监听，
但**所有**请求（含不带 cookie、含根 HTML）都返回 **403 + `text/plain` `forbidden`**。

**根因**（读桌面端代码确认，不是猜）：

- `resources\app\lib\desktop-browser-access-*.js`：
  `createDesktopBrowserAccess(ordinaryBrowserEnabled, token = randomBytes(32).toString('base64url'))`，
  请求头常量 `x-dsh-desktop-renderer`；`decideDesktopBrowserAccess()`：token 匹配 → `renderer`（放行）；
  否则 `!ordinaryBrowserEnabled || url 带 dsh-desktop-* 查询参数` → **`denied`**。
- `resources\app\lib\webserver.js` 的 `rejectBrowserRequest()` = 403 + `text/plain` + `nosniff` + `forbidden`
  （与实测响应一字不差）。
- token 只在内存里（`randomBytes`，经 `rendererAccessHeader` 注入 Electron 网络会话），**第三方进程读不到** ⇒
  反代（Node 发请求）必然被拒。别和 `dsh-client-connection` 的 `admit()` 混：那里是 403 栅栏之后的一层 401 认证。

**结论**：A2 反代路线**依赖用户开启「允许在浏览器中打开」**（桌面版 →「设置浏览器访问」；
桌面版自己提示"浏览器访问仅在兼容模式下可用"）。未开启时镜像卡 / SDK 提问仍可用（那条路自己起 `dsh --profile sdk`，不经过栅栏）。

**插件侧改动**：`discoverHost` 支持 `diag` 收集每端口探测结果，`describeDiscoveryFailure()` 把 403/401/连不上
翻译成可执行话术；`openGui` 与 `guiStatus.lastError` 都带上该原因（原来一律报"没找到 host"，误导性极强）。

### 踩过三次的坑：`compose()` 漏键 → 「改了没区别 + 插件重启就还原」

症状、根因（三次分别漏了 `show*` / `customCss` / `compactSpacing`）、结构性修法与护栏、以及顺带修掉的
CRLF 解析测试 bug：**见 [设置改了没反应或插件重启还原-compose漏键踩了三次.md](设置改了没反应或插件重启还原-compose漏键踩了三次.md)**。
一句话：**先查保存对象里有没有这个键**，别先去怀疑 CSS 或反代。

## 已知边界 / 以后要接的话

- **审批**：SDK 没有应答通道，工具调用按 profile 默认策略（`workspace-write` / `ask`）走。
  需要完全访问的用户可以配 `patchFile` 传 `dsh --patch <yml>`；真要在小窗里点「允许/拒绝」，
  只能走 `dsh web` + `/api/remote.mux` 的 `$events` waterfall（`approval/request`）。
- **接续已有会话**：`dsh web` 的 `session/create {sessionId}` 是唯一可能的路子（ACP profile 也有 `session/resume`），
  但那要起完整 web 宿主并做 token→cookie 握手（cookie 绑定 host:port，签名密钥在 `$DSH_HOME/.credentials.yaml`
  的 `client-connection/browser-session` 记录里）。本机 DSH Desktop 的端口/token 对外不可见，本期不碰。
- **日志格式版本**：当前是 `session.v4.jsonl.zstd`；DSH 升级若改事件结构，解析层对未知事件/未知 content 块
  一律跳过（不抛错），必要时再适配。
- 真实数据实测（`parsed` 全量）：9957 个事件 / 36 种类型 / `badLines = 0`；`readSession` 命中缓存后零解压。
