const React = globalThis.__CATRACE_REACT__;
if (!React?.createElement || !React?.useState)
    throw new Error('Catrace plugin React runtime missing');
const { createElement: h, useState, useRef, useEffect } = React;
const HeroUI = globalThis.__CATRACE_HEROUI__ || {};
const {
    AlertContent, AlertDescription, AlertIndicator, AlertRoot,
    Button, Chip, Input,
    NumberFieldDecrementButton, NumberFieldGroup, NumberFieldIncrementButton, NumberFieldInput, NumberFieldRoot,
    SwitchContent, SwitchControl, SwitchRoot, SwitchThumb,
} = HeroUI;
if (!Button || !Chip || !Input || !SwitchRoot || !SwitchContent || !SwitchControl || !SwitchThumb
    || !NumberFieldRoot || !NumberFieldGroup || !NumberFieldInput || !NumberFieldDecrementButton || !NumberFieldIncrementButton
    || !AlertRoot || !AlertIndicator || !AlertContent || !AlertDescription)
    throw new Error('Catrace React/HeroUI runtime missing');
const PLUGIN_ID = 'github-notify';
const MIN_POLL_SEC = 1;
const MAX_POLL_SEC = 3600;
const MIN_CARD_SEC = 0;
const MAX_CARD_SEC = 600;
const DEFAULT_POLL_SEC = 60;
const DEFAULT_CARD_SEC = 10;
const STYLE_ID = 'catrace-plugin-github-notify-settings-css';
// Layout only: HeroUI owns every control skin. Colours are --ct-* tokens, sizes are rem,
// and all plugin class names carry the gh- prefix so they cannot collide with HeroUI roots.
const CSS = `
.gh-set { width: 100%; display: flex; flex-direction: column; gap: 0.75rem; color: var(--ct-text); }
.gh-set *, .gh-set *::before, .gh-set *::after { box-sizing: border-box; }
.gh-set .gh-card {
  display: flex; flex-direction: column; gap: 0.75rem;
  padding: 1rem 1.25rem;
  border: 0.0625rem solid var(--ct-border-card);
  border-radius: 1rem;
  background: var(--ct-surface);
  box-shadow: var(--ct-shadow-card, none);
}
.gh-set .gh-head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.gh-set .gh-title { margin: 0; font-size: 0.9375rem; font-weight: 700; color: var(--ct-text); }
.gh-set .gh-desc { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: var(--ct-text-muted); }
.gh-set .gh-field { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.gh-set .gh-label { font-size: 0.75rem; font-weight: 600; color: var(--ct-text-muted); }
.gh-set .gh-hint { margin: 0; font-size: 0.6875rem; color: var(--ct-text-subtle); line-height: 1.45; }
.gh-set .gh-row {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.gh-set .gh-row-inline { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.gh-set .gh-num { width: 9rem; }
.gh-set .gh-unit { font-size: 0.75rem; color: var(--ct-text-muted); font-weight: 600; }
.gh-set .gh-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.gh-set .gh-status {
  display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem;
  padding: 0.625rem 0.75rem; border-radius: 0.5rem; background: var(--ct-surface-2);
  font-size: 0.75rem; color: var(--ct-text);
}
.gh-set .gh-status-label { color: var(--ct-text-muted); font-weight: 650; }
.gh-set .gh-status-value { font-variant-numeric: tabular-nums; }
.gh-set .gh-secret { display: flex; align-items: center; gap: 0.375rem; width: 100%; min-width: 0; }
.gh-set .gh-secret-input { flex: 1 1 auto; min-width: 0; }
.gh-set .gh-switch-label { font-size: 0.8125rem; font-weight: 500; color: var(--ct-text-muted); }
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
function feedbackStatus(tone) {
    if (tone === 'error')
        return 'danger';
    if (tone === 'warning')
        return 'warning';
    return 'success';
}
const DEFAULT_CONFIG = {
    token: '',
    pollIntervalSec: DEFAULT_POLL_SEC,
    cardDurationSec: DEFAULT_CARD_SEC,
    onlyWhenActive: true,
    enabled: true,
};
/** HeroUI 默认数字输入：−/+ 步进 + secondary 灰底；越界值等失焦夹回范围后再落盘。 */
function NumberInputField({ value, min, max, step = 1, label, onChange }) {
    return h(NumberFieldRoot, {
        variant: 'secondary',
        className: 'gh-num',
        value,
        minValue: min,
        maxValue: max,
        step,
        formatOptions: { useGrouping: false },
        'aria-label': label,
        onChange: next => {
            if (!Number.isFinite(next) || next < min || next > max)
                return;
            onChange(Math.round(next));
        },
    }, h(NumberFieldGroup, null, h(NumberFieldDecrementButton, { 'aria-label': '减少' }), h(NumberFieldInput, null), h(NumberFieldIncrementButton, { 'aria-label': '增加' })));
}
/** PAT field with its own show/hide affordance; the toggle stays a real, labelled button. */function SecretInput({ value, placeholder, onChange, ariaLabel }) {
    const [visible, setVisible] = useState(false);
    return h('div', { className: 'gh-secret' }, h(Input, {
        variant: 'secondary',
        className: 'gh-secret-input',
        type: visible ? 'text' : 'password',
        value,
        placeholder,
        onChange,
        'aria-label': ariaLabel,
    }), h(Button, {
        size: 'sm',
        variant: 'secondary',
        'aria-label': visible ? '隐藏密钥' : '显示密钥',
        'aria-pressed': visible,
        onClick: () => setVisible(!visible),
    }, visible ? '隐藏' : '显示'));
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
            className: 'gh-set'
        }, feedback ? h(AlertRoot, {
            status: feedbackStatus(feedback.tone),
            role: feedback.tone === 'error' ? 'alert' : 'status'
        }, h(AlertIndicator), h(AlertContent, null, h(AlertDescription, null, feedback.text))) : null, h('div', {
            className: 'gh-card'
        }, h('div', {
            className: 'gh-head'
        }, h('h2', {
            className: 'gh-title'
        }, 'GitHub 通知'), h(Chip, {
            size: 'sm',
            variant: 'soft',
            color: state.enabled ? 'success' : 'default'
        }, state.enabled ? '已启用' : '已关闭')), h('p', {
            className: 'gh-desc'
        }, '用 Personal Access Token 拉取 GitHub 未读通知。启动或拉取时，凡本机未见过的通知 id 一律推送（已通知 id 保存在本机）；之后按间隔轮询新变更。'), h('div', {
            className: 'gh-field'
        }, h('div', {
            className: 'gh-label'
        }, 'GitHub PAT'), h(SecretInput, {
            value: state.token,
            placeholder: 'ghp_… 或 github_pat_…（notifications 读权限）',
            onChange: event => ((v) => {
                updateState({
                    token: v
                });
                scheduleSave();
            })(event.target.value),
            ariaLabel: 'GitHub PAT'
        }), h('p', {
            className: 'gh-hint'
        }, '经典 Token 勾选 notifications；Fine-grained 需 Repository access + Notifications 读权限。Token 仅存本机 plugin_config。')), h('div', {
            className: 'gh-row'
        }, h('div', {
            className: 'gh-field'
        }, h('div', {
            className: 'gh-label'
        }, '轮询间隔'), h('div', {
            className: 'gh-row-inline'
        }, h(NumberInputField, {
            value: state.pollIntervalSec,
            min: MIN_POLL_SEC,
            max: MAX_POLL_SEC,
            step: 1,
            label: '轮询间隔秒数',
            onChange: value => {
                updateState({
                    pollIntervalSec: clamp(value, MIN_POLL_SEC, MAX_POLL_SEC, DEFAULT_POLL_SEC)
                });
                scheduleSave();
            },
        }), h('span', {
            className: 'gh-unit'
        }, '秒'))), h('div', {
            className: 'gh-field'
        }, h('div', {
            className: 'gh-label'
        }, '卡片停留'), h('div', {
            className: 'gh-row-inline'
        }, h(NumberInputField, {
            value: state.cardDurationSec,
            min: MIN_CARD_SEC,
            max: MAX_CARD_SEC,
            step: 1,
            label: '卡片停留秒数',
            onChange: value => {
                updateState({
                    cardDurationSec: clamp(value, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC)
                });
                scheduleSave();
            },
        }), h('span', {
            className: 'gh-unit'
        }, '秒（0=常驻）')))), h('div', {
            className: 'gh-row'
        }, h(SwitchRoot, {
            size: 'sm',
            isSelected: state.onlyWhenActive,
            'aria-label': '仅在用户活跃时推送',
            onChange: value => ((v) => {
                updateState({
                    onlyWhenActive: !!v
                });
                scheduleSave();
            })(value)
        }, h(SwitchContent, null, h(SwitchControl, null, h(SwitchThumb)), h('span', {
            className: 'gh-switch-label'
        }, '仅在用户活跃时推送'))), h('div', {
            className: 'gh-actions'
        }, h(Button, {
            size: 'sm',
            variant: 'primary',
            onClick: pollNow,
            isDisabled: !!state.busy && state.busy
                !== 'poll' || state.busy
                === 'poll',
            'aria-busy': state.busy
                === 'poll'
        }, '立即拉取'), h(Button, {
            size: 'sm',
            variant: 'secondary',
            onClick: sendTest,
            isDisabled: !!state.busy && state.busy
                !== 'test' || state.busy
                === 'test',
            'aria-busy': state.busy
                === 'test'
        }, '测试卡片'), h(Button, {
            size: 'sm',
            variant: 'tertiary',
            onClick: () => run('status', refreshStatus),
            isDisabled: !!state.busy && state.busy
                !== 'status' || state.busy
                === 'status',
            'aria-busy': state.busy
                === 'status'
        }, '刷新状态'), h(Button, {
            size: 'sm',
            variant: 'danger-soft',
            onClick: resetAndReseed,
            isDisabled: !!state.busy && state.busy
                !== 'reset' || state.busy
                === 'reset',
            'aria-busy': state.busy
                === 'reset'
        }, '重置基线')))), h('div', {
            className: 'gh-card'
        }, h('div', {
            className: 'gh-head'
        }, h('h2', {
            className: 'gh-title'
        }, '运行状态')), state.loading
            ? h('p', {
                className: 'gh-desc'
            }, '加载中…') : h('div', {
            className: 'gh-status'
        }, statusRows.flatMap(([k, v]) => [h('strong', { key: `${k}:label`, className: 'gh-status-label' }, k), h('span', { key: `${k}:value`, className: 'gh-status-value' }, String(v))]))));
    })();
    return panel;
}
export { GithubNotifySettings as Settings };
