# Pi 联动：npm 安装与 Webhook 接收

## 边界与职责

- Pi 事件是进程内事件，外部应用不能直接订阅。通用 `pi-webhook` 扩展监听 `agent_settled` / `agent_before_settle` / UI 等待事件，转发 v1 JSON；Catrace 只做接收适配，不修改 Pi / pi-web。
- 通用扩展独立发布于 `YHQY-Dev/pi-webhook`、npm `pi-webhook`；不要将 Catrace 专用协议写进通用项目。
- `runtime/pi-config.mjs`：全局 Pi 设置合并、目标订阅、私密凭据、原子写入与备份。
- `runtime/pi-package.mjs`：只检测 npm，不可用时明确报错；不下载 GitHub 备用包，不在 Catrace 中执行 npm install。
- `runtime/pi-webhook.mjs`：独立 HTTP 生命周期、鉴权、64 KiB 请求限制、v1 校验、重试 ID 去重；不掺 UI、磁盘配置或 sticky 状态。
- `runtime/pi-navigation.mjs`：跳转字段与会话链接校验。
- `runtime/main.mjs`：JSONL RPC、后台安装任务、现有 `handleState` 复用和卡片清理。npm 检测通过任务状态轮询，不能阻塞设置页单次 RPC。
- `settings.mjs` / `ui.mjs` 仍为单文件 Blob，无兄弟模块 import。Pi 放入同一「Agent 联动」列表，仅有安装/卸载 Hook 按钮，与其他 Agent 共用「事件通知策略」；无独立 Pi 面板、订阅或隐私开关。后台异步安装仍需轮询，但不改变 UI 布局。

## 安装不是加载成功

1. 在 Catrace 进程继承的 PATH 中检查 `npm --version`，4 秒无响应视为不可用。
2. 有 npm：向 `settings.json.packages` 加 `npm:pi-webhook`，由 Pi 后续安装，不在 Catrace 里执行 npm install。
3. 无 npm：提示安装 npm、确认 Catrace 的 PATH 并重启 Catrace，不修改 Pi 配置。Node.js 可用不代表 npm 一定可用；没有备用下载、版本锁定或哈希清单。
4. 现有同名 npm/git/本地包是用户配置，不重复加载、不改写来源。插件新增声明仅使用 npm:pi-webhook；存在 extensions 过滤时拒绝擅自修改。
5. 加入 `webhook.json.webhooks` 的专用目标 `catrace-agent-notify`；其他目标和全局配置保持原样。总开关关闭不自动开启，提示用户确认。无效 JSON/schema、16 目标上限、并发文件更改都拒绝写入。
6. 列表统一显示名称 Pi 与「已配置」，安装成功提示重启 Pi 或重载扩展；执行 `/webhook test catrace-agent-notify` 收到卡片才表示链路可用。配置存在不等于扩展已加载。
7. 安装默认订阅全部事件，Catrace「事件通知策略」本地即时过滤，修改策略无需 Pi 重载。手动改 Pi 配置仍需各会话 `/webhook reload`。卸载仅移除专用目标，不删除共享包，不保证撤回 Pi 已入队事件。旧测试版订阅可能不全，须卸载后重新安装 Hook；不在读取状态时悄悄改用户配置。

## 协议、隐私与卡片

- 独立端口 24527，`POST /pi`（也接受 `/`），`GET /health`。只绑定 127.0.0.1。可设置 `CATRACE_PI_WEBHOOK_PORT`，改端口后重新安装同步 URL。
- 随机 Bearer token 保存在插件 `runtime/cache/pi-webhook.token`，安装写入目标 Authorization。常量时间比较、不开放 CORS，拒绝 Origin 请求；token 不进入日志、状态 RPC 或卡片 raw。缓存丢失后必须重新安装同步凭据。
- 默认关闭 includeMessage/includeCwd；安装 UI 不提供此开关，仅可由用户手动编辑 Pi 配置。`sessionId = pi:<Pi session id>`，徽章为 Pi，标题为 `Pi · <会话名称>`，未命名显示 `Pi · 未命名会话`；不再用 ID 前缀当名字。会话名称由发送端当前读取，自动生成的标题可能晚于完成通知。
- 发送端新版本默认携带会话名称和 navigation 元数据：匹配 pi-web 官方运行记录 nextPid → `web` URL；未匹配按用户要求视为 `terminal` 尝试，提供 Pi PID。接收端 web 路径从不捕获进程链，terminal 路径复用现有 ensurePidChain，不能保证终端分屏/标签页级别定位；旧发送端无 metadata 时仍只能通知。
- web URL 须为无用户名/密码、无 fragment 的 HTTP(S)，唯一 query 字段 session 必须匹配原始会话 ID。Toast 直接调用允许 reminder-toast 窗使用的 `plugin.shell.openExternal(url)`，Promise 成功后再关闭卡片；失败不回退去聚焦服务器终端。禁止从卡片调用 sidecar.request（宿主只放行 main 窗）；不要为打开 URL 另建 sidecar RPC/HTTP 桥。
- 完成 → Stop；错误 → StopFailure；等待 → Notification；取消只清理已有卡片，不弹卡、不响铃、不提供通知策略；工具错误 → PostToolUseFailure。Pi 消息经过专用 v1 验证，不送入旧 `/permission`。
- started / resumed / session_closed / cancelled 固定订阅用于清理旧卡，resumed / session_closed / cancelled 不新建通知。安装订阅全部支持事件，展示统一使用通用事件策略；不要额外维护一套 Pi 通知设置或 configurePi RPC。
- Pi 以事件 ID 去重（10 分钟、最多 2048 条），不使用旧 Hook 的 8 秒同事件抑制，避免吞掉连续任务。失败处理不记为成功，允许发送方重试。
- host publish 回包可能晚于清理/新状态；若对应 entry 已不再是当前 sticky，则直接 resolve 晚到的 eventId，防止旧卡复活。
- waiting 只表示 Pi 扩展实际打开了阻塞 UI，不是普通助手提问，更不是远程审批。无允许/拒绝按钮；网页通过会话链接打开，终端仅尽力聚焦。
- Pi 接收端启动失败只记录错误，不阻断旧 23456 接收端。配置目录尊重 Catrace 进程的 `PI_CODING_AGENT_DIR`；远程 pi-web 无法连接本机回环地址。

## 验证与待用户确认

- `node --test agent-notify/runtime/*.test.mjs`：配置、npm 缺失时拒绝安装且无下载、鉴权、重试、多会话与真实 sidecar HTTP → JSONL。
- npm 新版本发布后，已有 Pi 安装仍需在对应环境执行 pi update 并重启/重载 Pi；本插件不轮询或强制自动更新扩展。
- 跳转新增测试：运行记录精确 PID 匹配、同机会话 URL、终端 fallback、名称、危险协议/错误会话校验、UI 分支、shell 打开成功/失败、危险协议拒绝；测试显式禁止卡片调用 sidecar.request，避免只模拟设置页权限而漏掉 Toast 窗限制。
- 仍需用户在宿主重载插件并更新 pi-webhook 新版本后验证名称和实际浏览器/终端聚焦；可能新开浏览器标签页，远程/代理地址不保证可直接使用。按仓库约定，此阶段不 commit。
