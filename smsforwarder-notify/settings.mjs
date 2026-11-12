/** SmsForwarder settings: HeroUI controls from the host runtime; config/RPC contracts remain framework-independent. */
const React = globalThis.__CATRACE_REACT__ || {}
const HeroUI = globalThis.__CATRACE_HEROUI__ || {}
const { createElement: h, Fragment, useState, useEffect, useRef } = React
const {
  AlertContent, AlertDescription, AlertIndicator, AlertRoot,
  AlertDialogBackdrop, AlertDialogBody, AlertDialogCloseTrigger, AlertDialogContainer, AlertDialogDialog,
  AlertDialogFooter, AlertDialogHeader, AlertDialogHeading, AlertDialogIcon, AlertDialogRoot,
  Button, Chip, Input,
  ListBox, ListBoxItem,
  NumberFieldDecrementButton, NumberFieldGroup, NumberFieldIncrementButton, NumberFieldInput, NumberFieldRoot,
  SelectIndicator, SelectPopover, SelectRoot, SelectTrigger, SelectValue,
  SwitchContent, SwitchControl, SwitchRoot, SwitchThumb,
  Tab, TabIndicator, TabList, TabListContainer, TabPanel, TabsRoot,
} = HeroUI
if (typeof h !== 'function' || !Button || !Input || !SwitchRoot || !SelectRoot || !NumberFieldRoot || !TabsRoot || !TabListContainer || !AlertDialogRoot) {
  throw new Error('Catrace React/HeroUI runtime missing')
}
if (!plugin?.config || !plugin.events) throw new Error('Catrace plugin facade missing')

const PLUGIN_ID = 'smsforwarder-notify'
const MIN_PORT = 1024
const MAX_PORT = 65535
const DEFAULT_PORT = 17890
const DEFAULT_PATH = '/webhook'
const MIN_CARD_SEC = 0
const MAX_CARD_SEC = 600
const DEFAULT_CARD_SEC = 10
const MIN_DEDUPE_SEC = 0
const MAX_DEDUPE_SEC = 300
const DEFAULT_DEDUPE_SEC = 5

