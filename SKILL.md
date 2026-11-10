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

1. 读 [AGENTS.md](AGENTS.md)，确认本次插件目录与已有工作区改动；插件源码、知识与提交留在本仓库。
2. 读 [develop.md](develop.md) 对应入口分支：React 卡片 / 设置、background 或 sidecar。清单只声明实际入口，业务能力优先在插件实现。
3. 先读目标插件现有实现、清单和 `.agent/features/<id>/`；修改保持配置字段、动作 id、RPC 与持久化数据合同。按功能做最小改动。
4. UI 导出真正 React 函数组件，使用宿主 `__CATRACE_REACT__` / `__CATRACE_RADIX__` 与注入的 `plugin`。Blob 入口必须单文件自包含；Card 动作为 `onClose` / `onAction`。
5. effects 清理所有监听 / 定时器；异步操作检查当前请求与卸载状态。普通配置保存不写顶层 enabled，启停走 `plugin.setEnabled`。
6. 插件版本使用改动当天 `YYYY.MM.DD`，同日再次发布增加第四段。自检清单 JSON、入口、语法与 React 导出，再跑目标插件 Node 回归。
7. 更新本插件现行知识，确认差异中无个人路径、密钥、运行数据和未要求的后台业务改动。实机验证、提交、push 均按用户授权执行。

## 按任务查阅

- 插件入口、React / Blob 合同、配置与 sidecar 协议：[develop.md](develop.md)。
- 可用插件与用户操作：[README.md](README.md)。
- Agent 状态、审批、Hook、会话聚焦：[Agent 通知知识](.agent/features/agent-notify/README.md)。
- DSH 状态卡、iframe、会话日志与外观：[DSH 小窗知识](.agent/features/dsh-chat/README.md)。
- 宿主窗口、安装和权限边界：Catrace 主仓的 `.agent/architecture/desktop-event-os/`。

## 必须保持

- 安装默认停用，启用即信任本地代码；不触碰用户已安装的应用数据目录。
- 用户配置走 plugin.config，机器运行数据走 plugin.storage；sidecar 必须处理 shutdown 并匹配 RPC requestId。
- Toast 自动隐藏进度与 hover 使用宿主同一时间源；关闭 / dismiss 后不要重新发布同一 sticky 事件。
- 样式有插件前缀，settings 根不重复宿主边距，尺寸使用 rem。
