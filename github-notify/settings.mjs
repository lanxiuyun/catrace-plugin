const React = globalThis.__CATRACE_REACT__;
if (!React?.createElement || !React?.useState)
    throw new Error('Catrace plugin React runtime missing');
const { createElement: h, useState, useRef, useEffect } = React;
const PLUGIN_ID = 'github-notify';
const MIN_POLL_SEC = 1;
const MAX_POLL_SEC = 3600;
const MIN_CARD_SEC = 0;
const MAX_CARD_SEC = 600;
const DEFAULT_POLL_SEC = 60;
const DEFAULT_CARD_SEC = 10;
const STYLE_ID = 'catrace-plugin-github-notify-settings-css';
const CSS = `
.gh-settings {
  width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 0.75rem;
  color: #1f2328;
}
.gh-settings *, .gh-settings *::before, .gh-settings *::after { box-sizing: border-box; }
.gh-settings .card {
  padding: 1rem 1.25rem;
  border: 0.0625rem solid #d0d7de;
  border-radius: 0.875rem;
  background: #fff;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.gh-settings .head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.gh-settings h2 { margin: 0; font-size: 0.9375rem; font-weight: 700; color: #1f2328; }
.gh-settings .desc { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: #656d76; }
.gh-settings .field { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.gh-settings .label { font-size: 0.75rem; font-weight: 600; color: #656d76; }
.gh-settings .hint { margin: 0; font-size: 0.6875rem; color: #8b949e; line-height: 1.45; }
.gh-settings .row {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.gh-settings .row-inline { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.gh-settings .num { width: 6.5rem; }
.gh-settings .unit { font-size: 0.75rem; color: #656d76; font-weight: 600; }
.gh-settings .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.gh-settings .status {
  display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem;
  padding: 0.625rem 0.75rem; border-radius: 0.5rem; background: #f6f8fa;
  font-size: 0.75rem; color: #424a53;
}
.gh-settings .status strong { color: #0969da; font-weight: 650; }
.gh-settings .switch-pair {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-size: 0.8125rem; color: #424a53; font-weight: 500;
}

.gh-settings .plugin-input{font:inherit;color:inherit;box-sizing:border-box;min-width:0;width:100%;padding:.4375rem .625rem;border:1px solid #d0d7de;border-radius:.375rem;background:#fff;outline:none;}
.gh-settings .plugin-input:focus{border-color:#007aff;box-shadow:0 0 0 2px #007aff22;}
.gh-settings textarea.plugin-input{resize:vertical;line-height:1.5;}
.gh-settings .row>.plugin-input{flex:1;}
.gh-settings .plugin-button{font:inherit;font-size:.75rem;padding:.375rem .625rem;border:1px solid #d0d7de;border-radius:.375rem;background:#fff;cursor:pointer;color:inherit;}
.gh-settings .plugin-button.is-primary{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;}
.gh-settings .plugin-button:disabled{opacity:.55;cursor:wait;}
.gh-settings .plugin-switch{accent-color:#007aff;width:1.125rem;height:1.125rem;cursor:pointer;}
.gh-settings .plugin-tag{padding:.125rem .5rem;border-radius:999px;background:#f1f5f9;font-size:.75rem;}
.gh-settings .plugin-tag[data-tone=success]{background:#ecfdf5;color:#047857;}
.gh-settings .plugin-alert{padding:.75rem;border-radius:.5rem;background:#eff6ff;line-height:1.5;display:flex;flex-direction:column;gap:.25rem;}
.gh-settings .plugin-secret{display:flex;align-items:center;gap:.375rem;min-width:0;width:100%;}
.gh-settings .plugin-secret button{flex:none;border:0;background:transparent;color:#0969da;cursor:pointer;font:inherit;font-size:.75rem;}
.plugin-feedback-github-notify{padding:.625rem .75rem;border-radius:.5rem;font-size:.8125rem;margin-bottom:.75rem;background:#eff6ff;color:#1e40af;}
.plugin-feedback-github-notify[data-tone=error]{background:#fef2f2;color:#b91c1c;}
.plugin-feedback-github-notify[data-tone=warning]{background:#fff7ed;color:#9a3412;}

.gh-settings .plugin-input.num{width:6.5rem;}
`;
function ensureStyles() {
    if (typeof document === 'undefined')
        return;
    if (document.getElementById(STYLE_ID))
        return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = plugin.theme.css(CSS);
    document.head.appendChild(el);
}
function clamp(n, min, max, fallback) {
    const v = Number(n);
    if (!Number.isFinite(v))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(v)));
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
const DEFAULT_CONFIG = {
    token: '',
    pollIntervalSec: DEFAULT_POLL_SEC,
    cardDurationSec: DEFAULT_CARD_SEC,
    onlyWhenActive: true,
    enabled: true,
};
function SecretInput({ className, type: _type, ...props }) {
    const [visible, setVisible] = useState(false);
    return h('span', { className: 'plugin-secret' }, h('input', { className, type: visible ? 'text' : 'password', ...props }), h('button', { type: 'button', 'aria-label': visible ? '隐藏密钥' : '显示密钥', 'aria-pressed': visible, onClick: () => setVisible(!visible) }, visible ? '隐藏' : '显示'));
}
export default function GithubNotifySettings() {
    const [state, setState] = useState(() => ({
        loading: true,
        busy: '',
        headerLoading: false,
        token: '',
        pollIntervalSec: DEFAULT_POLL_SEC,
        cardDurationSec: DEFAULT_CARD_SEC,
        onlyWhenActive: true,
        enabled: true,
        status: null
    }));
    // Rendering uses React state; this snapshot keeps async RPC/debounce callbacks current.
    const stateRef = useRef(state);
    const mountedRef = useRef(true);
    const [feedback, setFeedback] = useState(null);
    function updateState(patch) {
        const next = { ...stateRef.current, ...patch };
        stateRef.current = next;
        if (mountedRef.current)
            setState(next);
    }
    function notify(tone, text) {
        if (mountedRef.current)
            setFeedback({ tone, text: String(text) });
    }
    const saveTimerRef = useRef(null);
    function currentConfig() {
        return {
            token: String(stateRef.current.token
                || '').trim(),
            pollIntervalSec: clamp(stateRef.current.pollIntervalSec, MIN_POLL_SEC, MAX_POLL_SEC, DEFAULT_POLL_SEC),
            cardDurationSec: clamp(stateRef.current.cardDurationSec, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC),
            onlyWhenActive: stateRef.current.onlyWhenActive
                !== false,
            enabled: stateRef.current.enabled
                !== false,
        };
    }
    function applyConfig(cfg = {}) {
        if (typeof cfg.token === 'string')
            updateState({
                token: cfg.token
            });
        updateState({
            pollIntervalSec: clamp(cfg.pollIntervalSec, MIN_POLL_SEC, MAX_POLL_SEC, DEFAULT_POLL_SEC)
        });
        updateState({
            cardDurationSec: clamp(cfg.cardDurationSec, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC)
        });
        updateState({
            onlyWhenActive: cfg.onlyWhenActive !== false
        });
        updateState({
            enabled: cfg.enabled !== false
        });
    }
    async function run(key, task) {
        updateState({
            busy: key
        });
        try {
            await task();
        }
        catch (error) {
            notify("error", errorText(error));
        }
        finally {
            updateState({
                busy: ''
            });
        }
    }
    async function readActivityPulse() {
        try {
            if (plugin.storage && typeof plugin.storage.get === 'function') {
                const pulse = await plugin.storage.get('activity_pulse');
                if (pulse && typeof pulse.active === 'boolean')
                    return !!pulse.active;
            }
        }
        catch {
            /* ignore */
        }
        return null;
    }
    async function persistAndSync({ quiet = false } = {}) {
        // Enable/trust belongs to the host switch, not a delayed business-field save.
        const { enabled: _enabled, ...cfg } = currentConfig();
        updateState({
            pollIntervalSec: cfg.pollIntervalSec
        });
        updateState({
            cardDurationSec: cfg.cardDurationSec
        });
        await plugin.config.set(cfg);
        try {
            if (plugin.sidecar && typeof plugin.sidecar.request === 'function') {
                const activityActive = await readActivityPulse();
                const payload = activityActive == null ? cfg : { ...cfg, activityActive };
                await plugin.sidecar.request('setConfig', payload);
            }
            if (!quiet)
                notify("success", '已保存');
        }
        catch (error) {
            if (!quiet)
                notify("warning", '已保存（启用插件后 sidecar 生效）');
            await plugin.log?.warn?.('config saved without sidecar', { error: errorText(error) });
        }
    }
    async function forwardActivityPulse() {
        try {
            if (!plugin.sidecar || typeof plugin.sidecar.request !== 'function')
                return;
            const active = await readActivityPulse();
            if (active == null)
                return;
            await plugin.sidecar.request('setActivity', { active });
        }
        catch {
            /* ignore */
        }
    }
    function scheduleSave() {
        if (saveTimerRef.current)
            clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            persistAndSync({ quiet: true }).catch((error) => notify("error", errorText(error)));
        }, 400);
    }
    async function refreshStatus() {
        if (!plugin.sidecar || typeof plugin.sidecar.request !== 'function') {
            updateState({
                status: { error: 'sidecar 未运行（请启用插件）' }
            });
            return;
        }
        const result = await plugin.sidecar.request('getStatus');
        updateState({
            status: result && typeof result === 'object' ? result : { raw: result }
        });
    }
    async function pollNow() {
        await run('poll', async () => {
            await persistAndSync({ quiet: true });
            if (!plugin.sidecar?.request) {
                notify("warning", 'sidecar 未运行');
                return;
            }
            // forceFull on sidecar side — bypass 304 cache
            const result = await plugin.sidecar.request('pollNow', { forceFull: true });
            updateState({
                status: result
            });
            if (result?.held) {
                notify("warning", `有 ${result.held} 条，但当前不活跃，暂不弹窗`);
            }
            else {
                notify("success", result?.newCount
                    ? `拉取完成，新增 ${result.newCount} 条（已推送）`
                    : result?.skipped
                        ? '已跳过（检查 Token / 开关）'
                        : result?.notModified
                            ? 'GitHub 返回 304（无变更）'
                            : '拉取完成，无新通知');
            }
        });
    }
    async function resetAndReseed() {
        await run('reset', async () => {
            if (!plugin.sidecar?.request) {
                notify("warning", 'sidecar 未运行');
                return;
            }
            await plugin.sidecar.request('resetSeen');
            const result = await plugin.sidecar.request('pollNow', { forceSeed: true, forceFull: true });
            updateState({
                status: result
            });
            notify("success", '已清空已见记录并重新建基线（不弹历史）');
        });
    }
    async function sendTest() {
        await run('test', async () => {
            const cfg = currentConfig();
            const sticky = cfg.cardDurationSec <= 0;
            const snippet = [
                '这次把桌面通知和插件运行时一起收了一轮，方便过 0 点之后还能回看当天作息，也避免钩子用着用着就停。',
                '',
                '· 更新 plugin-demo 指针（钩子防卸与默认前缀）',
                '· PasteDrop 存图改到后台 STA 线程，避免 WH_KEYBOARD_LL 超时被系统悄悄卸钩',
                '· 每 15 秒重装键盘钩子兜底；设置页状态每 2 秒刷新',
                '· 默认文件名前缀改为 PasteDrop，空前缀回退同样生效',
                '· 历史作息可视化：环形表盘 / 单轴时间线 / 作息流卡片，可翻昨天',
                '· 插件 API 增加 plugin.activity.getRecords({ from, to })，最长 31 天',
                '· GitHub 通知：Release 丢掉下载表格，正文加长且卡片内可滚动',
                '· Toast 不再 4 行截断 changelog，标题优先用 tag_name',
                '',
                '已知限制：Linux 不做全局 Ctrl+V 拦截；macOS PasteDrop 仍未合入。',
            ].join('\n');
            await plugin.events.publish({
                eventType: 'github-notify.notification',
                kind: 'github-notify',
                title: 'Release · lanxiuyun/Catrace',
                body: `v26.9.3\n${snippet}`,
                level: 'info',
                sticky,
                actions: [
                    { id: 'open', label: '打开' },
                    { id: 'dismiss', label: sticky ? '知道了' : '关闭' },
                ],
                payload: {
                    notification_id: `test-${Date.now()}`,
                    repo: 'lanxiuyun/Catrace',
                    subject_type: 'Release',
                    subject_title: 'v26.9.3',
                    body_snippet: snippet,
                    body_author: 'github-actions[bot]',
                    reason: 'subscribed',
                    reason_label: '订阅',
                    html_url: 'https://github.com/lanxiuyun/Catrace/releases',
                    updated_at: new Date().toISOString(),
                    auto_hide_ms: sticky ? 0 : cfg.cardDurationSec * 1000,
                    card_duration_sec: cfg.cardDurationSec,
                },
                dedupeKey: `github-notify:test:${Date.now()}`,
            });
            notify("success", '已发送测试通知');
        });
    }
    async function toggleEnabled(val) {
        const previous = stateRef.current.enabled;
        updateState({
            enabled: val
        });
        updateState({
            headerLoading: true
        });
        try {
            await plugin.setEnabled(val);
            const { enabled: _enabled, ...cfg } = currentConfig();
            await plugin.config.set(cfg);
            window.dispatchEvent(new CustomEvent('catrace:plugin-enabled-changed', {
                detail: { id: PLUGIN_ID, enabled: val },
            }));
            try {
                if (plugin.sidecar?.request)
                    await plugin.sidecar.request('setConfig', { ...cfg, enabled: val });
            }
            catch {
                /* ignore */
            }
        }
        catch (e) {
            updateState({
                enabled: previous
            });
            notify("error", errorText(e));
        }
        finally {
            updateState({
                headerLoading: false
            });
        }
    }
    const activityTimerRef = useRef(null);
    useEffect(() => {
        mountedRef.current = true;
        ensureStyles();
        run('boot', async () => {
            updateState({
                loading: true
            });
            try {
                const raw = await plugin.config.get();
                if (!mountedRef.current)
                    return;
                applyConfig(raw && typeof raw === 'object' ? raw : DEFAULT_CONFIG);
                try {
                    await refreshStatus();
                }
                catch {
                    updateState({
                        status: null
                    });
                }
                // settings window can talk to sidecar — forward background activity pulse
                forwardActivityPulse().catch(() => { });
                if (!mountedRef.current)
                    return;
                activityTimerRef.current = setInterval(() => {
                    forwardActivityPulse().catch(() => { });
                }, 5000);
            }
            finally {
                updateState({
                    loading: false
                });
            }
        });
        return () => {
            if (saveTimerRef.current !== null) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
                void persistAndSync({ quiet: true }).catch(error => plugin.log?.warn?.('Pending settings save failed', { error: String(error) }));
            }
            mountedRef.current = false;
            clearInterval(activityTimerRef.current);
        };
    }, []);
    const panel = (() => {
        const st = state.status
            || {};
        const statusRows = st.error
            ? [['状态', st.error]]
            : [
                ['Token', st.hasToken ? '已配置' : '未配置'],
                ['基线', st.seeded ? '已建立' : '未建立'],
                ['已见', String(st.seenCount ?? '-')],
                ['已推送', String(st.publishCount ?? '-')],
                ['连续304', String(st.consecutive304 ?? 0)],
                ['上次轮询', st.lastPollAt ? new Date(st.lastPollAt).toLocaleTimeString() : '-'],
                ['HTTP', st.lastPollStatus ? String(st.lastPollStatus) : '-'],
                [
                    '活跃门控',
                    st.hostActivityActive == null
                        ? '未同步（关设置页时默认放行）'
                        : st.hostActivityActive
                            ? '活跃'
                            : '不活跃',
                ],
                ['错误', st.lastPollError || '无'],
            ];
        return h('div', {
            className: 'gh-settings'
        }, h('div', {
            className: 'card'
        }, h('div', {
            className: 'head'
        }, h('h2', null, 'GitHub 通知'), h("span", {
            className: "plugin-tag " + "",
            'data-tone': state.enabled
                ? 'success' : 'default'
        }, (() => (state.enabled
            ? '已启用' : '已关闭'))())), h('p', {
            className: 'desc'
        }, '用 Personal Access Token 拉取 GitHub 未读通知。启动或拉取时，凡本机未见过的通知 id 一律推送（已通知 id 保存在本机）；之后按间隔轮询新变更。'), h('div', {
            className: 'field'
        }, h('div', {
            className: 'label'
        }, 'GitHub PAT'), h(SecretInput, {
            value: state.token,
            type: 'password',
            placeholder: 'ghp_… 或 github_pat_…（notifications 读权限）',
            onChange: event => ((v) => {
                updateState({
                    token: v
                });
                scheduleSave();
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "GitHub PAT"
        }), h('p', {
            className: 'hint'
        }, '经典 Token 勾选 notifications；Fine-grained 需 Repository access + Notifications 读权限。Token 仅存本机 plugin_config。')), h('div', {
            className: 'row'
        }, h('div', {
            className: 'field'
        }, h('div', {
            className: 'label'
        }, '轮询间隔'), h('div', {
            className: 'row-inline'
        }, h("input", {
            value: String(state.pollIntervalSec),
            onChange: event => ((v) => {
                updateState({
                    pollIntervalSec: clamp(v, MIN_POLL_SEC, MAX_POLL_SEC, DEFAULT_POLL_SEC)
                });
                scheduleSave();
            })(event.target.value),
            className: "plugin-input " + 'num',
            "aria-label": "\u8F6E\u8BE2\u95F4\u9694\u79D2\u6570"
        }), h('span', {
            className: 'unit'
        }, '秒'))), h('div', {
            className: 'field'
        }, h('div', {
            className: 'label'
        }, '卡片停留'), h('div', {
            className: 'row-inline'
        }, h("input", {
            value: String(state.cardDurationSec),
            onChange: event => ((v) => {
                updateState({
                    cardDurationSec: clamp(v, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC)
                });
                scheduleSave();
            })(event.target.value),
            className: "plugin-input " + 'num',
            "aria-label": "\u5361\u7247\u505C\u7559\u79D2\u6570"
        }), h('span', {
            className: 'unit'
        }, '秒（0=常驻）')))), h('div', {
            className: 'row'
        }, h('span', {
            className: 'switch-pair'
        }, h("input", {
            onChange: event => ((v) => {
                updateState({
                    onlyWhenActive: !!v
                });
                scheduleSave();
            })(event.target.checked),
            type: "checkbox",
            role: "switch",
            checked: state.onlyWhenActive,
            className: "plugin-switch " + "",
            "aria-label": "\u4EC5\u5728\u7528\u6237\u6D3B\u8DC3\u65F6\u63A8\u9001"
        }), '仅在用户活跃时推送')), h('div', {
            className: 'actions'
        }, h("button", {
            onClick: pollNow,
            type: "button",
            disabled: !!state.busy && state.busy
                !== 'poll' || state.busy
                === 'poll',
            'aria-busy': state.busy
                === 'poll',
            className: "plugin-button is-primary " + ""
        }, (() => '立即拉取')()), h("button", {
            onClick: sendTest,
            type: "button",
            disabled: !!state.busy && state.busy
                !== 'test' || state.busy
                === 'test',
            'aria-busy': state.busy
                === 'test',
            className: "plugin-button " + ""
        }, (() => '测试卡片')()), h("button", {
            onClick: () => run('status', refreshStatus),
            type: "button",
            disabled: !!state.busy && state.busy
                !== 'status' || state.busy
                === 'status',
            'aria-busy': state.busy
                === 'status',
            className: "plugin-button " + ""
        }, (() => '刷新状态')()), h("button", {
            onClick: resetAndReseed,
            type: "button",
            disabled: !!state.busy && state.busy
                !== 'reset' || state.busy
                === 'reset',
            'aria-busy': state.busy
                === 'reset',
            className: "plugin-button " + ""
        }, (() => '重置基线')()))), h('div', {
            className: 'card'
        }, h('div', {
            className: 'head'
        }, h('h2', null, '运行状态')), state.loading
            ? h('p', {
                className: 'desc'
            }, '加载中…') : h('div', {
            className: 'status'
        }, statusRows.flatMap(([k, v]) => [h('strong', { key: `${k}:label` }, k), h('span', { key: `${k}:value` }, String(v))]))));
    })();
    return h(React.Fragment, null, feedback ? h('div', { className: 'plugin-feedback-github-notify', 'data-tone': feedback.tone, role: feedback.tone === 'error' ? 'alert' : 'status' }, feedback.text) : null, panel);
}
