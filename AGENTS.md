# catrace-plugin — Agent Guide

- 插件源码、开发约定与 AI 操作流程以 [SKILL.md](SKILL.md) 为准；开始任务先读取它，并遵守其中的最小改动、验证及提交授权要求。AI agent 从此文件发现并引入 `SKILL.md`。
- 本仓库通用规范只保留 AGENTS.md 与 SKILL.md；开发约定统一维护于 SKILL.md，禁止另建重复的通用指南。
- 插件功能知识按需读取 `.agent/features/<插件id>/` 对应 README；修改既有行为时再查该功能的专项说明。
- 不修改用户 AppData 内已安装的插件来替代源码测试；不自动启动开发服务或做界面验证。
- PR 标题和描述使用中文。修改先留工作区；用户明确要求提交或 push 后才执行。宿主与插件分别在各自仓库提交。
- 修改插件时更新 `manifest.version` 为当天 `YY.M.D`（如 `26.11.9`，不补零；同日多次发布增加第四段）；React UI 清单标记 `uiFramework: "react"`。
- 知识沉淀在本仓库 `.agent/features/<插件id>/`，增删时同步 `.agent/manifest.yaml`；宿主多模块协作知识放 Catrace 主仓 `.agent/`。文档记录现行行为，直接删除失效机制说明。
- 发布后由插件中心按固定仓库 commit 安装。
