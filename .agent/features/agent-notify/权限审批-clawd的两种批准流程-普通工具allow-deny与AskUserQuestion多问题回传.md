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
- 问答提交：`POST`（失败再 `GET`）`http://127.0.0.1:23456/permission-decide`，body `{ id, decision, answers }`，answers 的 key 是题目 index。
- sidecar `validateIndexedElicitationAnswers` 映射成 `updatedInput.answers[原始题面]`，再 `finishPerm(id, 'allow', { updatedInput })`。
- 拒绝 / 无 answers 的允许：走宿主 `deny:id` / `allow:id`（旧 sidecar 也能用）。
- 宿主 `allow:<id>` 在 elicitation 上会被忽略，防止无答案放行。
- Toast 不能 `plugin.sidecar.request`（只允许 main 窗），详见 [Toast窗口不能调sidecar.request-刷新卡片不等于重启sidecar.md](Toast窗口不能调sidecar.request-刷新卡片不等于重启sidecar.md)。
- 卡片交互细则：[AskUserQuestion卡片-预设选项与无标题textarea互斥-多题进度放右下角.md](AskUserQuestion卡片-预设选项与无标题textarea互斥-多题进度放右下角.md)。

## clawd 关键文件

- `src/bubble-renderer.js` — elicitation 表单、Other、多题、`elicitation-submit`
- `src/permission.js` — 校验、index 映射、`updatedInput`、回包
- `src/permission-automation-policy.js` — `intent` / `answerQuestions`
- `src/server-route-permission.js` — `POST /permission` 入口；plan-review 的 `updatedInput` 必须用未截断的原始 `tool_input`
- `src/feishu-approval-client.js` — 远程侧同一套「一题一张卡、答案按 index」
