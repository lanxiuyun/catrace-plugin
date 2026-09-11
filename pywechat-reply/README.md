# pywechat-reply

Catrace 外部插件：通过 [pywechat](https://github.com/Hello-Mr-Crab/pywechat) 操控微信 PC 客户端，在 Catrace 弹出新消息 Toast 并提供快捷回复。

## 功能

- 监听微信 PC 客户端新消息
- Catrace Toast 弹窗显示聊天名、发送人、消息内容
- Toast 内直接输入回复并发送
- 配置轮询间隔、调试模式
- 测试 Toast 按钮

## 依赖

- 已安装并登录的 **微信 PC 客户端**
- **Python 3**
- **pywechat127**（PyPI 包名不是 `pywechat`）：

```bash
pip install pywechat127
```

微信 4.x 用 `pyweixin`；3.9 才用 `pywechat`（要 3.9 注册表）。Catrace sidecar 的 `python` 必须能 `import pyweixin`。

## 安装到 Catrace

1. 将本目录复制到 Catrace 插件目录：
   - 开发/调试：`tools/plugin-demo/pywechat-reply/`
   - 用户插件目录：Catrace 应用内「打开插件目录」后放到 `plugins/pywechat-reply/`
2. 在 Catrace 插件中心启用「微信 PC 快捷回复」。
3. 在插件设置页确认依赖已安装，配置轮询间隔，点击「发送测试 Toast」验证链路。
4. 启用后 sidecar 会调 `Messages.check_new_messages` / `send_messages_to_friend`（`close_weixin=False`）。轮询会抢微信焦点。

## 配置项

| 项 | 默认值 | 说明 |
|---|---|---|
| `pollIntervalMs` | 8000 | 检查新消息间隔（毫秒）。太短会抢焦点、增加风控 |
| `debug` | false | 是否打印详细错误堆栈 |

## 数据流

```text
微信 PC 客户端
  → pywechat（UI 自动化）
  → Catrace sidecar (runtime/main.py)
  → stdout JSONL → Catrace Event Bus
  → Toast 弹窗（ui.mjs）
  → 用户输入回复
  → resolved 回传 sidecar
  → pywechat 在微信窗口输入并发送
```

## 风险与限制

- **非官方 API**：本插件通过 UI 自动化操控微信客户端，不属于微信官方开放能力。
- **风控/封号风险**：高频自动操作可能导致微信限制登录或封号，请降低轮询频率并谨慎使用。
- **UI 脆弱性**：微信 PC 版界面更新后，pywechat 选择器可能失效，需要更新集成代码。
- **焦点抢夺**：发送消息时微信窗口需要可操作，可能会短暂抢夺前台焦点。
- **法律声明**：请勿将本插件用于非法用途或商业用途，由此产生的一切后果由使用者自行承担。

## 实现

`runtime/main.py` 已接 `pyweixin.Messages`（失败再试 `pywechat.Messages`）。库的 print 被重定向到 stderr，避免弄脏 JSONL。

## 许可证

MIT / 与 Catrace 插件生态一致。

> 免责声明：本项目仅作为 UI 自动化技术学习交流使用，与微信官方无关。
