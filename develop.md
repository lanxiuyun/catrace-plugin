# 开发 Catrace 插件

插件源码和业务知识在本仓库维护；宿主提供 React 运行时、插件 API、事件、窗口与 sidecar 生命周期。用户通过插件中心从仓库固定 commit 安装到应用数据目录，安装默认停用，启用即信任本地代码。

## 1. 选择运行入口

| 需求 | 入口 | 示例 |
|---|---|---|
| 自定义 Toast 卡片 | `main` → `ui.mjs`，导出 React 函数组件 | timer、agent-notify |
| 设置面板 | `settings` → `settings.mjs`，导出 React 函数组件 | heatmap、wecom-todo |
| 本机进程、系统监听、HTTP 服务 | `sidecar` → `runtime/main.mjs` | bt-music、smsforwarder-notify |
| 需要页面环境的后台调度 | `background` → 普通 ESM 副作用 | timer、notify-demo |

后台逻辑优先放 sidecar；background 为每个启用插件创建独立隐藏 WebView。不要向宿主添加插件专用业务 API。

## 2. 插件包

```text
<plugin-id>/
  manifest.json
  ui.mjs
  settings.mjs
  background.mjs       # 可选
  runtime/main.mjs     # 可选
  assets/
```

目录名等于 `manifest.id`，使用 `[a-z0-9-]+`。所有文件使用 UTF-8，清单为严格 JSON。

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "2026.11.09",
  "description": "一句话说明",
  "uiFramework": "react",
  "main": "ui.mjs",
  "settings": "settings.mjs",
  "events": ["my-plugin", "kind:my-plugin", "my-plugin.tick"],
  "enabledByDefault": false,
  "sidecar": { "command": "node", "args": ["runtime/main.mjs"], "cwd": "." }
}
```

只声明实际存在的入口。保留 kind：`rest`、`agent`、`permission`、`update`、`rest-timer`、`sdk`。`events` 覆盖发布的 type / kind。插件改动时将版本改为当天 `YYYY.MM.DD`，同日多次发布使用第四段递增。

宿主不执行 npm install；发布包要包含运行必需文件，不能依赖源码仓库之外的本地路径。Node 命令解析优先使用系统安装，其次托管便携目录。

## 3. React UI 合同

宿主加载模块前注入按插件 id 绑定的 `plugin`。模块使用宿主的同一个 React 实例和 HeroUI 组件库（设置页控件统一 HeroUI，规范见 [HeroUI 设置页约定](.agent/features/shared-ui/hero-ui-settings.md)）：

```js
const { createElement: h, useState } = globalThis.__CATRACE_REACT__
const { Button, Input } = globalThis.__CATRACE_HEROUI__

