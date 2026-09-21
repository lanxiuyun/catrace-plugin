# Toast 按钮语言读宿主 locale

`background.mjs` 以前读 `document.documentElement.lang`。插件后台 WebView 的 `index.html` 写死 `lang="en"`，中文界面到点卡会变成中文标题 + 英文按钮。

用 `plugin.i18n.getLocale()`（宿主 DB `locale`）。`zh*` → 知道了 / 5 分钟后 / 跳过；否则英文。测试通知不要写死中文。
