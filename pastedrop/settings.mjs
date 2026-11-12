const React = globalThis.__CATRACE_REACT__ || {};
const HeroUI = globalThis.__CATRACE_HEROUI__ || {};
const { createElement: h, useEffect, useRef, useState } = React;
const {
    AlertContent, AlertDescription, AlertIndicator, AlertRoot,
    Button, Chip, Input,
    ListBox, ListBoxItem,
    SelectIndicator, SelectPopover, SelectRoot, SelectTrigger, SelectValue,
} = HeroUI;
if (typeof h !== 'function' || typeof useState !== 'function' || !Button || !Input
    || !SelectRoot || !SelectTrigger || !SelectValue || !SelectIndicator || !SelectPopover
    || !ListBox || !ListBoxItem || !Chip
    || !AlertRoot || !AlertIndicator || !AlertContent || !AlertDescription)
    throw new Error('Catrace React/HeroUI runtime missing');
const STYLE_ID = 'catrace-plugin-pastedrop-settings-css';
const CSS = `
.pd-set { width:100%; display:flex; flex-direction:column; gap:.75rem; color:var(--ct-text,#0f172a); }
.pd-set * { box-sizing:border-box; }
.pd-panel {
  min-width:0; padding:1.125rem 1.25rem 1.25rem; border:1px solid var(--ct-border-card,var(--ct-border,#e8eef7));
  border-radius:1rem; background:var(--ct-surface,#fff);
  box-shadow:0 .0625rem .125rem rgba(15,23,42,.03);
  display:flex; flex-direction:column; gap:.875rem;
}
.pd-title { margin:0; font-size:.9375rem; font-weight:700; color:var(--ct-text,#0f172a); }
.pd-field { display:flex; flex-direction:column; gap:.375rem; min-width:0; }
.pd-label { font-size:.75rem; font-weight:600; color:var(--ct-text-muted,#64748b); }
.pd-hint { margin:0; color:var(--ct-text-muted,#94a3b8); font-size:.6875rem; line-height:1.4; }
.pd-select, .pd-select-trigger { width:100%; }
.pd-status { display:flex; align-items:center; flex-wrap:wrap; gap:.375rem; font-size:.75rem; line-height:1.5; color:var(--ct-text,#475569); }
.pd-status-error { font-size:.75rem; color:var(--ct-text-muted,#64748b); word-break:break-all; }
.pd-saved { font-size:.6875rem; color:var(--ct-text-muted,#94a3b8); word-break:break-all; }
.pd-actions { display:flex; flex-wrap:wrap; gap:.5rem; }
.pd-alert { margin:0; }
`;
const SAVE_FORMAT_OPTIONS = [
    { label: '自动（优先无损 PNG）', value: 'auto' },
    { label: 'PNG', value: 'png' },
    { label: 'JPG', value: 'jpg' },
];
const DEFAULT_CONFIG = {
    namePrefix: 'PasteDrop',
    saveFormat: 'auto',
};
const FEEDBACK_STATUS = {
    success: 'success',
    error: 'danger',
    warning: 'warning',
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
        namePrefix: typeof input.namePrefix === 'string' && input.namePrefix.trim()
            ? input.namePrefix.trim()
            : DEFAULT_CONFIG.namePrefix,
        saveFormat: input.saveFormat === 'png' || input.saveFormat === 'jpg' || input.saveFormat === 'auto'
            ? input.saveFormat
            : DEFAULT_CONFIG.saveFormat,
    };
}
function selectField(options, value, onValueChange, ariaLabel) {
    return h(SelectRoot, {
        className: 'pd-select',
        variant: 'secondary',
        fullWidth: true,
        value,
        onChange(key) {
            if (key != null)
                onValueChange(String(key));
        },
    }, h(SelectTrigger, { className: 'pd-select-trigger', 'aria-label': ariaLabel },
        h(SelectValue),
        h(SelectIndicator)),
    h(SelectPopover, null, h(ListBox, { 'aria-label': ariaLabel }, ...options.map(option => h(ListBoxItem, {
        id: option.value,
        key: option.value,
        textValue: option.label,
    }, option.label)))));
}
export default function PasteDropSettings() {
    const [state, setState] = useState(() => ({
        osName: 'unknown',
        busy: '',
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
            namePrefix: stateRef.
                current.namePrefix,
            saveFormat: stateRef.
                current.saveFormat,
        });
    }
    function applyConfig(cfg = {}) {
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
    const statusChip = (ok, text) => h(Chip, {
        size: 'sm',
        variant: 'soft',
        color: ok ? 'success' : 'danger'
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
            className: 'pd-set'
        }, feedback ? h(AlertRoot, {
            status: FEEDBACK_STATUS[feedback.tone] || 'accent',
            className: 'pd-alert',
            role: feedback.tone === 'error' ? 'alert' : 'status'
        }, h(AlertIndicator), h(AlertContent, null, h(AlertDescription, null, feedback.text))) : null, h('section', {
            className: 'pd-panel'
        }, h('h3', {
            className: 'pd-title'
        }, '保存行为'), h('div', {
            className: 'pd-field'
        }, h('span', {
            className: 'pd-label'
        }, '文件名前缀'), h(Input, {
            variant: 'secondary',
            fullWidth: true,
            value: state.namePrefix,
            placeholder: 'PasteDrop',
            'aria-label': '文件名前缀',
            onChange: event => {
                updateState({
                    namePrefix: event.target.value
                });
                scheduleSave();
            }
        }), h('p', {
            className: 'pd-hint'
        }, '例如「PasteDrop 2026-08-13 10-00-00.png」，同名会自动加序号。')), h('div', {
            className: 'pd-field'
        }, h('span', {
            className: 'pd-label'
        }, '保存格式'), selectField(SAVE_FORMAT_OPTIONS, state.saveFormat, value => {
            updateState({
                saveFormat: value
            });
            scheduleSave();
        }, '保存格式'), h('p', {
            className: 'pd-hint'
        }, '自动：剪贴板自带 PNG 就原样写出（不重编码）；否则无损存 PNG。JPG 体积更小但有损。'))), h('section', {
            className: 'pd-panel'
        }, h('h3', {
            className: 'pd-title'
        }, '状态'), unsupported
            ? h(AlertRoot, {
                status: 'warning',
                className: 'pd-alert',
                role: 'status'
            }, h(AlertIndicator), h(AlertContent, null, h(AlertDescription, null, h('strong', null, '仅支持 Windows'), '本插件依赖 Windows 全局键盘钩子，当前系统不可用。'))) : null, workerBad && !unsupported
            ? h(AlertRoot, {
                status: 'danger',
                className: 'pd-alert',
                role: 'status'
            }, h(AlertIndicator), h(AlertContent, null, h(AlertDescription, null, h('strong', null, '钩子启动失败'), `需要 Windows PowerShell 5.1+（系统标配）。${st.lastWorkerError || ''}`))) : null, st && !unsupported
            ? h('div', {
                className: 'pd-status'
            }, statusChip(workerRunning, workerRunning ? '运行中' : '未运行'), statusChip(st.workerOk === true, st.workerOk === true ? '钩子 OK' : '钩子未知'), st.lastWorkerError ? h('span', {
                className: 'pd-status-error'
            }, st.lastWorkerError) : null) : null, st?.lastSaved
            ? h('div', {
                className: 'pd-saved'
            }, `最近保存：${st.lastSaved.fileName} @ ${st.lastSaved.path}`) : null, h('div', {
            className: 'pd-actions'
        }, h(Button, {
            type: 'button',
            size: 'sm',
            variant: 'secondary',
            isDisabled: !!state.busy,
            'aria-busy': state.busy === 'status',
            onClick: refreshStatus
        }, '刷新状态')), h('p', {
            className: 'pd-hint'
        }, 'Windows 跑 PowerShell 子进程装全局键盘钩子。启用即信任其全部代码。状态每 2 秒刷新。')));
    })();
    return panel;
}
export { PasteDropSettings as Settings };
