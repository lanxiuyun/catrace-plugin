# 设置页：只显示检测到的 Agent，以及按钮状态设计

`agent-notify/settings.mjs` + `runtime/hooks.mjs` 的约定。解决的问题：五家 agent 恒常列出，但机器上没装的 agent「安装 Hook」点了必然失败；且安装/卸载按钮同款样式，状态一眼分不清。

## 检测标准：配置目录存在（`isAgentPresent`）

| agent | 检测路径 |
|-------|----------|
| claude | `~/.claude` |
| zcode | `~/.zcode/cli` |
| codex | `~/.codex` |
| gemini | `~/.gemini` |
| kimi | `~/.kimi` 或 `$KIMI_CODE_HOME` |

没装过的 agent 连配置文件都无从写入，**目录存在 = 检测到**，不做更聪明的探测（比如查进程）。

- `listAgents` RPC 返回 `{ id, installed, detected }`；`installed` 是 hook 层面（配置文件里有没有 catrace 条目），`detected` 是机器层面（装没装过这个 agent），两者独立。
- 设置页只渲染 `detected !== false` 的行为完整行（标签 + 安装/卸载按钮）；`detected === false` 的折叠为**底部一行 warning 橙色标签**（hover 提示「未检测到配置目录，无法写入 hook」），不提供安装。
- 全部未检测到时显示空态文案，列明五种配置目录要求。

## 按钮状态（用户多轮迭代后的定稿）

| 状态 | 按钮 | 视觉 |
|------|------|------|
| 未安装（检测到） | 安装 Hook | **中性描边**（灰框深字），hover 边框文字变紫（`.install-btn` 自定义类 + 0.2s 过渡） |
| 已安装 | 卸载 Hook | `type: error, secondary` 浅红底块 |
| 未检测到 | 无按钮 | warning 标签 |

状态同时由绿/灰 `NTag` 双重编码，按钮保持安静。走过的弯路：实心 primary 太抢眼 → quaternary 太隐形 → ghost 紫框被接受过一版 → 最终回到中性描边 + hover 变紫。教训：**列表型设置页里，状态让标签承担，按钮只做安静的操作入口**。

## 关键坑：UI 热更新 ≠ sidecar 更新

`settings.mjs`/`ui.mjs` 是 webview 侧，刷新页面即生效；`runtime/main.mjs` 是常驻 sidecar 进程，**必须重启插件才会加载新代码**。曾因此出现「过滤代码写了但不生效」：旧进程的 `listAgents` 返回里没有 `detected` 字段，`detected !== false` 对 undefined 全放行。

兜底：设置页检测 `detected === undefined` 时显示「插件进程是旧版本：请关闭再开启本插件（或点刷新）」提示（`sidecarStale`）。相关记忆：sidecar 与 webview 热更新不对称。

## 降级路径

sidecar 请求失败（插件进程挂了）时退回全量展示（五家、`detected: true`）——此时安装功能本来不可用，但列表至少可见。
