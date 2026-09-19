# 权限审批：clawd 的两种批准流程

对照仓库：`C:\work_sapce\clawd-on-desk`（不是 Catrace 宿主）。  
用途：agent-notify 的 `/permission` 要分清「允许工具跑」和「回答问题」，不要把 `AskUserQuestion` 当成普通工具点允许。

## 为什么必须分两条路

`PermissionRequest` 都走阻塞 HTTP hook，但 **intent 不同**：

| 类型 | 用户在卡上做什么 | 回给 Agent 的 decision |
|------|------------------|------------------------|
| 普通工具权限（Bash / Write / Edit / MCP） | 允许或拒绝 | `{ behavior: "allow" }` 或 `{ behavior: "deny" }` |
| 向人提问（Claude `AskUserQuestion`） | 选选项、填 Other、多题逐步完成 | `{ behavior: "allow", updatedInput }`，答案在 `updatedInput.answers` |

clawd 用 `classifyPermissionInteraction()` 得到：

- `interaction.intent === "human-question"`
- `interaction.capabilities.answerQuestions === true`

才进入 elicitation。不能安全编码答案时，**不伪造 `updatedInput`、不显示允许/拒绝**，把请求交回 Agent 原生终端 UI（`src/bubble-renderer.js` 约 1248–1260 行）。

## 普通工具：允许 / 拒绝

卡片按钮：

```js
window.bubbleAPI.decide("allow")
window.bubbleAPI.decide("deny")
```

主进程回包（Claude / ZCode / Codex 同类最小 union）：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "allow" }
  }
}
```

拒绝可带 `message`。位置：`src/permission.js` 的 `buildCodexPermissionResponseBody` / `sendPermissionResponse`。

agent-notify **曾经只实现了这一条**；现在有 `questions` 时走 elicitation，见下方「对照」。

审批卡右上角也有自绘灰色 `×`（`ui.mjs` perm-card 分支）：点击等价于**拒绝**（`sendPermissionDecision('deny')`）再关卡，避免用户只想去掉卡片却让 Agent 永久阻塞等待；审批请求进行中（`permBusy`）按钮 disabled。普通状态卡的 `×` 只 emit close，无 deny 语义。

## AskUserQuestion：卡片内收集答案

识别成功后 `elicitationMode = true`（`src/bubble-renderer.js` 约 1242–1245、1332–1340 行）。

每题是真控件，不是装饰 chip：

- `question.multiSelect` → checkbox，否则 radio
- 选项来自 `question.options[].label`（可有 `description`）
- **终端 UI 会自动给 Other，hook 的 `options` 里往往没有**；clawd 在客户端注入 Other + textarea
- 多题：`activeQuestionIndex`，上一题 / 下一题，进度 `当前/总数`
- 当前题没答完不能进下一题；最后一题全部答完才能提交

提交载荷（key 是题目 **index 字符串**，不是截断后的题面）：

```js
{ type: "elicitation-submit", answers: { "0": "…", "1": "…" } }
```

## 主进程如何变成 Claude 的 updatedInput

1. `validateAndRemapIndexedElicitationAnswers(toolInput, indexedAnswers)`  
   每道上游题必须有且仅有一个非空答案；缺题 / 多 key 一律失败，**禁止部分答案当成 allow**。
2. index → 原始 `question.question` 文本（远程/UI 会截断题面，不能用显示文本当 round-trip key）。
3. `buildElicitationUpdatedInput`：

```js
{
  ...input,
  questions,
  answers: { [原始问题文本]: "用户回答" }
}
```

4. 对 Claude elicitation：`behavior: "allow"` + `updatedInput`（`src/permission.js` 约 3804–3816 行）。

Hermes 走另一条：`decision: "allow"` + 顶层 `answers`，不是 Claude 的 `updatedInput`。

## agent-notify 对照

- 有 `toolInput.questions` → 问答卡；否则普通工具允许/拒绝。
- 问答提交：`POST`（失败再 `GET`）`http://127.0.0.1:23456/permission-decide`，body `{ id, decision, answers }`，answers 的 key 是题目 index（传字符串化 JSON sidecar 也会自动 parse）。
- sidecar 校验与映射在 `runtime/permission.mjs`（2026-09-18 sidecar 按职责拆分后从 main.mjs 迁出）：`validateIndexedElicitationAnswers` 全量校验 → `remapIndexedElicitationAnswers` 映射成 `answers[原始题面]` → `buildElicitationUpdatedInput` 组装 → `finishPerm(id, 'allow', { updatedInput })`。
- 拒绝 / 无 answers 的允许：走宿主 `deny:id` / `allow:id`（旧 sidecar 也能用）。
- 宿主 `allow:<id>` 在 elicitation 上会被忽略（`main.mjs` resolved 分支显式守卫 + warn 日志），防止无答案放行。
- Toast 不能 `plugin.sidecar.request`（只允许 main 窗），详见 [Toast窗口不能调sidecar.request-刷新卡片不等于重启sidecar.md](Toast窗口不能调sidecar.request-刷新卡片不等于重启sidecar.md)。
- 卡片交互细则：[AskUserQuestion卡片-预设选项与无标题textarea互斥-多题进度放右下角.md](AskUserQuestion卡片-预设选项与无标题textarea互斥-多题进度放右下角.md)。

