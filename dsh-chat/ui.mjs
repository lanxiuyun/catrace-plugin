/**
 * dsh-chat 小窗卡片（Catrace Toast 自定义卡）。
 *
 * 两种卡片：
 *  - dsh-chat.window：常驻小窗 = 官方 GUI 的 iframe（sidecar 同源反代）。0.2.x 的
 *    镜像消息流 / SDK 对话已移除；旧版发布的无 guiUrl 卡片会渲染一段"请重开"的提示。
 *  - dsh-chat.notice：右下角可折叠状态卡，正文点击 → 同一张卡原地长高，正文区换成官方界面。
 *
 * 数据通路：**Toast 窗不能调 plugin.sidecar.request**（宿主只放行 main 窗），
 * 状态卡用 fetch 访问 sidecar 的本机 HTTP 桥（端口与口令来自事件 payload）拿 GUI 地址、上报展开状态。
 *
 * 尺寸约束（见插件 .agent/features/dsh-chat/README.md）：
 *  宿主 .toast-card 卡槽固定 22.5rem（360px），.toast-stack 是 overflow-x: hidden。
 *  所以根节点只能 width:100% + border-box，且内部一切长文本必须能换行/截断，
 *  否则会顶出横向滚动条（overflow-y:auto 会把 overflow-x 也算成 auto）。
 *
 * 约束（Catrace 外部插件合同）：只用注入的 Vue/Naive 白名单、尺寸用 rem、样式带 dsh-chat 前缀。
 */
const { h, ref, computed, watch, onBeforeUnmount } = globalThis.__CATRACE_VUE__ || {}

if (typeof h !== 'function') throw new Error('Catrace plugin Vue runtime missing')

const { NButton, NTooltip } = globalThis.__CATRACE_NAIVE__ || {}

const STYLE_ID = 'dsh-chat-card-style'

