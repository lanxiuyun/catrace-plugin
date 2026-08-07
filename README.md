# catrace-plugin

Catrace 外部插件仓库。作为 git submodule 挂在宿主仓库 `Catrace/tools/plugin-demo/`，插件代码只在这里维护。

- 宿主仓库：https://github.com/lanxiuyun/Catrace
- 挂载点：`tools/plugin-demo/`（submodule 指针锁版本）
- debug 构建：宿主启动时自动把本仓库各包 junction 到 `app_data/plugins/<id>`（须含 `manifest.json`）
- release 构建：宿主 `tauri.conf.json` 的 `bundle.resources` 只打包 `timer` / `bt-music` / `sidecar-echo`

## 插件索引

| 包 | 角色 | 参考价值 |
|----|------|----------|
| `bt-music/` | 蓝牙耳机连接 Toast → 打开音乐程序（OS 设备变更事件） | sidecar + settings 三卡 UI + RPC 的范本 |
| `github-notify/` | 轮询 GitHub Notifications（Node sidecar） | sidecar 轮询 + 去重状态落盘 |
| `linuxdo-notify/` | 轮询 linux.do 通知（Node sidecar） | 同 github-notify |
| `notify-demo/` | 按间隔弹 Toast 的极简 demo | 最小 background 插件 |
| `sidecar-echo/` | 完整 sidecar demo：生命周期、JSONL publish/log、自定义 Toast UI、action round-trip | sidecar 协议端到端最小闭环 |
| `smsforwarder-notify/` | 接收 Android SmsForwarder Webhook 转发到 Toast（Node sidecar） | sidecar 起本地 HTTP 服务 |
| `timer/` | 第一方**定时提醒**（settings + scheduling） | background 调度 + 规则 CRUD + sticky 动作回传的范本 |

## 包结构约定

每个插件是一个独立目录，须含 `manifest.json`，否则宿主不会加载。

```
<plugin-id>/
  manifest.json     # id / name / version / main / background / settings / events / sidecar
  ui.mjs            # Toast 卡片（纯 Vue render）
  settings.mjs      # 设置面板（根节点只出业务样式，外距归宿主）
  background.mjs    # 后台调度（可选）
  runtime/main.mjs  # Node sidecar（可选）
```

- `manifest.json` 必须为 **UTF-8** 编码、合法 JSON（宿主用 `serde_json` 严格解析，GBK 会加载失败）。
- 运行时产物一律写 `runtime/state.json` 之类，已 `.gitignore`，不要提交个人数据。

---

# 开发插件：完整流程

## 0. 需求与架构决策

先把需求拆成四问，答案决定用哪些文件（参考 `timer` / `bt-music` / `sidecar-echo`）：

| 需求 | 用什么 | 例子 |
|------|--------|------|
| 自定义 Toast 外观 | `main` → `ui.mjs` | 所有插件的卡 |
| 定时 / 读活跃状态 / 纯 JS 编排 | `background.mjs` | `timer`、`notify-demo` |
| 开关 / 路径 / 表单 | `settings.mjs` + `plugin.config` | `timer` 规则 CRUD、`bt-music` 三卡 |
| 蓝牙 / PowerShell / 启动本机程序 / 本地 HTTP | `sidecar`（Node + JSONL） | `bt-music`、`github-notify`、`smsforwarder-notify` |
| 只要简单通知 | `plugin.notification` 或直接 publish，可不写 `main` | — |

合法组合：仅 ui；ui+settings；ui+background+settings；ui+sidecar+settings；background 与 sidecar 可共存。

> 原则：**业务能力写在插件里，不要指望宿主开专用 API**。本机能力一律走 sidecar。

## 1. 定 id 并写 manifest

