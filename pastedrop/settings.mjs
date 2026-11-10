const React = globalThis.__CATRACE_REACT__;
if (!React?.createElement || !React?.useState)
    throw new Error('Catrace plugin React runtime missing');
const { createElement: h, useState, useRef, useEffect } = React;
const STYLE_ID = 'catrace-plugin-pastedrop-settings-css';
const CSS = `
.pd-settings { width:100%; display:flex; flex-direction:column; gap:0.75rem; color:#0f172a; }
.pd-settings * { box-sizing:border-box; }
.pd-settings .card {
  min-width:0; padding:1.125rem 1.25rem 1.25rem; border:0.0625rem solid #e8eef7;
  border-radius:1rem; background:#fff;
  box-shadow:0 0.0625rem 0.125rem rgba(15,23,42,0.03);
  display:flex; flex-direction:column; gap:0.875rem;
}
.pd-settings h3 { margin:0; font-size:0.9375rem; font-weight:700; color:#0f172a; }
.pd-settings .field { display:flex; flex-direction:column; gap:0.375rem; min-width:0; }
.pd-settings .label { font-size:0.75rem; color:#64748b; font-weight:600; }
.pd-settings .hint { margin:0; color:#94a3b8; font-size:0.6875rem; line-height:1.4; }
.pd-settings .row { display:flex; align-items:center; gap:0.5rem; }
.pd-settings .row .plugin-input { flex:1; min-width:0; }
.pd-settings .actions { display:flex; flex-wrap:wrap; gap:0.5rem; }
.pd-settings .status-line { font-size:0.75rem; color:#475569; line-height:1.5; }
.pd-settings .status-line .tag {
  display:inline-block; padding:0.0625rem 0.375rem; border-radius:0.375rem;
  font-weight:600; margin-right:0.375rem;
}
.pd-settings .tag.ok { background:#ecfdf5; color:#059669; }
.pd-settings .tag.bad { background:#fef2f2; color:#dc2626; }
.pd-settings .tag.muted { background:#f1f5f9; color:#64748b; }
.pd-settings .saved-line { font-size:0.6875rem; color:#94a3b8; word-break:break-all; }

.pd-settings .plugin-input{font:inherit;color:inherit;box-sizing:border-box;min-width:0;width:100%;padding:.4375rem .625rem;border:1px solid #d0d7de;border-radius:.375rem;background:#fff;outline:none;}
.pd-settings .plugin-input:focus{border-color:#007aff;box-shadow:0 0 0 2px #007aff22;}
.pd-settings textarea.plugin-input{resize:vertical;line-height:1.5;}
.pd-settings .row>.plugin-input{flex:1;}
.pd-settings .plugin-button{font:inherit;font-size:.75rem;padding:.375rem .625rem;border:1px solid #d0d7de;border-radius:.375rem;background:#fff;cursor:pointer;color:inherit;}
.pd-settings .plugin-button.is-primary{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;}
.pd-settings .plugin-button:disabled{opacity:.55;cursor:wait;}
.pd-settings .plugin-switch{accent-color:#007aff;width:1.125rem;height:1.125rem;cursor:pointer;}
.pd-settings .plugin-tag{padding:.125rem .5rem;border-radius:999px;background:#f1f5f9;font-size:.75rem;}
.pd-settings .plugin-tag[data-tone=success]{background:#ecfdf5;color:#047857;}
.pd-settings .plugin-alert{padding:.75rem;border-radius:.5rem;background:#eff6ff;line-height:1.5;display:flex;flex-direction:column;gap:.25rem;}
.pd-settings .plugin-secret{display:flex;align-items:center;gap:.375rem;min-width:0;width:100%;}
.pd-settings .plugin-secret button{flex:none;border:0;background:transparent;color:#0969da;cursor:pointer;font:inherit;font-size:.75rem;}
.plugin-feedback-pastedrop{padding:.625rem .75rem;border-radius:.5rem;font-size:.8125rem;margin-bottom:.75rem;background:#eff6ff;color:#1e40af;}
.plugin-feedback-pastedrop[data-tone=error]{background:#fef2f2;color:#b91c1c;}
.plugin-feedback-pastedrop[data-tone=warning]{background:#fff7ed;color:#9a3412;}
`;
const SAVE_SCOPE_OPTIONS = [
    { label: '桌面 + 资源管理器当前文件夹', value: 'both' },
    { label: '仅桌面', value: 'desktop' },
    { label: '仅资源管理器当前文件夹', value: 'explorer' },
];
const SAVE_FORMAT_OPTIONS = [
    { label: '自动（优先无损 PNG）', value: 'auto' },
    { label: 'PNG', value: 'png' },
    { label: 'JPG', value: 'jpg' },
];
const DEFAULT_CONFIG = {
    saveScope: 'both',
    namePrefix: 'PasteDrop',
    saveFormat: 'auto',
};
function ensureStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = plugin.theme.css(CSS);
    document.head.appendChild(style);
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
function normalizeConfig(input = {}) {
    return {
        saveScope: input.saveScope === 'desktop' || input.saveScope === 'explorer' || input.saveScope === 'both'
            ? input.saveScope
            : DEFAULT_CONFIG.saveScope,
        namePrefix: typeof input.namePrefix === 'string' && input.namePrefix.trim()
            ? input.namePrefix.trim()
            : DEFAULT_CONFIG.namePrefix,
        saveFormat: input.saveFormat === 'png' || input.saveFormat === 'jpg' || input.saveFormat === 'auto'
            ? input.saveFormat
            : DEFAULT_CONFIG.saveFormat,
    };
}
export default function PasteDropSettings() {
    const [state, setState] = useState(() => ({
        osName: 'unknown',
        busy: '',
        saveScope: DEFAULT_CONFIG.saveScope,
        namePrefix: DEFAULT_CONFIG.namePrefix,
        saveFormat: DEFAULT_CONFIG.saveFormat,
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
    const statusTimerRef = useRef(null);
    const statusInFlightRef = useRef(false);
    function currentConfig() {
        return normalizeConfig({
            saveScope: stateRef.
                current.saveScope,
            namePrefix: stateRef.
                current.namePrefix,
            saveFormat: stateRef.
                current.saveFormat,
        });
    }
    function applyConfig(cfg = {}) {
        updateState({
            saveScope: cfg.saveScope === 'desktop' || cfg.saveScope === 'explorer' || cfg.saveScope === 'both'
                ? cfg.saveScope
                : DEFAULT_CONFIG.saveScope
        });
        updateState({
            namePrefix: typeof cfg.namePrefix === 'string' && cfg.namePrefix.trim()
                ? cfg.namePrefix.trim()
                : DEFAULT_CONFIG.namePrefix
        });
        updateState({
            saveFormat: cfg.saveFormat === 'png' || cfg.saveFormat === 'jpg' || cfg.saveFormat === 'auto'
                ? cfg.saveFormat
                : DEFAULT_CONFIG.saveFormat
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
    async function persistAndSync({ quiet = false } = {}) {
        const cfg = currentConfig();
        updateState({
            saveScope: cfg.saveScope
        });
        updateState({
            namePrefix: cfg.namePrefix
        });
        updateState({
            saveFormat: cfg.saveFormat
        });
        await plugin.config.set(cfg);
        try {
            await plugin.sidecar.request('setConfig', cfg);
            updateState({
                status: await plugin.sidecar.request('getStatus')
            });
            if (!quiet)
                notify("success", '已保存');
            await plugin.log.info('pastedrop config auto-saved', { cfg });
        }
        catch (error) {
            if (!quiet)
                notify("warning", '已保存（启用插件后生效）');
            await plugin.log.warn('pastedrop config saved without runtime', {
                error: errorText(error),
            });
        }
    }
    function scheduleSave() {
        if (saveTimerRef.current)
            clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            persistAndSync({ quiet: true }).catch((error) => {
                notify("error", errorText(error));
            });
        }, 400);
    }
    async function refreshStatus() {
        await run('status', async () => {
            updateState({
                status: await plugin.sidecar.request('getStatus')
            });
        });
    }
    async function pollStatus() {
        if (statusInFlightRef.current || stateRef.
            current.busy
            === 'boot')
            return;
        statusInFlightRef.current = true;
        try {
            updateState({
                status: await plugin.sidecar.request('getStatus')
            });
        }
        catch {
            /* 未启用 sidecar 时保持现有行 */
        }
        finally {
            statusInFlightRef.current = false;
        }
    }
    const button = (label, key, onClick, props = {}) => h("button", {
        onClick,
        type: "button",
        disabled: !!stateRef.
            current.busy && stateRef.
            current.busy
            !== key || stateRef.
            current.busy
            === key,
        'aria-busy': stateRef.
            current.busy
            === key,
        className: "plugin-button is-primary " + "",
        ...props
    }, (() => label)());
    const statusTag = (ok, text) => h('span', {
        className: `tag ${ok ? 'ok' : 'bad'}`
    }, text);
    useEffect(() => {
        mountedRef.current = true;
        ensureStyles();
        run('boot', async () => {
            try {
                const info = await plugin.platform.getInfo();
                updateState({
                    osName: info?.os || 'unknown'
                });
            }
            catch { }
            const saved = await plugin.config.get();
            if (!mountedRef.current)
                return;
            if (saved && typeof saved === 'object')
                applyConfig(saved);
            await persistAndSync({ quiet: true });
        });
        statusTimerRef.current = setInterval(() => {
            pollStatus();
        }, 2000);
        return () => {
            if (saveTimerRef.current !== null) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
                void persistAndSync({ quiet: true }).catch(error => plugin.log?.warn?.('Pending settings save failed', { error: String(error) }));
            }
            if (saveTimerRef.current)
                clearTimeout(saveTimerRef.current);
            if (statusTimerRef.current)
                clearInterval(statusTimerRef.current);
            mountedRef.current = false;
            clearInterval(statusTimerRef.current);
        };
    }, []);
    const panel = (() => {
        const st = state.status;
        const unsupported = st?.supported === false;
        const workerBad = st && st.workerOk === false;
        const workerRunning = st?.workerRunning === true;
        return h('div', {
            className: 'pd-settings'
        }, h('section', {
            className: 'card'
        }, h('h3', null, '保存行为'), h('div', {
            className: 'field'
        }, h('span', {
            className: 'label'
        }, '在哪些地方拦截 Ctrl+V'), h("select", {
            value: state.saveScope,
            onChange: event => ((v) => {
                updateState({
                    saveScope: v
                });
                scheduleSave();
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "\u4FDD\u5B58\u4F4D\u7F6E"
        }, SAVE_SCOPE_OPTIONS.map(option => h('option', {
            key: option.value,
            value: option.value
        }, option.label))), h('p', {
            className: 'hint'
        }, '拦截范围内且剪贴板是图片时，把图片存成文件；其他情况原样放行粘贴。')), h('div', {
            className: 'field'
        }, h('span', {
            className: 'label'
        }, '文件名前缀'), h("input", {
            value: state.namePrefix,
            placeholder: 'PasteDrop',
            onChange: event => ((v) => {
                updateState({
                    namePrefix: v
                });
                scheduleSave();
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "\u6587\u4EF6\u540D\u524D\u7F00"
        }), h('p', {
            className: 'hint'
        }, '例如「PasteDrop 2026-08-13 10-00-00.png」，同名会自动加序号。')), h('div', {
            className: 'field'
        }, h('span', {
            className: 'label'
        }, '保存格式'), h("select", {
            value: state.saveFormat,
            onChange: event => ((v) => {
                updateState({
                    saveFormat: v
                });
                scheduleSave();
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "\u4FDD\u5B58\u683C\u5F0F"
        }, SAVE_FORMAT_OPTIONS.map(option => h('option', {
            key: option.value,
            value: option.value
        }, option.label))), h('p', {
            className: 'hint'
        }, '自动：剪贴板自带 PNG 就原样写出（不重编码）；否则无损存 PNG。JPG 体积更小但有损。'))), h('section', {
            className: 'card'
        }, h('h3', null, '状态'), unsupported
            ? h("div", {
                role: "status",
                className: "plugin-alert " + ""
            }, h("strong", null, '仅支持 Windows'), (() => '本插件依赖 Windows 全局键盘钩子，当前系统不可用。')()) : null, workerBad && !unsupported
            ? h("div", {
                role: "status",
                className: "plugin-alert " + ""
            }, h("strong", null, '钩子启动失败'), (() => `需要 Windows PowerShell 5.1+（系统标配）。${st.lastWorkerError || ''}`)()) : null, st && !unsupported
            ? h('div', {
                className: 'status-line'
            }, statusTag(workerRunning, workerRunning ? '运行中' : '未运行'), statusTag(st.workerOk === true, st.workerOk === true ? '钩子 OK' : '钩子未知'), st.lastWorkerError ? h('div', {}, st.lastWorkerError) : null) : null, st?.lastSaved
            ? h('div', {
                className: 'saved-line'
            }, `最近保存：${st.lastSaved.fileName} @ ${st.lastSaved.path}`) : null, h('div', {
            className: 'actions'
        }, button('刷新状态', 'status', refreshStatus)), h('p', {
            className: 'hint'
        }, 'Windows 跑 PowerShell 子进程装全局键盘钩子。启用即信任其全部代码。状态每 2 秒刷新。')));
    })();
    return h(React.Fragment, null, feedback ? h('div', { className: 'plugin-feedback-pastedrop', 'data-tone': feedback.tone, role: feedback.tone === 'error' ? 'alert' : 'status' }, feedback.text) : null, panel);
}