/** 卡片样式（尺寸必须落在宿主 22.5rem 卡槽内，见文件头注释）。 */
const CARD_CSS = `
.dsh-chat-card {
  display: flex; flex-direction: column;
  /* 撑满卡槽：宿主 .toast-card 固定 22.5rem，超出会被 .toast-stack 裁掉 */
  width: 100%; box-sizing: border-box;
  height: 30rem;
  background: var(--ct-surface, #ffffff);
  color: var(--ct-text, #2e1065);
  border: 1px solid var(--ct-border, rgba(0, 0, 0, 0.10));
  border-radius: 0.75rem;
  box-shadow:
    0 0.5rem 1.5rem rgba(0, 0, 0, 0.18),
    0 0.125rem 0.375rem rgba(0, 0, 0, 0.12);
  overflow: hidden;
  font-size: 0.8125rem; line-height: 1.5;
  overflow-wrap: anywhere;
}

/* ---------- 顶栏（小窗自己的那行，不是官方顶栏） ---------- */
.dsh-chat-card__header {
  display: flex; flex-direction: column; gap: 0.125rem;
  padding: 0.5rem 0.5rem 0.4375rem 0.75rem;
  border-bottom: 1px solid var(--ct-border, rgba(0,0,0,0.08));
  flex: 0 0 auto;
}
.dsh-chat-card__title {
  font-weight: 600; flex: 1 1 auto; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-chat-card__actions { display: flex; align-items: center; gap: 0.0625rem; flex: 0 0 auto; }

/* ---------- 真 GUI 模式（iframe 指向 sidecar 的同源反代） ---------- */
.dsh-chat-card__header.is-compact { flex-direction: row; align-items: center; gap: 0.375rem; padding: 0.3125rem 0.375rem 0.3125rem 0.625rem; }
.dsh-chat-card__frame {
  flex: 1 1 auto; min-height: 0; width: 100%; border: 0;
  background: var(--ct-surface, #ffffff);
}
.dsh-chat-card__actions button { min-width: 1.5rem; }
/* 旧版镜像卡事件的兜底提示（镜像模式已移除） */
.dsh-chat-card__legacy {
  flex: 1 1 auto; display: flex; align-items: center; justify-content: center;
  padding: 1rem 1.25rem; text-align: center;
  color: var(--ct-text-muted, #8a94a6); font-size: 0.75rem; line-height: 1.6;
}

/* ---------- 状态通知卡（dsh-chat.notice）：agent-notify 风格状态卡 ----------
   徽标 + 标题 + 状态 chip + 项目路径 + 最新输出正文；没有 footer，正文点击原地展开官方界面。
   视觉借鉴 agent-notify：左侧 0.25rem 状态色边框条（--accent，随状态琥珀/绿/紫）+
   彩色状态 chip + 正文悬停下划线；主题变量内联到根节点。 */
.dsh-chat-notice {
  width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column;
  background: var(--ct-surface, #ffffff);
  color: var(--ct-text, #2e1065);
  border: 1px solid var(--ct-border, rgba(0, 0, 0, 0.10));
  /* 状态色条 = 左边框本体（--accent 随状态琥珀/绿/紫）：border 天然跟随圆角、
     全高贯通，不会被 iframe/正文盖住，也没有 inset 阴影在圆角处的楔形缺损 */
  border-left: 0.25rem solid var(--accent, #64748b);
  border-radius: 0.75rem;
  box-shadow:
    0 0.5rem 1.5rem rgba(0, 0, 0, 0.18),
    0 0.125rem 0.375rem rgba(0, 0, 0, 0.12);
  overflow: hidden;
  font-size: 0.8125rem; line-height: 1.5;
  overflow-wrap: anywhere;
}
.dsh-chat-notice__bar {
  display: flex; align-items: center; gap: 0.375rem;
  padding: 0.375rem 0.5rem 0.125rem 0.875rem;
  min-width: 0;
}
.dsh-chat-notice__badge {
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 auto; width: 2rem; height: 2rem; border-radius: 0.625rem;
  background: #ffffff; overflow: hidden;
}
.dsh-chat-notice__title {
  flex: 1 1 auto; min-width: 0; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-chat-notice__chip {
  flex: 0 0 auto; display: inline-flex; align-items: center;
  height: 1.125rem; padding: 0 0.4375rem; border-radius: 0.25rem;
  font-size: 0.6875rem; font-weight: 600; line-height: 1; white-space: nowrap;
  background: var(--badge-bg, #f3f4f6); color: var(--badge-fg, #4b5563);
  border: 0.0625rem solid var(--border, rgba(15, 23, 42, 0.08));
}
.dsh-chat-notice__close {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 1.5rem; height: 1.5rem; margin: 0; padding: 0;
  border: none; border-radius: 0.375rem; background: transparent;
  color: var(--ct-text-subtle, #94a3b8); font-size: 1rem; line-height: 1; cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.dsh-chat-notice__close:hover { background: #fff1f2; color: #e11d48; }
.dsh-chat-notice__preview {
  margin: 0; /* <p> 的 UA 默认上下外边距不归零，标题和正文之间会凭空多出一条空带 */
  padding: 0 0.625rem 0.4375rem 0.875rem;
  color: var(--ct-text-muted, #8a94a6); font-size: 0.75rem;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
/* 正文就是入口：点击原地展开官方界面（agent-notify 的可点文本观感） */
.dsh-chat-notice__preview.is-interactive { cursor: pointer; }
.dsh-chat-notice__preview.is-interactive:hover {
  text-decoration: underline; text-decoration-color: rgba(15, 23, 42, 0.35); text-underline-offset: 3px;
}
.dsh-chat-notice__preview.is-error { color: #b42318; }
/* 展开态：状态卡原地长高，正文区换成 DSH 的对话交互区（官方 GUI iframe） */
.dsh-chat-notice.is-expanded { height: 30rem; }
.dsh-chat-notice__body {
  flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column;
  border-top: 1px solid var(--ct-border, rgba(0, 0, 0, 0.08));
}
.dsh-chat-notice__frame {
  flex: 1 1 auto; min-height: 0; width: 100%; border: 0;
  background: var(--ct-surface, #ffffff);
}
.dsh-chat-notice__loading,
.dsh-chat-notice__error {
  flex: 1 1 auto; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 0.5rem;
  color: var(--ct-text-muted, #8a94a6); padding: 1rem; text-align: center;
  overflow-wrap: anywhere;
}
.dsh-chat-notice__error { color: #b42318; }
.dsh-chat-notice__retry {
  border: 1px solid var(--ct-border, rgba(0, 0, 0, 0.12)); border-radius: 0.375rem;
  background: transparent; color: var(--ct-text, #2e1065);
  font-size: 0.75rem; padding: 0.1875rem 0.625rem; cursor: pointer;
}
.dsh-chat-notice__retry:hover { border-color: var(--ct-accent, #7c3aed); color: var(--ct-accent, #7c3aed); }
.dsh-chat-notice__collapse {
  flex: 0 0 auto; display: inline-flex; align-items: center;
  height: 1.25rem; padding: 0 0.4375rem; border-radius: 0.25rem;
  border: 1px solid var(--ct-border, rgba(0, 0, 0, 0.10)); background: transparent;
  color: var(--ct-text-muted, #8a94a6); font-size: 0.6875rem; font-weight: 600; line-height: 1;
  cursor: pointer; transition: border-color 0.15s ease, color 0.15s ease;
}
.dsh-chat-notice__collapse:hover { border-color: var(--ct-accent, #7c3aed); color: var(--ct-accent, #7c3aed); }
`

