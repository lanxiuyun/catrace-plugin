# Toast 卡观感：agent 徽章品牌图标从哪来、body 首段与 strip

`agent-notify/ui.mjs` 的卡片视觉约定与图标资产来源。改观感前先对照宿主原生卡（主仓 `src/components/SdkToastCard.vue`），分清「宿主惯例」和「插件自创」。

## agent 徽章

- 规范：**2rem 圆角方块**（border-radius 0.625rem），白字/白色 glyph，与标题**垂直居中**（`header-left` align-items: center），hover 出全名（原生 title 属性）。
- 渲染优先级：**`img`（PNG data URL）> `icon`（SVG path）> `label`（字母兜底）**——加新 agent 时能拿到真图标就放前两级，拿不到就字母。
- 品牌色定义在 `ui.mjs` 的 `AGENT_BADGES` 表：Claude 珊瑚橙 #D97757、ZCode 深灰 #1C1C1E、Codex 绿 #10A37F、Gemini 蓝 #4285F4、Kimi 深灰蓝 #334155。

### 图标资产从哪来

| agent | 来源 | 形态 |
|-------|------|------|
| Claude / Codex / Gemini / Kimi | simple-icons（`cdn.jsdelivr.net/npm/simple-icons/icons/<name>.svg`，kimi 已收录） | 24×24 单路径 SVG，把 `d` 内联进 `icon` 字段，白色 fill |
| ZCode | 桌面端安装目录 `D:\Apps\ZCode\resources\icon.png`（1024²） | PowerShell System.Drawing 缩到 96px → base64 data URL 内联进 `img` 字段 |

为什么 ZCode 不用官方 logo.svg：chat.z.ai 的 favicon.svg 是 HTML 壳，真身 `z-cdn.chatglm.cn/z-ai/static/logo.svg` 是 Illustrator 导出的 15KB 多层文件（渐变+描边+透明度层，浅灰底设计），塞进小徽章既脏又脆。等 simple-icons 收录后一行换上。

**换图标/重生成流程**：重新下载 SVG 或重缩 PNG → 更新 `AGENT_BADGES` 对应条目 → `node --check ui.mjs` → 重载插件。图标是内联的冻结副本，官方换了不会自动跟。

## body：全文 strip + 3 行折叠 / 10 行滚动

Stop 卡的 body 来自 `last_assistant_message`——assistant 回复的 markdown 原文。`bodyPreview()` 剥掉标记符号后**整段给卡片**，显示长度全权交给 CSS 与按钮：

1. **默认折叠 3 行**（`-webkit-line-clamp: 3`，截断自带 `…` 省略号）；
2. **无独立按钮、无角标**（用户拍板去掉）：溢出时**底部渐隐遮罩**提示还有内容；hover 三行加 35% 透明度下划线（offset 3px）表明可点；
3. **展开后 max-height 10 行**（10.875rem）+ `overflow-y: auto`，内部滚动看全文，再点正文收起。

**门控**：短文本（≤3 行）没有展开可言——无 hover 样式、无 title，点击不处理任何行为（跳转只认「前往会话」按钮，不做整卡冒泡）。`bodyClamped`（mounted/updated 实测 scrollHeight）是 hover 与点击的总开关。

点 body 本身和点按钮都能切换。只剥渲染层，数据层 `entry.message` 保留原文，调试面板「原始」仍看完整 markdown。只做轻量 strip、不渲染完整 markdown：宿主没给插件 markdown 渲染器，自己写 mini renderer 成本不匹配收益。

## 其他观感决策（用户拍板）

- **状态卡呼吸点已移除**：「任务完成/失败」这类终态卡还在呼吸是伪动态。权限审批卡的琥珀色呼吸点**保留**——「卡住等你操作」是有效信号。
- **「前往会话」深色实心按钮常驻右下角**（用户明确选了不 hover 化；点击通过 `plugin.http` 调 sidecar `/focus`，优先恢复 App 窗口、再恢复 terminal 窗口，链路详见[前往会话-进程链捕获与窗口聚焦.md](前往会话-进程链捕获与窗口聚焦.md)）。
- 调试字段面板是用户按需开的调试工具（`debugView: common/raw`），默认 off；批评观感前先分默认态和用户自开配置。