## sidecar 侧：/permission-decide 的回包与校验

`runtime/permission.mjs` 的 `handlePermissionDecideHttp` → `decidePermission`：

| 情形 | HTTP | 结果 |
|------|------|------|
| 决策成功（allow / deny） | 200 | `{ ok: true }` |
| id 不存在 / 已过期 | 409 | `permission request expired` |
| allow 但校验失败（缺题 / 多 key / 空答案） | 409 | 具体原因，**绝不部分放行** |
| 非法 decision / 非法 id | 409 | `invalid decision` / `invalid id` |
| body 不是合法 JSON | 400 | `invalid json` |

UI 端（`ui.mjs` `sendPermissionDecision`）对 404 有特判——提示「sidecar 未加载 /permission-decide，请在插件页点刷新」（旧 sidecar 进程没有该路由）；其他非 2xx 把 `error` 显示到卡片的 `perm-error` 区。

allow + questions 的完整校验链（与 clawd 同构，fail-closed）：

1. `validateIndexedElicitationAnswers`：answers 的 key 集合必须与题目**完全一致**——缺题、多 key、非字符串、空白答案任一命中即拒绝；
2. `remapIndexedElicitationAnswers`：index 数字 → 原始 `question.question` 题面（round-trip key 是题面不是显示文本，与 clawd 理由相同）；
3. `buildElicitationUpdatedInput`：`{ ...toolInput, questions, answers }` → 回包 `behavior: "allow"` + `updatedInput`。

deny 不需要 answers，直接 `{ behavior: "deny" }`。

## 生命周期：超时、挤占与过期

- **审批超时**：`PERM_WAIT_MS = 540_000`（9 分钟，`runtime/constants.mjs`）。超时 `finishPerm(id, 'timeout')` 回包是 `{}`——Agent 收到空决策，按未批准自行处理；不是 allow 也不是 deny。
- **新提问挤占**：同会话新 `UserPromptSubmit` 会 `timeoutSessionPerms` 清掉该会话所有未决审批（用户重新提问 = 撤回等待）。
- **新请求挤占**：同会话来第二个权限请求时，`startPermission` 也走 `timeoutSessionPerms`，旧请求直接过期。
- 过期后再点允许 / 拒绝（或 ×）→ 409 `permission request expired`，卡片 `perm-error` 区显示原因，不会误伤已结束的请求。

## 题目 index 的对齐坑（防御性边界）

UI 的 `permissionQuestions`（`ui.mjs`）在 map 时记录**原始数组下标**再 filter 掉无效题；sidecar 的 `elicitationQuestions` 是先 filter、再用**过滤后数组**的下标校验。当 `toolInput.questions` 中间夹着无效题（缺 question 字符串）时两边 index 会错位——此时全量校验必然 key 不匹配 → 409 拒绝。这是刻意 fail-closed：宁可让用户重试，也不把答案安到错误的题上放行。Claude 的 `AskUserQuestion` 不产生空题，正常流程不会触发。

## clawd 关键文件

- `src/bubble-renderer.js` — elicitation 表单、Other、多题、`elicitation-submit`
- `src/permission.js` — 校验、index 映射、`updatedInput`、回包
- `src/permission-automation-policy.js` — `intent` / `answerQuestions`
- `src/server-route-permission.js` — `POST /permission` 入口；plan-review 的 `updatedInput` 必须用未截断的原始 `tool_input`
- `src/feishu-approval-client.js` — 远程侧同一套「一题一张卡、答案按 index」