/**
 * 注入/更新卡片样式。
 * Toast 窗会跨挂载复用（同一 document），所以不能「有就跳过」——否则改了 ui.mjs 后
 * 老样式一直生效，只有重启应用才看得到新样式。这里发现内容不同就覆盖。
 */
function ensureStyle() {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ID)
  if (existing) {
    if (existing.textContent !== CARD_CSS) existing.textContent = CARD_CSS
    return
  }
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CARD_CSS
  document.head.appendChild(style)
}

/** 重新加载 iframe：改 src 会重挂，用 about:blank 中转一次 */
function reloadFrame(frameRef) {
  const frame = frameRef?.value?.$el ?? frameRef?.value
  if (!frame || typeof frame.src !== 'string') return
  const target = frame.src
  frame.src = 'about:blank'
  window.setTimeout(() => {
    frame.src = target
  }, 50)
}

/** 窗口卡（dsh-chat.window 事件）：官方 GUI iframe；旧版镜像卡的事件渲染"请重开"提示。 */
function setupWindowCard(props, { emit }) {
  const payload = computed(() => (props.event && props.event.payload) || {})
  const guiUrl = computed(() => String(payload.value.guiUrl || ''))

  /** 0.2.x 镜像卡发布的旧事件（无 guiUrl）：镜像模式已删，提示重开一次即可 */
  function renderLegacy() {
    return h('div', { class: 'dsh-chat-card' }, [
      h('div', { class: 'dsh-chat-card__header is-compact' }, [
        h('div', { class: 'dsh-chat-card__title' }, props.event?.title || 'DSH 对话'),
        h('div', { class: 'dsh-chat-card__actions' }, [
          h(NButton, { size: 'tiny', quaternary: true, onClick: () => emit('close') }, { default: () => '×' }),
        ]),
      ]),
      h(
        'div',
        { class: 'dsh-chat-card__legacy' },
        '这张小窗是旧版本的镜像卡，镜像模式已经移除。关掉它，点状态卡的正文即可展开官方界面。',
      ),
    ])
  }

  function renderGui() {
    const frameRef = ref(null)
    // 官方顶栏被去装饰隐藏了，所以标题显示"会话标题"（拿不到才退回 id）
    const label = payload.value.guiTitle || payload.value.guiSessionId || 'DSH'
    return h('div', { class: 'dsh-chat-card is-gui' }, [
      h('div', { class: 'dsh-chat-card__header is-compact' }, [
        h(
          'div',
          { class: 'dsh-chat-card__title', title: `${label}\n${payload.value.guiSessionId || ''}` },
          label,
        ),
        h('div', { class: 'dsh-chat-card__actions' }, [
          NTooltip
            ? h(NTooltip, null, {
                trigger: () =>
                  h(NButton, { size: 'tiny', quaternary: true, onClick: () => reloadFrame(frameRef) }, { default: () => '⟳' }),
                default: () => '重新加载官方界面',
              })
            : null,
          h(NButton, { size: 'tiny', quaternary: true, onClick: () => emit('close') }, { default: () => '×' }),
        ]),
      ]),
      h('iframe', {
        class: 'dsh-chat-card__frame',
        src: guiUrl.value,
        ref: frameRef,
        // 不加 sandbox：sandbox 会让页面变成 opaque origin，DSH 的信任栅栏直接 403
        allow: 'clipboard-read; clipboard-write',
        onLoad: () => window.setTimeout(() => frameRef.value?.focus?.(), 0),
      }),
    ])
  }

  return () => (guiUrl.value ? renderGui() : renderLegacy())
}

