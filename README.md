# catrace-plugin

Catrace 的插件仓库。这里每个插件都能给 Catrace 加一种新本事——大多数是「往桌面弹一张提醒卡片」的本事。

- 宿主仓库：https://github.com/lanxiuyun/Catrace
- 挂载点：`tools/plugin-demo/`（git submodule 指针锁版本）
- 插件怎么装：Catrace 里打开 **插件** 页 → 点「打开插件目录」→ 把插件目录拷进去 → 点插件的 **启用**。

> **启用 = 信任**：启用一个插件，等于信任它目录里的全部本地代码（有些插件还会跑一个 Node 小子进程来干活）。所以别从网上乱拷插件，使用前请先用 Ai 检查一遍安全性。

---

## 有哪些插件

### ⏰ 定时提醒（timer）
Catrace 自带的基础插件，开箱即用。

- 自定义 **间隔提醒**：每 N 分钟弹一次（比如护眼 20 分钟、喝水 40 分钟），你不在电脑前就不弹。
- 自定义 **定点提醒**：每天固定几点钟弹（比如 10:00 站桩，15:30 邮件）。
- 每条提醒都有自己的标题、正文、停留秒数；可设为「不自动消失」，等你亲手关掉。
- 卡片上有三个按钮：**知道了 / 5 分钟后 / 跳过**。
- 内置一条「护眼提醒」规则，休息过会重新计时。

### 🎧 蓝牙听歌（bt-music）
蓝牙耳机一连上电脑，马上弹一张卡片「XX 已连接」，点一下按钮就帮你打开音乐软件。

- 监听系统蓝牙设备连接事件，不用轮询不费电。
- 在设置里可以指定自动打开的播放器（软件名或路径）。
- 需要本机装 Node.js。

<video controls src="https://github.com/user-attachments/assets/da59bb35-3dcd-4159-af73-fad89bf3149a" title="Title"></video>

### 📱 SmsForwarder 通知（smsforwarder-notify）
安卓手机收到的短信 / App 通知，转发到电脑桌面上弹卡片。

- 手机装 **SmsForwarder** App，设置里填上电脑的接收地址，此后手机来通知，电脑就弹。
- 卡片上能看是谁发的、按 App 区分图标；不想要的 App 可以直接在卡片上点 **拉黑**。
- 调节：监听端口、去重秒数、卡片停留秒数、仅活跃时提醒，空闲时的通知会暂存、活跃后再补推。
- 需要本机装 Node.js。

![SmsForwarder 通知](screenshots/sms.png)
<video controls src="https://github.com/user-attachments/assets/fd3edc59-3cc6-44a6-90a4-bad76a438192" title="接收 trae 验证码"></video>

### 🔔 GitHub 通知（github-notify）
GitHub 上有新通知（PR、Issue、@我、评论）时，弹卡片提醒你。

- 轮询你的 GitHub 通知列表，**只有你在电脑前活跃时才弹**，人不在就静默。
- 在设置里填一个 GitHub 的访问令牌（token），可调轮询间隔、卡片停留秒数、只活跃时提醒等。
- 需要本机装 Node.js。

### 🐧 LINUX DO 通知（linuxdo-notify）
LinuxDO 论坛（linux.do）有新的回复 / @我 / 点赞时，弹卡片提醒。

- 和 GitHub 通知同类玩法：轮询、活跃时才弹、卡片停留秒数可调。
- 在设置里填 LinuxDO 的 cookie（登录态），不保存到别人的机器上，只存在本机配置。
- 需要本机装 Node.js。

### 🧪 间隔通知（notify-demo）
最小的演示插件：每隔几秒 / 几分钟自动弹一张卡片。

- 用途：验证 Toast 效果、当后台调度的「最小样品」（参考代码里边就几十行）。
- 可选「只在活跃时弹」。

### 🧩 Sidecar 能力演示（sidecar-echo）
给开发者看的「插件能干什么」大全，每个能力在设置页里点按钮就能试。

- 读环境变量、选文件 / 选文件夹、启动本机程序、发 HTTP 请求、读写剪贴板、读写插件存储、查屏幕 / 当前窗口、弹系统通知、隐藏主窗口 1 秒、响铃……
- 普通用户装上也能当玩具点着玩，但主要是给写插件的人做能力参考。
- 需要本机装 Node.js。

---

## 想自己写一个插件？

开发文档见 [`develop.md`](develop.md)。里面讲了完整的开发流程、文件怎么写、有哪些红线，以及一份「常见问题」速查表。

---

## 仓库结构

```
plugin-demo/
  <plugin-id>/          # 每个插件一个目录，须含 manifest.json
    manifest.json       # 插件信息：id / name / main / settings / events / sidecar
    ui.mjs              # 提醒卡片长啥样（可选）
    settings.mjs        # 设置页长啥样（可选）
    background.mjs      # 后台调度逻辑（可选）
    runtime/main.mjs    # Node 子进程，干粗活（可选）
```

插件一旦启用，它的 `.mjs` 代码和子进程就有你本机的完整权限，请只启用你信任的插件。
