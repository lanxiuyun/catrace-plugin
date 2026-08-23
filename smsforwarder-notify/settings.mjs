/** smsforwarder-notify settings — webhook / filter / status / guide. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, computed, onMounted, onBeforeUnmount } = vue
const { NButton, NInput, NSwitch, NTag, NPopconfirm, NSelect, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}
if (!NButton || !NInput || !NSwitch || !NTag || !NSelect || !useMessage) {
  throw new Error('Catrace plugin naive runtime missing (__CATRACE_NAIVE__)')
}
if (!plugin || !plugin.config || !plugin.events || !plugin.setEnabled) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

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

const STYLE_ID = 'catrace-plugin-smsforwarder-notify-settings-css-v12'
const CSS = `
.sf-settings {
  width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 0.75rem;
  color: #134e4a;
}
.sf-settings *, .sf-settings *::before, .sf-settings *::after { box-sizing: border-box; }
.sf-settings .card {
  padding: 1rem 1.25rem;
  border: 0.0625rem solid #99f6e4;
  border-radius: 0.875rem;
  background: #fff;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.sf-settings .card.is-error {
  border-color: #fecaca;
  background: #fff5f5;
  border-left: 0.25rem solid #ef4444;
  box-shadow: 0 0.125rem 0.5rem rgba(220, 38, 38, 0.08);
}
.sf-settings .card.is-error h2 { color: #991b1b; display: inline-flex; align-items: center; gap: 0.375rem; }
.sf-settings .card.is-error h2::before {
  content: '!';
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.125rem; height: 1.125rem; border-radius: 999px;
  background: #dc2626; color: #fff;
  font-size: 0.6875rem; font-weight: 800; line-height: 1;
}
.sf-settings .status.is-error {
  background: #fff;
  border: 0.0625rem solid #fecaca;
}
.sf-settings .head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.sf-settings h2 { margin: 0; font-size: 0.9375rem; font-weight: 700; color: #134e4a; }
.sf-settings .desc { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: #5b6b6a; }
.sf-settings .field { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; flex: 1; }
.sf-settings .label { font-size: 0.75rem; font-weight: 600; color: #5b6b6a; }
.sf-settings .hint { margin: 0; font-size: 0.6875rem; color: #8b949e; line-height: 1.45; }
.sf-settings .warn {
  margin: 0; font-size: 0.75rem; line-height: 1.5; color: #b45309;
  padding: 0.5rem 0.625rem; border-radius: 0.5rem; background: #fffbeb;
  border: 0.0625rem solid #fde68a;
}
.sf-settings .row {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.sf-settings .row-inline { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.sf-settings .num { width: 6.5rem; }
.sf-settings .unit { font-size: 0.75rem; color: #5b6b6a; font-weight: 600; }
.sf-settings .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.sf-settings .status {
  display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem;
  padding: 0.625rem 0.75rem; border-radius: 0.5rem; background: #f0fdfa;
  font-size: 0.75rem; color: #424a53;
}
.sf-settings .status.is-error {
  background: #fef2f2; color: #7f1d1d;
}
.sf-settings .status strong { color: #0d9488; font-weight: 650; }
.sf-settings .status.is-error strong { color: #dc2626; }
.sf-settings .status.is-error span { color: #991b1b; }
.sf-settings .switch-pair {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-size: 0.8125rem; color: #424a53; font-weight: 500;
}
.sf-settings .mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem; line-height: 1.45;
  padding: 0.5rem 0.625rem; border-radius: 0.5rem;
  background: #f0fdfa; color: #134e4a; word-break: break-all; white-space: pre-wrap;
  border: 0.0625rem solid #ccfbf1; margin: 0;
}
.sf-settings .copy-row {
  display: flex; align-items: flex-start; gap: 0.5rem;
}
.sf-settings .copy-row .mono { flex: 1; min-width: 0; }
.sf-settings .url-list { display: flex; flex-direction: column; gap: 0.375rem; }
.sf-settings .tabs {
  display: flex; gap: 0.25rem; flex-wrap: wrap;
  background: #f0fdfa; border: 0.0625rem solid #ccfbf1;
  border-radius: 0.75rem; padding: 0.25rem;
}
.sf-settings .tab {
  border: 0; background: transparent; cursor: pointer;
  padding: 0.5rem 1rem; border-radius: 0.625rem;
  font-size: 0.8125rem; font-weight: 600; color: #5b6b6a;
  transition: background 0.15s, color 0.15s;
}
.sf-settings .tab:hover { color: #0d9488; }
.sf-settings .tab.is-active { background: #14b8a6; color: #fff; }
.sf-settings .sf-tab-panel {
  display: flex; flex-direction: column; gap: 0.75rem;
}
.sf-settings .step {
  display: flex; gap: 0.75rem; align-items: flex-start;
  padding: 0.875rem 1rem;
  border: 0.0625rem solid #ccfbf1; border-radius: 0.75rem;
  background: #fff;
}
.sf-settings .step-num {
  flex: 0 0 auto;
  width: 1.5rem; height: 1.5rem; border-radius: 50%;
  background: #14b8a6; color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.8125rem; font-weight: 700;
}
.sf-settings .step-body { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.sf-settings .step-title { font-size: 0.875rem; font-weight: 700; color: #134e4a; }
.sf-settings .step-list {
  margin: 0; padding-left: 1.25rem;
  font-size: 0.8125rem; color: #424a53; line-height: 1.7;
}
.sf-settings .step-list li + li { margin-top: 0.125rem; }
.sf-settings .faq {
  display: flex; flex-direction: column; gap: 0.25rem;
  padding: 0.625rem 0; border-bottom: 0.0625rem solid #f0fdfa;
}
.sf-settings .faq:last-child { border-bottom: 0; }
.sf-settings .faq-q { font-size: 0.8125rem; font-weight: 700; color: #134e4a; }
.sf-settings .faq-a { margin: 0; font-size: 0.75rem; line-height: 1.6; color: #5b6b6a; }
.sf-settings .steps-wrap { display: flex; flex-direction: column; gap: 0.5rem; }
.sf-settings .dl-list { display: flex; flex-direction: column; gap: 0.375rem; }
.sf-settings .dl-item {
  display: flex; flex-direction: column; gap: 0.125rem;
  padding: 0.5rem 0.625rem; border-radius: 0.5rem;
  background: #f0fdfa; border: 0.0625rem solid #ccfbf1;
}
.sf-settings .dl-name { font-size: 0.8125rem; font-weight: 600; color: #134e4a; }
.sf-settings .dl-name a { color: #0d9488; text-decoration: none; }
.sf-settings .dl-name a:hover { text-decoration: underline; }
.sf-settings .dl-note { margin: 0; font-size: 0.6875rem; color: #8b949e; line-height: 1.45; }
.sf-settings .step-list .step-copy {
  list-style: none;
  display: flex; flex-direction: column; gap: 0.375rem;
  margin-left: -1.25rem; min-width: 0;
}
.sf-settings .step-copy-label { font-size: 0.8125rem; font-weight: 600; color: #134e4a; }
.sf-settings .step-copy-values { display: flex; flex-direction: column; gap: 0.375rem; }
.sf-settings .tag-wrap {
  display: flex; flex-wrap: wrap; gap: 0.375rem;
}
.sf-settings .mms-search { max-width: 20rem; }
.sf-settings .mms-toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.sf-settings .mms-tags { display: flex; flex-wrap: wrap; gap: 0.375rem; }
.sf-settings .mms-tag { cursor: pointer; user-select: none; transition: box-shadow 0.15s, opacity 0.15s; }
.sf-settings .mms-tag:hover { opacity: 0.85; }
.sf-settings .mms-tag.is-selected { box-shadow: 0 0 0 0.125rem #d97706 inset; }
.sf-settings .mms-empty { margin: 0; font-size: 0.8125rem; color: #8b949e; }
.sf-settings .kw-add { display: flex; gap: 0.5rem; align-items: center; }
.sf-settings .kw-add .n-input { flex: 1; min-width: 0; }
.sf-settings .filter-empty { margin: 0; font-size: 0.8125rem; color: #8b949e; }
.sf-settings .adv-section-title {
  margin: 0.25rem 0 0; font-size: 0.875rem; font-weight: 750; color: #134e4a;
}
.sf-settings .adv-grid-2,
.sf-settings .adv-grid-3 {
  display: grid; gap: 0.75rem; grid-template-columns: 1fr;
}
@media (min-width: 48rem) {
  .sf-settings .adv-grid-2 { grid-template-columns: 1fr 1fr; align-items: stretch; }
  .sf-settings .adv-grid-3 { grid-template-columns: 1fr 1fr 1fr; align-items: stretch; }
}
.sf-settings .adv-tile {
  padding: 1rem;
  border: 0.0625rem solid #ccfbf1; border-radius: 1rem;
  background: #fff; min-width: 0;
  display: flex; flex-direction: column; gap: 0.625rem;
}
.sf-settings .adv-tile-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;
}
.sf-settings .adv-tile-title { margin: 0; font-size: 0.875rem; font-weight: 750; color: #134e4a; }
.sf-settings .adv-tile-desc { margin: 0; font-size: 0.75rem; line-height: 1.55; color: #5b6b6a; }
.sf-settings .adv-chip-box {
  min-height: 5.5rem;
  padding: 0.5rem;
  border: 0.0625rem solid #e5e7eb; border-radius: 0.5rem;
  background: #fafafa;
  display: flex; flex-wrap: wrap; gap: 0.375rem; align-content: flex-start;
}
.sf-settings .adv-chip-input { flex: 1 1 8rem; min-width: 8rem; }
.sf-settings .chip-text {
  min-width: 0; overflow-wrap: anywhere; word-break: break-word; white-space: normal; line-height: 1.4;
}
.sf-settings .chip-pkg {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.sf-settings .adv-tile-foot {
  margin-top: auto; padding-top: 0.5rem;
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;
  font-size: 0.6875rem; color: #8b949e;
}
.sf-settings .adv-status-dot {
  width: 0.5rem; height: 0.5rem; border-radius: 999px; background: #14b8a6; display: inline-block;
}
.sf-settings .adv-metric { display: flex; align-items: center; gap: 0.5rem; }
.sf-settings .adv-metric .n-input { flex: 1; min-width: 0; }
.sf-settings .filter-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.sf-settings .filter-composer {
  display: flex; flex-direction: column; gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: 0.0625rem solid #ccfbf1; border-radius: 0.75rem;
  background: #f0fdfa;
}
.sf-settings .filter-composer-title { margin: 0; font-size: 0.8125rem; font-weight: 750; color: #0f766e; }
.sf-settings .filter-form {
  display: grid; gap: 0.5rem 0.75rem;
  grid-template-columns: 1fr;
}
.sf-settings .filter-form > .field { min-width: 0; }
@media (min-width: 40rem) {
  .sf-settings .filter-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 72rem) {
  .sf-settings .filter-form { grid-template-columns: repeat(5, minmax(0, 1fr)); }
}
.sf-settings .filter-form .label { font-size: 0.6875rem; }
.sf-settings .filter-add {
  display: flex; justify-content: flex-end;
}
.sf-settings .filter-list-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
  font-size: 0.75rem; color: #5b6b6a;
}
.sf-settings .filter-list {
  display: flex; flex-direction: column; gap: 0.5rem;
  max-height: 16rem; overflow-y: auto;
}
.sf-settings .filter-item {
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
  padding: 0.5rem 0.75rem;
  border: 0.0625rem solid #e2e8f0; border-radius: 0.75rem; background: #fff;
}
.sf-settings .filter-item.is-off { opacity: 0.55; }
.sf-settings .filter-item.is-warn { border-color: #fde68a; background: #fffbeb; }
.sf-settings .filter-tags { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; min-width: 0; flex: 1; }
.sf-settings .filter-tag {
  display: inline-flex; align-items: center;
  padding: 0.125rem 0.5rem; border-radius: 999px;
  font-size: 0.6875rem; font-weight: 700;
}
.sf-settings .filter-tag.is-hide { background: #ccfbf1; color: #0f766e; }
.sf-settings .filter-tag.is-muted { background: #f1f5f9; color: #475569; }
.sf-settings .filter-tag.is-match { background: #e0f2fe; color: #0369a1; }
.sf-settings .filter-quote {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem; color: #0f172a; background: #f8fafc;
  padding: 0.125rem 0.375rem; border-radius: 0.375rem;
}
.sf-settings .filter-scope { font-size: 0.6875rem; color: #64748b; }
.sf-settings .filter-warn { margin: 0; width: 100%; font-size: 0.6875rem; color: #b45309; }
.sf-settings .block-box {
  border: 0.0625rem solid #ccfbf1; border-radius: 0.75rem; overflow: hidden; background: #fff;
}
.sf-settings .block-search { padding: 0.5rem 0.625rem; border-bottom: 0.0625rem solid #f0fdfa; }
.sf-settings .block-list { max-height: 16rem; overflow-y: auto; }
.sf-settings .block-row {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 0.0625rem solid #f0fdfa;
}
.sf-settings .block-row:last-child { border-bottom: 0; }
.sf-settings .block-row:hover { background: #f0fdfa; }
.sf-settings .block-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 0.125rem; }
.sf-settings .block-title { font-size: 0.8125rem; font-weight: 600; color: #134e4a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-settings .block-sub {
  font-size: 0.6875rem; color: #8b949e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.sf-settings .block-count { font-size: 0.75rem; font-weight: 600; color: #8b949e; }
.sf-settings .block-split {
  display: grid; gap: 0.75rem;
  grid-template-columns: 1fr;
}
@media (min-width: 56rem) {
  .sf-settings .block-split { grid-template-columns: 1fr 1fr; align-items: stretch; }
}
.sf-settings .pane {
  padding: 1rem 1.125rem;
  border: 0.0625rem solid #99f6e4;
  border-radius: 1rem;
  background: #fff;
  display: flex; flex-direction: column; gap: 0.75rem; min-width: 0;
  max-height: 22rem; overflow: hidden;
}
.sf-settings .pane-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding-right: 0.25rem; margin-right: -0.25rem;
}
.sf-settings .pane-body:empty { display: none; }
.sf-settings .pane-head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;
}
.sf-settings .pane-title {
  margin: 0; font-size: 0.9375rem; font-weight: 750; color: #134e4a;
  display: inline-flex; align-items: center; gap: 0.5rem;
}
.sf-settings .pane-title .count { color: #8b949e; font-weight: 600; font-size: 0.8125rem; }
.sf-settings .pane-hint { font-size: 0.75rem; color: #94a3b8; font-weight: 500; }
.sf-settings .seg {
  display: inline-flex; padding: 0.1875rem; border-radius: 0.5rem;
  background: #f1f5f9; gap: 0.125rem;
}
.sf-settings .seg-btn {
  border: 0; background: transparent; cursor: pointer;
  padding: 0.25rem 0.625rem; border-radius: 0.375rem;
  font-size: 0.75rem; font-weight: 600; color: #64748b;
}
.sf-settings .seg-btn.is-on { background: #fff; color: #0f172a; box-shadow: 0 0.0625rem 0.125rem rgba(15,23,42,0.08); }
.sf-settings .search-add {
  display: flex; align-items: center; gap: 0.5rem;
}
.sf-settings .search-add .n-input { flex: 1; min-width: 0; }
.sf-settings .title-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: flex-start; }
.sf-settings .title-chips .n-tag { max-width: 100%; height: auto; white-space: normal; }
.sf-settings .adv-toggle {
  border: 0; background: transparent; cursor: pointer;
  padding: 0; text-align: left;
  font-size: 0.8125rem; font-weight: 700; color: #0d9488;
  display: inline-flex; align-items: center; gap: 0.375rem;
}
.sf-settings .adv-toggle:hover { color: #0f766e; }
.sf-settings .adv-chevron {
  display: inline-block; font-size: 0.6875rem; line-height: 1;
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: center;
}
.sf-settings .adv-toggle[aria-expanded="true"] .adv-chevron { transform: rotate(180deg); }
.sf-settings .advanced-card { gap: 0; }
.sf-settings .adv-collapse {
  display: grid; grid-template-rows: 0fr;
  margin-top: 0; opacity: 0;
  transition:
    grid-template-rows 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    margin-top 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.18s ease;
}
.sf-settings .adv-collapse.open {
  grid-template-rows: 1fr;
  margin-top: 0.75rem; opacity: 1;
}
.sf-settings .adv-collapse-inner { min-height: 0; overflow: hidden; }
.sf-settings .adv-body {
  display: flex; flex-direction: column; gap: 0.75rem;
  padding-top: 0.25rem;
}
@media (prefers-reduced-motion: reduce) {
  .sf-settings .adv-chevron,
  .sf-settings .adv-collapse { transition: none; }
}
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  for (const id of [
    'catrace-plugin-smsforwarder-notify-settings-css',
    'catrace-plugin-smsforwarder-notify-settings-css-v2',
    'catrace-plugin-smsforwarder-notify-settings-css-v3',
    'catrace-plugin-smsforwarder-notify-settings-css-v4',
    'catrace-plugin-smsforwarder-notify-settings-css-v5',
    'catrace-plugin-smsforwarder-notify-settings-css-v6',
    'catrace-plugin-smsforwarder-notify-settings-css-v7',
    'catrace-plugin-smsforwarder-notify-settings-css-v8',
    'catrace-plugin-smsforwarder-notify-settings-css-v9',
    'catrace-plugin-smsforwarder-notify-settings-css-v10',
    'catrace-plugin-smsforwarder-notify-settings-css-v11',
  ]) {
    const old = document.getElementById(id)
    if (old) old.remove()
  }
  let el = document.getElementById(STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = CSS
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

/** Stable sort for blacklist entries: digits/letters first, then CJK by pinyin. */
function sortBlacklist(list) {
  return [...list].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'base' }))
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