/** 状态卡的徽标：官方托盘鲸鱼（DSH Desktop resources/app/build/tray-icon.svg，viewBox 0 0 50 50），蓝底白鲸 */
const DSH_WHALE_PATH = 'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z'

/** 状态 → chip 文案与主题（配色对齐 agent-notify 的 EVENT_THEMES） */
const NOTICE_STATUS_META = {
  running: { label: '进行中' },
  done: { label: '已完成' },
  waiting: { label: '等你审批' },
}

/** running 对齐 PreToolUse（琥珀=干活）、done 对齐 Stop（绿=完成）、waiting 对齐 Notification（紫=需要你回来） */
const NOTICE_THEMES = {
  running: { accent: '#F59E0B', badgeBg: '#FEF3C7', badgeFg: '#B45309', border: '#FDE68A' },
  done: { accent: '#10B981', badgeBg: '#D1FAE5', badgeFg: '#047857', border: '#6EE7B7' },
  waiting: { accent: '#8B5CF6', badgeBg: '#EDE9FE', badgeFg: '#6D28D9', border: '#DDD6FE' },
}

function noticeThemeStyle(theme) {
  return {
    '--accent': theme.accent,
    '--badge-bg': theme.badgeBg,
    '--badge-fg': theme.badgeFg,
    '--border': theme.border,
  }
}

/**
 * 状态通知卡（dsh-chat.notice 事件）：agent-notify 风格 + 卡内原地展开。
 *
 * 折叠态：徽标 + 标题 + 状态 chip + 项目路径 + 最新输出正文（3 行渐隐）；没有 footer，
 * header 纯展示（无 hover 无点击）。正文就是入口：点击后**同一张卡**原地长高，
 * 正文区换成 DSH 的对话交互区（官方 GUI iframe），header 上出现「收起」按钮。
 * 展开期间上报 /notice/view，sidecar 用 sticky 持有（完成也不自动收），收起后恢复计时。
 * 生命周期由 sidecar 巡检驱动（同 dedupeKey 原地刷新），× = 本轮静默。
 */
