# 定时提醒（timer）

宿主文档入口：宿主仓 `.agent/features/timer-plugin/README.md`。本仓库只记插件包内约定。

## Toast 按钮语言

到点 publish 的按钮 label 必须用 `plugin.i18n.getLocale()`，禁止 `document.documentElement.lang`。后台窗共用宿主 `index.html`（`lang="en"`），会把中文界面的按钮打成 `Got it` / `Snooze 5m` / `Skip`。

规则自定义 title/body 保持原文；缺省标题和 ack / snooze_5 / skip 才按 locale 翻译。设置页「测试」与到点共用同一套 `actionLabel`。

详见 [Toast按钮语言读宿主locale不要读html-lang.md](Toast按钮语言读宿主locale不要读html-lang.md)。