const STYLE_ID = 'catrace-plugin-smsforwarder-notify-settings-css-react-20261111'
const CSS = `
.sf-settings {
  width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 0.75rem;
  color: var(--ct-text);
}
.sf-settings *, .sf-settings *::before, .sf-settings *::after { box-sizing: border-box; }
.sf-settings .sf-section {
  display: flex; flex-direction: column; gap: 0.75rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--ct-border-card);
  border-radius: 1rem;
  background: var(--ct-surface);
  box-shadow: var(--ct-shadow-card);
}
.sf-settings .sf-section.is-error { border-color: var(--ct-error); }
.sf-settings .sf-section.is-error .sf-section-head h2 { color: var(--ct-error-strong); }
.sf-settings .sf-section-head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.sf-settings .sf-section-head h2 { margin: 0; font-size: 0.9375rem; font-weight: 700; color: var(--ct-text); }
.sf-settings .sf-desc { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: var(--ct-text-muted); }
.sf-settings .sf-field { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; flex: 1; }
.sf-settings .sf-label { font-size: 0.75rem; font-weight: 600; color: var(--ct-text-muted); }
.sf-settings .sf-hint { margin: 0; font-size: 0.6875rem; color: var(--ct-text-subtle); line-height: 1.45; }
.sf-settings .sf-row-inline { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.sf-settings .sf-num { width: 9rem; }
.sf-settings .sf-input-token { flex: 1; min-width: 12rem; }
.sf-settings .sf-select { width: 100%; min-width: 0; }
.sf-settings .sf-unit { font-size: 0.75rem; color: var(--ct-text-muted); font-weight: 600; }
.sf-settings .sf-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.sf-settings .sf-status {
  display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem;
  padding: 0.625rem 0.75rem; border-radius: 0.5rem; background: var(--ct-surface-2);
  font-size: 0.75rem; color: var(--ct-text);
}
.sf-settings .sf-status.is-error { background: var(--ct-error-soft); color: var(--ct-error-strong); }
.sf-settings .sf-status strong { color: var(--ct-accent); font-weight: 650; }
.sf-settings .sf-status.is-error strong { color: var(--ct-error-strong); }
.sf-settings .sf-status span { color: var(--ct-text-muted); }
.sf-settings .sf-status.is-error span { color: var(--ct-error-strong); }
.sf-settings .sf-mono {
  font-family: var(--ct-font-mono);
  font-size: 0.75rem; line-height: 1.45;
  padding: 0.5rem 0.625rem; border-radius: 0.5rem;
  background: var(--ct-surface-2); color: var(--ct-text); word-break: break-all; white-space: pre-wrap;
  border: 1px solid var(--ct-border); margin: 0;
  user-select: text; -webkit-user-select: text; cursor: text;
}
.sf-settings .sf-copy-row { display: flex; align-items: flex-start; gap: 0.5rem; }
.sf-settings .sf-copy-row .sf-mono { flex: 1; min-width: 0; }
.sf-settings .sf-url-list { display: flex; flex-direction: column; gap: 0.375rem; }
.sf-settings .sf-tab-panel { display: flex; flex-direction: column; gap: 0.75rem; }
.sf-settings .sf-config-fields {
  border: 0; margin: 0; padding: 0; min-width: 0;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.sf-settings .sf-chip {
  max-width: 100%; height: auto; white-space: normal;
  display: inline-flex; align-items: center; gap: 0.375rem;
}
.sf-settings .sf-chip-text {
  min-width: 0; overflow-wrap: anywhere; word-break: break-word; white-space: normal; line-height: 1.4;
}
.sf-settings .sf-chip-remove {
  border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 0 0.125rem;
}
.sf-settings .sf-chip-remove:focus-visible { outline: 0.125rem solid currentColor; outline-offset: 0.125rem; }
.sf-settings .sf-search-add { display: flex; align-items: center; gap: 0.5rem; }
.sf-settings .sf-search-input { flex: 1; min-width: 0; }
.sf-settings .sf-title-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: flex-start; }
.sf-settings .sf-empty-text { margin: 0; font-size: 0.8125rem; color: var(--ct-text-subtle); }
.sf-settings .sf-block-split { display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
@media (min-width: 56rem) {
  .sf-settings .sf-block-split { grid-template-columns: 1fr 1fr; align-items: stretch; }
}
.sf-settings .sf-pane {
  padding: 1rem 1.125rem;
  border: 1px solid var(--ct-border-card);
  border-radius: 1rem;
  background: var(--ct-surface);
  display: flex; flex-direction: column; gap: 0.75rem; min-width: 0;
  max-height: 22rem; overflow: hidden;
}
.sf-settings .sf-pane-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding-right: 0.25rem; margin-right: -0.25rem;
}
.sf-settings .sf-pane-body:empty { display: none; }
.sf-settings .sf-pane-title {
  margin: 0; font-size: 0.9375rem; font-weight: 700; color: var(--ct-text);
  display: inline-flex; align-items: center; gap: 0.5rem;
}
.sf-settings .sf-advanced { padding: 0; gap: 0; overflow: hidden; }
.sf-settings .sf-advanced-toggle {
  width: 100%; justify-content: space-between;
  padding: 1rem 1.25rem; text-align: left; gap: 0.375rem;
  font-size: 0.8125rem; font-weight: 700; color: var(--ct-accent);
}
.sf-settings .sf-advanced-chevron {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1rem; height: 1rem; line-height: 0;
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: center;
  transform: rotate(-90deg);
}
.sf-settings .sf-advanced-chevron svg { width: 0.875rem; height: 0.875rem; display: block; }
.sf-settings .sf-advanced-toggle[aria-expanded="true"] .sf-advanced-chevron { transform: rotate(0deg); }
.sf-settings .sf-advanced-collapse {
  display: grid; grid-template-rows: 0fr;
  margin-top: 0; opacity: 0;
  transition:
    grid-template-rows 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.18s ease;
}
.sf-settings .sf-advanced-collapse.open { grid-template-rows: 1fr; opacity: 1; }
.sf-settings .sf-advanced-collapse-inner { min-height: 0; overflow: hidden; }
.sf-settings .sf-advanced-body {
  display: flex; flex-direction: column; gap: 0.75rem;
  padding: 0 1.25rem 1rem;
}
.sf-settings .sf-advanced-title {
  margin: 0.25rem 0 0; font-size: 0.875rem; font-weight: 750; color: var(--ct-text);
}
.sf-settings .sf-grid-2,
.sf-settings .sf-grid-3 {
  display: grid; gap: 0.75rem; grid-template-columns: 1fr;
}
@media (min-width: 48rem) {
  .sf-settings .sf-grid-2 { grid-template-columns: 1fr 1fr; align-items: stretch; }
  .sf-settings .sf-grid-3 { grid-template-columns: 1fr 1fr 1fr; align-items: stretch; }
}
.sf-settings .sf-tile {
  padding: 1rem;
  border: 1px solid var(--ct-border-card); border-radius: 1rem;
  background: var(--ct-surface); min-width: 0;
  display: flex; flex-direction: column; gap: 0.625rem;
}
.sf-settings .sf-tile-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.sf-settings .sf-tile-title { margin: 0; font-size: 0.875rem; font-weight: 700; color: var(--ct-text); }
.sf-settings .sf-tile-desc { margin: 0; font-size: 0.75rem; line-height: 1.55; color: var(--ct-text-muted); }
.sf-settings .sf-chip-box {
  min-height: 5.5rem;
  padding: 0.5rem;
  border: 1px solid var(--ct-border); border-radius: 0.5rem;
  background: var(--ct-surface-2);
  display: flex; flex-wrap: wrap; gap: 0.375rem; align-content: flex-start;
}
.sf-settings .sf-chip-input { flex: 1 1 8rem; min-width: 8rem; }
.sf-settings .sf-tile-foot {
  margin-top: auto; padding-top: 0.5rem;
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;
  font-size: 0.6875rem; color: var(--ct-text-subtle);
}
.sf-settings .sf-filter-composer {
  display: flex; flex-direction: column; gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--ct-border-card); border-radius: 0.75rem;
  background: var(--ct-surface-2);
}
.sf-settings .sf-filter-composer-title { margin: 0; font-size: 0.8125rem; font-weight: 700; color: var(--ct-text); }
.sf-settings .sf-filter-form {
  display: grid; gap: 0.5rem 0.75rem;
  grid-template-columns: 1fr;
}
.sf-settings .sf-filter-form > .sf-field { min-width: 0; }
.sf-settings .sf-filter-form .sf-label { font-size: 0.6875rem; }
@media (min-width: 40rem) {
  .sf-settings .sf-filter-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 72rem) {
  .sf-settings .sf-filter-form { grid-template-columns: repeat(5, minmax(0, 1fr)); }
}
.sf-settings .sf-filter-add { display: flex; justify-content: flex-end; }
.sf-settings .sf-filter-list-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
  font-size: 0.75rem; color: var(--ct-text-muted);
}
.sf-settings .sf-filter-list {
  display: flex; flex-direction: column; gap: 0.5rem;
  max-height: 16rem; overflow-y: auto;
}
.sf-settings .sf-filter-item {
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--ct-border); border-radius: 0.75rem; background: var(--ct-surface);
}
.sf-settings .sf-filter-item.is-off { opacity: 0.55; }
.sf-settings .sf-filter-item.is-warn { border-color: var(--ct-warning); background: var(--ct-warning-soft); }
.sf-settings .sf-filter-tags { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; min-width: 0; flex: 1; }
.sf-settings .sf-filter-quote {
  font-family: var(--ct-font-mono);
  font-size: 0.75rem; color: var(--ct-text); background: var(--ct-surface-2);
  padding: 0.125rem 0.375rem; border-radius: 0.375rem;
}
.sf-settings .sf-filter-scope { font-size: 0.6875rem; color: var(--ct-text-subtle); }
.sf-settings .sf-filter-alert { width: 100%; }
.sf-settings .sf-alert { margin: 0; }
.sf-settings .sf-step {
  display: flex; gap: 0.75rem; align-items: flex-start;
  padding: 0.875rem 1rem;
  border: 1px solid var(--ct-border-card); border-radius: 0.75rem;
  background: var(--ct-surface);
}
.sf-settings .sf-step-num {
  flex: 0 0 auto;
  width: 1.5rem; height: 1.5rem; border-radius: 50%;
  background: var(--ct-accent); color: var(--ct-on-accent);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.8125rem; font-weight: 700;
}
.sf-settings .sf-step-body { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.sf-settings .sf-step-title { font-size: 0.875rem; font-weight: 700; color: var(--ct-text); }
.sf-settings .sf-step-list {
  margin: 0; padding-left: 1.25rem;
  font-size: 0.8125rem; color: var(--ct-text); line-height: 1.7;
}
.sf-settings .sf-step-list li + li { margin-top: 0.125rem; }
.sf-settings .sf-step-list .sf-step-copy {
  list-style: none;
  display: flex; flex-direction: column; gap: 0.375rem;
  margin-left: -1.25rem; min-width: 0;
}
.sf-settings .sf-step-copy-label { font-size: 0.8125rem; font-weight: 600; color: var(--ct-text); }
.sf-settings .sf-faq {
  display: flex; flex-direction: column; gap: 0.25rem;
  padding: 0.625rem 0; border-bottom: 1px solid var(--ct-border);
}
.sf-settings .sf-faq:last-child { border-bottom: 0; }
.sf-settings .sf-faq-q { font-size: 0.8125rem; font-weight: 700; color: var(--ct-text); }
.sf-settings .sf-faq-a { margin: 0; font-size: 0.75rem; line-height: 1.6; color: var(--ct-text-muted); }
.sf-settings .sf-steps-wrap { display: flex; flex-direction: column; gap: 0.5rem; }
.sf-settings .sf-dl-list { display: flex; flex-direction: column; gap: 0.375rem; }
.sf-settings .sf-dl-item {
  display: flex; flex-direction: column; gap: 0.125rem;
  padding: 0.5rem 0.625rem; border-radius: 0.5rem;
  background: var(--ct-surface-2); border: 1px solid var(--ct-border);
}
.sf-settings .sf-dl-name { font-size: 0.8125rem; font-weight: 600; color: var(--ct-text); }
.sf-settings .sf-dl-name a { color: var(--ct-accent); text-decoration: none; }
.sf-settings .sf-dl-name a:hover { text-decoration: underline; }
.sf-settings .sf-dl-note { margin: 0; font-size: 0.6875rem; color: var(--ct-text-subtle); line-height: 1.45; }
@media (prefers-reduced-motion: reduce) {
  .sf-settings .sf-advanced-chevron,
  .sf-settings .sf-advanced-collapse { transition: none; }
}
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  document.querySelectorAll('style[id^="catrace-plugin-smsforwarder-notify-settings-css"]').forEach(node => { if (node.id !== STYLE_ID) node.remove() })
  let el = document.getElementById(STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = plugin.theme.css(CSS)
}

function clamp(n, min, max, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function normalizePath(raw) {
  let p = String(raw || DEFAULT_PATH).trim() || DEFAULT_PATH
  if (!p.startsWith('/')) p = `/${p}`
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

/** Skip leading whitespace / punctuation so `"短信"` sorts as 短信, not before digits. */
function firstSignificantChar(value) {
  const str = String(value || '')
  for (const ch of str) {
    if (/\s/u.test(ch)) continue
    if (/[\p{P}\p{S}]/u.test(ch)) continue
    return ch
  }
  return ''
}

function blacklistSortRank(value) {
  const ch = firstSignificantChar(value)
  if (!ch) return 3
  if (/\d/u.test(ch)) return 0
  if (/\p{Script=Latin}/u.test(ch)) return 1
  if (/\p{Script=Han}/u.test(ch)) return 2
  return 3
}

/** Digits, then Latin, then CJK by pinyin. Leading quotes/brackets do not change the group. */
function compareBlacklist(a, b) {
  const sa = String(a || '')
  const sb = String(b || '')
  const ra = blacklistSortRank(sa)
  const rb = blacklistSortRank(sb)
  if (ra !== rb) return ra - rb
  return sa.localeCompare(sb, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
}

function sortBlacklist(list) {
  return [...list].sort(compareBlacklist)
}

function blacklistToText(list) {
  if (Array.isArray(list)) return sortBlacklist(list).join('\n')
  return String(list || '')
}

function textToBlacklist(text) {
  return sortBlacklist(
    String(text || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200),
  )
}

const DEFAULT_CONFIG = {
  enabled: true,
  host: '0.0.0.0',
  port: DEFAULT_PORT,
  path: DEFAULT_PATH,
  token: '',
  cardDurationSec: DEFAULT_CARD_SEC,
  dedupeWindowSec: DEFAULT_DEDUPE_SEC,
  appBlacklist: [],
  appBlacklistPaused: [],
  mmsTitleBlacklist: [],
  filters: [],
  hideSensitiveBody: false,
  enableOtpAction: true,
  onlyPushWhenActive: false,
  mergeChatThreads: true,
  chatApps: ['QQ', '微信', 'WeChat', 'TIM', 'Telegram', 'Discord', 'WhatsApp', 'com.tencent.mobileqq', 'com.tencent.mm'],
}

const JSON_TEMPLATE = `{
  "packageName": "{{PACKAGE_NAME}}",
  "appName": "{{APP_NAME}}",
  "title": "{{TITLE}}",
  "body": "{{MSG}}",
  "receivedAt": "{{RECEIVE_TIME}}",
  "uid": "{{UID}}",
  "device": "[device_mark]",
  "timestamp": "[timestamp]"
}`

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'settings', label: '设置' },
  { id: 'tutorial', label: '教程' },
]

const MAX_FILTERS = 50
const FILTER_ACTION_OPTIONS = [
  { label: '不看（屏蔽）', value: 'hide' },
]
const FILTER_FIELD_OPTIONS = [
  { label: '标题', value: 'title' },
  { label: '正文', value: 'body' },
  { label: '应用名', value: 'app' },
  { label: '包名', value: 'package' },
  { label: '任意位置', value: 'any' },
]
const FILTER_MATCH_OPTIONS = [
  { label: '包含文本', value: 'contains' },
  { label: '完全等于', value: 'equals' },
  { label: '开头是', value: 'startsWith' },
  { label: '正则匹配', value: 'regex' },
]
const FILTER_FIELDS = new Set(FILTER_FIELD_OPTIONS.map((o) => o.value))
const FILTER_MATCHES = new Set(FILTER_MATCH_OPTIONS.map((o) => o.value))

function newFilterId() {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeFilter(raw) {
  if (!raw || typeof raw !== 'object') return null
  const field = FILTER_FIELDS.has(raw.field) ? raw.field : 'title'
  const match = FILTER_MATCHES.has(raw.match) ? raw.match : 'contains'
  const value = String(raw.value || '').trim().slice(0, match === 'regex' ? 80 : 200)
  const id = String(raw.id || '').trim().slice(0, 64) || newFilterId()
  const appContains = String(raw.appContains || raw.app || '').trim().slice(0, 100)
  return {
    id,
    enabled: raw.enabled !== false,
    field,
    match,
    value,
    appContains,
  }
}

function normalizeFilters(input) {
  if (!Array.isArray(input)) return []
  const out = []
  const seen = new Set()
  for (const raw of input) {
    if (out.length >= MAX_FILTERS) break
    const f = normalizeFilter(raw)
    if (!f) continue
    if (seen.has(f.id)) f.id = newFilterId()
    seen.add(f.id)
    out.push(f)
  }
  return out
}

function persistableFilters(list) {
  return normalizeFilters(list)
}

function chevronIcon() {
  return h(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      'aria-hidden': 'true',
    },
    ...[
      h('path', {
        d: 'M6 9l6 6 6-6',
        stroke: 'currentColor',
        strokeWidth: '1.8',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    ],
  )
}

function filterTagLabel(f) {
  const value = String(f && f.value ? f.value : '').trim()
  const app = String(f && f.appContains ? f.appContains : '').trim()
  if (app) return `${value} · ${app}`
  return value
}

function optionLabel(options, value, fallback) {
  const hit = options.find((o) => o.value === value)
  return hit ? hit.label : fallback
}

function filterPreview(f) {
  const value = String(f && f.value ? f.value : '').trim()
  const app = String(f && f.appContains ? f.appContains : '').trim()
  const field = optionLabel(FILTER_FIELD_OPTIONS, f && f.field, '标题')
  const match = optionLabel(FILTER_MATCH_OPTIONS, f && f.match, '包含文本')
  const core = `不看 ${field} ${match}「${value || '…'}」`
  return app ? `${core}（仅限 ${app}）` : core
}

function filterRegexError(match, value) {
  if (match !== 'regex') return ''
  const v = String(value || '').trim()
  if (!v) return ''
  try {
    void new RegExp(v, 'i')
    return ''
  } catch {
    return '正则无效，这条不会生效'
  }
}

function filterIssue(f) {
  if (!String(f && f.value ? f.value : '').trim()) return '还没填内容，这条不会生效'
  return filterRegexError(f && f.match, f && f.value)
}

const DOWNLOAD_LINKS = [
  {
    name: 'GitHub Releases（官方首发）',
    url: 'https://github.com/pppscn/SmsForwarder/releases',
    note: '官方 APK 下载页，推荐优先使用；国内网络可能访问较慢',
  },
  {
    name: 'Gitee 国内镜像',
    url: 'https://gitee.com/pp/SmsForwarder/releases',
    note: '国内下载更快，版本与 GitHub 同步',
  },
  {
    name: '蓝奏云网盘',
    url: 'https://wws.lanzoui.com/b025yl86h',
    note: '访问密码：pppscn',
  },
  {
    name: '项目主页（源码与 Wiki 文档）',
    url: 'https://github.com/pppscn/SmsForwarder',
    note: '查看使用文档、提交 Issue 或参与开发',
  },
  {
    name: '官方使用流程（必读）',
    url: 'https://gitee.com/pp/SmsForwarder/wikis/%E3%80%90%E5%BF%85%E8%AF%BB%E3%80%91%E4%BD%BF%E7%94%A8%E6%B5%81%E7%A8%8B',
    note: '通用设置 → 发送通道 → 转发规则 的完整图文教程',
  },
]

const FAQ = [
  [
    '通道测试成功但真实通知不来',
    '发送通道只负责投递；还须在「转发规则」里新建规则，发送通道选 catrace，打开「启用该条转发规则」。通知与短信是两套规则，要分别建。',
  ],
  [
    '手机访问不到电脑',
    '确认与电脑同一 Wi-Fi；首次启动时若防火墙弹窗选过「允许访问」则无需手动配置；若仍未放行，可在「Windows Defender 防火墙 → 高级设置 → 入站规则」手动放行 TCP 端口；同时关闭路由器「客户端隔离」，并在「设置」里核对端口、路径、Token 是否一致。',
  ],
  [
    '服务显示未运行',
    '确认插件已启用；确认电脑能执行 node 命令；点「重启服务」；查看「最近错误」摘要。',
  ],
  [
    '取不到 App 名，只显示包名',
    'SmsForwarder 需开启「启动时异步获取已安装 App 列表」；未开启时回退显示包名属正常现象。',
  ],
  [
    '重复通知刷屏',
    '在「高级」里调大「相同通知最短间隔」（默认 5 秒）。只想不看某个标题：在卡片上点「屏蔽这个标题」，或在「不看这些标题」里添加。',
  ],
  [
    '验证码没有复制按钮',
    '正文或标题需包含「验证码 / 校验码 / 动态码 / OTP」等关键词，且出现独立的 4–8 位数字。',
  ],
  [
    '端口被占用',
    '通常是上次 Catrace 退出后残留的旧 sidecar 进程仍占着端口。重启服务 / 重新加载插件 / 关闭再启用插件时，会自动杀死残留进程并重新监听；若仍失败，换一个端口（1024–65535）保存并重启服务。',
  ],
]

export default function SmsforwarderNotifySettings() {
  const [config, setConfig] = useState(() => ({ ...DEFAULT_CONFIG }))
  const configRef = useRef(config)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [showToken, setShowToken] = useState(false)
  const [status, setStatus] = useState(null)
  const [webhookInfo, setWebhookInfo] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [appDraft, setAppDraft] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [chatAppDraft, setChatAppDraft] = useState('')
  const [filterDraft, setFilterDraft] = useState({ field: 'title', match: 'contains', value: '', appContains: '' })
  // One shared alert dialog: destructive buttons only open it with their own copy and action.
  const [confirmState, setConfirmState] = useState(null)
  const mounted = useRef(false)
  const saveTimer = useRef(null)
  const pendingSave = useRef(false)
  const saveQueue = useRef(Promise.resolve())
  const feedbackTimer = useRef(null)
  const running = useRef(false)

  function notify(text, type = 'success') {
    if (!mounted.current) return
    setFeedback({ text, type })
    clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => { if (mounted.current) setFeedback(null) }, 4000)
  }
  function replaceConfig(next) {
    configRef.current = next
    if (mounted.current) setConfig(next)
  }
  function normalizeConfig(raw = {}) {
    return {
      ...DEFAULT_CONFIG, ...raw,
      enabled: raw.enabled !== false,
      host: String(raw.host || '0.0.0.0').trim() || '0.0.0.0',
      port: clamp(raw.port, MIN_PORT, MAX_PORT, DEFAULT_PORT),
      path: normalizePath(raw.path), token: String(raw.token || '').trim(),
      cardDurationSec: clamp(raw.cardDurationSec, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC),
      dedupeWindowSec: clamp(raw.dedupeWindowSec, MIN_DEDUPE_SEC, MAX_DEDUPE_SEC, DEFAULT_DEDUPE_SEC),
      appBlacklist: textToBlacklist(blacklistToText(raw.appBlacklist)),
      appBlacklistPaused: sortBlacklist(Array.isArray(raw.appBlacklistPaused) ? raw.appBlacklistPaused : []),
      mmsTitleBlacklist: sortBlacklist(Array.isArray(raw.mmsTitleBlacklist) ? raw.mmsTitleBlacklist : []),
      filters: normalizeFilters(raw.filters), hideSensitiveBody: false,
      enableOtpAction: raw.enableOtpAction !== false,
      onlyPushWhenActive: raw.onlyPushWhenActive === true,
      mergeChatThreads: raw.mergeChatThreads !== false,
      chatApps: Array.isArray(raw.chatApps) ? textToBlacklist(blacklistToText(raw.chatApps)) : [...DEFAULT_CONFIG.chatApps],
    }
  }
  function settingsOnly(value) {
    // Host owns top-level activation; nested filter.enabled remains business data.
    const { enabled: _hostEnabled, ...settings } = value
    return settings
  }
  function updateConfig(patch) {
    replaceConfig({ ...configRef.current, ...patch })
    clearTimeout(saveTimer.current)
    pendingSave.current = true
    saveTimer.current = setTimeout(() => { void persistAndSync(true).catch(error => notify(errorText(error), 'error')) }, 400)
  }
  async function refreshStatus() {
    if (!plugin.sidecar?.request) {
      if (mounted.current) setStatus({ error: 'sidecar 未运行（请启用插件）', running: false })
      return
    }
    const result = await plugin.sidecar.request('getStatus')
    if (mounted.current) setStatus(result && typeof result === 'object' ? result : { raw: result })
  }
  async function refreshWebhookInfo() {
    if (!plugin.sidecar?.request) return
    const result = await plugin.sidecar.request('getWebhookInfo')
    if (!mounted.current) return
    setWebhookInfo(result && typeof result === 'object' ? result : null)
    if (result?.token && String(configRef.current.token || '').trim() !== result.token.trim()) {
      const next = { ...configRef.current, token: result.token.trim() }
      replaceConfig(next)
      await plugin.config.set(settingsOnly(normalizeConfig(next)))
    }
    if (result) setStatus(previous => ({ ...previous, ...result, token: undefined }))
  }
  function persistAndSync(quiet = true) {
    clearTimeout(saveTimer.current)
    pendingSave.current = false
    const snapshot = settingsOnly(normalizeConfig(configRef.current))
    const job = saveQueue.current.catch(() => {}).then(async () => {
      await plugin.config.set(snapshot)
      // Unmount may be caused by host disable: flush user data, never restart its service.
      if (!mounted.current) return
      try {
        if (!plugin.sidecar?.request) throw new Error('sidecar 未运行')
        const result = await plugin.sidecar.request('setConfig', snapshot)
        if (mounted.current && result && typeof result === 'object') setStatus(result)
        if (result?.ok === false && result.error) {
          if (!quiet) notify(`监听失败：${result.error}`, 'error')
        } else if (!quiet) notify('已保存')
        // Do not replace a newer local Token draft with a previous save's response.
        if (mounted.current && configRef.current.token === snapshot.token) await refreshWebhookInfo()
      } catch (error) {
        if (!quiet) notify('已保存（启用插件后 sidecar 生效）', 'warning')
        await plugin.log?.warn?.('config saved without sidecar', { error: errorText(error) })
      }
    })
    saveQueue.current = job
    return job
  }
  async function run(key, task) {
    if (running.current) return
    running.current = true
    setBusy(key)
    try { await task() } catch (error) { notify(errorText(error), 'error') }
    finally { running.current = false; if (mounted.current) setBusy('') }
  }
  async function copyText(text) {
    const value = String(text || '')
    if (!value) { notify('无可复制内容', 'warning'); return }
    try {
      if (plugin.clipboard?.writeText) await plugin.clipboard.writeText(value)
      else if (globalThis.navigator?.clipboard?.writeText) await navigator.clipboard.writeText(value)
      else throw new Error('clipboard unavailable')
      notify('已复制')
    } catch (error) { notify(`复制失败：${errorText(error)}`, 'error') }
  }
  async function regenerateToken() {
    await run('regen', async () => {
      await persistAndSync(true)
      let nextToken
      if (plugin.sidecar?.request) {
        const result = await plugin.sidecar.request('regenerateToken')
        if (!result?.token) throw new Error('未收到新的 Token')
        nextToken = result.token
        if (mounted.current) setWebhookInfo(result)
      } else {
        const bytes = new Uint8Array(32)
        crypto.getRandomValues(bytes)
        nextToken = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
      }
      replaceConfig({ ...configRef.current, token: nextToken })
      await persistAndSync(true)
      notify('已重新生成 Token（手机端需同步更新）')
      await refreshStatus()
    })
  }
  async function restartServer() {
    await run('restart', async () => {
      await persistAndSync(true)
      if (!plugin.sidecar?.request) { notify('sidecar 未运行', 'warning'); return }
      const result = await plugin.sidecar.request('restartServer')
      if (mounted.current) setStatus(result)
      notify(result?.ok === false ? result.error || '重启失败' : '服务已重启', result?.ok === false ? 'error' : 'success')
      await refreshWebhookInfo()
    })
  }
  async function clearChatHistory() {
    await run('clear-chat', async () => {
      if (plugin.sidecar?.request) await plugin.sidecar.request('clearChatHistory', {})
      if (plugin.storage?.remove) {
        try { await plugin.storage.remove('chatThreads') } catch { /* sidecar already cleared */ }
      }
      notify('对话历史已清空')
    })
  }
  async function sendTest() {
    await run('test', async () => {
      const cfg = normalizeConfig(configRef.current)
      if (plugin.sidecar?.request) {
        try {
          await plugin.sidecar.request('setConfig', cfg)
          await plugin.sidecar.request('sendTest', {})
          notify('已发送测试通知')
          await refreshStatus()
          return
        } catch { /* fallback exercises event publish when the process is unavailable */ }
      }
      const sticky = cfg.cardDurationSec <= 0
      const now = Date.now()
      const pcIso = new Date(now).toISOString()
      await plugin.events.publish({
        eventType: 'smsforwarder-notify.notification', kind: 'smsforwarder-notify',
        title: '测试 App · 测试通知', body: '这是一条 SmsForwarder 测试消息，验证码 123456', level: 'info', sticky,
        actions: [{ id: 'copy-otp', label: '复制验证码' }, ...(sticky ? [{ id: 'dismiss', label: '知道了' }] : []), { id: 'block-app', label: '屏蔽此应用' }, { id: 'block-title', label: '屏蔽这个标题' }],
        payload: { packageName: 'com.example.test', appName: '测试 App', title: '测试通知', body: '这是一条 SmsForwarder 测试消息，验证码 123456', receivedAt: new Date(now - 300000).toISOString(), webhookAt: pcIso, publishedAt: pcIso, shownAt: pcIso, otp: '123456', noticeKind: 'otp', auto_hide_ms: sticky ? 0 : cfg.cardDurationSec * 1000, card_duration_sec: cfg.cardDurationSec },
        dedupeKey: `smsforwarder-notify:test:${now}`,
      })
      notify('已发送测试通知')
    })
  }
  useEffect(() => {
    mounted.current = true
    running.current = true
    setBusy('boot')
    ensureStyles()
    let disposed = false
    const changed = async event => {
      const id = event?.detail?.pluginId
      if (id && id !== PLUGIN_ID) return
      try {
        const raw = await plugin.config.get()
        if (disposed || !raw || typeof raw !== 'object') return
        const normalized = normalizeConfig(raw)
        // Cross-window block actions change these lists, not connection drafts.
        replaceConfig({ ...configRef.current, appBlacklist: normalized.appBlacklist, appBlacklistPaused: normalized.appBlacklistPaused, mmsTitleBlacklist: normalized.mmsTitleBlacklist, filters: normalized.filters })
      } catch (error) { console.warn('[smsforwarder-notify] reload config failed', error) }
    }
    window.addEventListener('catrace:plugin-config-changed', changed)
    void (async () => {
      try {
        const raw = await plugin.config.get()
        if (disposed) return
        const initial = normalizeConfig(raw && typeof raw === 'object' ? raw : DEFAULT_CONFIG)
        replaceConfig(initial)
        try {
          if (plugin.sidecar?.request) {
            const result = await plugin.sidecar.request('setConfig', initial)
            if (!disposed) setStatus(result)
          }
          if (!disposed) await refreshStatus()
          if (!disposed) await refreshWebhookInfo()
        } catch (error) { if (!disposed) setStatus({ running: false, error: errorText(error) }) }
      } catch (error) { if (!disposed) notify(errorText(error), 'error') }
      finally {
        if (!disposed) {
          running.current = false
          setBusy('')
          setLoading(false)
        }
      }
    })()
    return () => {
      disposed = true
      mounted.current = false
      window.removeEventListener('catrace:plugin-config-changed', changed)
      clearTimeout(feedbackTimer.current)
      clearTimeout(saveTimer.current)
      if (pendingSave.current) void persistAndSync(true).catch(error => console.warn('[smsforwarder-notify] final save failed', error))
    }
  }, [])

  function addApp() {
    const value = appDraft.trim()
    if (!value) return
    const list = configRef.current.appBlacklist
    if (!list.some(item => item.toLowerCase() === value.toLowerCase())) updateConfig({ appBlacklist: sortBlacklist([...list, value]).slice(0, 200) })
    setAppDraft('')
  }
  function removeApp(value) {
    const same = item => String(item).toLowerCase() !== value.toLowerCase()
    updateConfig({ appBlacklist: configRef.current.appBlacklist.filter(same), appBlacklistPaused: configRef.current.appBlacklistPaused.filter(same) })
  }
  function addKeyword() {
    const value = titleDraft.trim()
    if (!value) return
    const list = configRef.current.filters
    if (list.length >= MAX_FILTERS) { notify(`最多 ${MAX_FILTERS} 条`, 'warning'); return }
    if (!list.some(f => f.value.toLowerCase() === value.toLowerCase() && ['contains', 'equals'].includes(f.match))) updateConfig({ filters: [...list, { id: newFilterId(), enabled: true, field: 'any', match: 'contains', value, appContains: '' }] })
    setTitleDraft('')
  }
  function addCustomFilter() {
    const next = normalizeFilter(filterDraft)
    if (!next.value) { notify('先填要拦截的内容', 'warning'); return }
    const issue = filterIssue(next)
    if (issue) { notify(issue, 'warning'); return }
    const list = configRef.current.filters
    if (list.length >= MAX_FILTERS) { notify(`最多 ${MAX_FILTERS} 条`, 'warning'); return }
    if (list.some(f => f.field === next.field && f.match === next.match && f.value.toLowerCase() === next.value.toLowerCase() && f.appContains.toLowerCase() === next.appContains.toLowerCase())) { notify('已经有同样的规则了', 'warning'); return }
    updateConfig({ filters: [...list, next] })
    setFilterDraft(previous => ({ ...previous, value: '' }))
  }
  function addChatApp() {
    const value = chatAppDraft.trim()
    if (!value) return
    const list = configRef.current.chatApps
    if (!list.some(item => item.toLowerCase() === value.toLowerCase())) updateConfig({ chatApps: sortBlacklist([...list, value]).slice(0, 200) })
    setChatAppDraft('')
  }
  const st = status || {}, info = webhookInfo || {}
  const urls = Array.isArray(st.webhookUrls) && st.webhookUrls.length ? st.webhookUrls : Array.isArray(info.webhookUrls) ? info.webhookUrls : []
  const primaryUrl = urls[0] || `http://<电脑IP>:${config.port}${normalizePath(config.path)}`
  const authHeader = info.authorizationHeader || (config.token ? `Authorization: Bearer ${config.token}` : 'Authorization: Bearer <token>')
  const template = info.jsonTemplate || JSON_TEMPLATE
  const field = (label, control, hint) => h('div', { className: 'sf-field' }, h('label', { className: 'sf-label' }, label), control, hint ? h('p', { className: 'sf-hint' }, hint) : null)
  const button = (label, onClick, options = {}) => h(Button, { size: 'sm', variant: 'secondary', onClick, ...options }, label)
  const input = (value, onChange, props = {}) => h(Input, { variant: 'secondary', value: String(value ?? ''), onChange: event => onChange(event.target.value), ...props })
  // Numeric settings use the HeroUI number field (−/+ buttons + secondary field) instead of a bare input.
  const numberField = (value, onChange, { min, max, ariaLabel, className = '' }) => h(NumberFieldRoot, {
    variant: 'secondary',
    className,
    value,
    minValue: min,
    maxValue: max,
    step: 1,
    formatOptions: { useGrouping: false },
    isDisabled: loading,
    'aria-label': ariaLabel,
    onChange: next => { if (Number.isFinite(next)) onChange(next) },
  },
    h(NumberFieldGroup, null,
      h(NumberFieldDecrementButton, { 'aria-label': '减少' }),
      h(NumberFieldInput),
      h(NumberFieldIncrementButton, { 'aria-label': '增加' })))
  const enter = action => event => { if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); action() } }
  const select = (value, options, onChange, disabled = false) => h(SelectRoot, {
    variant: 'secondary',
    className: 'sf-select',
    value,
    isDisabled: disabled,
    onChange: next => { if (next != null && typeof onChange === 'function') onChange(String(next)) },
  },
    h(SelectTrigger, { 'aria-label': optionLabel(options, value, '') }, h(SelectValue), h(SelectIndicator)),
    h(SelectPopover, null, h(ListBox, null, options.map(option => h(ListBoxItem, { key: option.value, id: option.value, textValue: option.label }, option.label)))))
  const switchControl = (checked, onChange, ariaLabel) => h(SwitchRoot, { size: 'sm', isSelected: checked, 'aria-label': ariaLabel, onChange },
    h(SwitchContent, null, h(SwitchControl, null, h(SwitchThumb))))
  const chip = (text, onRemove, color = 'accent', title = text, key = text) => h(Chip, { key, color, size: 'sm', variant: 'soft', className: 'sf-chip', title },
    h('span', { className: 'sf-chip-text' }, text),
    onRemove ? h('button', { type: 'button', className: 'sf-chip-remove', 'aria-label': `移除 ${text}`, onClick: onRemove }, '×') : null)
  const copyRow = (text, key = text) => h('div', { className: 'sf-copy-row', key }, h('pre', { className: 'sf-mono' }, text), button('复制', () => void copyText(text), { variant: 'tertiary' }))
  // Destructive actions open the single controlled AlertDialog instead of acting immediately.
  const confirmButton = (label, description, action) => button(label, () => setConfirmState({ title: label, description, action }), { variant: 'danger-soft', isDisabled: !!busy })
  const confirmDialog = h(AlertDialogRoot, {
    isOpen: !!confirmState,
    onOpenChange: open => { if (!open) setConfirmState(null) },
  }, confirmState ? h(AlertDialogBackdrop, null,
    h(AlertDialogContainer, null,
      h(AlertDialogDialog, null,
        h(AlertDialogCloseTrigger),
        h(AlertDialogHeader, null,
          h(AlertDialogIcon, { status: 'danger' }),
          h(AlertDialogHeading, null, confirmState.title)),
        h(AlertDialogBody, null, h('p', { className: 'sf-confirm-desc' }, confirmState.description)),
        h(AlertDialogFooter, null,
          h(Button, { slot: 'close', size: 'sm', variant: 'secondary', onClick: () => setConfirmState(null) }, '取消'),
          h(Button, {
            slot: 'close', size: 'sm', variant: 'danger', isDisabled: !!busy,
            onClick: () => { const action = confirmState.action; setConfirmState(null); void action() },
          }, '确认'))))) : null)
  const section = (title, children, className = '') => h('section', { className: `sf-section${className ? ` ${className}` : ''}` }, h('div', { className: 'sf-section-head' }, h('h2', null, title)), ...children)
  const statusRows = st.error ? [['状态', st.error]] : [['服务', st.running ? '运行中' : '未运行'], ['监听', st.running ? `${st.host || config.host}:${st.port || config.port}` : '-'], ['路径', st.path || config.path], ['Token', st.hasToken || config.token ? '已配置' : '未配置'], ['已接收', String(st.acceptedCount ?? 0)], ['已拒绝', String(st.rejectedCount ?? 0)], ['已去重', String(st.dedupedCount ?? 0)], ['最近成功', st.lastSuccessAt ? new Date(st.lastSuccessAt).toLocaleString() : '-'], ['最近来源', st.lastClientIp || '-'], ['最近错误', st.lastErrorSummary || '无'], ...(st.onlyPushWhenActive && st.pendingCount > 0 ? [['待补推', `${st.pendingCount} 条（空闲时暂存，活跃后推送）`]] : [])]
  const overview = section('服务状态', [loading ? h('p', { className: 'sf-desc' }, '加载中…') : h('div', { className: `sf-status${st.error ? ' is-error' : ''}` }, statusRows.map(([label, value]) => h(Fragment, { key: label }, h('strong', null, label), h('span', null, String(value))))), h('div', { className: 'sf-actions' }, button('刷新状态', () => void run('status', async () => { await refreshStatus(); await refreshWebhookInfo() }), { isDisabled: !!busy }), button('重启服务', () => void restartServer(), { isDisabled: !!busy }), button('发送测试 Toast', () => void sendTest(), { isDisabled: !!busy, variant: 'primary' }))], st.error ? 'is-error' : '')
  const connection = section('连接', [field('电脑接收地址', h('div', { className: 'sf-url-list' }, (urls.length ? urls : [primaryUrl]).map(url => copyRow(url))), '填到手机 SmsForwarder 的 Webhook。详细步骤见「教程」。'), field('Token', h('div', { className: 'sf-row-inline' }, input(config.token, value => updateConfig({ token: value }), { type: showToken ? 'text' : 'password', placeholder: '启用插件后自动生成', 'aria-label': 'Token', className: 'sf-input-token' }), button(showToken ? '隐藏' : '显示', () => setShowToken(!showToken)), button('复制', () => void copyText(authHeader.replace(/^Authorization:\s*/i, ''))), confirmButton('重新生成', '重新生成会使手机端旧 Token 立即失效，确认？', regenerateToken)), 'SmsForwarder 请求头：Authorization: Bearer <token>'), field('卡片显示多久', h('div', { className: 'sf-row-inline' }, numberField(config.cardDurationSec, value => updateConfig({ cardDurationSec: clamp(value, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC) }), { min: MIN_CARD_SEC, max: MAX_CARD_SEC, ariaLabel: '卡片停留秒数', className: 'sf-num' }), h('span', { className: 'sf-unit' }, '秒（0=不自动关掉）'))), h('div', { className: 'sf-actions' }, button('保存并应用', () => void run('save', () => persistAndSync(false)), { variant: 'primary', isDisabled: !!busy || loading }))])
  const appRows = config.appBlacklist.filter(item => item.toLowerCase().includes(appDraft.trim().toLowerCase())).sort(compareBlacklist)
  const titleRows = [...config.filters.filter(f => f.value).map(f => ({ ...f, kind: 'filter', title: f.value, sub: f.appContains })), ...config.mmsTitleBlacklist.map(title => ({ kind: 'mms', id: `mms:${title}`, title, sub: '锁屏短信' }))].filter(item => `${item.title} ${item.sub || ''}`.toLowerCase().includes(titleDraft.trim().toLowerCase())).sort((a, b) => compareBlacklist(a.title, b.title))
  const blockPanes = h('div', { className: 'sf-block-split' },
    h('section', { className: 'sf-pane' }, h('h3', { className: 'sf-pane-title' }, `不看这些应用 (${appRows.length})`), h('div', { className: 'sf-search-add' }, input(appDraft, setAppDraft, { className: 'sf-search-input', placeholder: '搜索或输入包名，按 Enter 添加…', onKeyDown: enter(addApp), 'aria-label': '应用搜索或包名' }), button('添加', addApp)), h('div', { className: 'sf-pane-body' }, appRows.length ? h('div', { className: 'sf-title-chips' }, appRows.map(item => chip(item, () => removeApp(item), 'accent'))) : h('p', { className: 'sf-empty-text' }, appDraft ? '没有匹配的应用' : '暂无。也可在通知卡片上点「屏蔽此应用」。'))),
    h('section', { className: 'sf-pane' }, h('h3', { className: 'sf-pane-title' }, `不看这些标题 (${titleRows.length})`), h('p', { className: 'sf-hint' }, '支持文本模糊或精准匹配'), h('div', { className: 'sf-search-add' }, input(titleDraft, setTitleDraft, { className: 'sf-search-input', placeholder: '搜索或输入消息标题关键字，按 Enter 添加…', onKeyDown: enter(addKeyword), 'aria-label': '标题搜索或关键词' }), button('添加', addKeyword, { isDisabled: config.filters.length >= MAX_FILTERS })), h('div', { className: 'sf-pane-body' }, titleRows.length ? h('div', { className: 'sf-title-chips' }, titleRows.map(item => chip(`${item.title}${item.sub ? ` · ${item.sub}` : ''}`, () => updateConfig(item.kind === 'filter' ? { filters: configRef.current.filters.filter(f => f.id !== item.id) } : { mmsTitleBlacklist: configRef.current.mmsTitleBlacklist.filter(t => t.toLowerCase() !== item.title.toLowerCase()) }), 'warning', filterPreview(item), item.id))) : h('p', { className: 'sf-empty-text' }, titleDraft ? '没有匹配的标题' : '暂无。也可在通知卡片上点「屏蔽这个标题」。'))))
  const advanced = h('section', { className: 'sf-section sf-advanced' }, h(Button, { size: 'sm', variant: 'tertiary', fullWidth: true, className: 'sf-advanced-toggle', 'aria-expanded': showAdvanced, 'aria-controls': 'smsforwarder-advanced-settings', onClick: () => setShowAdvanced(!showAdvanced) }, '高级', h('span', { className: 'sf-advanced-chevron', 'aria-hidden': true }, chevronIcon())), h('div', { id: 'smsforwarder-advanced-settings', className: `sf-advanced-collapse${showAdvanced ? ' open' : ''}`, 'aria-hidden': !showAdvanced, inert: !showAdvanced }, h('div', { className: 'sf-advanced-collapse-inner' }, h('div', { className: 'sf-advanced-body' },
    h('div', { className: 'sf-grid-2' }, h('section', { className: 'sf-tile' }, h('div', { className: 'sf-tile-head' }, h('h3', { className: 'sf-tile-title' }, '活跃时推送'), switchControl(config.onlyPushWhenActive, value => updateConfig({ onlyPushWhenActive: value }), '活跃时推送')), h('p', { className: 'sf-tile-desc' }, '电脑有键鼠操作时才实时推送；空闲时先暂存，回来后一次性补推。'), h('div', { className: 'sf-tile-foot' }, config.onlyPushWhenActive ? '已开启（空闲先存）' : '已关闭（随时推送）')), h('section', { className: 'sf-tile' }, h('div', { className: 'sf-tile-head' }, h('h3', { className: 'sf-tile-title' }, '聊天小窗'), switchControl(config.mergeChatThreads, value => updateConfig({ mergeChatThreads: value }), '合并聊天小窗')), h('p', { className: 'sf-tile-desc' }, '指定 IM 合成对话小窗：弹出只显示最新一条，新消息往上顶；往上滚加载本机历史。'), h('div', { className: 'sf-chip-box' }, config.chatApps.map(name => chip(name, () => updateConfig({ chatApps: configRef.current.chatApps.filter(item => item.toLowerCase() !== name.toLowerCase()) }))), input(chatAppDraft, setChatAppDraft, { className: 'sf-chip-input', placeholder: '+ 输入名字按回车添加', onKeyDown: enter(addChatApp), 'aria-label': '聊天应用名称或包名' })), h('div', { className: 'sf-tile-foot' }, h('span', null, '输入应用名或包名后按回车添加'), confirmButton('清空聊天记录', '清空本机保存的全部会话气泡？', clearChatHistory)))),
    h('h3', { className: 'sf-advanced-title' }, '频控与 Webhook'), h('div', { className: 'sf-grid-3' }, h('section', { className: 'sf-tile' }, field('相同通知最短间隔', numberField(config.dedupeWindowSec, value => updateConfig({ dedupeWindowSec: clamp(value, MIN_DEDUPE_SEC, MAX_DEDUPE_SEC, DEFAULT_DEDUPE_SEC) }), { min: MIN_DEDUPE_SEC, max: MAX_DEDUPE_SEC, ariaLabel: '相同通知最短间隔秒数' }), '相同通知在间隔内再次到达时不重复弹出。')), h('section', { className: 'sf-tile' }, field('Webhook 监听端口', numberField(config.port, value => updateConfig({ port: clamp(value, MIN_PORT, MAX_PORT, DEFAULT_PORT) }), { min: MIN_PORT, max: MAX_PORT, ariaLabel: 'Webhook 监听端口' }), `端口范围：${MIN_PORT} – ${MAX_PORT}`)), h('section', { className: 'sf-tile' }, field('Webhook 路由路径', input(config.path, value => updateConfig({ path: value }), { placeholder: '/webhook', 'aria-label': 'Webhook 路由路径' }), '接收 SmsForwarder POST 的 HTTP 路径。'))),
    h('h3', { className: 'sf-advanced-title' }, '自定义过滤规则'), h('p', { className: 'sf-hint' }, '可指定应用、正文或正则。命中就不弹。'), h('div', { className: 'sf-filter-composer' }, h('p', { className: 'sf-filter-composer-title' }, '新建规则'), h('div', { className: 'sf-filter-form' }, field('动作', select('hide', FILTER_ACTION_OPTIONS, undefined, true)), field('匹配字段', select(filterDraft.field, FILTER_FIELD_OPTIONS, value => setFilterDraft(previous => ({ ...previous, field: value })))), field('匹配逻辑', select(filterDraft.match, FILTER_MATCH_OPTIONS, value => setFilterDraft(previous => ({ ...previous, match: value })))), field('关键词 / 正则', input(filterDraft.value, value => setFilterDraft(previous => ({ ...previous, value })), { placeholder: filterDraft.match === 'regex' ? '例如 DSH Desktop.*交流群' : '例如：DSH Desktop 交流群', onKeyDown: enter(addCustomFilter), 'aria-label': '过滤关键词或正则' })), field('仅限应用（可选）', input(filterDraft.appContains, value => setFilterDraft(previous => ({ ...previous, appContains: value })), { placeholder: 'QQ / com.tencent.mobileqq', onKeyDown: enter(addCustomFilter), 'aria-label': '过滤规则应用范围' }))), filterRegexError(filterDraft.match, filterDraft.value) ? h(AlertRoot, { status: 'warning', className: 'sf-filter-alert', role: 'alert' }, h(AlertIndicator), h(AlertContent, null, h(AlertDescription, null, filterRegexError(filterDraft.match, filterDraft.value)))) : null, h('div', { className: 'sf-filter-add' }, button('添加到规则列表', addCustomFilter, { variant: 'primary', isDisabled: config.filters.length >= MAX_FILTERS }))),
    h('div', { className: 'sf-filter-list-head' }, `已生效规则（${config.filters.length}）`, h('span', { className: 'sf-hint' }, '从上到下匹配')), config.filters.length ? h('div', { className: 'sf-filter-list' }, config.filters.map(f => h('div', { key: f.id, className: `sf-filter-item${f.enabled === false ? ' is-off' : ''}${filterIssue(f) ? ' is-warn' : ''}` }, h('div', { className: 'sf-filter-tags' }, h(Chip, { size: 'sm', variant: 'soft', color: 'danger' }, '不看'), h(Chip, { size: 'sm', variant: 'soft', color: 'default' }, optionLabel(FILTER_FIELD_OPTIONS, f.field, '标题')), h(Chip, { size: 'sm', variant: 'soft', color: 'accent' }, optionLabel(FILTER_MATCH_OPTIONS, f.match, '包含文本')), h('span', { className: 'sf-filter-quote' }, `"${f.value || '…'}"`), f.appContains ? h('span', { className: 'sf-filter-scope' }, `仅限 ${f.appContains}`) : null), filterIssue(f) ? h(AlertRoot, { status: 'warning', className: 'sf-filter-alert' }, h(AlertIndicator), h(AlertContent, null, h(AlertDescription, null, filterIssue(f)))) : null, switchControl(f.enabled !== false, value => updateConfig({ filters: configRef.current.filters.map(item => item.id === f.id ? { ...item, enabled: value } : item) }), `启用 ${filterPreview(f)}`), button('删除', () => updateConfig({ filters: configRef.current.filters.filter(item => item.id !== f.id) }), { variant: 'danger-soft' })))) : h('p', { className: 'sf-empty-text' }, '还没有自定义规则。常见群名直接在上面「不看这些标题」里加就行。')))))
  const steps = [
    { title: '准备条件', items: ['电脑已安装 Catrace，且能在命令行执行 node 命令（sidecar 依赖 Node）', '手机与电脑连接同一 Wi-Fi', '手机安装 SmsForwarder（官方支持 Android 4.4–13，14 以上需实机验证；下载地址见上方）', '在 Catrace 插件列表启用 smsforwarder-notify，回到「概览」确认服务「运行中」', 'Windows 防火墙首次弹窗选「允许访问」；手机连不上时再手动放行入站端口'] },
    { title: 'SmsForwarder 通用设置', items: ['打开 SmsForwarder → 通用设置，开启需要的转发能力（短信 / 应用通知）', '按系统弹窗逐一授权；加入电池优化白名单，允许后台运行，勿强杀', '转发应用通知：开启「通知使用权」', '开启「启动时异步获取已安装 App 列表」，否则取不到 App 名'] },
    { title: '新建发送通道（Webhook）', items: ['发送通道 → 新建，类型选 Webhook，方法 POST，通道名称如 catrace', h('div', { className: 'sf-step-copy', key: 'urls' }, h('span', { className: 'sf-step-copy-label' }, 'Webhook Server：选手机能访问的电脑局域网 IP'), ...(urls.length ? urls : [primaryUrl]).map(url => copyRow(url)), !urls.length ? h('p', { className: 'sf-hint' }, 'URL 列表为空：先启用插件，确认服务运行中，再点「刷新状态」。') : null), h('div', { className: 'sf-step-copy', key: 'headers' }, h('span', { className: 'sf-step-copy-label' }, 'Headers：点 + 加一行，Key / Value 分开填'), h('pre', { className: 'sf-mono' }, authHeader), h('div', { className: 'sf-row-inline' }, button('复制 Key', () => void copyText('Authorization'), { variant: 'tertiary' }), button('复制 Value', () => void copyText(authHeader.replace(/^Authorization:\s*/i, '')), { variant: 'tertiary' }))), h('div', { className: 'sf-step-copy', key: 'template' }, h('span', { className: 'sf-step-copy-label' }, '消息模板：整段粘贴'), copyRow(template)), '保存后点「测试」，手机显示发送成功、电脑弹出 Toast 即通道 OK'] },
    { title: '新建转发规则（通道建好后必做）', items: ['仅有发送通道不会转发，必须配置转发规则并绑定通道', '应用通知：转发规则 → 通知转发规则 → 新建', '短信：转发规则 → 短信转发规则 → 新建（可选）', '规则别名随意；发送通道选刚建的 catrace', '匹配字段先选「全部」跑通，之后可改成包名 / 内容过滤', '「启用自定义模版」「启用正则替换」保持关闭，使用通道模板', '打开「启用该条转发规则」，免打扰时段保持 00:00～00:00（相等=不启用）', '保存后点测试，再让手机来一条真实通知 / 短信，电脑应弹 Toast'] },
  ]
  const downloadList = h('div', { className: 'sf-dl-list' }, DOWNLOAD_LINKS.map(link =>
    h('div', { key: link.url, className: 'sf-dl-item' },
      h('div', { className: 'sf-dl-name' }, h('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer' }, link.name)),
      h('p', { className: 'sf-dl-note' }, link.note))))
  const stepList = h('div', { className: 'sf-steps-wrap' }, steps.map((step, index) =>
    h('div', { key: step.title, className: 'sf-step' },
      h('span', { className: 'sf-step-num' }, String(index + 1)),
      h('div', { className: 'sf-step-body' },
        h('h3', { className: 'sf-step-title' }, step.title),
        h('ul', { className: 'sf-step-list' }, step.items.map((item, i) =>
          h('li', { key: i, className: typeof item === 'string' ? undefined : 'sf-step-copy' }, item)))))))
  const tutorial = h(Fragment, null,
    section('使用教程', [
      h('p', { className: 'sf-desc' }, '按官方流程：通用设置 → 发送通道 → 转发规则。通道决定「发到哪」，规则决定「哪些会转发」。'),
      field('下载 SmsForwarder', downloadList), stepList,
    ]),
    section('常见问题', FAQ.map(([question, answer]) =>
      h('div', { key: question, className: 'sf-faq' }, h('div', { className: 'sf-faq-q' }, question), h('p', { className: 'sf-faq-a' }, answer)))))
  const tabPanel = (id, content) => h(TabPanel, { id, className: 'sf-tab-panel', 'aria-label': 'SmsForwarder 设置面板' }, activeTab === id ? content : null)
  const tabs = h(TabsRoot, {
    selectedKey: activeTab,
    onSelectionChange(key) { if (key != null) setActiveTab(String(key)) },
  },
  h(TabListContainer, null,
    h(TabList, { 'aria-label': 'SmsForwarder 设置' }, ...TABS.map(tab => h(Tab, { key: tab.id, id: tab.id }, tab.label, h(TabIndicator))))),
  tabPanel('overview', overview),
  tabPanel('settings', h('fieldset', { disabled: loading, className: 'sf-config-fields' }, connection, blockPanes, advanced)),
  tabPanel('tutorial', tutorial))
  return h('div', { className: 'sf-settings' }, section('SmsForwarder 通知', [h(Chip, { size: 'sm', variant: 'soft', color: config.enabled ? 'success' : 'default' }, config.enabled ? '已启用' : '已关闭'), h('p', { className: 'sf-desc' }, '本机 HTTP Webhook 接收 Android SmsForwarder 转发的 App 通知，弹出 Catrace Toast。仅建议可信局域网使用。'), h(AlertRoot, { status: 'warning', className: 'sf-alert' }, h(AlertIndicator), h(AlertContent, null, h(AlertDescription, null, '默认监听 0.0.0.0（全部网卡）。务必使用强 Token，勿暴露公网。首次启动防火墙弹窗选「允许访问」；手机连不上时再放行入站端口。')))]), feedback ? h(AlertRoot, { status: feedback.type === 'error' ? 'danger' : feedback.type === 'warning' ? 'warning' : 'success', className: 'sf-alert', role: feedback.type === 'error' ? 'alert' : 'status' }, h(AlertIndicator), h(AlertContent, null, h(AlertDescription, null, feedback.text))) : null, confirmDialog, tabs)
}
export { SmsforwarderNotifySettings as Settings }
