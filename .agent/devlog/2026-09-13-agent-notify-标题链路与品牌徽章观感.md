# 2026-09-13 agent-notify 标题链路与品牌徽章观感

## 会话目标

修掉卡片三处「怪」：标题解析从未成功过（che/che、Catrace/Catrace 复读）、agent 徽章像 placeholder、body markdown 裸奔。

## 完成项

- 标题链路重写：`session_title`(pinned) > 缓存 > UserPromptSubmit 首条 prompt 填空 > 项目名兜底；`titleFromTranscript`/`titleReadAttempts` 整段删除；chip 去重、body 防复读（3b0c8fe）
- Toast 观感：呼吸点移除（权限卡保留）、agent 徽章 2rem 圆角方块 + 品牌图标（simple-icons SVG × 4 + ZCode 桌面真图标 PNG data URL）、body 首段 + stripMarkdown、徽章与标题垂直居中（4e0aa72、e5617ec）
- 宿主 submodule 指针同步：bbaa3fd → 03d5f51 → caabd8b（全部未 push）
- Claude Code hook 官方文档关键事实核查：session_title 时机、async 输出限制、HTTP hook 失败噪声、transcript 滞后警告、SessionEnd 定位 → 结论「只读不回写」

## 待开发

- **并行会话冲突待确认**：另一会话记忆称「prompt 当标题被用户否决、已移除」，与本仓库已提交代码不符；动标题前先问用户
- SessionEnd 自动清理 sticky 卡（仅 Claude，ZCode 事件支持未验证）
- SessionStart body 带 model/source
- 调试「常用」视图字段重排（低优先级）

## 关键文件变更

| 文件 | 变更 |
|------|------|
| `agent-notify/runtime/main.mjs` | deriveSessionTitle 重写、删 transcript 分支、body 防复读 |
| `agent-notify/ui.mjs` | AGENT_BADGES 品牌图标、chip 去重、bodyPreview/stripMarkdown、呼吸点移除 |
| `.gitignore` | `**/runtime/cache/` 入 ignore |

## 经验

- 多个 agent 会话并行改同一插件时，记忆可能记录彼此冲突的「最新决定」——一切先 grep/git 核实工作区，再问用户。
- 图标类资产的最省路线：simple-icons 内联 path > 官方 favicon/logo > 从安装目录提取（CLI agent 根本没有 exe 图标可提取）。
- 插件相关的知识写本仓库 `.agent/`，主仓 `.agent/` 只留宿主侧知识。