- id 用 kebab-case：`[a-z0-9-]+`，**目录名 = `manifest.id`**。
- 不要占用宿主保留 kind：`rest` · `water` · `agent` · `permission` · `update` · `rest-timer` · `sdk`。
- **一次把 `events` 写全**（后面 publish 的白名单就在这，漏了直接不发）：

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "description": "一句话说明",
  "main": "ui.mjs",
  "background": "background.mjs",
  "settings": "settings.mjs",
  "events": ["my-plugin", "kind:my-plugin", "my-plugin.tick", "my-plugin.connected"],
  "enabledByDefault": false,
  "sidecar": { "command": "node", "args": ["runtime/main.mjs"], "cwd": "." }
}
```

- `sidecar.env` 可选；宿主会**最后**注入 `CATRACE_PLUGIN_ID` 与 `CATRACE_PROTOCOL_VERSION=1`（覆盖同名）。
- 宿主**不会**执行 `npm install`；`command: "node"` 要求用户机器 PATH 里有 Node。

## 2. 各文件按合同写

宿主加载前注入 `const plugin = globalThis.__CATRACE_CREATE_PLUGIN_API__('<id>')`，脚本**直接用模块级 `plugin`**，不要 import 宿主模块。

### ui.mjs — Toast 卡

- 只用 `globalThis.__CATRACE_VUE__.h`；props `event` / `isHovered`；emits `close` / `action`；`export default`。
- 样式：注入 `<style id="插件前缀-…">`，class 带插件前缀防冲突；尺寸用 **rem**（1px 边框/blur/SVG viewBox 例外）。
- 参考 `timer/ui.mjs`（进度条 + 按钮）与 `bt-music/ui.mjs`（紧凑卡）。

### settings.mjs — 设置面板

- 只用白名单 Naive 组件：`NAlert NButton NDivider NInput NModal NPopconfirm NProgress NRadioButton NRadioGroup NSelect NSlider NSpace NSwitch NTag NTooltip useDialog useMessage`。**没有 `NInputNumber`**，数字用 `NInput` + `Number(...)` 钳制。
- 根节点**不要**写外层 `padding` / `max-width`（宿主 `.plugin-detail` 已负责，会双倍缩进）；内部小组件间距可以有。
- 用户配置走 `plugin.config`（整包）；侧配置同时推 sidecar：`plugin.config.set` 后 `plugin.sidecar.request('setConfig', cfg)`（见 `bt-music/settings.mjs:194`）。
- `useMessage` / `useDialog` 必须在 `setup()` 内调用。

### background.mjs — 后台

- 典型：`setInterval` 或分钟对齐循环 + `plugin.activity.get()` + `plugin.events.publish()`。
- **配置 vs 运行时**：用户可改的 → `plugin.config`；上次触发/计数器 → `plugin.storage`（按 key）。
- 用户点了 Toast 按钮/关闭：监听 `window.addEventListener('catrace:plugin-event-resolved', ...)` 处理 `detail.actionId` / `detail.resolutionKind`（见 `timer/background.mjs:432`）。
- publish 必须带合理 `dedupeKey`（见下）。

### runtime/main.mjs — Node sidecar

协议：**stdin/stdout UTF-8 JSON Lines**，字段 `v: 1`。

- Sidecar → 宿主（stdout）：`ready` · `publish` · `log` · `response` · `error`
- 宿主 → Sidecar（stdin）：`config`（启动/配置变更）· `resolved`（Toast 用户操作）· `shutdown`（禁用/退出，**必须结束进程**）· 带 `requestId`+`method` 的 RPC
- 每个 RPC 必须 `op: 'response'` 且 `requestId` 一致；stderr 会进宿主日志。
- 参考 `github-notify/runtime/main.mjs`（config/state 落盘、shutdown、RPC）与 `sidecar-echo/runtime/main.mjs`（端到端闭环）。

**publish 字段**：

```js
await plugin.events.publish({
  eventType: 'my-plugin.tick', // 必须在 events 白名单
  kind: 'my-plugin',           // 同上，不用保留 kind
  title: '标题',
  body: '正文',
  level: 'info',               // info | warning | error | success
  sticky: false,               // true = 不自动消失，靠按钮/关闭
  actions: [{ id: 'ack', label: '知道了' }],
  payload: { auto_hide_ms: 8000 },
  dedupeKey: 'my-plugin:tick', // 防刷屏，相同 key 合并/限流
})
```

**sticky 语义（必读）**：

| 用户操作 | 卡片应 |
|----------|--------|
| 更新类（echo / 再 publish 同 sticky） | **保留**卡片，可刷新内容 |
| 完成 / 关闭 / dismiss | **卸掉**，禁止再发同 sticky |

## 3. 本地测试循环

1. 确认宿主 dev 在跑：`pnpm tauri dev`（插件目录靠 junction 自动同步，改完即生效；新包需重启 dev）。
2. `Plugins` 页 → **启用**目标插件（启用 = 信任全部本地代码含 sidecar）。
3. 触发场景验证 Toast；点按钮/关闭验证回传；禁用验证进程退出。
4. JS 语法校验：`node --check ui.mjs settings.mjs background.mjs runtime/main.mjs`。

## 4. 自检清单

- [ ] `manifest.id` = 目录名 = `[a-z0-9-]+`；`events` 覆盖所有 publish 的 type/kind；无保留 kind
- [ ] manifest 是合法 UTF-8 JSON（`node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"`）
- [ ] ui/settings 只用白名单 Vue/Naive；无 `NInputNumber`；无 bare `import 'vue'/'naive-ui'`；无模板 SFC
- [ ] settings 根无外层 padding / max-width
- [ ] 配置走 `plugin.config`，运行时走 `plugin.storage`
- [ ] sidecar 处理 `shutdown`；每个 RPC 都回 `response`；sticky dismiss 不再 publish
- [ ] 不打印密钥日志；不提交 `runtime/state.json`
- [ ] `enabledByDefault` 保持 `false`

