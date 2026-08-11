---
name: develop-catrace-plugin
description: >
  Develop a plugin in the catrace-plugin repository (catrace-plugin). Use when asked to
  create/add a new Catrace external plugin, implement a Toast card, settings panel,
  background scheduler, or Node sidecar in this repo, fix plugin contract bugs, or walk
  through the full plugin development flow. Repo-specific workflow on top of the public
  contract; real implementations live in this repo (timer/bt-music/sidecar-echo).
---

# Catrace 插件开发（catrace-plugin 仓库）

面向：在本仓库里新增/修改 Catrace 外部插件的开发者与 AI。宿主与插件契约细节以本仓库现有插件为第一参考（它们都是被宿主验证过的）。

**信任模型：启用插件 = 信任其全部本地代码（含 sidecar 子进程）。默认 `enabledByDefault: false`。**

---

## 0. 先读这些

动手前，至少扫一遍（作为范本）：

- `timer/` — background 调度 + settings CRUD + sticky 动作回传
- `bt-music/` — sidecar（OS 设备事件）+ settings 三卡 + `plugin.sidecar.request` RPC
- `sidecar-echo/` — sidecar JSONL 端到端最小闭环
- `github-notify/runtime/main.mjs` — sidecar config/state 落盘、shutdown、去重
- 本仓库 `develop.md`「契约速查」与「常见问题」；完整通用合同在宿主 `.agent/architecture/desktop-event-os/m10-external-plugins.md`

---

## 1. 收集需求 → 选架构

四问：触发条件？要自定义卡？要设置项？要本机进程？

| 需求 | 表面 | 本仓库例子 |
|------|------|-----------|
| 自定义 Toast 外观 | `main` → `ui.mjs` | 全部 |
| 定时 / 读活跃 / 纯 JS | `background.mjs` | `timer`, `notify-demo` |
| 开关 / 路径 / 表单 | `settings.mjs` + `plugin.config` | `timer`, `bt-music` |
| 蓝牙 / PnP / PowerShell / 起程序 / 本地 HTTP | `sidecar`（Node + JSONL） | `bt-music`, `smsforwarder-notify` |
| 只简单通知 | `plugin.notification` 或 publish，可不写 `main` | — |

合法组合：仅 ui；ui+settings；ui+background+settings；ui+sidecar+settings；background 与 sidecar 可共存。

> 业务能力写在插件里，不要要求宿主开专用 API。本机能力一律 sidecar。

## 2. 定 id 与目录

- id：kebab-case `[a-z0-9-]+`；**目录名 = `manifest.id`**。
- 保留 kind（禁用）：`rest` `water` `agent` `permission` `update` `rest-timer` `sdk`。
- 在 `catrace-plugin/` 根下新建 `<id>/` 目录。

