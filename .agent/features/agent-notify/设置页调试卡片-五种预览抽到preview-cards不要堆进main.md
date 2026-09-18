# 设置页调试卡片：五种预览抽到 preview-cards.mjs

设置页最底部「调试卡片」，用来弹出真实 Toast 看会话卡 / 工具批准 / 问答卡，不要和正式 hook 安装区混在一起。

按钮：任务完成、调用工具中、批准工具、回答问题、多题问答。

实现：

- `agent-notify/settings.mjs` — 只负责按钮和 `sidecar.request('testCard', { kind })`
- `agent-notify/runtime/preview-cards.mjs` — fixture 和 `publishTestCard`，不要堆进 `main.mjs`
- `main.mjs` 的 `testCard` 把 `publishSession` / `publishPermission` / `pendingPerm` / `finishPerm` 注入进去

预览权限卡会登记假的 pending HTTP res，点允许/拒绝/提交可以走完整 decide 路径（没有真实 hook 在等）。改问答 UI 时先点「回答问题 / 多题问答」，避免每次等真 Agent。
