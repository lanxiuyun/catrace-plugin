/** SmsForwarder settings: native React; config/RPC contracts remain framework-independent. */
const React = globalThis.__CATRACE_REACT__
const Radix = globalThis.__CATRACE_RADIX__
if (!React?.createElement || !React.useState || !Radix?.Button || !Radix.TextField || !Radix.Switch || !Radix.Select || !Radix.AlertDialog) {
  throw new Error('Catrace React/Radix runtime missing')
}
if (!plugin?.config || !plugin.events) throw new Error('Catrace plugin facade missing')
const { createElement: h, Fragment, useState, useEffect, useRef } = React
const { Button, TextField, Switch, Badge, Select, AlertDialog } = Radix

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

const STYLE_ID = 'catrace-plugin-smsforwarder-notify-settings-css-react-20261109'
const CSS = `
.sf-settings .sf-config-fields { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: .75rem; }
.sf-settings .sf-chip { max-width: 100%; white-space: normal; height: auto; display: inline-flex; align-items: center; gap: .375rem; }
.sf-settings .sf-chip-remove { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 0 .125rem; }
.sf-settings .sf-chip-remove:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.sf-settings .sf-feedback { padding: .625rem .75rem; border-radius: .5rem; background: #ecfdf5; color: #047857; font-size: .8125rem; }
.sf-settings .sf-feedback.is-error { background: #fef2f2; color: #b91c1c; }
.sf-settings .sf-feedback.is-warning { background: #fffbeb; color: #b45309; }

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
  user-select: text; -webkit-user-select: text; cursor: text;
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
.sf-settings .kw-add .rt-TextFieldRoot { flex: 1; min-width: 0; }
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
.sf-settings .adv-metric .rt-TextFieldRoot { flex: 1; min-width: 0; }
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
.sf-settings .search-add .rt-TextFieldRoot { flex: 1; min-width: 0; }
.sf-settings .title-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: flex-start; }
.sf-settings .title-chips .rt-Badge { max-width: 100%; height: auto; white-space: normal; }
.sf-settings .advanced-card { gap: 0; padding: 0; overflow: hidden; }
.sf-settings .adv-toggle {
  border: 0; background: transparent; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; margin: 0;
  padding: 1rem 1.25rem; text-align: left;
  font-size: 0.8125rem; font-weight: 700; color: #0d9488;
  gap: 0.375rem;
}

.sf-settings .adv-chevron {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1rem; height: 1rem; line-height: 0;
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: center;
  transform: rotate(-90deg);
}
.sf-settings .adv-chevron svg { width: 0.875rem; height: 0.875rem; display: block; }
.sf-settings .adv-toggle[aria-expanded="true"] .adv-chevron { transform: rotate(0deg); }
.sf-settings .adv-collapse {
  display: grid; grid-template-rows: 0fr;
  margin-top: 0; opacity: 0;
  transition:
    grid-template-rows 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.18s ease;
}
.sf-settings .adv-collapse.open {
  grid-template-rows: 1fr;
  opacity: 1;
}
.sf-settings .adv-collapse-inner { min-height: 0; overflow: hidden; }
.sf-settings .adv-body {
  display: flex; flex-direction: column; gap: 0.75rem;
  padding: 0 1.25rem 1rem;
}
@media (prefers-reduced-motion: reduce) {
  .sf-settings .adv-chevron,
  .sf-settings .adv-collapse { transition: none; }
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
  const field = (label, control, hint) => h('div', { className: 'field' }, h('label', { className: 'label' }, label), control, hint ? h('p', { className: 'hint' }, hint) : null)
  const button = (label, onClick, options = {}) => h(Button, { type: 'button', size: '2', variant: 'soft', onClick, ...options }, label)
  const input = (value, onChange, props = {}) => h(TextField.Root, { size: '2', value: String(value ?? ''), onChange: event => onChange(event.target.value), ...props })
  const enter = action => event => { if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); action() } }
  const select = (value, options, onChange, disabled = false) => h(Select.Root, { value, onValueChange: onChange, disabled, size: '2' }, h(Select.Trigger, { 'aria-label': optionLabel(options, value, '') }), h(Select.Content, null, options.map(option => h(Select.Item, { key: option.value, value: option.value }, option.label))))
  const chip = (text, onRemove, color = 'teal', title = text, key = text) => h(Badge, { key, color, size: '2', className: 'sf-chip', title }, h('span', { className: 'chip-text' }, text), h('button', { type: 'button', className: 'sf-chip-remove', 'aria-label': `移除 ${text}`, onClick: onRemove }, '×'))
  const copyRow = (text, key = text) => h('div', { className: 'copy-row', key }, h('pre', { className: 'mono' }, text), button('复制', () => void copyText(text), { size: '1' }))
  const confirmButton = (label, description, action, key) => h(AlertDialog.Root, null,
    h(AlertDialog.Trigger, null, button(label, undefined, { color: 'red', disabled: !!busy, loading: busy === key })),
    h(AlertDialog.Content, { maxWidth: '28rem' }, h(AlertDialog.Title, null, label), h(AlertDialog.Description, null, description), h('div', { className: 'actions', style: { justifyContent: 'flex-end', marginTop: '1rem' } }, h(AlertDialog.Cancel, null, button('取消', undefined, { color: 'gray' })), h(AlertDialog.Action, null, button('确认', () => void action(), { color: 'red' })))))
  const section = (title, children, className = '') => h('section', { className: `card ${className}` }, h('div', { className: 'head' }, h('h2', null, title)), ...children)
  const statusRows = st.error ? [['状态', st.error]] : [['服务', st.running ? '运行中' : '未运行'], ['监听', st.running ? `${st.host || config.host}:${st.port || config.port}` : '-'], ['路径', st.path || config.path], ['Token', st.hasToken || config.token ? '已配置' : '未配置'], ['已接收', String(st.acceptedCount ?? 0)], ['已拒绝', String(st.rejectedCount ?? 0)], ['已去重', String(st.dedupedCount ?? 0)], ['最近成功', st.lastSuccessAt ? new Date(st.lastSuccessAt).toLocaleString() : '-'], ['最近来源', st.lastClientIp || '-'], ['最近错误', st.lastErrorSummary || '无'], ...(st.onlyPushWhenActive && st.pendingCount > 0 ? [['待补推', `${st.pendingCount} 条（空闲时暂存，活跃后推送）`]] : [])]
  const overview = section('服务状态', [loading ? h('p', { className: 'desc' }, '加载中…') : h('div', { className: `status${st.error ? ' is-error' : ''}` }, statusRows.map(([label, value]) => h(Fragment, { key: label }, h('strong', null, label), h('span', null, String(value))))), h('div', { className: 'actions' }, button('刷新状态', () => void run('status', async () => { await refreshStatus(); await refreshWebhookInfo() }), { disabled: !!busy, loading: busy === 'status' }), button('重启服务', () => void restartServer(), { disabled: !!busy, loading: busy === 'restart' }), button('发送测试 Toast', () => void sendTest(), { disabled: !!busy, loading: busy === 'test', variant: 'solid' }))], st.error ? 'is-error' : '')
  const connection = section('连接', [field('电脑接收地址', h('div', { className: 'url-list' }, (urls.length ? urls : [primaryUrl]).map(url => copyRow(url))), '填到手机 SmsForwarder 的 Webhook。详细步骤见「教程」。'), field('Token', h('div', { className: 'row-inline' }, input(config.token, value => updateConfig({ token: value }), { type: showToken ? 'text' : 'password', placeholder: '启用插件后自动生成', 'aria-label': 'Token', style: { flex: 1, minWidth: '12rem' } }), button(showToken ? '隐藏' : '显示', () => setShowToken(!showToken)), button('复制', () => void copyText(authHeader.replace(/^Authorization:\s*/i, ''))), confirmButton('重新生成', '重新生成会使手机端旧 Token 立即失效，确认？', regenerateToken, 'regen')), 'SmsForwarder 请求头：Authorization: Bearer <token>'), field('卡片显示多久', h('div', { className: 'row-inline' }, input(config.cardDurationSec, value => updateConfig({ cardDurationSec: clamp(value, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC) }), { className: 'num', inputMode: 'numeric', 'aria-label': '卡片停留秒数' }), h('span', { className: 'unit' }, '秒（0=不自动关掉）'))), h('div', { className: 'actions' }, button('保存并应用', () => void run('save', () => persistAndSync(false)), { variant: 'solid', loading: busy === 'save', disabled: !!busy || loading }))])
  const appRows = config.appBlacklist.filter(item => item.toLowerCase().includes(appDraft.trim().toLowerCase())).sort(compareBlacklist)
  const titleRows = [...config.filters.filter(f => f.value).map(f => ({ ...f, kind: 'filter', title: f.value, sub: f.appContains })), ...config.mmsTitleBlacklist.map(title => ({ kind: 'mms', id: `mms:${title}`, title, sub: '锁屏短信' }))].filter(item => `${item.title} ${item.sub || ''}`.toLowerCase().includes(titleDraft.trim().toLowerCase())).sort((a, b) => compareBlacklist(a.title, b.title))
  const blockPanes = h('div', { className: 'block-split' },
    h('section', { className: 'pane' }, h('h3', { className: 'pane-title' }, `不看这些应用 (${appRows.length})`), h('div', { className: 'search-add' }, input(appDraft, setAppDraft, { placeholder: '搜索或输入包名，按 Enter 添加…', onKeyDown: enter(addApp), 'aria-label': '应用搜索或包名' }), button('添加', addApp)), h('div', { className: 'pane-body' }, appRows.length ? h('div', { className: 'title-chips' }, appRows.map(item => chip(item, () => removeApp(item), 'blue'))) : h('p', { className: 'filter-empty' }, appDraft ? '没有匹配的应用' : '暂无。也可在通知卡片上点「屏蔽此应用」。'))),
    h('section', { className: 'pane' }, h('h3', { className: 'pane-title' }, `不看这些标题 (${titleRows.length})`), h('p', { className: 'hint' }, '支持文本模糊或精准匹配'), h('div', { className: 'search-add' }, input(titleDraft, setTitleDraft, { placeholder: '搜索或输入消息标题关键字，按 Enter 添加…', onKeyDown: enter(addKeyword), 'aria-label': '标题搜索或关键词' }), button('添加', addKeyword, { disabled: config.filters.length >= MAX_FILTERS })), h('div', { className: 'pane-body' }, titleRows.length ? h('div', { className: 'title-chips' }, titleRows.map(item => chip(`${item.title}${item.sub ? ` · ${item.sub}` : ''}`, () => updateConfig(item.kind === 'filter' ? { filters: configRef.current.filters.filter(f => f.id !== item.id) } : { mmsTitleBlacklist: configRef.current.mmsTitleBlacklist.filter(t => t.toLowerCase() !== item.title.toLowerCase()) }), 'amber', filterPreview(item), item.id))) : h('p', { className: 'filter-empty' }, titleDraft ? '没有匹配的标题' : '暂无。也可在通知卡片上点「屏蔽这个标题」。'))))
  const advanced = h('section', { className: 'card advanced-card' }, h('button', { type: 'button', className: 'adv-toggle', 'aria-expanded': showAdvanced, 'aria-controls': 'smsforwarder-advanced-settings', onClick: () => setShowAdvanced(!showAdvanced) }, '高级', h('span', { className: 'adv-chevron', 'aria-hidden': true }, chevronIcon())), h('div', { id: 'smsforwarder-advanced-settings', className: `adv-collapse${showAdvanced ? ' open' : ''}`, 'aria-hidden': !showAdvanced, inert: !showAdvanced }, h('div', { className: 'adv-collapse-inner' }, h('div', { className: 'adv-body' },
    h('div', { className: 'adv-grid-2' }, h('section', { className: 'adv-tile' }, h('div', { className: 'adv-tile-head' }, h('h3', { className: 'adv-tile-title' }, '活跃时推送'), h(Switch, { checked: config.onlyPushWhenActive, onCheckedChange: value => updateConfig({ onlyPushWhenActive: value }), 'aria-label': '活跃时推送' })), h('p', { className: 'adv-tile-desc' }, '电脑有键鼠操作时才实时推送；空闲时先暂存，回来后一次性补推。'), h('div', { className: 'adv-tile-foot' }, config.onlyPushWhenActive ? '已开启（空闲先存）' : '已关闭（随时推送）')), h('section', { className: 'adv-tile' }, h('div', { className: 'adv-tile-head' }, h('h3', { className: 'adv-tile-title' }, '聊天小窗'), h(Switch, { checked: config.mergeChatThreads, onCheckedChange: value => updateConfig({ mergeChatThreads: value }), 'aria-label': '合并聊天小窗' })), h('p', { className: 'adv-tile-desc' }, '指定 IM 合成对话小窗：弹出只显示最新一条，新消息往上顶；往上滚加载本机历史。'), h('div', { className: 'adv-chip-box' }, config.chatApps.map(name => chip(name, () => updateConfig({ chatApps: configRef.current.chatApps.filter(item => item.toLowerCase() !== name.toLowerCase()) }))), input(chatAppDraft, setChatAppDraft, { className: 'adv-chip-input', placeholder: '+ 输入名字按回车添加', onKeyDown: enter(addChatApp), 'aria-label': '聊天应用名称或包名' })), h('div', { className: 'adv-tile-foot' }, h('span', null, '输入应用名或包名后按回车添加'), confirmButton('清空聊天记录', '清空本机保存的全部会话气泡？', clearChatHistory, 'clear-chat')))),
    h('h3', { className: 'adv-section-title' }, '频控与 Webhook'), h('div', { className: 'adv-grid-3' }, h('section', { className: 'adv-tile' }, field('相同通知最短间隔', input(config.dedupeWindowSec, value => updateConfig({ dedupeWindowSec: clamp(value, MIN_DEDUPE_SEC, MAX_DEDUPE_SEC, DEFAULT_DEDUPE_SEC) }), { inputMode: 'numeric', 'aria-label': '相同通知最短间隔秒数' }), '相同通知在间隔内再次到达时不重复弹出。')), h('section', { className: 'adv-tile' }, field('Webhook 监听端口', input(config.port, value => updateConfig({ port: clamp(value, MIN_PORT, MAX_PORT, DEFAULT_PORT) }), { inputMode: 'numeric', 'aria-label': 'Webhook 监听端口' }), `端口范围：${MIN_PORT} – ${MAX_PORT}`)), h('section', { className: 'adv-tile' }, field('Webhook 路由路径', input(config.path, value => updateConfig({ path: value }), { placeholder: '/webhook', 'aria-label': 'Webhook 路由路径' }), '接收 SmsForwarder POST 的 HTTP 路径。'))),
    h('h3', { className: 'adv-section-title' }, '自定义过滤规则'), h('p', { className: 'hint' }, '可指定应用、正文或正则。命中就不弹。'), h('div', { className: 'filter-composer' }, h('p', { className: 'filter-composer-title' }, '新建规则'), h('div', { className: 'filter-form' }, field('动作', select('hide', FILTER_ACTION_OPTIONS, undefined, true)), field('匹配字段', select(filterDraft.field, FILTER_FIELD_OPTIONS, value => setFilterDraft(previous => ({ ...previous, field: value })))), field('匹配逻辑', select(filterDraft.match, FILTER_MATCH_OPTIONS, value => setFilterDraft(previous => ({ ...previous, match: value })))), field('关键词 / 正则', input(filterDraft.value, value => setFilterDraft(previous => ({ ...previous, value })), { placeholder: filterDraft.match === 'regex' ? '例如 DSH Desktop.*交流群' : '例如：DSH Desktop 交流群', onKeyDown: enter(addCustomFilter), 'aria-label': '过滤关键词或正则' })), field('仅限应用（可选）', input(filterDraft.appContains, value => setFilterDraft(previous => ({ ...previous, appContains: value })), { placeholder: 'QQ / com.tencent.mobileqq', onKeyDown: enter(addCustomFilter), 'aria-label': '过滤规则应用范围' }))), filterRegexError(filterDraft.match, filterDraft.value) ? h('p', { className: 'filter-warn', role: 'alert' }, filterRegexError(filterDraft.match, filterDraft.value)) : null, h('div', { className: 'filter-add' }, button('添加到规则列表', addCustomFilter, { variant: 'solid', disabled: config.filters.length >= MAX_FILTERS }))),
    h('div', { className: 'filter-list-head' }, `已生效规则（${config.filters.length}）`, h('span', { className: 'hint' }, '从上到下匹配')), config.filters.length ? h('div', { className: 'filter-list' }, config.filters.map(f => h('div', { key: f.id, className: `filter-item${f.enabled === false ? ' is-off' : ''}${filterIssue(f) ? ' is-warn' : ''}` }, h('div', { className: 'filter-tags' }, h('span', { className: 'filter-tag is-hide' }, '不看'), h('span', { className: 'filter-tag is-muted' }, optionLabel(FILTER_FIELD_OPTIONS, f.field, '标题')), h('span', { className: 'filter-tag is-match' }, optionLabel(FILTER_MATCH_OPTIONS, f.match, '包含文本')), h('span', { className: 'filter-quote' }, `"${f.value || '…'}"`), f.appContains ? h('span', { className: 'filter-scope' }, `仅限 ${f.appContains}`) : null), filterIssue(f) ? h('p', { className: 'filter-warn' }, filterIssue(f)) : null, h(Switch, { size: '1', checked: f.enabled !== false, 'aria-label': `启用 ${filterPreview(f)}`, onCheckedChange: value => updateConfig({ filters: configRef.current.filters.map(item => item.id === f.id ? { ...item, enabled: value } : item) }) }), button('删除', () => updateConfig({ filters: configRef.current.filters.filter(item => item.id !== f.id) }), { size: '1', color: 'red', variant: 'ghost' })))) : h('p', { className: 'filter-empty' }, '还没有自定义规则。常见群名直接在上面「不看这些标题」里加就行。')))))
  const steps = [
    { title: '准备条件', items: ['电脑已安装 Catrace，且能在命令行执行 node 命令（sidecar 依赖 Node）', '手机与电脑连接同一 Wi-Fi', '手机安装 SmsForwarder（官方支持 Android 4.4–13，14 以上需实机验证；下载地址见上方）', '在 Catrace 插件列表启用 smsforwarder-notify，回到「概览」确认服务「运行中」', 'Windows 防火墙首次弹窗选「允许访问」；手机连不上时再手动放行入站端口'] },
    { title: 'SmsForwarder 通用设置', items: ['打开 SmsForwarder → 通用设置，开启需要的转发能力（短信 / 应用通知）', '按系统弹窗逐一授权；加入电池优化白名单，允许后台运行，勿强杀', '转发应用通知：开启「通知使用权」', '开启「启动时异步获取已安装 App 列表」，否则取不到 App 名'] },
    { title: '新建发送通道（Webhook）', items: ['发送通道 → 新建，类型选 Webhook，方法 POST，通道名称如 catrace', h('div', { className: 'step-copy', key: 'urls' }, h('span', { className: 'step-copy-label' }, 'Webhook Server：选手机能访问的电脑局域网 IP'), ...(urls.length ? urls : [primaryUrl]).map(url => copyRow(url)), !urls.length ? h('p', { className: 'hint' }, 'URL 列表为空：先启用插件，确认服务运行中，再点「刷新状态」。') : null), h('div', { className: 'step-copy', key: 'headers' }, h('span', { className: 'step-copy-label' }, 'Headers：点 + 加一行，Key / Value 分开填'), h('pre', { className: 'mono' }, authHeader), h('div', { className: 'row-inline' }, button('复制 Key', () => void copyText('Authorization')), button('复制 Value', () => void copyText(authHeader.replace(/^Authorization:\s*/i, ''))))), h('div', { className: 'step-copy', key: 'template' }, h('span', { className: 'step-copy-label' }, '消息模板：整段粘贴'), copyRow(template)), '保存后点「测试」，手机显示发送成功、电脑弹出 Toast 即通道 OK'] },
    { title: '新建转发规则（通道建好后必做）', items: ['仅有发送通道不会转发，必须配置转发规则并绑定通道', '应用通知：转发规则 → 通知转发规则 → 新建', '短信：转发规则 → 短信转发规则 → 新建（可选）', '规则别名随意；发送通道选刚建的 catrace', '匹配字段先选「全部」跑通，之后可改成包名 / 内容过滤', '「启用自定义模版」「启用正则替换」保持关闭，使用通道模板', '打开「启用该条转发规则」，免打扰时段保持 00:00～00:00（相等=不启用）', '保存后点测试，再让手机来一条真实通知 / 短信，电脑应弹 Toast'] },
  ]
  const downloadList = h('div', { className: 'dl-list' }, DOWNLOAD_LINKS.map(link =>
    h('div', { key: link.url, className: 'dl-item' },
      h('div', { className: 'dl-name' }, h('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer' }, link.name)),
      h('p', { className: 'dl-note' }, link.note))))
  const stepList = h('div', { className: 'steps-wrap' }, steps.map((step, index) =>
    h('div', { key: step.title, className: 'step' },
      h('span', { className: 'step-num' }, String(index + 1)),
      h('div', { className: 'step-body' },
        h('h3', { className: 'step-title' }, step.title),
        h('ul', { className: 'step-list' }, step.items.map((item, i) =>
          h('li', { key: i, className: typeof item === 'string' ? undefined : 'step-copy' }, item)))))))
  const tutorial = h(Fragment, null,
    section('使用教程', [
      h('p', { className: 'desc' }, '按官方流程：通用设置 → 发送通道 → 转发规则。通道决定「发到哪」，规则决定「哪些会转发」。'),
      field('下载 SmsForwarder', downloadList), stepList,
    ]),
    section('常见问题', FAQ.map(([question, answer]) =>
      h('div', { key: question, className: 'faq' }, h('div', { className: 'faq-q' }, question), h('p', { className: 'faq-a' }, answer)))))
  return h('div', { className: 'sf-settings' }, section('SmsForwarder 通知', [h(Badge, { color: config.enabled ? 'green' : 'gray' }, config.enabled ? '已启用' : '已关闭'), h('p', { className: 'desc' }, '本机 HTTP Webhook 接收 Android SmsForwarder 转发的 App 通知，弹出 Catrace Toast。仅建议可信局域网使用。'), h('p', { className: 'warn' }, '默认监听 0.0.0.0（全部网卡）。务必使用强 Token，勿暴露公网。首次启动防火墙弹窗选「允许访问」；手机连不上时再放行入站端口。')]), feedback ? h('div', { role: feedback.type === 'error' ? 'alert' : 'status', className: `sf-feedback is-${feedback.type}` }, feedback.text) : null, h('div', { className: 'tabs', role: 'tablist', 'aria-label': 'SmsForwarder 设置' }, TABS.map(tab => h('button', { key: tab.id, type: 'button', role: 'tab', className: `tab${activeTab === tab.id ? ' is-active' : ''}`, 'aria-selected': activeTab === tab.id, onClick: () => setActiveTab(tab.id) }, tab.label))), h('div', { className: 'sf-tab-panel', role: 'tabpanel' }, activeTab === 'settings' ? h('fieldset', { disabled: loading, className: 'sf-config-fields' }, connection, blockPanes, advanced) : activeTab === 'tutorial' ? tutorial : overview))
}
export { SmsforwarderNotifySettings as Settings }