export default function Settings() {
  const [token,setToken] = useState('')
  return h('section',{className:'my-plugin-card'},
    h(Input,{variant:'secondary',value:token,onChange:event => setToken(event.target.value),'aria-label':'Token'}),
    h(Button,{size:'sm',variant:'primary',onClick:() => save(token)},'保存'))
}
```

- Card 导出 `default` / `Card` / `card`；设置面板导出 `default` / `Settings` / `settings`，使用普通 React 函数组件与 hooks。
- `__CATRACE_REACT__` 是 React 命名空间；`__CATRACE_HEROUI__` 是 HeroUI v3 命名空间，组件样式与深浅色由宿主页面提供，插件不用自带控件皮肤。用扁平导出（`SwitchRoot` / `SwitchContent` / `SelectRoot` / `SelectTrigger` …），不用 `Switch.Content` 这类复合静态属性。
- `__CATRACE_RADIX__` 是 Radix Themes 命名空间，只为尚未迁移的旧卡片 / 旧设置页保留；新代码不要再用。宿主没有 `__CATRACE_HEROUI__` 时设置页应显式抛错，不要静默退回原生控件。
- Card props 为 `event`、`isHovered`、`remainingMs`、`totalMs`，动作通过 `onClose()` / `onAction(actionId)` 回调。业务动作在后台 / sidecar 中处理。
- Blob 模块必须自包含：不能 bare import 包，也不能相对 import 兄弟文件。需要拆分源码时，先构建为单文件 ESM，再交付清单入口。
- effects 清理监听、计时器、观察器和请求；异步返回检查卸载 / 请求世代，不覆盖新的会话或表单草稿。
- 用户配置自动保存要有顺序与失败反馈，离开面板时处理待保存修改。普通业务保存**省略顶层 `enabled`**，主开关只走 `plugin.setEnabled()`，避免待保存快照在停用后重新启用插件。

## 4. 布局与状态

- settings 根只提供业务内容，页面边距、最大宽度、详情导航和主开关由宿主管理。
- 控件统一 HeroUI：输入 / 多行输入 / 下拉默认 `variant="secondary"`，按钮 `size="sm"`（主操作 `primary`、次操作 `secondary` / `tertiary`、危险 `danger-soft`），开关 / 复选框用 `isSelected` + `onChange`，分段选择用 `ToggleButtonGroup` + `ToggleButton`。详见 [HeroUI 设置页约定](.agent/features/shared-ui/hero-ui-settings.md)。
- 不要用 Tailwind utility class（`flex` / `gap-2` / `w-full` 等）：宿主的 Tailwind 只扫描宿主源码，插件里写的工具类不会生成。
- 不要用 `.card` / `.badge` / `.header` / `.progress-bar` 这类 HeroUI 全局裸类名贴在原生 div 上；插件自有 class 一律加插件前缀。
- class / style id 使用插件前缀；尺寸用 rem（1px 边框、blur、SVG viewBox 除外）。样式注入要支持同 document 的内容更新。
- 使用 `--ct-*` 主题 token；数据中的颜色值、文件路径、正则不能当 CSS 变量处理。
- 自动隐藏进度条使用 CSS animation + `--toast-auto-hide-ms`，hover 与宿主暂停状态同源，恢复不重写 totalMs。
- 表单使用 React 受控值和原生 `onChange` / Radix `onValueChange` 等回调；动态列表使用稳定业务 key。

## 5. 插件 API 与配置同步

| 能力 | API |
|---|---|
| 可移植用户配置 | `plugin.config.get()` / `set(object)` |
| 持久化运行数据 | `plugin.storage.get/set/remove(key)` |
| 启停当前插件 | `plugin.setEnabled(boolean)` |
| 活动与休息记录 | `plugin.activity.get/getLastRealRest/getRecords` |
| 发布 / 关闭事件 | `plugin.events.publish/close` |
| 文件、音频、剪贴板、系统原语 | `plugin.dialog` / `audio` / `clipboard` / `shell` / `path` 等 |
| 自定义 sidecar RPC | `plugin.sidecar.request(method, params)` |
| 语言 | `plugin.i18n.getLocale()` |

配置写入后，如需立即推送 sidecar，显式调用该插件已有的配置 RPC。宿主会发送 `catrace:plugin-config-changed`；设置面板监听同名 DOM CustomEvent，并按 `detail.pluginId` 过滤。刷新外部写入时保留尚未保存的本地草稿。

后台 WebView 的 `catrace:plugin-event-resolved` DOM 事件带 `actionId`、`resolutionKind` 和 payload；background 作为普通 ESM 执行副作用。宿主销毁窗口时回收页面资源。

## 6. Sidecar JSONL

stdin/stdout 为 UTF-8 JSON Lines，协议 `v: 1`。stdout 仅用于协议，调试写 stderr 或 `log`。

- Sidecar → Host：`ready`、`publish`、`resolve`、`log`、`response`；带 requestId 的能力请求包括 `storage.get/set`、`activity.get`、`clipboard.write_text`、`shell.open_url`、`config.get/set`。
- Host → Sidecar：启动时已有配置的 `config`、卡片处理结果 `resolved`、RPC `request`、能力 `response` 和 `shutdown`。
- RPC 回应须匹配 requestId；处理 shutdown 并退出。普通配置写入不会自动向 stdin 再发 config，需要主动读取或自定义 RPC 同步。
- 事件与存储按插件身份隔离，不能通过消息自报另一个 pluginId。

## 7. 验证与交付

1. 检查清单 JSON、入口存在、ESM 语法以及 React 导出合同。
2. 跑插件自己的 Node 单元测试，验证配置全键、RPC、事件动作和卸载清理，不访问用户数据或密钥。
3. 宿主提供可选源码包测试，指定插件仓库路径后验证全部 Card / settings 的真实 React 渲染与回调。
4. 实机界面验证仅在用户要求时进行，连接已运行的宿主；不要自动启动 dev server，也不要修改用户已安装的插件目录冒充源码测试。
5. 文档更新为现行行为。修改留工作区；用户明确要求提交 / push 后，才在本仓库按功能执行。宿主和插件仓库分别提交。

发布后，用户通过插件中心选择已发布仓库快照安装；本地源码改动不会自动影响应用数据目录中的已安装插件。
