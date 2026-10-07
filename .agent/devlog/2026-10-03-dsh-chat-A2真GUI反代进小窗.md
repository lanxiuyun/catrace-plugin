# dsh-chat 三轮：A2 把官方 GUI 反代进小窗

日期：2026-10-03　插件：`tools/plugin-demo/dsh-chat/`　起因：用户「小窗里没有 `/` 和 `@`，和原生完全不一样」

## 结论

小窗现在有两种模式：**真 GUI（iframe 官方界面）** 与 **镜像卡（自绘消息流）**。
真 GUI 已端到端跑通（360×480：对话可见、真输入框带 `/` 与 `@` 提示、`/api/*` 全 200、WS mux 已连、零报错）。

## 关键决策链（按事实推进，不是拍脑袋）

1. 用户想「直接 iframe 官方地址」→ **不行**：webview 没票据、HttpOnly 写不了、桌面版 `?token=` 拿不到（已核实 `printUrl: false`）。
2. 用户想「iframe 紧凑面」→ **也不存在**：`dsh-client-ui-overlay-chat` 是 orb fork 的包，装着 rc.2 里没有；
   即便移植，postMessage 被 `dsh-app://shell` 锁死。
3. 于是选「反代 + 整块官方 GUI」。先做了四轮侦察（Playwright + 自签 cookie 直连真 GUI）确认：
   - SPA 全用文档相对 URL、`<base href="./">` 由宿主注入 ⇒ **HTML 零改写**；
   - `localStorage['dsh.sessions.current']` 决定显示哪条会话，不写就落到"选择工作区"引导页；
   - 360px 下官方自带窄模式（56px 图标栏），观感可用。

## 踩到的两个真 bug（都由测试/实测抓到）

| bug | 现象 | 修法 |
|---|---|---|
| upgrade 分支剥掉了 `connection`/`upgrade` | WS 握手不成立（上游当普通请求回响应） | upgrade 只剥其余逐跳头 |
| 用 `URLSearchParams` 改写查询串 | 插件 bundle URL `/plugins/??a,b&rev=` 被重新编码 → 全 404、"HTML did not preload" | 按字符串处理，只删自己的 `dshw-session`，其余字节保真 |

另外两条硬约束写进了合同测试：**iframe 不许 sandbox**（opaque origin → 403）、只有 sidecar 反代这一条路。

## 验证

- `node --test "runtime/test/*.test.mjs"` → 102 项全过（新增 gui-proxy 8 项 + 合同 1 项）。
- `e2e-temp/a2-e2e.mjs`：用**真实插件代码**起 sidecar → `openGui` → 浏览器打开返回的 guiUrl →
  断言对话内容/真输入框/`/api` 200/WS 已连/零控制台错误。

## 还没做（记录在案）

- Q8：DSH Desktop 完全退出时不自动起 `dsh web`，目前只有明确报错 + 提示（本轮范围外）。
- 自绘紧凑模式（用户要的第二个模式）：押后，真 GUI 先跑通。
- 裁剪官方布局、会话切换按钮、主题跟随：都试过/评估过，收益不如风险。
- 依赖用户 DSH 里「普通浏览器访问」开着（compatibility + openBrowser），关掉会 403。
