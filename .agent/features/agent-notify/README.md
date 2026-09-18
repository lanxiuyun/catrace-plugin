# Agent 通知插件（agent-notify）

接收 AI agent（Claude Code / Codex / ZCode / Gemini / Kimi）hook 推送的状态事件，经本地 HTTP(23456) 归一化后按事件策略弹 Catrace toast 卡；Claude/ZCode 的 **PermissionRequest** 走阻塞 `/permission`。普通工具是允许/拒绝；`AskUserQuestion` 必须收集答案后带 `updatedInput` 回包，对照 clawd 的两条路见子文档。

## 涉及文件

- `agent-notify/runtime/main.mjs` — sidecar：HTTP `/state` `/permission` `/focus` `/permission-decide`、归一化、标题缓存、sticky
- `agent-notify/runtime/preview-cards.mjs` — 设置页调试卡片 fixture，不要堆回 main
- `agent-notify/runtime/hook.cjs` — hook 脚本：stdin、事件别名、转发 `/state` 或阻塞 `/permission`
- `agent-notify/runtime/hooks.mjs` — 五家 agent 安装/卸载/检测
- `agent-notify/ui.mjs` — 会话卡与权限/问答卡
- `agent-notify/settings.mjs` — 安装、事件策略、底部「调试卡片」
- 协议与字段差异的完整说明：[../agent-notify/AGENT_HOOK_EVENTS.md](../../agent-notify/AGENT_HOOK_EVENTS.md)、[../agent-notify/HOOK_DATA_NORMALIZATION.md](../../agent-notify/HOOK_DATA_NORMALIZATION.md)

宿主侧（junction 挂载、插件目录约定、toast 窗口机制）见 Catrace 主仓 `.agent/`（features/agent-notification、architecture/desktop-event-os）。

## 子文档

- [会话标题-三级来源与为什么不读transcript不回写.md](会话标题-三级来源与为什么不读transcript不回写.md) — **标题策略与只读不回写的取舍**
- [toast卡观感-agent徽章品牌图标与body展开滚动.md](toast卡观感-agent徽章品牌图标与body展开滚动.md) — **徽章图标资产来源与换法、body 3行折叠/10行滚动**
- [设置页-只显示检测到的Agent与按钮状态设计.md](设置页-只显示检测到的Agent与按钮状态设计.md) — **检测标准、按钮状态定稿、sidecar 旧进程坑**
- [前往会话-进程链捕获与窗口聚焦.md](前往会话-进程链捕获与窗口聚焦.md) — **「前往会话」按钮完整链路：hook 进程链捕获、sidecar `/focus`、App 优先与 terminal 降级**
- [Toast卡片通过toastStyle选择默认或独立外壳.md](Toast卡片通过toastStyle选择默认或独立外壳.md) — **payload.toastStyle=standalone 去掉宿主默认外壳**
- [外部Toast自动消失进度条必须使用CSS动画.md](外部Toast自动消失进度条必须使用CSS动画.md) — **自动隐藏进度条用 CSS 动画，不要 JS 轮询**
- [权限审批-clawd的两种批准流程-普通工具allow-deny与AskUserQuestion多问题回传.md](权限审批-clawd的两种批准流程-普通工具allow-deny与AskUserQuestion多问题回传.md) — **clawd 对照与 agent-notify 回包**
- [AskUserQuestion卡片-预设选项与无标题textarea互斥-多题进度放右下角.md](AskUserQuestion卡片-预设选项与无标题textarea互斥-多题进度放右下角.md) — **问答卡交互：点 Other 清预设、单题不显示进度**
- [AskUserQuestion选项-左侧radio标题在上-选中细蓝边带hover.md](AskUserQuestion选项-左侧radio标题在上-选中细蓝边带hover.md) — **选项观感：radio + 上下标题描述，选中细蓝边**
- [Toast窗口不能调sidecar.request-刷新卡片不等于重启sidecar.md](Toast窗口不能调sidecar.request-刷新卡片不等于重启sidecar.md) — **Toast 用本机 HTTP；404 多半是旧 sidecar 占 23456**
- [设置页调试卡片-五种预览抽到preview-cards不要堆进main.md](设置页调试卡片-五种预览抽到preview-cards不要堆进main.md) — **设置页底部调试卡片与 fixture 抽离**

## 开发流程

改代码 → 用户重载插件实际验证 → 确认后 commit（本仓库）→ 主仓更新 submodule 指针（分开提交，默认不 push）。
