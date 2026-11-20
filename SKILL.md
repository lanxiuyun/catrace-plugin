---
name: develop-catrace-plugin
description: >
  Develop or review Catrace external plugins: React Toast cards and settings,
  background modules, sidecar RPC, configuration, event actions and packaging.
  Use for plugin implementation, runtime contract bugs, testing or release guidance
  in the catrace-plugin repository.
---

# Catrace 插件开发

## 操作顺序

1. 读 [AGENTS.md](AGENTS.md)，确认本次插件目录与已有工作区改动；插件源码、知识与提交留在本仓库。本文件是唯一的通用插件开发规范，不再另维护 develop 指南或共享 UI 规范副本。
2. 按目标入口处理 React 卡片 / 设置、background 或 sidecar。清单只声明实际入口，业务能力优先在插件实现。
3. 先读目标插件现有实现、清单和 `.agent/features/<id>/`；修改保持配置字段、动作 id、RPC 与持久化数据合同。按功能做最小改动。
4. 按「React UI 与设置页」执行 React / HeroUI 合同。Blob 入口必须单文件自包含；Card 动作为 `onClose` / `onAction`。
5. effects 清理所有监听 / 定时器；异步操作检查当前请求与卸载状态。普通配置保存不写顶层 enabled，启停走 `plugin.setEnabled`。
6. 按「验证与交付」完成清单 JSON、入口、语法、React 导出与目标插件 Node 回归。
7. 更新本插件现行知识，确认差异中无个人路径、密钥、运行数据和未要求的后台业务改动。实机验证、提交、push 均按用户授权执行。

## React UI 与设置页

- UI 导出真正 React 函数组件，使用宿主注入的 `__CATRACE_REACT__`、`__CATRACE_HEROUI__` 与插件 `plugin`。设置页控件统一使用 HeroUI 扁平导出；`__CATRACE_RADIX__` 只留给尚未迁移的旧 UI。宿主运行时缺失时显式抛错，不静默退回原生控件。
- `__CATRACE_REACT__` 是宿主唯一 React 实例；`__CATRACE_HEROUI__` 提供宿主 HeroUI 组件，样式由宿主加载。不得在插件模块中单独安装或导入这些宿主依赖。
- Input / TextArea / NumberField / Select 沿用 HeroUI 当前默认外观，**不要显式覆写 `variant`**。这条只在本节维护，避免重复口径。
- 按钮默认 `size="sm"`。`primary` 只给保存 / 提交类主操作；`secondary` 给改变状态或数据的动作；`tertiary` 给预览、查看、刷新、复制等辅助动作；破坏性动作使用 `danger-soft`，确认弹窗最终确认使用 `danger`。状态标签优先用 `Chip`。
- 表单控件使用受控值与对应回调；独立 Input 用原生 `disabled`，Button / NumberField / Slider 等按 HeroUI 合同用 `isDisabled`。`SettingsCardRow.title` 不自动关联控件；Slider、NumberField、独立 Input、ToggleButtonGroup 要提供 `aria-label` 或 `aria-labelledby`。
- 简单设置页使用宿主注入的 `__CATRACE_SETTINGS_UI__`：`SettingsCard` props 为 `title`、可选 `description`、`children`；`SettingsCardRow` props 为 `title`、可选 `description`、`control`、可选 `stack` 与 `children`。标题置左，控件置右；宿主管卡片、行与分隔线样式。只在连续 Row 之间由宿主加 Separator；备注、预览按钮等原生内容不必包成 Row。直接放 Card 的按钮组沿用默认内容间距，不额外加行内 padding。要求最新版宿主，缺失共享组件时显式报错。
- Toast 使用注入的 `Toast` / `ToastQueue` 与 `Toast.Provider`；仅在操作结果有确认价值或发生错误时反馈，预览成功不重复提示。按产品需要设置 placement；不要用内嵌 Alert 代替短暂反馈，也不要自绘 Toast。宿主 Toast 合同缺失时显式报错。
- 不用 Tailwind utility class；宿主构建不会扫描插件源码。不要在原生节点使用 `.card` / `.badge` 等 HeroUI 全局裸类名；自有样式类加插件前缀，尺寸用 rem、颜色用 `--ct-*` token，不覆写 HeroUI `--field-*`。
- settings 根不重复宿主提供的页面边距。卡片标题、说明与背景交给共享组件；仅保留必要的业务局部样式。
- Blob 模块必须自包含，不能 bare import 包或相对 import 兄弟文件；需要拆分源码时先构建单文件 ESM，再交付清单入口。
- Card 导出 `default` / `Card` / `card`；设置面板导出 `default` / `Settings` / `settings`。Card props 为 `event`、`isHovered`、`remainingMs`、`totalMs`；动作通过 `onClose()` / `onAction(actionId)` 回调。
- `manifest.json` 只声明实际存在的入口；目录名等于 `manifest.id`，id 使用 `[a-z0-9-]+`，清单必须是严格 JSON。清单 `events` 覆盖插件发布的 type / kind；保留 kind：`rest`、`agent`、`permission`、`update`、`rest-timer`、`sdk`。宿主不执行 npm install，发布包必须包含运行所需文件且不能依赖仓库外本地路径。
- 插件修改时更新 `manifest.version` 为当天 `YY.M.D`（不补零），同日多次发布增加第四段；React UI 清单标记 `uiFramework: "react"`。
- 通过 `plugin.events.publish/close` 发布 / 关闭事件；设置面板监听 `catrace:plugin-config-changed` 时按 `detail.pluginId` 过滤，并在刷新外部配置时保留未保存草稿。background 收到 `catrace:plugin-event-resolved` 时处理 `actionId`、`resolutionKind` 与 payload。插件事件与存储按插件身份隔离，不能通过消息自报其他 pluginId。
- sidecar 能力使用宿主提供的 `plugin.dialog`、`audio`、`clipboard`、`shell`、`path` 等 API；语言读取 `plugin.i18n.getLocale()`。

## 验证与交付

1. 检查 manifest JSON、入口存在、ESM 语法及 React 导出合同。
2. 跑目标插件 Node 测试，覆盖配置全键、RPC、事件动作与卸载清理；不要访问用户数据或密钥。
3. 有宿主真实渲染合同测试时，按其说明验证 Card / settings 渲染与回调；SSR 结果不代表完整挂载行为。
4. 实机界面验证仅在用户要求时进行，并连接已运行宿主；不要自动启动 dev server，也不要修改用户已安装插件目录冒充源码测试。
5. 文档只记录现行行为；提交与 push 仅在用户明确授权后进行，宿主与插件仓库分开处理。

## 按任务查阅

- 可用插件与用户操作：[README.md](README.md)。
- Agent 状态、审批、Hook、会话聚焦：[Agent 通知知识](.agent/features/agent-notify/README.md)。
- DSH 状态卡、iframe、会话日志与外观：[DSH 小窗知识](.agent/features/dsh-chat/README.md)。
- 宿主窗口、安装和权限边界：Catrace 主仓的 `.agent/architecture/desktop-event-os/`。

## 必须保持

- 插件安装默认停用；启用即信任该目录的本地代码。不触碰用户已安装的应用数据目录。
