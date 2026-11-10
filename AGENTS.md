# catrace-plugin — Agent Guide

每个插件一个目录，React 卡片和设置、自包含 ESM、Node sidecar 与插件知识均在本仓库维护。

## 开发入口

- 修改插件前读 [develop.md](develop.md) 的 React / Blob、配置、事件与 sidecar 合同；AI 操作流程见 [SKILL.md](SKILL.md)。
- UI 使用宿主同一个 React 实例，普通配置保存不覆盖主开关；不要向宿主添加插件专用业务 API。
- 不修改用户 AppData 内已安装的插件来替代源码测试；不自动启动开发服务或做界面验证。

## 知识沉淀

- 插件相关知识写本仓库 `.agent/features/<插件id>/`，入口为 README；增删时同步 [.agent/manifest.yaml](.agent/manifest.yaml)。
- 宿主多模块协作知识放 Catrace 主仓 `.agent/`；文档写现行行为，直接删除失效机制说明。

## 提交约定

- PR 标题和描述使用中文。
- 改动先留工作区，用户明确要求提交或 push 后才执行；按功能合并同类修改。
- 修改插件时更新 `manifest.version` 为当天 `YYYY.MM.DD`，同日多次发布增加第四段；UI 清单标记 `uiFramework: "react"`。
- 宿主与插件分别在各自仓库提交；发布后由插件中心按固定仓库 commit 安装。
