/** DSH React cards: official GUI iframe and expandable local status notice. */
const { createElement: h, useState, useEffect, useRef } = globalThis.__CATRACE_REACT__ || {}
const { Button } = globalThis.__CATRACE_RADIX__ || {}
if (typeof h !== 'function' || !Button) throw new Error('Catrace React/Radix runtime missing')

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

/* ---------- 状态通知卡（dsh-chat.notice）：方案 2 · Ambient Fluid Aura ----------
   保留参考方案 2 的内部状态光晕、边框和阴影；桌面通知改用不透明白底，
   不采样或模糊卡片背后的窗口/壁纸，确保不同背景下底色和可读性稳定。
   内部光晕仍半透明并独立模糊；不画底沿进度流丝。 */
.dsh-chat-notice {
  width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column;
  color: var(--ct-text, #2e1065);
  position: relative;
  isolation: isolate;
  border-radius: 1rem; /* rounded-2xl */
  overflow: hidden;
  font-size: 0.8125rem; line-height: 1.5;
  overflow-wrap: anywhere;
  /* 不透明底隔离桌面背景；只模糊内部光晕，不使用 backdrop-filter */
  background: #ffffff;
  /* border-slate-200/90 */
  border: 1px solid rgba(226, 232, 240, 0.9);
  /* shadow-2xl shadow-black/20 */
  box-shadow: 0 1.5625rem 3.125rem -0.75rem rgba(0, 0, 0, 0.2);
  /* 参考的 transition-all duration-300；这里只过渡状态色，避免连展开高度一起动画 */
  transition: background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}
/* 状态色 border + shadow（对应参考里 toastCard.className 的整串覆盖） */
.dsh-chat-notice.is-running {
  border-color: #93c5fd; /* border-blue-300 */
  box-shadow: 0 1.5625rem 3.125rem -0.75rem rgba(59, 130, 246, 0.15); /* shadow-2xl shadow-blue-500/15 */
}
.dsh-chat-notice.is-done {
  border-color: rgba(167, 243, 208, 0.8); /* border-emerald-200/80 */
  box-shadow: /* shadow-xl */
    0 1.25rem 1.5625rem -0.3125rem rgba(0, 0, 0, 0.1),
    0 0.5rem 0.625rem -0.375rem rgba(0, 0, 0, 0.1);
}
.dsh-chat-notice.is-waiting {
  border-color: rgba(253, 230, 138, 0.8); /* border-amber-200/80 */
  box-shadow:
    0 1.25rem 1.5625rem -0.3125rem rgba(0, 0, 0, 0.1),
    0 0.5rem 0.625rem -0.375rem rgba(0, 0, 0, 0.1);
}
.dsh-chat-notice.is-error {
  border-color: rgba(253, 164, 175, 0.8); /* border-rose-200/80 */
  box-shadow:
    0 1.25rem 1.5625rem -0.3125rem rgba(0, 0, 0, 0.1),
    0 0.5rem 0.625rem -0.375rem rgba(0, 0, 0, 0.1);
}
/* 弥散流体层 = 参考里的 #ambientGlowLayer（inset-0，压在内容之下） */
.dsh-chat-notice::before {
  content: ''; position: absolute; z-index: 0; inset: 0;
  pointer-events: none;
}
.dsh-chat-notice.is-running::before {
  /* 增强蓝色识别度：蓝为主色，青/靛为流动层次；保留参考的弥散结构 */
  background-image: linear-gradient(to right,
    rgba(59, 130, 246, 0.24), rgba(34, 211, 238, 0.18), rgba(99, 102, 241, 0.20));
  background-size: 200% 200%;
  filter: blur(1.5rem); /* blur-xl */
  animation: dsh-chat-ambient-aura 6s ease-in-out infinite;
}
.dsh-chat-notice.is-done::before { background-color: rgba(16, 185, 129, 0.14); } /* 增强绿色识别度，仍保持浅底 */
.dsh-chat-notice.is-waiting::before { background-color: rgba(245, 158, 11, 0.05); } /* bg-amber-500/5 */
.dsh-chat-notice.is-error::before { background-color: rgba(244, 63, 94, 0.14); } /* 明确红色错误底色，仍保持浅底可读 */
.dsh-chat-notice__statusline { display: none; } /* 参考底部流丝按用户要求去掉 */
.dsh-chat-notice > :not(.dsh-chat-notice__statusline) { position: relative; z-index: 1; }
@keyframes dsh-chat-ambient-aura {
  0% { background-position: 0% 50%; opacity: 0.6; }
  50% { background-position: 100% 50%; opacity: 0.9; }
  100% { background-position: 0% 50%; opacity: 0.6; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-chat-notice.is-running::before { animation: none; opacity: 0.75; }
}
.dsh-chat-notice__bar {
  display: flex; align-items: center; gap: 0.375rem;
  padding: 0.625rem 0.5rem 0.125rem 0.75rem;
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
    if (existing.textContent !== CARD_CSS) existing.textContent = plugin.theme.css(CARD_CSS)
    return
  }
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = plugin.theme.css(CARD_CSS)
  document.head.appendChild(style)
}

const DSH_WHALE_PATH = 'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z'

/** 状态 → chip 文案与主题（配色对齐 agent-notify 的 EVENT_THEMES） */
const NOTICE_STATUS_META = {
  running: { label: '进行中' },
  done: { label: '已完成' },
  waiting: { label: '等你处理' },
  error: { label: '处理失败' },
}

/** running 蓝色=工作中、done 绿色=完成、waiting 黄色=需要你处理 */
const NOTICE_THEMES = {
  running: { accent: '#3B82F6', badgeBg: '#DBEAFE', badgeFg: '#1D4ED8', border: 'rgba(147,197,253,0.9)' },
  done: { accent: '#10B981', badgeBg: '#ECFDF5', badgeFg: '#047857', border: 'rgba(167,243,208,0.9)' },
  waiting: { accent: '#F59E0B', badgeBg: '#FFFBEB', badgeFg: '#B45309', border: 'rgba(253,230,138,0.9)' },
  error: { accent: '#F43F5E', badgeBg: '#FFF1F2', badgeFg: '#BE123C', border: 'rgba(253,164,175,0.9)' },
}

function noticeThemeStyle(theme) {
  return {
    '--accent': plugin.theme.css(theme.accent),
    '--badge-bg': plugin.theme.css(theme.badgeBg),
    '--badge-fg': plugin.theme.css(theme.badgeFg),
    '--border': plugin.theme.css(theme.border),
  }
}

function DshWindowCard({event={},onClose}) {
  const payload=event.payload || {}
  const frameRef=useRef(null)
  const reloadTimer=useRef(null)
  const [linkError,setLinkError]=useState('')
  useEffect(() => () => {if(reloadTimer.current)clearTimeout(reloadTimer.current)},[])
  const guiUrl=String(payload.guiUrl || '')
  const label=payload.guiTitle || payload.guiSessionId || event.title || 'DSH'
  function reload() {
    const frame=frameRef.current
    if(!frame)return
    frame.src='about:blank'
    if(reloadTimer.current)clearTimeout(reloadTimer.current)
    reloadTimer.current=setTimeout(() => {if(frameRef.current===frame)frame.src=guiUrl},50)
  }
  async function openExternal() {
    try {await plugin.shell.openExternal(guiUrl)}catch(error){setLinkError(error?.message || String(error))}
  }
  return h('div',{className:'dsh-chat-card is-gui'},
    h('div',{className:'dsh-chat-card__header is-compact'},h('div',{className:'dsh-chat-card__title',title:`${label}\n${payload.guiSessionId || ''}`},label),
      h('div',{className:'dsh-chat-card__actions'},
        guiUrl ? h(Button,{size:'1',variant:'ghost',title:'在浏览器打开官方界面','aria-label':'在浏览器打开官方界面',onClick:() => void openExternal()},'↗') : null,
        guiUrl ? h(Button,{size:'1',variant:'ghost',title:'重新加载官方界面','aria-label':'重新加载官方界面',onClick:reload},'⟳') : null,
        h(Button,{size:'1',variant:'ghost','aria-label':'关闭卡片',onClick:() => onClose?.()},'×'))),
    linkError ? h('div',{className:'dsh-chat-notice__error',role:'alert'},linkError) : null,
    guiUrl ? h('iframe',{className:'dsh-chat-card__frame',src:guiUrl,ref:frameRef,title:String(label),allow:'clipboard-read; clipboard-write',onLoad:() => frameRef.current?.focus?.()})
      : h('div',{className:'dsh-chat-card__legacy'},'没有收到官方界面地址。关闭本卡片，点击状态卡正文重新展开官方界面。'))
}

function DshNoticeCard({event={},onClose}) {
  const payload=event.payload || {}
  const sessionId=String(payload.sessionId || '')
  const status=NOTICE_STATUS_META[payload.status] ? payload.status : 'running'
  const label=String(payload.statusLabel || '').trim() || NOTICE_STATUS_META[status].label
  const title=event.title || sessionId || 'DSH 任务'
  const [expanded,setExpanded]=useState(false)
  const [guiUrl,setGuiUrl]=useState('')
  const [guiError,setGuiError]=useState('')
  const [guiLoading,setGuiLoading]=useState(false)
  const payloadRef=useRef(payload)
  payloadRef.current=payload
  const expandedRef=useRef(false)
  const collapsedWaitingReason=useRef(null)
  const alive=useRef(true)
  const generation=useRef(0)
  const loadingRef=useRef(false)
  const frameRef=useRef(null)
  async function call(method,params={},keepalive=false) {
    const current=payloadRef.current
    const port=Number(current.httpPort) || 23457
    const token=String(current.httpToken || '')
    const path=method==='gui' ? '/gui' : '/notice/view'
    const headers={...(token ? {'X-Dsh-Chat-Token':token} : {}),'Content-Type':'application/json'}
    let response
    try {
      response=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers,keepalive,body:JSON.stringify(params)})
    } catch(error){throw new Error(`本机 HTTP 桥连不上（127.0.0.1:${port}）：${error?.message || error}`)}
    const data=await response.json().catch(() => {throw new Error(`HTTP ${response.status}：返回不是 JSON`)})
    if(!response.ok || data?.ok===false)throw new Error(data?.error || `HTTP ${response.status}`)
    return data.result
  }
  function notifyView(value,keepalive=false) {
    if(!sessionId)return Promise.resolve()
    return call('view',{sessionId,expanded:value},keepalive).catch(() => {})
  }
  async function ensureGui() {
    if(loadingRef.current || !alive.current)return
    const request=++generation.current
    loadingRef.current=true
    setGuiLoading(true)
    setGuiError('')
    try {
      const result=await call('gui',{sessionId})
      if(!result?.guiUrl)throw new Error('sidecar 没有返回 GUI 地址')
      if(alive.current && expandedRef.current && request===generation.current)setGuiUrl(result.guiUrl)
    } catch(error){if(alive.current && request===generation.current)setGuiError(error?.message || String(error))}
    finally {if(request===generation.current){loadingRef.current=false;if(alive.current)setGuiLoading(false)}}
  }
  function expand() {
    if(expandedRef.current || !alive.current)return
    collapsedWaitingReason.current=null
    expandedRef.current=true
    setExpanded(true)
    void notifyView(true)
    void ensureGui()
  }
  function collapse() {
    if(!expandedRef.current)return
    collapsedWaitingReason.current=status === 'waiting' ? String(payload.waitKind || label) : null
    expandedRef.current=false
    generation.current+=1
    loadingRef.current=false
    setExpanded(false)
    setGuiUrl('')
    setGuiError('')
    setGuiLoading(false)
    void notifyView(false)
  }
  useEffect(() => {
    alive.current=true
    return () => {
      alive.current=false
      generation.current+=1
      if(expandedRef.current)void notifyView(false,true)
    }
  },[])
  useEffect(() => {
    if(status !== 'waiting')collapsedWaitingReason.current=null
    const waitingReason=String(payload.waitKind || label)
    if(payload.autoExpand===true && collapsedWaitingReason.current!==waitingReason)expand()
  },[payload.autoExpand,payload.waitKind,label,status])
  async function openExternal() {
    if(!guiUrl)return
    try {await plugin.shell.openExternal(guiUrl)}catch(error){if(alive.current)setGuiError(error?.message || String(error))}
  }
  let content
  if(!expanded) content=h('p',{className:'dsh-chat-notice__preview is-interactive',role:'button',tabIndex:0,onClick:expand,onKeyDown:event => {if(event.key==='Enter'||event.key===' '){event.preventDefault();expand()}}},String(payload.preview || '点击查看对话'))
  else content=h('div',{className:'dsh-chat-notice__body'},
    guiError ? h('div',{className:'dsh-chat-notice__error',role:'alert'},h('div',null,`连不上 DSH 官方界面：${guiError}`),
      h('button',{className:'dsh-chat-notice__retry',type:'button',onClick:event => {event.stopPropagation();void ensureGui()}},'重试'))
      : guiUrl ? h('iframe',{className:'dsh-chat-notice__frame',src:guiUrl,ref:frameRef,title:String(title),allow:'clipboard-read; clipboard-write'})
        : h('div',{className:'dsh-chat-notice__loading',role:'status'},guiLoading ? '正在连接 DSH 官方界面…' : '准备中…'))
  return h('div',{className:`dsh-chat-notice is-${status}${expanded ? ' is-expanded' : ''}`,style:noticeThemeStyle(NOTICE_THEMES[status])},
    h('div',{className:'dsh-chat-notice__statusline','aria-hidden':true}),
    h('div',{className:'dsh-chat-notice__bar'},
      h('span',{className:'dsh-chat-notice__badge',title:'DSH · DeepSeek Harness'},h('svg',{viewBox:'0 0 50 50',width:'1.25rem',height:'1.25rem','aria-hidden':true},h('path',{d:DSH_WHALE_PATH,fill:'#4D6BFE'}))),
      h('span',{className:'dsh-chat-notice__title'},title),h('span',{className:'dsh-chat-notice__chip'},label),
      expanded && guiUrl ? h('button',{className:'dsh-chat-notice__collapse',type:'button','aria-label':'在浏览器打开官方界面',onClick:() => void openExternal()},'↗') : null,
      expanded ? h('button',{className:'dsh-chat-notice__collapse',type:'button',onClick:collapse},'收起') : null,
      h('button',{className:'dsh-chat-notice__close',type:'button','aria-label':'关闭卡片',onClick:event => {event.stopPropagation();onClose?.()}},'×')),
    content)
}

export default function DshChatWindowCard({event={},isHovered=false,onClose,onAction}) {
  useEffect(ensureStyle,[])
  const notice=(event.event_type || event.eventType)==='dsh-chat.notice' || event.payload?.notice===true
  const props={event,isHovered,onClose,onAction}
  return notice ? h(DshNoticeCard,{...props,key:event.payload?.sessionId || 'notice'}) : h(DshWindowCard,props)
}
export { DshChatWindowCard as Card }
