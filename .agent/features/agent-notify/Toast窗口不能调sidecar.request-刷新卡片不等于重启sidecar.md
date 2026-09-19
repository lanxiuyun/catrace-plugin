# Toast 窗口不能调 sidecar.request，刷新卡片不等于重启 sidecar

Toast 卡片跑在 `reminder-toast` 窗。宿主 `plugin_sidecar_request` **只允许 `window.label() === "main"`**，设置页可以 `plugin.sidecar.request`，卡片里调用会直接失败。

卡片要调 sidecar，走本机 HTTP：

```text
GET  http://127.0.0.1:23456/focus?pids=
POST http://127.0.0.1:23456/permission-decide
GET  http://127.0.0.1:23456/permission-decide?id=&decision=&answers=
GET  http://127.0.0.1:23456/health   → { ok, routes }
```

`fetch` 即可，不必 `plugin.http.get`。

## 为什么 UI 新了、提交仍 404

插件 UI 是 blob 热加载；sidecar 是长驻 `node`，占死 `23456`。只 reload Toast / 只改 `ui.mjs`，旧进程还在，新路由不存在。

现象：`POST /permission-decide` → 404，DevTools 报 `permission decide failed`。

处理：

1. 功能插件页 **刷新**（force 重启 sidecar），不要只重载卡片。
2. 日志应有 `listening { port: 23456, routes: [..., "/permission-decide"] }`。
3. 若 `http bind failed EADDRINUSE`：旧 node 还占端口，先杀掉再刷新。
4. 拒绝 / 普通允许可走宿主 `deny:id` / `allow:id` 兜底；带 answers 的提交必须新 sidecar。

开关单个插件不等于 reload 全部 sidecar。见宿主记忆：sidecar 关开才吃新脚本，reload 才全量。
