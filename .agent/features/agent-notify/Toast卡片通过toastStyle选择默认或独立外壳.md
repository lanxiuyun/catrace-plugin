# agent-notify Toast 外壳样式

agent-notify 使用 `payload.toastStyle: 'standalone'` 让宿主放弃默认 Toast 外壳，由插件 UI 自己绘制完整卡片。

## 当前约定

- `runtime/main.mjs` 的状态卡、非 sticky 状态卡和 Permission 卡都传 `toastStyle: 'standalone'`。
- `ui.mjs` 负责圆角、背景、类型色条、accent 阴影、header/body/footer 等完整视觉。
- 不传该字段的其他插件不受影响，继续使用 Catrace 默认白底 Toast。
- `toastStyle` 也可以是 CSS style object，用于单个 event 的自定义；宿主默认仍保留，除非使用 `standalone` flag。

完整宿主 contract 见：[外部插件通过payload-toastStyle选择默认或独立卡片外壳.md](../../../../.agent/features/toast-window/外部插件通过payload-toastStyle选择默认或独立卡片外壳.md)。
