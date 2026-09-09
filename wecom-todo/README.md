# 企业微信待办（wecom-todo）

用本机 [wecom-cli](https://github.com/WecomTeam/wecom-cli) 拉企业微信工作台待办。新出现的进行中待办弹桌面小窗；卡片可标完成。

## 前置

- 本机 Node.js ≥ 18
- `npm install -g @wecom/cli`（建议 ≥ 1.1.0）
- `wecom-cli auth init` 扫码一次

插件只调 `wecom-cli todo list` / `todo finish`，不存企业微信 Secret。默认关闭。首次启用会把当前列表记作基线，不刷一屏旧待办。
