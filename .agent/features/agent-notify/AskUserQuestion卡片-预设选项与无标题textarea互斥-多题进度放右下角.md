# AskUserQuestion 卡片：预设选项与无标题 textarea 互斥，多题进度放右下角

权限卡外壳与会话卡同一套：agent 徽章、会话 title、状态 chip、项目路径、深色标题/灰色正文、右下角深色主按钮。不要再用整块棕黄字。

判定：`toolInput.questions` 非空 → 问答卡；否则工具批准卡（允许/拒绝）。

## 问答卡怎么用

- 选项：左标题、右描述，可点。单选点一项即选中并**清空**自定义文本。
- Other：**不要标题「其他」**，就是一条全宽 textarea，placeholder「输入你的回答」。
- **点 textarea（mousedown/focus）立刻清掉预设选项**，改选 Other；空着点进去也算切走预设，提交仍要有非空文字。
- 不要写「选一项，或自行填写」这类提示。
- 不要渲染 `question.header`（例如「下一页」），那不是给用户看的进度。
- 多题才显示进度，放在**右下角按钮组左侧**（`2 / 2` 挨着上一题/提交）。单题不显示 `1 / 1`，也不显示上一题。
- 当前题没答完不能下一题；最后一题全部答完才能提交。

## 实现位置

- `agent-notify/ui.mjs` — `permToggleOption` / `permChooseOther` / `permSetOtherText`
- `agent-notify/runtime/main.mjs` — `decidePermission`、`/permission-decide`
- 回包结构仍按 [权限审批-clawd的两种批准流程-普通工具allow-deny与AskUserQuestion多问题回传.md](权限审批-clawd的两种批准流程-普通工具allow-deny与AskUserQuestion多问题回传.md)

## 避坑

- `render()` 里不要给 `permAnswers` 写默认对象，会触发重复渲染、看起来像点了又被取消。
- 单选不要在「空 input 事件」上就把 selected 换成 Other；**明确的点击/focus Other** 才清预设。
