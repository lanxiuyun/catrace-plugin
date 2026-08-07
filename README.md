# catrace-plugin

Catrace 外部插件仓库。作为 git submodule 挂在宿主仓库 `Catrace/tools/plugin-demo/`，插件代码只在这里维护。

- 宿主仓库：https://github.com/lanxiuyun/Catrace
- 挂载点：`tools/plugin-demo/`（submodule 指针锁版本）
- debug 构建：宿主启动时自动把本仓库各包 junction 到 `app_data/plugins/<id>`（须含 `manifest.json`）
- release 构建：宿主 `tauri.conf.json` 的 `bundle.resources` 只打包 `timer` / `bt-music` / `sidecar-echo`

## 插件索引

| 包 | 角色 |
|----|------|
| `timer/` | 第一方**定时提醒**（settings + scheduling），宿主内置功能的外部化 |
| `bt-music/` | 蓝牙耳机连接 Toast → 打开音乐程序（OS 设备变更事件） |
| `sidecar-echo/` | 完整 sidecar demo：生命周期、JSONL publish/log、自定义 Toast UI、action round-trip |
| `notify-demo/` | 按间隔弹 Toast 的极简 demo（background + settings） |
| `github-notify/` | 轮询 GitHub Notifications，活跃时弹出 PR/Issue 提醒（Node sidecar） |
| `linuxdo-notify/` | 轮询 linux.do 通知，活跃时弹出回复/提及提醒（Node sidecar） |
| `smsforwarder-notify/` | 接收 Android SmsForwarder Webhook，局域网转发 App 通知到 Toast（Node sidecar） |

## 包结构约定

每个插件是一个独立目录，须含 `manifest.json`，否则宿主不会加载。

```
<plugin-id>/
  manifest.json     # id / name / version / main / background / settings / events / sidecar
  ui.mjs            # Toast 卡片（纯 Vue render）
  settings.mjs      # 设置面板（根节点只出业务样式，外距归宿主）
  background.mjs    # 后台调度（可选）
  runtime/main.mjs  # Node sidecar（可选）
```

- `manifest.json` 必须为 **UTF-8** 编码、合法 JSON（宿主用 `serde_json` 严格解析，GBK 会加载失败）。
- 运行时产物一律写 `runtime/state.json` 之类，已 `.gitignore`，不要提交个人数据。
- settings.mjs 布局合同：宿主 `Plugins.vue` 的 `.plugin-detail` 负责 max-width / padding / gap，settings 根节点**不要**加外 padding 或 `max-width: 64rem`（含窄屏 media 块）。参考 `timer/settings.mjs`。

## 新增插件

1. 复制 `timer/` 骨架，改 `manifest.json` 的 `id` / `name` / `version`。
2. 按需加 `background.mjs` / `runtime/main.mjs`（sidecar 用 `node runtime/main.mjs`）。
3. `node --check <file>` 校验各 mjs。
4. 在宿主 `tauri.conf.json` 的 `bundle.resources` 补一行（仅当要随 release 打包）。
5. 更新本 README 插件索引。

## 本地开发联动

插件改动直接发生在宿主 `Catrace/tools/plugin-demo/`（即本仓库 checkout），存盘即被 junction 生效：

1. `pnpm tauri dev` 启动宿主，`Plugins` 页启用目标插件。
2. 改代码 → 宿主重载（或按插件页刷新）→ 验证。
3. commit 推本仓库：`git push origin main`（或先 PR）。

> 注意：宿主仓库需 `git submodule update --init --recursive` 后才有 `tools/plugin-demo/`。