function setupNoticeCard(props, { emit }) {
  const payload = computed(() => (props.event && props.event.payload) || {})
  const sessionId = computed(() => String(payload.value.sessionId || ''))
  const status = computed(() => (NOTICE_STATUS_META[payload.value.status] ? payload.value.status : 'running'))
  const statusMeta = computed(() => NOTICE_STATUS_META[status.value])
  // chip 文案以 sidecar 给的 statusLabel 为准（等你审批 / 等你回答 / 计划待审），
  // 旧版宿主或测试卡没带就用状态默认文案
  const statusLabel = computed(() => {
    const label = String(payload.value.statusLabel || '').trim()
    return label.length > 0 ? label : statusMeta.value.label
  })
  const title = computed(() => props.event?.title || sessionId.value || 'DSH 任务')
  const preview = computed(() => String(payload.value.preview || ''))
  const expanded = ref(false)
  const guiUrl = ref('')
  const guiError = ref('')
  const guiLoading = ref(false)
  let disposed = false

  async function call(method, params = {}) {
    const port = Number(payload.value.httpPort) || 23457
    const token = String(payload.value.httpToken || '')
    const base = `http://127.0.0.1:${port}`
    const headers = token ? { 'X-Dsh-Chat-Token': token } : {}
    let url = base
    let init = { headers }
    if (method === 'gui') {
      url = `${base}/gui`
      init = { ...init, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: params.sessionId ?? '' }) }
    } else if (method === 'view') {
      url = `${base}/notice/view`
      init = { ...init, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: params.sessionId ?? '', expanded: params.expanded !== false }) }
    } else {
      throw new Error(`状态卡不支持的方法：${method}`)
    }
    let response
    try {
      response = await fetch(url, init)
    } catch (cause) {
      throw new Error(`本机 HTTP 桥连不上（127.0.0.1:${port}）：${cause?.message || cause}`)
    }
    let data = null
    try {
      data = await response.json()
    } catch {
      throw new Error(`HTTP ${response.status}：返回不是 JSON`)
    }
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`)
    return data.result
  }

  /** 展开/收起上报：sidecar 把该会话置为 sticky 持有（正在看，完成也不自动收） */
  function notifyView(value) {
    if (!sessionId.value) return Promise.resolve()
    return call('view', { sessionId: sessionId.value, expanded: value }).catch(() => {})
  }

  async function ensureGui() {
    if (guiUrl.value) return
    guiLoading.value = true
    guiError.value = ''
    try {
      const res = await call('gui', { sessionId: sessionId.value })
      guiUrl.value = res?.guiUrl || ''
      if (!guiUrl.value) throw new Error('sidecar 没有返回 GUI 地址')
    } catch (cause) {
      guiError.value = cause?.message || String(cause)
    } finally {
      guiLoading.value = false
    }
  }

  async function expand() {
    if (expanded.value || disposed) return
    expanded.value = true
    void notifyView(true)
    void ensureGui()
  }

  function collapse() {
    if (!expanded.value) return
    expanded.value = false
    // 丢掉 iframe 地址：外观/端口类设置在收起期间可能已改（旧反代被 sidecar 关掉），
    // 下次展开重新 /gui 取一次，保证拿到的是新配置的界面
    guiUrl.value = ''
    guiError.value = ''
    void notifyView(false)
  }

  function toggle() {
    if (expanded.value) collapse()
    else void expand()
  }

  // 审批自动展开：sidecar 发出 waiting + autoExpand → 卡内原地展开对话交互区
  const stopAutoExpandWatch = watch
    ? watch(
        () => payload.value.autoExpand === true,
        (wanted) => {
          if (wanted && !expanded.value && !disposed) void expand()
        },
      )
    : null

  onBeforeUnmount(() => {
    disposed = true
    if (typeof stopAutoExpandWatch === 'function') stopAutoExpandWatch()
    if (expanded.value && sessionId.value) {
      // 收尾上报带 keepalive：Toast 窗被关时也尽量把「已收起」带给 sidecar
      try {
        const port = Number(payload.value.httpPort) || 23457
        const token = String(payload.value.httpToken || '')
        void fetch(`http://127.0.0.1:${port}/notice/view`, {
          method: 'POST',
          keepalive: true,
          headers: { ...(token ? { 'X-Dsh-Chat-Token': token } : {}), 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId.value, expanded: false }),
        }).catch(() => {})
      } catch {
        /* 尽力而为 */
      }
    }
  })

  function renderBar() {
    // 注意别挂 title 属性：原生 tooltip 会弹白框盖在卡上
    return h('div', { class: 'dsh-chat-notice__bar' }, [
      h('span', { class: 'dsh-chat-notice__badge', title: 'DSH · DeepSeek Harness' }, [
        h('svg', { viewBox: '0 0 50 50', width: '1.25rem', height: '1.25rem', 'aria-hidden': 'true' }, [
          h('path', { d: DSH_WHALE_PATH, fill: '#4D6BFE' }),
        ]),
      ]),
      h('span', { class: 'dsh-chat-notice__title' }, title.value),
      h('span', { class: 'dsh-chat-notice__chip' }, statusLabel.value),
      expanded.value
        ? h('button', { class: 'dsh-chat-notice__collapse', type: 'button', onClick: collapse }, '收起')
        : null,
      h('button', {
        class: 'dsh-chat-notice__close',
        type: 'button',
        onClick: (e) => {
          e.stopPropagation()
          emit('close')
        },
      }, '×'),
    ])
  }

  /** 展开态的主体：对话交互区（官方 GUI iframe）/ 连接失败重试 */
  function renderBodyArea() {
    if (guiError.value) {
      return [
        h('div', { class: 'dsh-chat-notice__error' }, [
          h('div', null, `连不上 DSH 官方界面：${guiError.value}`),
          h('button', {
            class: 'dsh-chat-notice__retry',
            type: 'button',
            onClick: (e) => {
              e.stopPropagation()
              void ensureGui()
            },
          }, '重试'),
        ]),
      ]
    }
    if (!guiUrl.value) {
      return [h('div', { class: 'dsh-chat-notice__loading' }, guiLoading.value ? '正在连接 DSH 官方界面…' : '准备中…')]
    }
    return [
      h('iframe', {
        class: 'dsh-chat-notice__frame',
        src: guiUrl.value,
        // 不加 sandbox：sandbox 会让页面变成 opaque origin，DSH 的信任栅栏直接 403
        allow: 'clipboard-read; clipboard-write',
      }),
    ]
  }

  function renderBody() {
    if (expanded.value) {
      return h('div', { class: 'dsh-chat-notice__body' }, renderBodyArea())
    }
    const text = preview.value || '点击查看对话'
    return h('p', { class: ['dsh-chat-notice__preview', 'is-interactive'], onClick: toggle }, text)
  }

  return () =>
    h(
      'div',
      {
        class: `dsh-chat-notice${expanded.value ? ' is-expanded' : ''}`,
        style: noticeThemeStyle(NOTICE_THEMES[status.value] ?? NOTICE_THEMES.running),
      },
      [renderBar(), renderBody()],
    )
}

/**
 * 卡片入口：按事件类型分流（宿主按 kind 找插件、加载这一个组件）。
 *  - dsh-chat.notice → 状态通知卡（正文点击 ⇄ 原地展开官方界面）
 *  - dsh-chat.window → 常驻小窗（官方 GUI）
 */
const DshChatWindowCard = {
  name: 'DshChatWindowCard',
  props: {
    event: { type: Object, required: true },
    isHovered: { type: Boolean, default: false },
  },
  emits: ['close', 'action'],
  setup(props, ctx) {
    // 两类卡片共用一份 CARD_CSS：谁先挂载谁负责注入/更新（状态卡独立挂载时也必须有样式）
    ensureStyle()
    const isNotice =
      props.event?.event_type === 'dsh-chat.notice' || props.event?.payload?.notice === true
    return isNotice ? setupNoticeCard(props, ctx) : setupWindowCard(props, ctx)
  },
}

/** 默认导出即卡片组件；宿主同时兼容 `default` / `Card` 两种取法。 */
export default DshChatWindowCard
export const Card = DshChatWindowCard