## 3. 写 manifest.json（一次写全）

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "description": "一句话说明",
  "main": "ui.mjs",
  "background": "background.mjs",
  "settings": "settings.mjs",
  "events": ["my-plugin", "kind:my-plugin", "my-plugin.tick"],
  "enabledByDefault": false,
  "sidecar": { "command": "node", "args": ["runtime/main.mjs"], "cwd": "." }
}
```

- `events` 是 publish 白名单：把以后要发的 `eventType`、裸 `kind`、`kind:<id>` 都列全。漏了 → 不发 Toast。
- `sidecar.env` 可选；宿主最后注入 `CATRACE_PLUGIN_ID`、`CATRACE_PROTOCOL_VERSION=1`（覆盖同名）。
- 宿主不跑 `npm install`；`command:"node"` 要用户 PATH 有 Node。
- **文件必须是 UTF-8、合法 JSON**（宿主 `serde_json` 严格解析）。

## 4. 写各文件

注入：宿主加载前插 `const plugin = globalThis.__CATRACE_CREATE_PLUGIN_API__('<id>')` → 模块级直接用 `plugin`，禁止 import 宿主模块、禁止重新 create。

### ui.mjs

- 仅 `globalThis.__CATRACE_VUE__.h`（可加 `ref/computed/watch/markRaw/onMounted/onBeforeUnmount`）。
- props：`event`、`isHovered`；emits：`close`、`action`；`export default` 或 `export const Card`。
- `<style id="<前缀>-css">` 自插样式，class 带插件前缀；尺寸用 rem（1rem=16px，1px 边框/blur/SVG viewBox 例外）。
- 范本：`timer/ui.mjs`。

### settings.mjs

- Naive 白名单：`NAlert NButton NDivider NInput NModal NPopconfirm NProgress NRadioButton NRadioGroup NSelect NSlider NSpace NSwitch NTag NTooltip useDialog useMessage`。**无 `NInputNumber`** → `NInput` + `Number()` 钳制。
- `useMessage/useDialog` 必须在 `setup()` 内。
- 根节点**零外 padding / 零 max-width**（宿主 `.plugin-detail` 管边距）；内部间距可以有。
- 用户配置 `plugin.config.get/set`（整包）；需要 sidecar 同步时：`await plugin.config.set(cfg); await plugin.sidecar.request('setConfig', cfg)`（`bt-music/settings.mjs:194`）。
- 范本：`timer/settings.mjs`（内联编辑）、`bt-music/settings.mjs`（三卡）。

### background.mjs

- 注入同 ui；优先只用 `plugin.*`，少做 DOM。
- 调度：`setInterval` 或分钟对齐（`timer/background.mjs:417`）。
- 活跃门控：`plugin.activity.get()`；休息锚点：`plugin.activity.getLastRealRest()`。
- 配置 → `plugin.config`；上次触发/计数器 → `plugin.storage`（`timer/background.mjs:214`）。
- 按钮/关闭回传：`window.addEventListener('catrace:plugin-event-resolved', ...)` 读 `detail.actionId` / `detail.resolutionKind`（`timer/background.mjs:432`）。
- publish 必带 `dedupeKey`。

### runtime/main.mjs（sidecar）

JSONL v1：stdout 输出、stdin 读入，均为 UTF-8 JSON Lines，字段 `v:1`。

- Sidecar→宿主：`ready` · `publish` · `log` · `response` · `error`
- 宿主→Sidecar：`config` · `resolved` · `shutdown`（**必须结束进程**）· RPC（`requestId`+`method`+`params`）
- 每个 RPC 必回 `op:'response'` 且 `requestId` 一致；stderr 进宿主日志。
- 落盘状态写 `runtime/state.json`（已在 `.gitignore`，勿提交个人数据）。
- 范本：`github-notify/runtime/main.mjs`、`sidecar-echo/runtime/main.mjs`。

**publish 字段**：

```js
await plugin.events.publish({
  eventType: 'my-plugin.tick', // 白名单内
  kind: 'my-plugin',           // 白名单内，非保留
  title: '标题',
  body: '正文',
  level: 'info',               // info|warning|error|success
  sticky: false,               // true=不自动消失
  actions: [{ id: 'ack', label: '知道了' }],
  payload: { auto_hide_ms: 8000 },
  dedupeKey: 'my-plugin:tick',
})
```

**sticky 语义**：更新类动作（echo/再 publish 同 sticky）→ 保留卡片刷新；完成/关闭/dismiss → 卸卡，**禁止再发同 sticky**。

## 5. 验证（本地联动）

1. 语法：`node --check ui.mjs settings.mjs background.mjs runtime/main.mjs`
2. manifest 可解析：`node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"`
3. 宿主 dev 运行：`pnpm tauri dev`（debug 自动把 `<id>/` junction 到 `app_data/plugins/<id>`；新包需重启一次）
4. `Plugins` 页启用 → 触发场景 → 验 Toast/按钮/关闭/禁用退进程
5. 用 `node --check` 再验 settings 修改；确认日志不打印密钥

## 6. 自检清单

- [ ] `manifest.id` = 目录名 = `[a-z0-9-]+`
- [ ] `events` 覆盖所有 publish 的 type/kind；无保留 kind
- [ ] UTF-8、合法 JSON
- [ ] 仅白名单 Vue/Naive；无 `NInputNumber`；无 bare import；无模板 SFC
- [ ] settings 根无外 padding/max-width
- [ ] 配置走 `plugin.config`；运行时走 `plugin.storage`
- [ ] sidecar 处理 `shutdown`、回 `response`；sticky dismiss 不再 publish
- [ ] `enabledByDefault: false`；README 写明启用即信任
- [ ] 未提交 `runtime/state.json`

## 7. 提交

1. 递增 `manifest.version`。
2. 要随宿主 release 打包 → 宿主 `tauri.conf.json` `bundle.resources` 补一行（当前只打 `timer`/`bt-music`/`sidecar-echo`）。
3. commit 推本仓库 `main`；宿主 `git add tools/plugin-demo` 更新 submodule 指针。
4. 更新 `README.md` 插件列表与 `develop.md` 插件索引。

---

## 反模式

- 用 `NInputNumber` 或白名单外组件
- settings 根写大 padding / max-width（双倍缩进）
- `import 'vue'` / `import 'naive-ui'` / 模板 SFC
- publish 不落白名单 / 不带 dedupeKey
- dismiss 后仍 publish 同 sticky
- sidecar 不处理 `shutdown`（禁用后进程残留）
- 把「配对」当「已连接」（蓝牙）
- 把个人路径 / 密钥写进插件或文档
