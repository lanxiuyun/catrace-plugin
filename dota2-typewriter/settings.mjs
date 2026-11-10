const React = globalThis.__CATRACE_REACT__;
if (!React?.createElement || !React?.useState)
    throw new Error('Catrace plugin React runtime missing');
const { createElement: h, useState, useRef, useEffect } = React;
const MIN_MS = 20;
const MAX_MS = 60000;
const DEFAULT_MS = 100;
const STYLE_ID = 'catrace-plugin-dota2-typewriter-settings-css';
const CSS = `
.d2tw-settings { width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 0.75rem; }
.d2tw-settings *, .d2tw-settings *::before, .d2tw-settings *::after { box-sizing: border-box; }
.d2tw-settings .card {
  padding: 1rem 1.25rem; border: 0.0625rem solid #ebe6f2; border-radius: 0.875rem;
  background: #fff; display: flex; flex-direction: column; gap: 0.875rem;
}
.d2tw-settings h2 { margin: 0; font-size: 0.9375rem; font-weight: 600; color: #2e1065; }
.d2tw-settings .desc { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: #6b7280; }
.d2tw-settings .row {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.d2tw-settings .label { font-size: 0.8125rem; font-weight: 600; color: #4c1d95; }
.d2tw-settings .field { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.d2tw-settings .hint { margin: 0; font-size: 0.6875rem; color: #9ca3af; line-height: 1.45; }
.d2tw-settings .num { width: 8.5rem; }
.d2tw-settings .unit { font-size: 0.75rem; color: #6b7280; font-weight: 600; }
.d2tw-settings .row-inline { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }

.d2tw-settings .plugin-input{font:inherit;color:inherit;box-sizing:border-box;min-width:0;width:100%;padding:.4375rem .625rem;border:1px solid #d0d7de;border-radius:.375rem;background:#fff;outline:none;}
.d2tw-settings .plugin-input:focus{border-color:#007aff;box-shadow:0 0 0 2px #007aff22;}
.d2tw-settings textarea.plugin-input{resize:vertical;line-height:1.5;}
.d2tw-settings .row>.plugin-input{flex:1;}
.d2tw-settings .plugin-button{font:inherit;font-size:.75rem;padding:.375rem .625rem;border:1px solid #d0d7de;border-radius:.375rem;background:#fff;cursor:pointer;color:inherit;}
.d2tw-settings .plugin-button.is-primary{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;}
.d2tw-settings .plugin-button:disabled{opacity:.55;cursor:wait;}
.d2tw-settings .plugin-switch{accent-color:#007aff;width:1.125rem;height:1.125rem;cursor:pointer;}
.d2tw-settings .plugin-tag{padding:.125rem .5rem;border-radius:999px;background:#f1f5f9;font-size:.75rem;}
.d2tw-settings .plugin-tag[data-tone=success]{background:#ecfdf5;color:#047857;}
.d2tw-settings .plugin-alert{padding:.75rem;border-radius:.5rem;background:#eff6ff;line-height:1.5;display:flex;flex-direction:column;gap:.25rem;}
.d2tw-settings .plugin-secret{display:flex;align-items:center;gap:.375rem;min-width:0;width:100%;}
.d2tw-settings .plugin-secret button{flex:none;border:0;background:transparent;color:#0969da;cursor:pointer;font:inherit;font-size:.75rem;}
.plugin-feedback-dota2-typewriter{padding:.625rem .75rem;border-radius:.5rem;font-size:.8125rem;margin-bottom:.75rem;background:#eff6ff;color:#1e40af;}
.plugin-feedback-dota2-typewriter[data-tone=error]{background:#fef2f2;color:#b91c1c;}
.plugin-feedback-dota2-typewriter[data-tone=warning]{background:#fff7ed;color:#9a3412;}

.d2tw-settings .plugin-input.num{width:8.5rem;}
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
function portable(cfg) {
    return {
        showCard: cfg.showCard !== false,
        intervalMs: clamp(cfg.intervalMs, MIN_MS, MAX_MS, DEFAULT_MS),
    };
}
export default function Dota2TypewriterSettings() {
    const [state, setState] = useState(() => ({
        loading: true,
        showCard: true,
        intervalMs: DEFAULT_MS
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
    async function load() {
        updateState({
            loading: true
        });
        try {
            const raw = await plugin.config.get();
            if (!mountedRef.current)
                return;
            const s = portable(raw && typeof raw === 'object' ? raw : {});
            updateState({
                showCard: s.showCard
            });
            updateState({
                intervalMs: s.intervalMs
            });
        }
        catch (e) {
            notify("error", `加载失败：${e instanceof Error ? e.message : String(e)}`);
        }
        finally {
            updateState({
                loading: false
            });
        }
    }
    async function persist() {
        const cfg = portable({ showCard: stateRef.current.showCard, intervalMs: stateRef.current.intervalMs });
        await plugin.config.set(cfg);
        if (plugin.sidecar && typeof plugin.sidecar.request === 'function') {
            try {
                await plugin.sidecar.request('setConfig', cfg);
            }
            catch {
                /* sidecar may not be up until enabled */
            }
        }
    }
    function scheduleSave() {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            persist().catch((e) => notify("error", `保存失败：${e instanceof Error ? e.message : String(e)}`));
        }, 200);
    }
    function onConfigChanged(ev) {
        const id = ev && ev.detail && ev.detail.pluginId;
        if (id && id !== 'dota2-typewriter')
            return;
        load();
    }
    useEffect(() => {
        mountedRef.current = true;
        ensureStyles();
        load();
        window.addEventListener('catrace:plugin-config-changed', onConfigChanged);
        return () => {
            if (saveTimerRef.current !== null) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
                void persist().catch(error => plugin.log?.warn?.('Pending settings save failed', { error: String(error) }));
            }
            window.removeEventListener('catrace:plugin-config-changed', onConfigChanged);
            clearTimeout(saveTimerRef.current);
            mountedRef.current = false;
        };
    }, []);
    const panel = (() => (h('div', {
        className: 'd2tw-settings'
    }, h('div', {
        className: 'card'
    }, h('h2', null, '暗黑狂欢打字机'), h('p', {
        className: 'desc'
    }, '循环往前台打 a→z。间隔是打完一轮 a–z 的总时间，不是每个字母隔这么久。'), h('div', {
        className: 'row'
    }, h('span', {
        className: 'label'
    }, '显示卡片'), h("input", {
        disabled: state.loading,
        onChange: event => ((v) => {
            updateState({
                showCard: !!v
            });
            persist().catch((e) => notify("error", `保存失败：${e instanceof Error ? e.message : String(e)}`));
        })(event.target.checked),
        type: "checkbox",
        role: "switch",
        checked: state.showCard,
        className: "plugin-switch " + "",
        "aria-label": "\u663E\u793A\u5361\u7247"
    })), h('div', {
        className: 'field'
    }, h('span', {
        className: 'label'
    }, '一轮间隔'), h('div', {
        className: 'row-inline'
    }, h("input", {
        value: String(state.intervalMs),
        disabled: state.loading,
        onChange: event => ((v) => {
            updateState({
                intervalMs: clamp(v, MIN_MS, MAX_MS, DEFAULT_MS)
            });
            scheduleSave();
        })(event.target.value),
        className: "plugin-input " + 'num',
        "aria-label": "\u4E00\u8F6E\u95F4\u9694\u6BEB\u79D2"
    }), h('span', {
        className: 'unit'
    }, 'ms / 一轮 a–z')), h('p', {
        className: 'hint'
    }, `默认 ${DEFAULT_MS}ms 打完一轮。Windows。`))))))();
    return h(React.Fragment, null, feedback ? h('div', { className: 'plugin-feedback-dota2-typewriter', 'data-tone': feedback.tone, role: feedback.tone === 'error' ? 'alert' : 'status' }, feedback.text) : null, panel);
}
