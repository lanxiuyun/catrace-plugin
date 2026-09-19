# 外部 Toast 自动消失进度条通用写法

所有外部插件 Toast 的自动消失进度条统一使用 **CSS animation + `--toast-auto-hide-ms`**，不要依赖 Vue/React props 的高频刷新去手动计算宽度。

## 发布侧约定

普通自动消失卡片在事件 payload 中传入毫秒数：

```js
payload: {
  auto_hide_ms: cardDurationSec * 1000,
}
```

常驻卡片传 `0` 或不渲染进度条：

```js
payload: {
  auto_hide_ms: 0,
}
```

Catrace 宿主会读取 `auto_hide_ms`，并把当前 Toast 的完整时长注入为 CSS variable：

```css
--toast-auto-hide-ms
```

同时通过外部 Card 的 `remainingMs` / `totalMs` props 管理实际卡片生命周期；进度条不需要自己再创建 timer。

## UI 侧标准写法

推荐直接使用一个进度条元素：

```css
.plugin-card .progress-bar {
  height: 0.125rem;
  margin: 0.5rem 0 0;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--light-bg));
  transform-origin: left center;
  animation: plugin-card-progress-shrink var(--toast-auto-hide-ms, 8000ms) linear forwards;
}

.plugin-card .progress-bar.is-paused {
  animation-play-state: paused;
}

@keyframes plugin-card-progress-shrink {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}
```

渲染时只根据宿主传入的 hover 状态切换暂停 class：

```js
h('div', {
  class: ['progress-bar', this.isHovered ? 'is-paused' : ''],
})
```

## 为什么必须用 CSS animation

宿主的 `remainingMs` 主要用于控制关闭 timer，并不会每一帧更新。若插件只用 `remainingMs / totalMs` 计算 inline width，进度条就可能只有在 hover、更新或其他响应式事件发生时才变化。

CSS animation 在卡片渲染后由浏览器持续执行，因此：

- 不 hover 时也会持续收缩；
- hover 时通过 `animation-play-state: paused` 暂停；
- 离开 hover 后自动继续；
- 与宿主的自动关闭 timer 使用同一个 `--toast-auto-hide-ms` 时长，不会另起一套计时逻辑。

SMSForwarder 插件的 `.sf-card .bar` / `sf-card-shrink` 是此约定的参考实现。

## 必须遵守的边界

- 普通 auto 卡片才显示进度条；sticky、PermissionRequest、需要用户持续操作的卡片不显示。
- 使用 `transform: scaleX()`，不要动画 `width`，避免布局抖动。
- `transform-origin` 必须是 `left center`，让进度从右侧缩短。
- animation duration 使用 `var(--toast-auto-hide-ms, <合理默认值>)`，不要把秒数写死在 UI 中。
- 进度条的 timer 由宿主管理，插件只负责视觉 animation 和 hover pause。
- class 使用插件自身前缀，避免多个外部插件的 `.progress-bar` 互相污染。
- 进度条样式应放在插件自己的 UI 文件中，不修改宿主通用 CSS。

## 涉及参考文件

- `smsforwarder-notify/ui.mjs` — `.sf-card .bar`、`.sf-card .bar.paused`、`sf-card-shrink`
- `smsforwarder-notify/runtime/main.mjs` — `payload.auto_hide_ms`
- `agent-notify/ui.mjs` — `.agent-toast .progress-track` / `.progress-fill` 与 `agent-progress-shrink`