export default {
  name: 'SmsforwarderNotifySettings',
  setup(_props, { expose }) {
    ensureStyles()
    const message = useMessage()
    const loading = ref(true)
    const busy = ref('')
    const headerLoading = ref(false)
    const enabled = ref(true)
    const host = ref('0.0.0.0')
    const port = ref(DEFAULT_PORT)
    const path = ref(DEFAULT_PATH)
    const token = ref('')
    const showToken = ref(false)
    const cardDurationSec = ref(DEFAULT_CARD_SEC)
    const dedupeWindowSec = ref(DEFAULT_DEDUPE_SEC)
    const blacklistText = ref('')
    const mmsTitleBlacklist = ref([])
    const mmsTitleQuery = ref('')
    const mmsSelected = ref(new Set())
    const filters = ref([])
    const keywordDraft = ref('')
    const filterDraft = ref({
      field: 'title',
      match: 'contains',
      value: '',
      appContains: '',
    })
    const appDraft = ref('')
    const appQuery = ref('')
    const titleQuery = ref('')
    const pausedApps = ref([])
    const hideSensitiveBody = ref(false)
    const enableOtpAction = ref(true)
    const onlyPushWhenActive = ref(false)
    const mergeChatThreads = ref(true)
    const chatAppsText = ref(blacklistToText(DEFAULT_CONFIG.chatApps))
    const chatAppDraft = ref('')
    const status = ref(null)
    const webhookInfo = ref(null)
    const activeTab = ref('overview')
    const showAdvanced = ref(false)
    let saveTimer = null

    const headerEnabled = computed(() => enabled.value !== false)

    const shownMmsTitles = computed(() => {
      const q = mmsTitleQuery.value.trim().toLowerCase()
      const list = sortBlacklist(mmsTitleBlacklist.value)
      if (!q) return list
      return list.filter((t) => String(t).toLowerCase().includes(q))
    })

    const mmsSelectedCount = computed(() => mmsSelected.value.size)

    function toggleMmsTitle(t) {
      const next = new Set(mmsSelected.value)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      mmsSelected.value = next
    }

    function selectAllShown() {
      mmsSelected.value = new Set(shownMmsTitles.value)
    }

    function clearMmsSelection() {
      mmsSelected.value = new Set()
    }

    const blockedAppRows = computed(() => {
      const q = appQuery.value.trim().toLowerCase()
      return textToBlacklist(blacklistText.value)
        .map((item) => {
          const label = String(item || '').trim()
          return {
            key: `app:${label.toLowerCase()}`,
            title: label,
            tokens: [label],
          }
        })
        .filter((row) => !q || row.title.toLowerCase().includes(q))
        .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN', { sensitivity: 'base' }))
    })

    const titleBlocks = computed(() => {
      const out = []
      for (const f of filters.value) {
        if (!f || !f.value) continue
        out.push({
          kind: 'filter',
          id: f.id,
          title: String(f.value).trim(),
          sub: String(f.appContains || '').trim(),
        })
      }
      for (const t of mmsTitleBlacklist.value) {
        const label = String(t || '').trim()
        if (!label) continue
        out.push({ kind: 'mms', id: `mms:${label}`, title: label, sub: '锁屏短信' })
      }
      out.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN', { sensitivity: 'base' }))
      const q = titleQuery.value.trim().toLowerCase()
      if (!q) return out
      return out.filter(
        (r) =>
          r.title.toLowerCase().includes(q) || String(r.sub || '').toLowerCase().includes(q),
      )
    })

    function addChatApp() {
      const value = String(chatAppDraft.value || '').trim()
      if (!value) return
      const list = textToBlacklist(chatAppsText.value)
      if (!list.some((x) => String(x).toLowerCase() === value.toLowerCase())) {
        list.push(value)
        chatAppsText.value = sortBlacklist(list).join('\n')
        scheduleSave()
      }
      chatAppDraft.value = ''
    }

    function removeChatApp(name) {
      const drop = String(name || '').toLowerCase()
      chatAppsText.value = textToBlacklist(chatAppsText.value)
        .filter((x) => String(x).toLowerCase() !== drop)
        .join('\n')
      scheduleSave()
    }

    function addBlockedApp() {
      const value = String(appDraft.value || '').trim()
      if (!value) return
      const list = textToBlacklist(blacklistText.value)
      if (!list.some((x) => String(x).toLowerCase() === value.toLowerCase())) {
        list.push(value)
        blacklistText.value = sortBlacklist(list).join('\n')
        scheduleSave()
      }
      appDraft.value = ''
    }

    function removeBlockedApp(row) {
      const drop = String(row && row.title ? row.title : '').toLowerCase()
      if (!drop) return
      const list = textToBlacklist(blacklistText.value).filter(
        (x) => String(x).toLowerCase() !== drop,
      )
      blacklistText.value = list.join('\n')
      pausedApps.value = sortBlacklist(
        pausedApps.value.filter((x) => String(x).toLowerCase() !== drop),
      )
      scheduleSave()
    }

    function patchFilter(idx, patch) {
      const next = filters.value.slice()
      if (!next[idx]) return
      next[idx] = { ...next[idx], ...patch }
      filters.value = next
      scheduleSave()
    }

    function addKeywordFilter() {
      const value = String(keywordDraft.value || '').trim()
      if (!value) return
      const dup = filters.value.some(
        (f) =>
          f &&
          String(f.value || '').toLowerCase() === value.toLowerCase() &&
          (f.match === 'contains' || f.match === 'equals'),
      )
      if (dup) {
        keywordDraft.value = ''
        return
      }
      if (filters.value.length >= MAX_FILTERS) return
      filters.value = [
        ...filters.value,
        {
          id: newFilterId(),
          enabled: true,
          field: 'any',
          match: 'contains',
          value,
          appContains: '',
        },
      ]
      keywordDraft.value = ''
      scheduleSave()
    }

    function addCustomFilter() {
      const field = FILTER_FIELDS.has(filterDraft.value.field) ? filterDraft.value.field : 'title'
      const match = FILTER_MATCHES.has(filterDraft.value.match)
        ? filterDraft.value.match
        : 'contains'
      const value = String(filterDraft.value.value || '').trim()
      const appContains = String(filterDraft.value.appContains || '').trim()
      if (!value) {
        message.warning('先填要拦截的内容')
        return
      }
      const regexErr = filterRegexError(match, value)
      if (regexErr) {
        message.warning(regexErr)
        return
      }
      if (filters.value.length >= MAX_FILTERS) {
        message.warning(`最多 ${MAX_FILTERS} 条`)
        return
      }
      const dup = filters.value.some(
        (f) =>
          f &&
          String(f.field || '') === field &&
          String(f.match || '') === match &&
          String(f.value || '').toLowerCase() === value.toLowerCase() &&
          String(f.appContains || '').toLowerCase() === appContains.toLowerCase(),
      )
      if (dup) {
        message.warning('已经有同样的规则了')
        return
      }
      filters.value = [
        ...filters.value,
        {
          id: newFilterId(),
          enabled: true,
          field,
          match,
          value,
          appContains,
        },
      ]
      filterDraft.value = { field, match, value: '', appContains }
      scheduleSave()
    }

    function removeFilter(id) {
      filters.value = filters.value.filter((f) => f && f.id !== id)
      scheduleSave()
    }

    function removeTitleBlock(item) {
      if (!item) return
      if (item.kind === 'filter') {
        removeFilter(item.id)
        return
      }
      const label = String(item.title || item.label || '')
      mmsTitleBlacklist.value = mmsTitleBlacklist.value.filter(
        (t) => String(t).toLowerCase() !== label.toLowerCase(),
      )
      scheduleSave()
    }

    function removeSelectedMmsTitles() {
      const sel = mmsSelected.value
      if (!sel.size) return
      const next = mmsTitleBlacklist.value.filter((t) => !sel.has(t))
      mmsTitleBlacklist.value = next
      mmsSelected.value = new Set()
      scheduleSave()
    }

    function currentConfig() {
      return {
        enabled: enabled.value !== false,
        host: String(host.value || '0.0.0.0').trim() || '0.0.0.0',
        port: clamp(port.value, MIN_PORT, MAX_PORT, DEFAULT_PORT),
        path: normalizePath(path.value),
        token: String(token.value || '').trim(),
        cardDurationSec: clamp(cardDurationSec.value, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC),
        dedupeWindowSec: clamp(
          dedupeWindowSec.value,
          MIN_DEDUPE_SEC,
          MAX_DEDUPE_SEC,
          DEFAULT_DEDUPE_SEC,
        ),
        appBlacklist: textToBlacklist(blacklistText.value),
        appBlacklistPaused: sortBlacklist(pausedApps.value),
        mmsTitleBlacklist: sortBlacklist(
          Array.isArray(mmsTitleBlacklist.value) ? mmsTitleBlacklist.value : [],
        ),
        filters: persistableFilters(filters.value),
        hideSensitiveBody: false,
        enableOtpAction: enableOtpAction.value !== false,
        onlyPushWhenActive: onlyPushWhenActive.value === true,
        mergeChatThreads: mergeChatThreads.value !== false,
        chatApps: textToBlacklist(chatAppsText.value),
      }
    }

    function applyConfig(cfg = {}) {
      enabled.value = cfg.enabled !== false
      if (typeof cfg.host === 'string' && cfg.host.trim()) host.value = cfg.host.trim()
      port.value = clamp(cfg.port, MIN_PORT, MAX_PORT, DEFAULT_PORT)
      path.value = normalizePath(cfg.path)
      if (typeof cfg.token === 'string') token.value = cfg.token
      cardDurationSec.value = clamp(cfg.cardDurationSec, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC)
      dedupeWindowSec.value = clamp(
        cfg.dedupeWindowSec,
        MIN_DEDUPE_SEC,
        MAX_DEDUPE_SEC,
        DEFAULT_DEDUPE_SEC,
      )
      blacklistText.value = blacklistToText(cfg.appBlacklist)
      pausedApps.value = sortBlacklist(
        Array.isArray(cfg.appBlacklistPaused) ? cfg.appBlacklistPaused : [],
      )
      mmsTitleBlacklist.value = sortBlacklist(
        Array.isArray(cfg.mmsTitleBlacklist) ? cfg.mmsTitleBlacklist : [],
      )
      mmsSelected.value = new Set()
      mmsTitleQuery.value = ''
      filters.value = normalizeFilters(cfg.filters)
      hideSensitiveBody.value = false
      enableOtpAction.value = cfg.enableOtpAction !== false
      onlyPushWhenActive.value = cfg.onlyPushWhenActive === true
      mergeChatThreads.value = cfg.mergeChatThreads !== false
      chatAppsText.value = blacklistToText(
        Array.isArray(cfg.chatApps) && cfg.chatApps.length ? cfg.chatApps : DEFAULT_CONFIG.chatApps,
      )
    }

    async function run(key, task) {
      busy.value = key
      try {
        await task()
      } catch (error) {
        message.error(errorText(error))
      } finally {
        busy.value = ''
      }
    }

    async function copyText(text, okMsg = '已复制') {
      const s = String(text || '')
      if (!s) {
        message.warning('无可复制内容')
        return
      }
      try {
        if (plugin.clipboard && typeof plugin.clipboard.writeText === 'function') {
          await plugin.clipboard.writeText(s)
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(s)
        } else {
          throw new Error('clipboard unavailable')
        }
        message.success(okMsg)
      } catch (e) {
        message.error(`复制失败：${errorText(e)}`)
      }
    }

    async function persistAndSync({ quiet = false } = {}) {
      const cfg = currentConfig()
      port.value = cfg.port
      path.value = cfg.path
      cardDurationSec.value = cfg.cardDurationSec
      dedupeWindowSec.value = cfg.dedupeWindowSec
      await plugin.config.set(cfg)
      try {
        if (plugin.sidecar && typeof plugin.sidecar.request === 'function') {
          const result = await plugin.sidecar.request('setConfig', cfg)
          status.value = result && typeof result === 'object' ? result : status.value
          if (result && result.ok === false && result.error) {
            if (!quiet) message.error(`监听失败：${result.error}`)
          } else if (!quiet) {
            message.success('已保存')
          }
          // pull token if sidecar generated one
          await refreshWebhookInfo({ quiet: true })
        } else if (!quiet) {
          message.warning('已保存（启用插件后 sidecar 生效）')
        }
      } catch (error) {
        if (!quiet) message.warning('已保存（启用插件后 sidecar 生效）')
        await plugin.log?.warn?.('config saved without sidecar', { error: errorText(error) })
      }
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null
        persistAndSync({ quiet: true }).catch((error) => message.error(errorText(error)))
      }, 400)
    }

    async function refreshStatus() {
      if (!plugin.sidecar || typeof plugin.sidecar.request !== 'function') {
        status.value = { error: 'sidecar 未运行（请启用插件）', running: false }
        return
      }
      const result = await plugin.sidecar.request('getStatus')
      status.value = result && typeof result === 'object' ? result : { raw: result }
    }

    async function refreshWebhookInfo({ quiet = false } = {}) {
      if (!plugin.sidecar || typeof plugin.sidecar.request !== 'function') {
        if (!quiet) webhookInfo.value = null
        return
      }
      try {
        const result = await plugin.sidecar.request('getWebhookInfo')
        webhookInfo.value = result && typeof result === 'object' ? result : null
        if (result && typeof result.token === 'string' && result.token) {
          // sidecar is source of truth for the live webhook secret
          const prev = String(token.value || '').trim()
          const live = result.token.trim()
          if (prev !== live) {
            token.value = live
            await plugin.config.set(currentConfig())
          }
        }
        if (result) {
          status.value = {
            ...(status.value && typeof status.value === 'object' ? status.value : {}),
            ...result,
            token: undefined,
          }
        }
      } catch (e) {
        if (!quiet) throw e
      }
    }

    async function regenerateToken() {
      await run('regen', async () => {
        if (!plugin.sidecar?.request) {
          // local fallback
          const bytes = new Uint8Array(32)
          crypto.getRandomValues(bytes)
          token.value = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
          await persistAndSync({ quiet: true })
          message.success('已重新生成 Token')
          return
        }
        const result = await plugin.sidecar.request('regenerateToken')
        if (result && typeof result.token === 'string') {
          token.value = result.token
          webhookInfo.value = result
          await plugin.config.set(currentConfig())
          message.success('已重新生成 Token（手机端需同步更新）')
        }
        await refreshStatus()
      })
    }

    async function restartServer() {
      await run('restart', async () => {
        await persistAndSync({ quiet: true })
        if (!plugin.sidecar?.request) {
          message.warning('sidecar 未运行')
          return
        }
        const result = await plugin.sidecar.request('restartServer')
        status.value = result
        if (result?.ok === false) message.error(result.error || '重启失败')
        else message.success('服务已重启')
        await refreshWebhookInfo({ quiet: true })
      })
    }

    async function clearChatHistory() {
      await run('clear-chat', async () => {
        if (plugin.sidecar?.request) {
          await plugin.sidecar.request('clearChatHistory', {})
        }
        if (plugin.storage && typeof plugin.storage.remove === 'function') {
          try {
            await plugin.storage.remove('chatThreads')
          } catch {
            /* sidecar already cleared */
          }
        }
        message.success('对话历史已清空')
      })
    }

    async function sendTest() {
      await run('test', async () => {
        const cfg = currentConfig()
        // prefer sidecar test (exercises publish path)
        if (plugin.sidecar?.request) {
          try {
            await plugin.sidecar.request('setConfig', cfg)
            await plugin.sidecar.request('sendTest', {})
            message.success('已发送测试通知')
            await refreshStatus()
            return
          } catch {
            /* fall through */
          }
        }
        const sticky = cfg.cardDurationSec <= 0
        const now = Date.now()
        const lagMs = 5 * 60 * 1000
        const phoneIso = new Date(now - lagMs).toISOString()
        const pcIso = new Date(now).toISOString()
        await plugin.events.publish({
          eventType: 'smsforwarder-notify.notification',
          kind: 'smsforwarder-notify',
          title: '测试 App · 测试通知',
          body: '这是一条 SmsForwarder 测试消息，验证码 123456',
          level: 'info',
          sticky,
          actions: [
            { id: 'copy-otp', label: '复制验证码' },
            ...(sticky ? [{ id: 'dismiss', label: '知道了' }] : []),
            { id: 'block-title', label: '屏蔽这个标题' },
            { id: 'block-app', label: '屏蔽此应用' },
          ],
          payload: {
            packageName: 'com.example.test',
            appName: '测试 App',
            title: '测试通知',
            body: '这是一条 SmsForwarder 测试消息，验证码 123456',
            // phone 5 min earlier; PC receive / toast now → 延迟 ~5 分
            receivedAt: phoneIso,
            webhookAt: pcIso,
            publishedAt: pcIso,
            shownAt: pcIso,
            otp: '123456',
            noticeKind: 'otp',
            auto_hide_ms: sticky ? 0 : cfg.cardDurationSec * 1000,
            card_duration_sec: cfg.cardDurationSec,
          },
          dedupeKey: `smsforwarder-notify:test:${now}`,
        })
        message.success('已发送测试通知')
      })
    }

    async function toggleEnabled(val) {
      const previous = enabled.value
      enabled.value = val
      headerLoading.value = true
      try {
        await plugin.setEnabled(val)
        await plugin.config.set(currentConfig())
        window.dispatchEvent(
          new CustomEvent('catrace:plugin-enabled-changed', {
            detail: { id: PLUGIN_ID, enabled: val },
          }),
        )
        try {
          if (plugin.sidecar?.request) {
            const result = await plugin.sidecar.request('setConfig', currentConfig())
            status.value = result
          }
        } catch {
          /* ignore */
        }
      } catch (e) {
        enabled.value = previous
        message.error(errorText(e))
      } finally {
        headerLoading.value = false
      }
    }

    /** Reload blacklist / switches when toast block-app (or other window) writes config. */
    async function reloadConfigFromStore() {
      try {
        const raw = await plugin.config.get()
        if (!raw || typeof raw !== 'object') return
        // Keep local edits if user is mid-type: only refresh lists + toggles that
        // toast actions mutate; full applyConfig would stomp port/token drafts.
        const cfg = raw
        blacklistText.value = blacklistToText(cfg.appBlacklist)
        pausedApps.value = sortBlacklist(
          Array.isArray(cfg.appBlacklistPaused) ? cfg.appBlacklistPaused : [],
        )
        mmsTitleBlacklist.value = sortBlacklist(
          Array.isArray(cfg.mmsTitleBlacklist) ? cfg.mmsTitleBlacklist : [],
        )
        filters.value = normalizeFilters(cfg.filters)
        // Drop selections that no longer exist
        if (mmsSelected.value.size) {
          const set = new Set(mmsTitleBlacklist.value)
          mmsSelected.value = new Set([...mmsSelected.value].filter((t) => set.has(t)))
        }
      } catch (e) {
        console.warn('[smsforwarder-notify] reload config failed', e)
      }
    }

    function onPluginConfigChanged(ev) {
      const id = ev && ev.detail && ev.detail.pluginId
      if (id && id !== PLUGIN_ID) return
      void reloadConfigFromStore()
    }

    onMounted(() => {
      if (typeof window !== 'undefined') {
        window.addEventListener('catrace:plugin-config-changed', onPluginConfigChanged)
      }
      run('boot', async () => {
        loading.value = true
        try {
          const raw = await plugin.config.get()
          applyConfig(raw && typeof raw === 'object' ? raw : DEFAULT_CONFIG)
          try {
            // push UI/plugin.config into sidecar first so the Token field is what HTTP checks
            if (plugin.sidecar?.request) {
              const pushed = await plugin.sidecar.request('setConfig', currentConfig())
              if (pushed && typeof pushed === 'object') status.value = pushed
            }
            await refreshStatus()
            // pull live token (sidecar may have generated one if field was empty)
            await refreshWebhookInfo({ quiet: true })
          } catch {
            status.value = null
          }
        } finally {
          loading.value = false
        }
      })
    })

    if (typeof onBeforeUnmount === 'function') {
      onBeforeUnmount(() => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('catrace:plugin-config-changed', onPluginConfigChanged)
        }
      })
    }

    expose({
      headerEnabled,
      headerLoading,
      toggleEnabled,
    })

    return () => {
      const st = status.value || {}
      const info = webhookInfo.value || {}
      const urls =
        (Array.isArray(st.webhookUrls) && st.webhookUrls.length
          ? st.webhookUrls
          : Array.isArray(info.webhookUrls)
            ? info.webhookUrls
            : []) || []
      const primaryUrl = urls[0] || `http://<电脑IP>:${port.value}${normalizePath(path.value)}`
      const authHeader =
        info.authorizationHeader ||
        (token.value ? `Authorization: Bearer ${token.value}` : 'Authorization: Bearer <token>')
      const template = info.jsonTemplate || JSON_TEMPLATE

      const statusRows = st.error
        ? [['状态', st.error]]
        : [
            ['服务', st.running ? '运行中' : '未运行'],
            ['监听', st.running ? `${st.host || host.value}:${st.port || port.value}` : '-'],
            ['路径', st.path || path.value],
            ['Token', st.hasToken || token.value ? '已配置' : '未配置'],
            ['已接收', String(st.acceptedCount ?? 0)],
            ['已拒绝', String(st.rejectedCount ?? 0)],
            ['已去重', String(st.dedupedCount ?? 0)],
            [
              '最近成功',
              st.lastSuccessAt ? new Date(st.lastSuccessAt).toLocaleString() : '-',
            ],
            ['最近来源', st.lastClientIp || '-'],
            ['最近错误', st.lastErrorSummary || '无'],
            ...(st.onlyPushWhenActive && st.pendingCount > 0
              ? [['待补推', `${String(st.pendingCount)} 条（空闲时暂存，活跃后推送）`]]
              : []),
          ]

      const copyBtn = (label, text, key) =>
        h(
          NButton,
          {
            size: 'tiny',
            secondary: true,
            loading: busy.value === key,
            onClick: () => copyText(text),
          },
          { default: () => label },
        )

      const tabBar = h(
        'div',
        { class: 'tabs' },
        TABS.map((t) =>
          h(
            'button',
            {
              key: t.id,
              class: ['tab', { 'is-active': activeTab.value === t.id }],
              onClick: () => {
                activeTab.value = t.id
              },
            },
            t.label,
          ),
        ),
      )

      const headerCard = h('div', { class: 'card' }, [
        h('div', { class: 'head' }, [
          h('h2', 'SmsForwarder 通知'),
          h(
            NTag,
            {
              size: 'small',
              round: true,
              bordered: false,
              type: enabled.value ? 'success' : 'default',
            },
            { default: () => (enabled.value ? '已启用' : '已关闭') },
          ),
        ]),
        h(
          'p',
          { class: 'desc' },
          '本机开 HTTP Webhook，接收 Android SmsForwarder 转发的 App 通知，弹出 Catrace Toast。仅建议可信局域网使用。',
        ),
        h(
          'p',
          { class: 'warn' },
          '安全：默认监听 0.0.0.0（全部网卡）。务必使用强 Token，勿暴露到公网。首次启动防火墙弹窗选「允许访问」即可，无需手动配置；手机连不上时再放行入站端口。',
        ),
      ])

      const overviewCard = h('div', { class: ['card', { 'is-error': !!st.error }] }, [
        h('div', { class: 'head' }, [h('h2', '服务状态')]),
        loading.value
          ? h('p', { class: 'desc' }, '加载中…')
          : h(
              'div',
              { class: ['status', { 'is-error': !!st.error }] },
              statusRows.flatMap(([k, v]) => [h('strong', k), h('span', String(v))]),
            ),
        h('div', { class: 'actions' }, [
          h(
            NButton,
            {
              size: 'small',
              loading: busy.value === 'status',
              disabled: !!busy.value && busy.value !== 'status',
              onClick: () =>
                run('status', async () => {
                  await refreshStatus()
                  await refreshWebhookInfo({ quiet: true })
                }),
            },
            { default: () => '刷新状态' },
          ),
          h(
            NButton,
            {
              size: 'small',
              loading: busy.value === 'restart',
              disabled: !!busy.value && busy.value !== 'restart',
              onClick: restartServer,
            },
            { default: () => '重启服务' },
          ),
          h(
            NButton,
            {
              size: 'small',
              type: 'primary',
              loading: busy.value === 'test',
              disabled: !!busy.value && busy.value !== 'test',
              onClick: sendTest,
            },
            { default: () => '发送测试 Toast' },
          ),
        ]),
      ])

      const settingsCard = h('div', { class: 'card' }, [
        h('div', { class: 'head' }, [h('h2', '连接')]),
        h('div', { class: 'field' }, [
          h('div', { class: 'label' }, '电脑接收地址'),
          h('div', { class: 'copy-row' }, [
            h('pre', { class: 'mono' }, primaryUrl),
            copyBtn('复制', primaryUrl, 'copy-url'),
          ]),
          urls.length > 1
            ? h(
                'div',
                { class: 'url-list' },
                urls.slice(1).map((u) =>
                  h('div', { class: 'copy-row', key: u }, [
                    h('pre', { class: 'mono' }, u),
                    copyBtn('复制', u, `copy-url-${u}`),
                  ]),
                ),
              )
            : null,
          h('p', { class: 'hint' }, '填到手机 SmsForwarder 的 Webhook。详细步骤见「教程」。'),
        ]),
        h('div', { class: 'field' }, [
          h('div', { class: 'label' }, 'Token'),
          h('div', { class: 'row-inline' }, [
            h(NInput, {
              value: token.value,
              type: showToken.value ? 'text' : 'password',
              showPasswordOn: 'click',
              placeholder: '启用插件后自动生成',
              style: { flex: 1, minWidth: '12rem' },
              'onUpdate:value': (v) => {
                token.value = v
                scheduleSave()
              },
            }),
            h(
              NButton,
              {
                size: 'small',
                onClick: () => {
                  showToken.value = !showToken.value
                },
              },
              { default: () => (showToken.value ? '隐藏' : '显示') },
            ),
            copyBtn('复制', authHeader.replace(/^Authorization:\s*/i, ''), 'copy-token'),
            NPopconfirm
              ? h(
                  NPopconfirm,
                  {
                    onPositiveClick: regenerateToken,
                  },
                  {
                    trigger: () =>
                      h(
                        NButton,
                        {
                          size: 'small',
                          type: 'warning',
                          loading: busy.value === 'regen',
                          disabled: !!busy.value && busy.value !== 'regen',
                        },
                        { default: () => '重新生成' },
                      ),
                    default: () => '重新生成会使手机端旧 Token 立即失效，确认？',
                  },
                )
              : h(
                  NButton,
                  {
                    size: 'small',
                    type: 'warning',
                    loading: busy.value === 'regen',
                    onClick: regenerateToken,
                  },
                  { default: () => '重新生成' },
                ),
          ]),
          h('p', { class: 'hint' }, 'SmsForwarder 请求头：Authorization: Bearer <token>'),
        ]),
        h('div', { class: 'field' }, [
          h('div', { class: 'label' }, '卡片显示多久'),
          h('div', { class: 'row-inline' }, [
            h(NInput, {
              class: 'num',
              value: String(cardDurationSec.value),
              'onUpdate:value': (v) => {
                cardDurationSec.value = clamp(v, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC)
                scheduleSave()
              },
            }),
            h('span', { class: 'unit' }, '秒（0=不自动关掉）'),
          ]),
        ]),
        h('div', { class: 'actions' }, [
          h(
            NButton,
            {
              size: 'small',
              type: 'primary',
              loading: busy.value === 'save',
              onClick: () => run('save', () => persistAndSync({ quiet: false })),
            },
            { default: () => '保存并应用' },
          ),
        ]),
      ])

      const chatApps = textToBlacklist(chatAppsText.value)
      const clearChatBtn = NPopconfirm
        ? h(
            NPopconfirm,
            { onPositiveClick: clearChatHistory },
            {
              trigger: () =>
                h(
                  NButton,
                  {
                    size: 'tiny',
                    type: 'error',
                    text: true,
                    loading: busy.value === 'clear-chat',
                  },
                  { default: () => '清空聊天记录' },
                ),
              default: () => '清空本机保存的全部会话气泡？',
            },
          )
        : h(
            NButton,
            {
              size: 'tiny',
              type: 'error',
              text: true,
              loading: busy.value === 'clear-chat',
              onClick: clearChatHistory,
            },
            { default: () => '清空聊天记录' },
          )

      const advancedBody = [
        h('div', { class: 'adv-grid-2' }, [
          h('div', { class: 'adv-tile' }, [
            h('div', { class: 'adv-tile-head' }, [
              h('h3', { class: 'adv-tile-title' }, '活跃时推送'),
              h(NSwitch, {
                value: onlyPushWhenActive.value,
                'onUpdate:value': (v) => {
                  onlyPushWhenActive.value = v === true
                  scheduleSave()
                },
              }),
            ]),
            h(
              'p',
              { class: 'adv-tile-desc' },
              '电脑有键鼠操作时才实时推送；空闲时先暂存，回来后一次性补推。',
            ),
            h('div', { class: 'adv-tile-foot' }, [
              h('span', [
                h('span', { class: 'adv-status-dot' }),
                ' ',
                onlyPushWhenActive.value ? '已开启（空闲先存）' : '已关闭（随时推送）',
              ]),
            ]),
          ]),
          h('div', { class: 'adv-tile' }, [
            h('div', { class: 'adv-tile-head' }, [
              h('h3', { class: 'adv-tile-title' }, '聊天小窗'),
              h(NSwitch, {
                value: mergeChatThreads.value,
                'onUpdate:value': (v) => {
                  mergeChatThreads.value = v !== false
                  scheduleSave()
                },
              }),
            ]),
            h('p', { class: 'adv-tile-desc' }, '指定 IM 合成对话小窗，历史保存在这台电脑。'),
            h('div', { class: 'adv-chip-box' }, [
              ...chatApps.map((name) =>
                h(
                  NTag,
                  {
                    key: name,
                    size: 'small',
                    round: true,
                    closable: true,
                    onClose: () => removeChatApp(name),
                  },
                  { default: () => h('span', { class: 'chip-text' }, name) },
                ),
              ),
              h(NInput, {
                class: 'adv-chip-input',
                size: 'small',
                bordered: true,
                value: chatAppDraft.value,
                placeholder: '+ 输入名字按回车添加',
                'onUpdate:value': (v) => {
                  chatAppDraft.value = v
                },
                onKeyup: (e) => {
                  if (e && e.key === 'Enter') addChatApp()
                },
              }),
            ]),
            h('div', { class: 'adv-tile-foot' }, [
              h('span', '输入应用名或包名后按回车添加'),
              clearChatBtn,
            ]),
          ]),
        ]),
        h('h3', { class: 'adv-section-title' }, '频控与 Webhook'),
        h('div', { class: 'adv-grid-3' }, [
          h('div', { class: 'adv-tile' }, [
            h('h3', { class: 'adv-tile-title' }, '相同通知最短间隔'),
            h('div', { class: 'adv-metric' }, [
              h(NInput, {
                value: String(dedupeWindowSec.value),
                'onUpdate:value': (v) => {
                  dedupeWindowSec.value = clamp(
                    v,
                    MIN_DEDUPE_SEC,
                    MAX_DEDUPE_SEC,
                    DEFAULT_DEDUPE_SEC,
                  )
                  scheduleSave()
                },
              }),
              h('span', { class: 'unit' }, '秒'),
            ]),
            h('p', { class: 'hint' }, '完全不一样的通知，短时间内再来一次就不重复。'),
          ]),
          h('div', { class: 'adv-tile' }, [
            h('h3', { class: 'adv-tile-title' }, 'Webhook 监听端口'),
            h(NInput, {
              value: String(port.value),
              'onUpdate:value': (v) => {
                port.value = clamp(v, MIN_PORT, MAX_PORT, DEFAULT_PORT)
                scheduleSave()
              },
            }),
            h('p', { class: 'hint' }, `端口范围：${MIN_PORT} – ${MAX_PORT}`),
          ]),
          h('div', { class: 'adv-tile' }, [
            h('h3', { class: 'adv-tile-title' }, 'Webhook 路由路径'),
            h(NInput, {
              value: path.value,
              placeholder: '/webhook',
              'onUpdate:value': (v) => {
                path.value = v
                scheduleSave()
              },
            }),
            h('p', { class: 'hint' }, '接收 SmsForwarder POST 的 HTTP 路径。'),
          ]),
        ]),
        h('div', { class: 'filter-head' }, [
          h('h3', { class: 'adv-section-title' }, '自定义过滤规则'),
          h(
            'p',
            { class: 'hint' },
            '比「不看这些标题」更细：可指定应用、正文或正则。命中就不弹。',
          ),
        ]),
        h('div', { class: 'filter-composer' }, [
          h('p', { class: 'filter-composer-title' }, '新建规则'),
          h('div', { class: 'filter-form' }, [
            h('div', { class: 'field' }, [
              h('div', { class: 'label' }, '动作'),
              h(NSelect, {
                value: 'hide',
                options: FILTER_ACTION_OPTIONS,
                size: 'small',
                disabled: true,
              }),
            ]),
            h('div', { class: 'field' }, [
              h('div', { class: 'label' }, '匹配字段'),
              h(NSelect, {
                value: filterDraft.value.field,
                options: FILTER_FIELD_OPTIONS,
                size: 'small',
                'onUpdate:value': (v) => {
                  filterDraft.value = {
                    ...filterDraft.value,
                    field: FILTER_FIELDS.has(v) ? v : 'title',
                  }
                },
              }),
            ]),
            h('div', { class: 'field' }, [
              h('div', { class: 'label' }, '匹配逻辑'),
              h(NSelect, {
                value: filterDraft.value.match,
                options: FILTER_MATCH_OPTIONS,
                size: 'small',
                'onUpdate:value': (v) => {
                  filterDraft.value = {
                    ...filterDraft.value,
                    match: FILTER_MATCHES.has(v) ? v : 'contains',
                  }
                },
              }),
            ]),
            h('div', { class: 'field' }, [
              h('div', { class: 'label' }, '关键词 / 正则'),
              h(NInput, {
                size: 'small',
                value: filterDraft.value.value,
                placeholder:
                  filterDraft.value.match === 'regex'
                    ? '例如 DSH Desktop.*交流群'
                    : '例如：DSH Desktop 交流群',
                'onUpdate:value': (v) => {
                  filterDraft.value = { ...filterDraft.value, value: v }
                },
                onKeyup: (e) => {
                  if (e && e.key === 'Enter') addCustomFilter()
                },
              }),
            ]),
            h('div', { class: 'field' }, [
              h('div', { class: 'label' }, '仅限应用（可选）'),
              h(NInput, {
                size: 'small',
                value: filterDraft.value.appContains,
                placeholder: 'QQ / com.tencent.mobileqq',
                'onUpdate:value': (v) => {
                  filterDraft.value = { ...filterDraft.value, appContains: v }
                },
                onKeyup: (e) => {
                  if (e && e.key === 'Enter') addCustomFilter()
                },
              }),
            ]),
          ]),
          filterRegexError(filterDraft.value.match, filterDraft.value.value)
            ? h('p', { class: 'filter-warn' }, filterRegexError(filterDraft.value.match, filterDraft.value.value))
            : null,
          h('div', { class: 'filter-add' }, [
            h(
              NButton,
              {
                size: 'small',
                type: 'primary',
                disabled: filters.value.length >= MAX_FILTERS,
                onClick: addCustomFilter,
              },
              { default: () => '添加到规则列表' },
            ),
          ]),
        ]),
        h('div', { class: 'filter-list-head' }, [
          h('span', `已生效规则（${filters.value.length}）`),
          h('span', { class: 'hint' }, '从上到下匹配'),
        ]),
        filters.value.length
          ? h(
              'div',
              { class: 'filter-list' },
              filters.value.map((f, idx) => {
                const issue = filterIssue(f)
                return h(
                  'div',
                  {
                    class: ['filter-item', { 'is-off': f.enabled === false, 'is-warn': !!issue }],
                    key: f.id,
                  },
                  [
                    h('div', { class: 'filter-tags' }, [
                      h('span', { class: 'filter-tag is-hide' }, '不看'),
                      h('span', { class: 'filter-tag is-muted' }, optionLabel(FILTER_FIELD_OPTIONS, f.field, '标题')),
                      h('span', { class: 'filter-tag is-match' }, optionLabel(FILTER_MATCH_OPTIONS, f.match, '包含文本')),
                      h('span', { class: 'filter-quote' }, `"${f.value || '…'}"`),
                      f.appContains ? h('span', { class: 'filter-scope' }, `仅限 ${f.appContains}`) : null,
                    ]),
                    issue ? h('p', { class: 'filter-warn' }, issue) : null,
                    h(NSwitch, {
                      size: 'small',
                      value: f.enabled !== false,
                      'onUpdate:value': (v) => patchFilter(idx, { enabled: v === true }),
                    }),
                    h(
                      NButton,
                      {
                        size: 'tiny',
                        quaternary: true,
                        type: 'error',
                        onClick: () => {
                          filters.value = filters.value.filter((_, i) => i !== idx)
                          scheduleSave()
                        },
                      },
                      { default: () => '删除' },
                    ),
                  ],
                )
              }),
            )
          : h('p', { class: 'filter-empty' }, '还没有自定义规则。常见群名直接在上面「不看这些标题」里加就行。'),
      ]

      const appPane = h('div', { class: 'pane' }, [
        h('div', { class: 'pane-head' }, [
          h('h3', { class: 'pane-title' }, [
            '不看这些应用',
            h('span', { class: 'count' }, `(${blockedAppRows.value.length})`),
          ]),
        ]),
        h('div', { class: 'search-add' }, [
          h(NInput, {
            size: 'small',
            value: appDraft.value || appQuery.value,
            placeholder: '搜索或输入包名，按 Enter 添加…',
            'onUpdate:value': (v) => {
              appDraft.value = v
              appQuery.value = v
            },
            onKeyup: (e) => {
              if (e && e.key === 'Enter') addBlockedApp()
            },
          }),
          h(
            NButton,
            { size: 'small', secondary: true, onClick: addBlockedApp },
            { default: () => '添加' },
          ),
        ]),
        h(
          'div',
          { class: 'pane-body' },
          blockedAppRows.value.length
            ? h(
                'div',
                { class: 'title-chips' },
                blockedAppRows.value.map((row) =>
                  h(
                    NTag,
                    {
                      key: row.key,
                      size: 'small',
                      round: true,
                      type: 'info',
                      closable: true,
                      onClose: () => removeBlockedApp(row),
                    },
                    {
                      default: () =>
                        h('span', { class: 'chip-text chip-pkg', title: row.title }, row.title),
                    },
                  ),
                ),
              )
            : h(
                'p',
                { class: 'filter-empty' },
                appQuery.value.trim() ? '没有匹配的应用' : '暂无。也可在通知卡片上点「屏蔽此应用」。',
              ),
        ),
      ])

      const titlePane = h('div', { class: 'pane' }, [
        h('div', { class: 'pane-head' }, [
          h('h3', { class: 'pane-title' }, [
            '不看这些标题',
            h('span', { class: 'count' }, `(${titleBlocks.value.length})`),
          ]),
          h('span', { class: 'pane-hint' }, '支持文本模糊或精准匹配'),
        ]),
        h('div', { class: 'search-add' }, [
          h(NInput, {
            size: 'small',
            value: keywordDraft.value || titleQuery.value,
            placeholder: '搜索或输入消息标题关键字，按 Enter 添加…',
            'onUpdate:value': (v) => {
              keywordDraft.value = v
              titleQuery.value = v
            },
            onKeyup: (e) => {
              if (e && e.key === 'Enter') addKeywordFilter()
            },
          }),
          h(
            NButton,
            {
              size: 'small',
              secondary: true,
              disabled: filters.value.length >= MAX_FILTERS,
              onClick: addKeywordFilter,
            },
            { default: () => '添加' },
          ),
        ]),
        h(
          'div',
          { class: 'pane-body' },
          titleBlocks.value.length
            ? h(
                'div',
                { class: 'title-chips' },
                titleBlocks.value.map((item) =>
                  h(
                    NTag,
                    {
                      key: item.id,
                      size: 'small',
                      round: true,
                      type: 'warning',
                      closable: true,
                      onClose: () => removeTitleBlock(item),
                    },
                    {
                      default: () => [
                        h('span', { class: 'chip-text' }, item.title),
                        item.sub === '锁屏短信'
                          ? h(
                              NTag,
                              { size: 'tiny', round: true, bordered: false },
                              { default: () => '锁屏短信' },
                            )
                          : null,
                      ],
                    },
                  ),
                ),
              )
            : h(
                'p',
                { class: 'filter-empty' },
                titleQuery.value.trim() ? '没有匹配的标题' : '暂无。也可在通知卡片上点「屏蔽这个标题」。',
              ),
        ),
      ])

      const filterCard = h('div', { class: 'block-split' }, [appPane, titlePane])

      const advancedCard = h('div', { class: 'card advanced-card' }, [
        h(
          'button',
          {
            class: 'adv-toggle',
            type: 'button',
            'aria-expanded': String(showAdvanced.value),
            'aria-controls': 'smsforwarder-advanced-settings',
            onClick: () => {
              showAdvanced.value = !showAdvanced.value
            },
          },
          [
            '高级',
            h('span', { class: 'adv-chevron', 'aria-hidden': 'true' }, '▾'),
          ],
        ),
        h(
          'div',
          {
            id: 'smsforwarder-advanced-settings',
            class: ['adv-collapse', { open: showAdvanced.value }],
            'aria-hidden': String(!showAdvanced.value),
            inert: !showAdvanced.value,
          },
          [h('div', { class: 'adv-collapse-inner' }, [h('div', { class: 'adv-body' }, advancedBody)])],
        ),
      ])

      const urlRows = urls.length ? urls : [primaryUrl]

      const steps = [
        {
          title: '准备条件',
          items: [
            '电脑已安装 Catrace，且能在命令行执行 node 命令（sidecar 依赖 Node）',
            '手机与电脑连接同一 Wi-Fi',
            '手机上安装 SmsForwarder（官方支持 Android 4.4–13，14 以上需实机验证；下载地址见上方）',
            '在 Catrace 插件列表启用 smsforwarder-notify，回到本页「概览」确认服务「运行中」',
            'Windows 防火墙首次弹窗选「允许访问」；手机连不上时再手动放行入站端口',
          ],
        },
        {
          title: 'SmsForwarder 通用设置',
          items: [
            '打开 SmsForwarder → 通用设置，开启需要的转发能力（短信 / 应用通知）',
            '按系统弹窗逐一授权；加入电池优化白名单，允许后台运行，勿强杀',
            '转发应用通知：开启「通知使用权」',
            '设置里开启「启动时异步获取已安装 App 列表」，否则取不到 App 名',
          ],
        },
        {
          title: '新建发送通道（Webhook）',
          items: [
            '发送通道 → 新建，类型选 Webhook，方法选 POST，通道名称随意（如 catrace）',
            {
              kind: 'copy',
              label: 'Webhook Server：选手机能访问的电脑局域网 IP',
              urls: urlRows,
              emptyUrls: !urls.length,
            },
            {
              kind: 'copy',
              label: 'Headers：点 + 加一行，Key / Value 分开填',
              headers: [
                { key: 'Authorization', value: authHeader.replace(/^Authorization:\s*/i, '') },
              ],
            },
            { kind: 'copy', label: '消息模板：整段粘贴', value: template, copyKey: 'copy-tpl' },
            '保存后点「测试」，SmsForwarder 显示发送成功、电脑弹出 Toast 即通道 OK',
          ],
        },
        {
          title: '新建转发规则（通道建好后必做）',
          items: [
            '仅有发送通道不会转发；必须再配「转发规则」并绑定到刚才的通道',
            '应用通知：转发规则 → 通知转发规则 → 新建',
            '短信：转发规则 → 短信转发规则 → 新建（可选）',
            '规则别名随意（如 catrace）；发送通道选刚建的 catrace',
            '匹配字段选「全部」（先跑通全量；之后可改成包名/内容过滤）',
            '「启用自定义模版」「启用正则替换」保持关闭（用通道里的消息模板即可）',
            '打开「启用该条转发规则」，免打扰时段保持 00:00～00:00（相等=不启用）',
            '保存后点「测试」；再让手机来一条真实通知/短信，电脑应弹 Toast',
          ],
        },
      ]

      const renderStepItem = (it) => {
        if (!it || it.kind !== 'copy') return h('li', it)
        if (Array.isArray(it.headers)) {
          return h('li', { class: 'step-copy' }, [
            h('span', { class: 'step-copy-label' }, it.label),
            h(
              'div',
              { class: 'step-copy-values' },
              it.headers.map((hdr) =>
                h('div', { class: 'copy-row', key: hdr.key }, [
                  h('pre', { class: 'mono' }, `${hdr.key}: ${hdr.value}`),
                  h('div', { class: 'row-inline' }, [
                    copyBtn('复制 Key', hdr.key, `copy-hk-${hdr.key}`),
                    copyBtn('复制 Value', hdr.value, `copy-hv-${hdr.key}`),
                  ]),
                ]),
              ),
            ),
          ])
        }
        const rows = Array.isArray(it.urls)
          ? it.urls.map((u) =>
              h('div', { class: 'copy-row', key: u }, [
                h('pre', { class: 'mono' }, u),
                copyBtn('复制', u, `copy-${u}`),
              ]),
            )
          : [
              h('div', { class: 'copy-row' }, [
                h('pre', { class: 'mono' }, it.value),
                copyBtn('复制', it.value, it.copyKey),
              ]),
            ]
        return h('li', { class: 'step-copy' }, [
          h('span', { class: 'step-copy-label' }, it.label),
          h('div', { class: 'step-copy-values' }, rows),
          it.emptyUrls
            ? h('p', { class: 'hint' }, 'URL 列表为空：先启用插件，确认服务运行中，再点「刷新状态」。')
            : null,
        ])
      }

      const tutorialCard = h('div', { class: 'card' }, [
        h('div', { class: 'head' }, [h('h2', '使用教程')]),
        h(
          'p',
          { class: 'desc' },
          '按官方流程：通用设置 → 发送通道 → 转发规则。通道只决定「发到哪」；规则决定「哪些通知/短信会转发」。需要填写的内容点「复制」即可。',
        ),
        h('div', { class: 'field' }, [
          h('div', { class: 'label' }, '下载 SmsForwarder'),
          h(
            'div',
            { class: 'dl-list' },
            DOWNLOAD_LINKS.map((d) =>
              h('div', { class: 'dl-item', key: d.url }, [
                h(
                  'div',
                  { class: 'dl-name' },
                  h(
                    'a',
                    { href: d.url, target: '_blank', rel: 'noopener noreferrer' },
                    d.name,
                  ),
                ),
                h('p', { class: 'dl-note' }, d.note),
              ]),
            ),
          ),
        ]),
        h(
          'div',
          { class: 'steps-wrap' },
          steps.map((s, i) =>
            h('div', { class: 'step', key: s.title }, [
              h('span', { class: 'step-num' }, String(i + 1)),
              h('div', { class: 'step-body' }, [
                h('div', { class: 'step-title' }, s.title),
                h('ul', { class: 'step-list' }, s.items.map(renderStepItem)),
              ]),
            ]),
          ),
        ),
      ])

      const faqCard = h('div', { class: 'card' }, [
        h('div', { class: 'head' }, [h('h2', '常见问题')]),
        ...FAQ.map(([q, a]) =>
          h('div', { class: 'faq', key: q }, [
            h('div', { class: 'faq-q' }, q),
            h('p', { class: 'faq-a' }, a),
          ]),
        ),
      ])

      let panel
      if (activeTab.value === 'settings') {
        panel = h('div', { class: 'sf-tab-panel' }, [settingsCard, filterCard, advancedCard])
      } else if (activeTab.value === 'tutorial') {
        panel = h('div', { class: 'sf-tab-panel' }, [tutorialCard, faqCard])
      } else {
        panel = h('div', { class: 'sf-tab-panel' }, [overviewCard])
      }

      return h('div', { class: 'sf-settings' }, [headerCard, tabBar, panel])
    }
  },
}
