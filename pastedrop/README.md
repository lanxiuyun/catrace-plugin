# PasteDrop 剪贴板存图

在**桌面**或**资源管理器**里按 `Ctrl+V`，如果剪贴板里是图片，直接把图片存成 PNG 文件，不用再开画图/另存为。源自独立工具 [PasteDrop](https://github.com/lanxiuyun/PasteDrop)。

## 它能干什么

- 桌面按 `Ctrl+V` → 存到「桌面」
- 资源管理器当前文件夹按 `Ctrl+V` → 存到当前文件夹
- 剪贴板不是图片时，`Ctrl+V` 原样放行，不影响正常粘贴
- 自动命名：`Pasted Image 2026-08-13 10-00-00.png`，同名自动加序号
- 静默运行，无弹窗（可选：保存后弹一张卡片，可一键打开所在文件夹）
- 只在桌面/资源管理器生效，其他软件里粘贴行为不变

## 运行依赖

- Windows（全局键盘钩子）
- Catrace 标配的 Node（sidecar 用）
- **PowerShell 5.1+** —— Windows 自带，**无需额外安装任何东西**

> 全局低级键盘钩子（`WH_KEYBOARD_LL`）需要真正的 Win32 消息循环，Node 纯 JS 做不到；本插件用 PowerShell + Add-Type C# 实现（和 Catrace 蓝牙插件的同款方案），PasteDrop 的 Python 逻辑近直译为 C# 钩子。

## 启用

1. Catrace「插件」页 → 打开插件目录 → 把本目录拷进去
2. 启用「PasteDrop 剪贴板存图」

> **启用 = 信任**：启用后本插件会跑 PowerShell 子进程、装全局键盘钩子，等于信任本目录全部代码。

## 设置项

| 设置 | 说明 |
|------|------|
| 保存位置 | 桌面 + 资源管理器 / 仅桌面 / 仅资源管理器 |
| 文件名前缀 | 默认 `Pasted Image` |
| 保存后弹卡片 | 关 = 静默存（原生行为）；开 = 每张存完弹卡片 |
| 卡片停留 | 0 = 不自动消失 |

## 目录结构

```
pastedrop/
  manifest.json     # 插件元信息（sidecar = node runtime/main.mjs）
  settings.mjs      # 设置面板
  runtime/
    main.mjs        # Node sidecar：宿主协议 + 监督 worker + 转 Toast
    main.ps1        # PowerShell worker：全局 Ctrl+V 钩子 + 剪贴板存图（零依赖）
```

> `runtime/` 下运行时产物 `shutdown.signal` / `last-saved.txt` 已被忽略，不会提交。
