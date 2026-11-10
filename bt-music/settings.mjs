const React = globalThis.__CATRACE_REACT__;
if (!React?.createElement || !React?.useState)
    throw new Error('Catrace plugin React runtime missing');
const { createElement: h, useState, useRef, useEffect } = React;
const STYLE_ID = 'catrace-plugin-bt-music-settings-css';
const CSS = `
.bt-settings { width:100%; display:flex; flex-direction:column; gap:0.75rem; color:#0f172a; }
.bt-settings * { box-sizing:border-box; }
.bt-settings .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(18rem,1fr)); gap:0.75rem; }
.bt-settings .card {
  min-width:0; padding:1.125rem 1.25rem 1.25rem; border:0.0625rem solid #e8eef7;
  border-radius:1rem; background:#fff;
  box-shadow:0 0.0625rem 0.125rem rgba(15,23,42,0.03);
  display:flex; flex-direction:column; gap:0.875rem;
}
.bt-settings .head {
  display:flex; align-items:center; gap:0.75rem;
  padding-bottom:0.75rem; border-bottom:0.0625rem solid #f1f5f9;
}
.bt-settings .head-left { display:flex; align-items:center; gap:0.5rem; min-width:0; }
.bt-settings .icon {
  width:1.625rem; height:1.625rem; border-radius:0.5rem; flex:0 0 auto;
  display:flex; align-items:center; justify-content:center; font-size:0.8125rem;
}
.bt-settings .icon.green { background:#ecfdf5; color:#059669; }
.bt-settings .icon.blue { background:#eff6ff; color:#2563eb; }
.bt-settings h3 { margin:0; font-size:0.9375rem; font-weight:700; color:#0f172a; }
.bt-settings .field { display:flex; flex-direction:column; gap:0.375rem; min-width:0; }
.bt-settings .label { font-size:0.75rem; color:#64748b; font-weight:600; }
.bt-settings .hint { margin:0; color:#94a3b8; font-size:0.6875rem; line-height:1.4; }
.bt-settings .row { display:flex; align-items:center; gap:0.5rem; }
.bt-settings .row .plugin-input { flex:1; min-width:0; }
.bt-settings .row-inline { display:flex; align-items:center; gap:0.5rem; }
.bt-settings .row-inline .plugin-input { width:5.5rem; flex:0 0 auto; }
.bt-settings .unit { font-size:0.75rem; color:#64748b; }
.bt-settings .actions { display:flex; flex-wrap:wrap; gap:0.5rem; }
.bt-settings .action-block {
  display:flex; flex-direction:column; gap:0.5rem;
  padding:0.75rem; border:0.0625rem solid #f1f5f9; border-radius:0.75rem; background:#fafcff;
}

.bt-settings .plugin-input{font:inherit;color:inherit;box-sizing:border-box;min-width:0;width:100%;padding:.4375rem .625rem;border:1px solid #d0d7de;border-radius:.375rem;background:#fff;outline:none;}
.bt-settings .plugin-input:focus{border-color:#007aff;box-shadow:0 0 0 2px #007aff22;}
.bt-settings textarea.plugin-input{resize:vertical;line-height:1.5;}
.bt-settings .row>.plugin-input{flex:1;}
.bt-settings .plugin-button{font:inherit;font-size:.75rem;padding:.375rem .625rem;border:1px solid #d0d7de;border-radius:.375rem;background:#fff;cursor:pointer;color:inherit;}
.bt-settings .plugin-button.is-primary{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;}
.bt-settings .plugin-button:disabled{opacity:.55;cursor:wait;}
.bt-settings .plugin-switch{accent-color:#007aff;width:1.125rem;height:1.125rem;cursor:pointer;}
.bt-settings .plugin-tag{padding:.125rem .5rem;border-radius:999px;background:#f1f5f9;font-size:.75rem;}
.bt-settings .plugin-tag[data-tone=success]{background:#ecfdf5;color:#047857;}
.bt-settings .plugin-alert{padding:.75rem;border-radius:.5rem;background:#eff6ff;line-height:1.5;display:flex;flex-direction:column;gap:.25rem;}
.bt-settings .plugin-secret{display:flex;align-items:center;gap:.375rem;min-width:0;width:100%;}
.bt-settings .plugin-secret button{flex:none;border:0;background:transparent;color:#0969da;cursor:pointer;font:inherit;font-size:.75rem;}
.plugin-feedback-bt-music{padding:.625rem .75rem;border-radius:.5rem;font-size:.8125rem;margin-bottom:.75rem;background:#eff6ff;color:#1e40af;}
.plugin-feedback-bt-music[data-tone=error]{background:#fef2f2;color:#b91c1c;}
.plugin-feedback-bt-music[data-tone=warning]{background:#fff7ed;color:#9a3412;}
`;
const CONNECT_OPTIONS = [
    { label: '不做任何动作', value: 'none' },
    { label: '显示通知', value: 'notify' },
    { label: '启动软件', value: 'launch' },
];
const DISCONNECT_OPTIONS = [
    { label: '不做任何动作', value: 'none' },
    { label: '暂停播放', value: 'pause' },
    { label: '关闭软件', value: 'close' },
];
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
function splitArgs(value) {
    return (value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part) || []);
}
function clampAutoHideSec(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    const rounded = Math.round(n);
    if (rounded <= 0)
        return 0;
    return Math.min(600, Math.max(3, rounded));
}
function normalizeConnectAction(value, legacy = {}) {
    if (value === 'none' || value === 'notify' || value === 'launch')
        return value;
    if (legacy.autoLaunchOnConnect === true)
        return 'launch';
    return 'notify';
}
function normalizeDisconnectAction(value, legacy = {}) {
    if (value === 'none' || value === 'pause' || value === 'close')
        return value;
    // legacy: notify → none (disconnect no longer notifies); pause stays; close is new
    if (value === 'notify')
        return 'none';
    if (legacy.pauseOnDisconnect === true)
        return 'pause';
    if (legacy.notifyDisconnect === false)
        return 'none';
    return 'none';
}
const DEFAULT_CONFIG = {
    playerPath: '',
    playerArgs: '',
    connectAction: 'notify',
    disconnectAction: 'none',
    connectedAutoHideSec: 5,
    disconnectedAutoHideSec: 3,
};
export default function BtMusicSettings() {
    const [state, setState] = useState(() => ({
        busy: '',
        playerPath: DEFAULT_CONFIG.playerPath,
        playerArgs: DEFAULT_CONFIG.playerArgs,
        connectAction: DEFAULT_CONFIG.connectAction,
        disconnectAction: DEFAULT_CONFIG.disconnectAction,
        connectedAutoHideSec: DEFAULT_CONFIG.connectedAutoHideSec,
        disconnectedAutoHideSec: DEFAULT_CONFIG.disconnectedAutoHideSec
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
            listenEnabled: true,
            nameKeywords: [],
            playerPath: stateRef.current.playerPath
                || '',
            playerArgs: splitArgs(stateRef.current.playerArgs
                || ''),
            connectAction: normalizeConnectAction(stateRef.current.connectAction),
            disconnectAction: normalizeDisconnectAction(stateRef.current.disconnectAction),
            // Keep legacy mirrors for older sidecars / status dumps.
            autoLaunchOnConnect: stateRef.current.connectAction
                === 'launch',
            notifyDisconnect: false,
            pauseOnDisconnect: stateRef.current.disconnectAction
                === 'pause',
            connectedAutoHideSec: clampAutoHideSec(stateRef.current.connectedAutoHideSec, DEFAULT_CONFIG.connectedAutoHideSec),
            disconnectedAutoHideSec: clampAutoHideSec(stateRef.current.disconnectedAutoHideSec, DEFAULT_CONFIG.disconnectedAutoHideSec),
        };
    }
    function applyConfig(cfg = {}) {
        if (typeof cfg.playerPath === 'string')
            updateState({
                playerPath: cfg.playerPath
            });
        if (Array.isArray(cfg.playerArgs))
            updateState({
                playerArgs: cfg.playerArgs.join(' ')
            });
        else if (typeof cfg.playerArgs === 'string')
            updateState({
                playerArgs: cfg.playerArgs
            });
        updateState({
            connectAction: normalizeConnectAction(cfg.connectAction, cfg)
        });
        updateState({
            disconnectAction: normalizeDisconnectAction(cfg.disconnectAction, cfg)
        });
        if (typeof cfg.connectedAutoHideSec === 'number') {
            updateState({
                connectedAutoHideSec: clampAutoHideSec(cfg.connectedAutoHideSec, DEFAULT_CONFIG.connectedAutoHideSec)
            });
        }
        if (typeof cfg.disconnectedAutoHideSec === 'number') {
            updateState({
                disconnectedAutoHideSec: clampAutoHideSec(cfg.disconnectedAutoHideSec, DEFAULT_CONFIG.disconnectedAutoHideSec)
            });
        }
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
            connectAction: cfg.connectAction
        });
        updateState({
            disconnectAction: cfg.disconnectAction
        });
        updateState({
            connectedAutoHideSec: cfg.connectedAutoHideSec
        });
        updateState({
            disconnectedAutoHideSec: cfg.disconnectedAutoHideSec
        });
        await plugin.config.set(cfg);
        try {
            await plugin.sidecar.request('setConfig', cfg);
            if (!quiet)
                notify("success", '已保存');
            await plugin.log.info('bt-music config auto-saved', { cfg });
        }
        catch (error) {
            if (!quiet)
                notify("warning", '已保存（启用插件后生效）');
            await plugin.log.warn('bt-music config saved without runtime', { error: errorText(error) });
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
    async function pickPlayer() {
        await run('pick', async () => {
            const path = await plugin.dialog.pickFile();
            if (path) {
                updateState({
                    playerPath: path
                });
                scheduleSave();
            }
        });
    }
    async function testOpenPlayer() {
        await run('open', async () => {
            await persistAndSync({ quiet: true });
            const result = await plugin.sidecar.request('openPlayer', {});
            const body = result && typeof result === 'object' && 'result' in result ? result.result : result;
            const ok = body?.ok === true || (body && body.pid && body.path);
            if (ok) {
                const name = String(body.path ||
                    stateRef.current.playerPath || '').split(/[/\\]/).pop() || '程序';
                notify("success", `已启动 ${name}${body.pid ? ` (PID ${body.pid})` : ''}`);
            }
            else {
                notify("error", body?.error || result?.error || '启动失败');
            }
        });
    }
    async function testNotification() {
        await run('toast', async () => {
            await persistAndSync({ quiet: true });
            let sampleName = '蓝牙耳机';
            try {
                const status = await plugin.sidecar.request('getStatus');
                const devices = status?.devices || status?.pairedDevices || [];
                if (Array.isArray(devices) && devices[0]?.name)
                    sampleName = devices[0].name;
            }
            catch {
                /* ignore */
            }
            const hideSec = clampAutoHideSec(stateRef.current.connectedAutoHideSec, DEFAULT_CONFIG.connectedAutoHideSec);
            const sticky = hideSec <= 0;
            const payload = {
                deviceId: 'bt-music:test',
                deviceName: sampleName,
                source: 'settings-test',
                reason: 'manual-test',
                publishedAt: new Date().toISOString(),
                playerPath: stateRef.current.playerPath
                    || '',
                playerName: String(stateRef.current.playerPath
                    || '')
                    .split(/[/\\]/)
                    .pop()
                    ?.replace(/\.exe$/i, '') || '',
            };
            if (!sticky)
                payload.auto_hide_ms = hideSec * 1000;
            // Prefer sidecar status for icon if available.
            try {
                const status = await plugin.sidecar.request('getStatus');
                if (status?.playerIconDataUrl)
                    payload.playerIconDataUrl = status.playerIconDataUrl;
                if (status?.playerName)
                    payload.playerName = status.playerName;
                if (status?.playerPath)
                    payload.playerPath = status.playerPath;
            }
            catch {
                /* ignore */
            }
            await plugin.events.publish({
                eventType: 'bt-music.connected',
                kind: 'bt-music',
                title: '耳机已连接',
                body: sampleName,
                level: 'success',
                sticky,
                actions: [
                    { id: 'open-player', label: '打开听歌' },
                    { id: 'dismiss', label: sticky ? '知道了' : '关闭' },
                ],
                payload,
                dedupeKey: `bt-music:connected:test:${Date.now()}`,
            });
            notify("success", '已发送测试通知');
        });
    }
    const button = (label, key, onClick, props = {}) => h("button", {
        onClick,
        type: "button",
        disabled: !!stateRef.current.busy && stateRef.current.busy
            !== key || stateRef.current.busy
            === key,
        'aria-busy': stateRef.current.busy
            === key,
        className: "plugin-button is-primary " + "",
        ...props
    }, (() => label)());
    const card = (iconClass, icon, title, children) => h('section', {
        className: 'card'
    }, h('div', {
        className: 'head'
    }, h('div', {
        className: 'head-left'
    }, h('span', {
        className: `icon ${iconClass}`
    }, icon), h('h3', null, title))), ...children);
    useEffect(() => {
        mountedRef.current = true;
        ensureStyles();
        run('boot', async () => {
            const saved = await plugin.config.get();
            if (!mountedRef.current)
                return;
            if (saved && typeof saved === 'object')
                applyConfig(saved);
            await persistAndSync({ quiet: true });
        });
        return () => {
            if (saveTimerRef.current !== null) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
                void persistAndSync({ quiet: true }).catch(error => plugin.log?.warn?.('Pending settings save failed', { error: String(error) }));
            }
            mountedRef.current = false;
        };
    }, []);
    const panel = (() => (h('div', {
        className: 'bt-settings'
    }, h('div', {
        className: 'grid'
    }, card('green', '♪', '听歌程序', [
        h('div', {
            className: 'field'
        }, h('span', {
            className: 'label'
        }, '音乐软件路径'), h('div', {
            className: 'row'
        }, h("input", {
            value: state.playerPath,
            placeholder: '选择音乐软件可执行文件',
            onChange: event => ((v) => {
                updateState({
                    playerPath: v
                });
                scheduleSave();
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "\u97F3\u4E50\u8F6F\u4EF6\u8DEF\u5F84"
        }), button('浏览', 'pick', pickPlayer))),
        h('div', {
            className: 'field'
        }, h('span', {
            className: 'label'
        }, '启动参数（可选）'), h("input", {
            value: state.playerArgs,
            placeholder: '例如 --autoplay',
            onChange: event => ((v) => {
                updateState({
                    playerArgs: v
                });
                scheduleSave();
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "\u542F\u52A8\u53C2\u6570"
        })),
        h('div', {
            className: 'actions'
        }, button('测试启动', 'open', testOpenPlayer), button('测试通知', 'toast', testNotification)),
    ]), card('blue', '⚡', '连接 / 断开动作', [
        h('div', {
            className: 'action-block'
        }, h('div', {
            className: 'field'
        }, h('span', {
            className: 'label'
        }, '耳机连上时'), h("select", {
            value: state.connectAction,
            onChange: event => ((v) => {
                updateState({
                    connectAction: normalizeConnectAction(v)
                });
                scheduleSave();
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "\u8033\u673A\u8FDE\u4E0A\u65F6"
        }, CONNECT_OPTIONS.map(option => h('option', {
            key: option.value,
            value: option.value
        }, option.label))), h('p', {
            className: 'hint'
        }, state.connectAction
            === 'launch'
            ? '连接后直接启动听歌软件'
            : state.connectAction
                === 'none'
                ? '连接时不处理'
                : '弹出连接通知，可手动打开听歌')), state.connectAction
            === 'notify'
            ? h('div', {
                className: 'field'
            }, h('span', {
                className: 'label'
            }, '连接通知驻留'), h('div', {
                className: 'row-inline'
            }, h("input", {
                value: String(state.connectedAutoHideSec
                    ?? 5),
                placeholder: '5',
                onChange: event => ((v) => {
                    updateState({
                        connectedAutoHideSec: clampAutoHideSec(v, DEFAULT_CONFIG.connectedAutoHideSec)
                    });
                    scheduleSave();
                })(event.target.value),
                className: "plugin-input " + "",
                "aria-label": "\u8FDE\u63A5\u901A\u77E5\u9A7B\u7559\u79D2\u6570"
            }), h('span', {
                className: 'unit'
            }, '秒')), h('p', {
                className: 'hint'
            }, '0 表示不自动消失')) : null),
        h('div', {
            className: 'action-block'
        }, h('div', {
            className: 'field'
        }, h('span', {
            className: 'label'
        }, '耳机断开时'), h("select", {
            value: state.disconnectAction,
            onChange: event => ((v) => {
                updateState({
                    disconnectAction: normalizeDisconnectAction(v)
                });
                scheduleSave();
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "\u8033\u673A\u65AD\u5F00\u65F6"
        }, DISCONNECT_OPTIONS.map(option => h('option', {
            key: option.value,
            value: option.value
        }, option.label))), h('p', {
            className: 'hint'
        }, state.disconnectAction
            === 'pause'
            ? '断开后向系统发送暂停键'
            : state.disconnectAction
                === 'close'
                ? '断开后关闭已配置的听歌软件'
                : '断开时不处理'))),
    ])))))();
    return h(React.Fragment, null, feedback ? h('div', { className: 'plugin-feedback-bt-music', 'data-tone': feedback.tone, role: feedback.tone === 'error' ? 'alert' : 'status' }, feedback.text) : null, panel);
}
