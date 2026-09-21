# 2026-09-21 timer Toast 按钮误用 html lang

中文界面护眼/定时到点卡按钮是 Got it / Snooze 5m / Skip。原因：background 读 `document.documentElement.lang`，宿主 index.html 默认 `en`。设置页测试写死中文所以测不出来。

改：宿主 `plugin.i18n.getLocale()`；timer background/settings 共用 actionLabel；locale 空则 zh-CN。