## 5. 提交与发布

1. 改版本号：`manifest.version` 递增（语义化版本）。
2. 要随宿主 release 打包的，去宿主 `tauri.conf.json` 的 `bundle.resources` 补一行（当前只打 `timer` / `bt-music` / `sidecar-echo`）。
3. commit 推本仓库 `main`；宿主仓库 `git add tools/plugin-demo` 更新 submodule 指针。
4. 更新本 README 插件索引。

---

# 契约速查（红线）

| 主题 | 规则 |
|------|------|
| 注入 | 直接用 `plugin`；Vue 取 `globalThis.__CATRACE_VUE__`；Naive 取 `globalThis.__CATRACE_NAIVE__` |
| 组件 | 仅白名单；**无 `NInputNumber`**；`useMessage/useDialog` 在 `setup()` 内 |
| 尺寸 | rem（1rem=16px）；1px 边框 / blur / SVG viewBox 例外 |
| 布局 | settings 根不外 padding / max-width |
| 数据 | 用户配置 → `plugin.config`；运行时 → `plugin.storage` |
| 事件 | publish 的 type/kind 必须落 `events` 白名单；带 `dedupeKey` |
| sidecar | JSONL v1；必须处理 `shutdown`；RPC 必回 `response` |
| 信任 | `enabledByDefault: false`；README 写明启用即信任 |
| 编码 | 所有文件 UTF-8；manifest 严格 JSON |

# 常见问题

| 现象 | 常见原因 | 处理 |
|------|----------|------|
| 组件 undefined / Invalid vnode | 用了白名单外组件（如 `NInputNumber`） | 改 `NInput` + `Number` 钳制 |
| 设置页左右空白过大 | 根节点写了 padding/max-width | 删掉 |
| 没有 Toast | 未启用；events 漏白名单 | 启用并补 `events` |
| 连点刷屏 | 无 `dedupeKey` | 加 key、限流 |
| sticky 关不掉 | dismiss 后仍 publish | dismiss 禁止再发 |
| sidecar 无响应 | 无 Node / PATH；RPC 未回 `response` | 查进程与协议 |
| 模块加载失败 | bare import | 只用全局注入 |

> 更完整的通用合同见宿主 `.agent/architecture/desktop-event-os/m10-external-plugins.md`。AI 开发可加载本仓库根目录 skill：`SKILL.md`。
