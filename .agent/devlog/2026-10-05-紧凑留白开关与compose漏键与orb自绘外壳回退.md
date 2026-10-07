# 2026-10-05 紧凑留白开关（含 compose 漏键修复）与 orb 自绘外壳回退

## Session goal

用户看完参考项目 orb 的悬浮窗后，要两件事：① 让"紧凑留白"成为设置里**独立的开关**；
② 先做过一版 orb 那种"自绘外壳"，用户看效果后决定不做（回退到 `orb` 分支），本分支只留①。

## Completed

- **紧凑留白开关**（`config.compactSpacing`，默认关）：把官方 `--dsh-composer-side-clearance`（16px）归零 +
  对话区滚动内边距 32px→8px、输入框贴边、消息块间距 16px→10px；360px 下正文宽度 296→344px（+16%）。
  规则在 `gui-proxy.compactSurfaceRules()`，进 `guiSignature()` ⇒ 切换自动重建反代 + 重开小窗。
  **故意不动 `--dsh-chat-content-width`**（最小 680px 在 360px 下不生效，且被宽表格 calc 消费）。
- **修掉 `compose()` 漏键**（同一 bug 第三次：show* → customCss → compactSpacing）：`compose()` 与
  `loadConfig()` 改成遍历 `DEFAULTS` 全键、按默认值类型处理，新增配置键不必再登记名单。
- **护栏**：保存对象必须覆盖 `DEFAULTS` 全键；紧凑留白只在开启时注入；自定义 CSS 必须原样保存；
  速查表补 `_body` / `_viewArea _scroll` / `_toBottomSlot`。
- **修测试自身的 CRLF bug**：`/\/\/.*$/` 因行尾 `\r` 匹配失败 → 注释被当成值（`dshHome` 误报）。
- **orb 调研沉淀**：它的小窗 = 自建 Electron 透明置顶窗 + 自绘壳页 + iframe 只装官方 ChatView；
  它的"紧凑面"只有 38 行 CSS，与我们在 360px 下几乎等价 —— 观感优势来自窗口形态与自绘输入条。
- **诊断上报**：`guiStatus` 增加 `compactSpacing` / `cssBytes`（"怎么没区别"时先看这两个数）；
  `discoverHost` 收集每端口探测结果 + `describeDiscoveryFailure`（403/forbidden 与"没找到 host"分清）。
- 提交：插件仓库 `729fa2f`（12 文件，+394/−40），未 push。

## Remaining

- 主仓 submodule 指针未 bump（`tools/plugin-demo` 2e943b9 → 729fa2f）：等插件分支合并进插件 `main` 再 bump，
  或按用户选择在主仓新开分支提交。主仓另有一个不属于本轮的 `M src-tauri/Cargo.toml`。
- 自绘外壳代码在插件仓库 `orb` 分支，本分支不含；除非宿主提供"插件悬浮窗"能力，不建议重做。
- 紧凑留白开关待用户在真机上肉眼确认效果（预期内容每侧多约 24px）。

## Key file changes

| File | Change |
|------|--------|
| `dsh-chat/runtime/lib/config.mjs` | 新增 `compactSpacing` 键 + 进 `guiSignature()` + 布尔校验 |
| `dsh-chat/runtime/lib/gui-proxy.mjs` | 新增 `compactSurfaceRules()` 与 `compactSpacing` 参数（自定义 CSS 仍排最后） |
| `dsh-chat/runtime/main.mjs` | 把 `compactSpacing` 传给 `buildCropCss`；`cssBytes` 统计；`guiStatus` 增加 `compactSpacing`/`cssBytes` |
| `dsh-chat/settings.mjs` | DEFAULTS 加键；「小窗外观」顶部加开关行；`compose()`/`loadConfig()` 改成遍历 `DEFAULTS` 全键 |
| `dsh-chat/runtime/lib/gui-classes.mjs` | 速查表补 `_body`、`_viewArea _scroll`、`_toBottomSlot` |
| `dsh-chat/runtime/test/*.test.mjs` | 紧凑留白开关/注入/generic 全键护栏/CRLF 解析修复 |
| `dsh-chat/README.md`、`.agent/features/dsh-chat/*` | 使用说明与知识沉淀（本轮拆出 3 篇子文档） |
