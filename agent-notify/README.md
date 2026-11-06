# Agent 通知（agent-notify）

把原来宿主内置的 Agent 通知做成外置插件。启用后 sidecar 监听 `127.0.0.1:23456`：

- `POST /state`：会话状态 → 右下角小窗
- `POST /permission`：阻塞式权限审批（Claude http hook）

设置里可给 Claude / ZCode / Codex / Gemini / Kimi 安装 hook，并配置 Pi / pi-web 的 Webhook 扩展。默认关闭。启用 = 信任本目录代码（含 sidecar）。需要本机 Node.js；Pi 扩展要求其宿主运行环境支持 Node.js ≥ 22.18。

## Pi / pi-web

1. 在 Catrace 启用插件，重载插件进程以加载新版本，在设置的「Agent 联动」找到 Pi，点击「安装 Hook」。
2. 安装器检测 **Catrace 进程环境**中的 `npm --version`：可用时在 Pi `settings.json` 声明 `npm:pi-webhook`，由 Pi 启动/重载时完成包安装；不可用时明确报错，不修改 Pi 配置，不下载 GitHub 备用包。Node.js 与 npm 并非必然同时可用，请确保 Catrace 的 PATH 可以找到 npm。
3. 后续由 Pi 安装失败时，应查看 Pi 的包加载错误；不会自动声称已加载成功。已有安装升级需在对应 Pi 环境执行 `pi update` 并重启/重载 Pi，本插件不自动更新扩展。
4. 接收地址为 `http://127.0.0.1:23456/pi`，复用现有 Hook HTTP 服务，仅本机可访问，不另开监听端口；安装器向 Pi `webhook.json` 添加 `catrace-agent-notify` 接收端及随机 Bearer 凭据。默认不发送回复正文或工作目录。
5. 重启 Pi / pi-web，或使用其扩展重载功能；首次加载后执行 `/webhook test catrace-agent-notify`。收到测试卡片才表示接收链路验证过。列表的「已配置」仅表示配置写入成功，不代表扩展已经加载。
6. Pi 与其他 Agent 共用下方的「事件通知策略」，不再提供独立的 Pi 开关区。安装时订阅全部受支持事件，由 Catrace 统一决定不通知 / 自动消失 / 常驻；策略改动立即在 Catrace 生效，无需 Pi 重载。开始任务、恢复交互、会话关闭和任务取消负责清理旧卡；取消事件不弹卡、不响铃，也不提供通知策略选项。等待交互**仅提醒，不提供允许/拒绝远程审批**，普通对话提问也不等于触发等待事件。

配置目录默认 `~/.pi/agent`，尊重 **Catrace 进程继承的** `PI_CODING_AGENT_DIR`。同用户同目录的 Pi CLI / pi-web 共享配置；如两者运行于不同机器、用户或目录，需要分别配置，远程服务器不能连接本机回环地址。端口与其他 Agent 共用 Catrace 进程环境 `CATRACE_AGENT_NOTIFY_PORT`（默认 23456）；修改后重新安装 Pi Hook 来更新 URL，不再使用 `CATRACE_PI_WEBHOOK_PORT`。

此前试用版本写入过 `24527` 地址的用户，需重新安装 Pi Hook，或仅将 `webhook.json` 中 `catrace-agent-notify` 的 URL 改为 `http://127.0.0.1:23456/pi`（自定义端口相应调整），保留其他目标和令牌，再在各 Pi 会话执行 `/webhook reload`。旧地址不再监听；通用 pi-webhook 包的默认地址不受影响。

默认不发送正文或工作目录，设置页不再提供额外隐私开关。若手动修改 Pi `webhook.json`，需要在各 Pi 会话执行 `/webhook reload`；旧版独立 Pi 开关区写入过较少事件的用户，请卸载后重新安装 Hook 以恢复完整订阅。安装保留其他包、目标及设置，修改已有文件前保存 `.catrace.bak`；配置损坏、总开关关闭或接收端超限时拒绝写入。卸载只删除 `catrace-agent-notify` 接收端，保留通用扩展包和其他接收端；Pi 重载前已入队事件可能继续到达。

支持跳转元数据的 pi-webhook 新版本会发送会话名称，卡片显示 `Pi · 会话名称`，未命名显示 `Pi · 未命名会话`。默认会发送会话名称和跳转元数据，请避免在名称中放秘密。网页来源通过 pi-web 官方运行记录精确匹配服务 PID 后识别，点击「前往会话」由 Toast 直接使用宿主 `plugin.shell.openExternal` 在系统浏览器打开会话链接（可能新开标签页，不走只限设置页的 sidecar RPC）；未匹配时按终端 Pi 尝试捕获父进程链定位窗口，不保证终端标签页、分屏或远程进程定位。旧发送端不带跳转信息时仍无法跳转，仅更新 Catrace 不够。自动生成的会话名称可能晚于首次完成通知。

鉴权文件位于插件 `runtime/cache/pi-webhook.token`，不要分享它或带凭据的 `webhook.json`/备份。插件目录若被完整替换导致凭据丢失，请重新安装 Pi Hook 同步新凭据。新接收服务启动失败不影响旧 23456 端口的 Agent Hook。

## 验证

```bash
node --test agent-notify/runtime/*.test.mjs
```

在仓库根目录执行。测试包含配置保留、npm 检测及缺失时无备用下载、鉴权、请求大小限制、重试去重、多会话和 sidecar HTTP → JSONL 联调；实际桌面卡片观感仍需宿主验证。

旧内置配置键 `plugin_config:agent` **不会**自动迁过来，请重新装 hook。

## 代码结构

- `ui.mjs` / `settings.mjs`：宿主按单文件 Blob 加载，不能 `import` 兄弟模块
- `runtime/main.mjs`：sidecar 入口（HTTP + JSONL）
- `runtime/hook-data.mjs`：hook JSON → CatraceHookData
- `runtime/pid-chain.mjs`：会话进程链捕获
- `runtime/permission.mjs`：权限审批 / elicitation
- `runtime/focus-windows.mjs`：前往会话窗口聚焦
- `runtime/hooks/`：各 Agent 的 hook 安装器
- `runtime/pi-config.mjs`：Pi 配置合并、备份、凭据及订阅
- `runtime/pi-package.mjs`：npm 可用性检测（仅 npm 安装，无备用下载）
- `runtime/pi-webhook.mjs`：共享 HTTP 服务的 `/pi` 路由处理、鉴权、请求限制与协议适配；不创建服务器
- `runtime/pi-navigation.mjs`：网页会话链接/终端 PID 校验
- `runtime/hook.cjs`：Agent 侧 hook 脚本
- `runtime/sound.mjs`：提示音模式解析
- `assets/agent-notify.wav`：内置提示音
