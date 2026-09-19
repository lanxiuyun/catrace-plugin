# AskUserQuestion 选项：左侧 radio、标题在上，选中用细蓝边和 hover

预设选项不要再做成「左标题右描述」两列。现行结构：

```
[ radio ]  标题（加粗）
           描述（灰色，换行）
```

`ui.mjs` 里是 `option-radio` + `option-copy`（label 在上、description 在下）。

## 颜色与边框

用户拍板：**蓝色，不要紫色；border 不要加粗。**

| 状态 | 边框 | 底 | 标题 | radio |
|------|------|----|------|-------|
| 默认 | 1px `#e2e8f0` | 白 | `#0f172a` | 空心灰圈 |
| hover | 1px `#93c5fd` | `#f8fbff` | 不变 | 圈变浅蓝 |
| 选中 | 1px `#2563eb` | `#eff6ff` | `#1d4ed8` | 蓝圈 + 内填 |

选中不要改成 2px，否则选项会「跳一下」还显得粗。Other 的 textarea 行用同一套蓝 hover/选中，但没有 radio、没有「其他」标题。

底部分割线必须和最后一项之间有空隙：`.perm-card .footer { margin-top: 0.75rem }`。只有 `padding-top` 会把线贴在 textarea 底下。

交互规则仍见 [AskUserQuestion卡片-预设选项与无标题textarea互斥-多题进度放右下角.md](AskUserQuestion卡片-预设选项与无标题textarea互斥-多题进度放右下角.md)。
