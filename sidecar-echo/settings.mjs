const React = globalThis.__CATRACE_REACT__;
if (!React?.createElement || !React?.useState)
    throw new Error('Catrace plugin React runtime missing');
const { createElement: h, useState, useRef, useEffect } = React;
const STYLE_ID = 'catrace-sidecar-capability-settings-css';
const CSS = `
.cap-demo { width:100%; display:flex; flex-direction:column; gap:0.75rem; color:#164e63; }
.cap-demo * { box-sizing:border-box; }
.cap-demo .intro { line-height:1.55; }
.cap-demo .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(19rem,1fr)); gap:0.75rem; }
.cap-demo .card { min-width:0; padding:1rem 1.125rem; border:0.0625rem solid #d5f3f8; border-radius:0.875rem; background:#fff; display:flex; flex-direction:column; gap:0.625rem; }
.cap-demo .head { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; }
.cap-demo h3 { margin:0; font-size:0.875rem; color:#155e75; }
.cap-demo .desc { margin:0; color:#648b95; font-size:0.75rem; line-height:1.5; }
.cap-demo .actions { display:flex; flex-wrap:wrap; gap:0.5rem; }
.cap-demo .value { min-height:2.25rem; padding:0.625rem; border-radius:0.5rem; background:#ecfeff; color:#155e75; font:0.75rem/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; white-space:pre-wrap; word-break:break-all; overflow:auto; max-height:14rem; }
.cap-demo .env { max-height:20rem; }
.cap-demo .row { display:flex; align-items:center; gap:0.5rem; }
.cap-demo .row .plugin-input { flex:1; min-width:0; }

.cap-demo .plugin-input{font:inherit;color:inherit;box-sizing:border-box;min-width:0;width:100%;padding:.4375rem .625rem;border:1px solid #d0d7de;border-radius:.375rem;background:#fff;outline:none;}
.cap-demo .plugin-input:focus{border-color:#007aff;box-shadow:0 0 0 2px #007aff22;}
.cap-demo textarea.plugin-input{resize:vertical;line-height:1.5;}
.cap-demo .row>.plugin-input{flex:1;}
.cap-demo .plugin-button{font:inherit;font-size:.75rem;padding:.375rem .625rem;border:1px solid #d0d7de;border-radius:.375rem;background:#fff;cursor:pointer;color:inherit;}
.cap-demo .plugin-button.is-primary{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;}
.cap-demo .plugin-button:disabled{opacity:.55;cursor:wait;}
.cap-demo .plugin-switch{accent-color:#007aff;width:1.125rem;height:1.125rem;cursor:pointer;}
.cap-demo .plugin-tag{padding:.125rem .5rem;border-radius:999px;background:#f1f5f9;font-size:.75rem;}
.cap-demo .plugin-tag[data-tone=success]{background:#ecfdf5;color:#047857;}
.cap-demo .plugin-alert{padding:.75rem;border-radius:.5rem;background:#eff6ff;line-height:1.5;display:flex;flex-direction:column;gap:.25rem;}
.cap-demo .plugin-secret{display:flex;align-items:center;gap:.375rem;min-width:0;width:100%;}
.cap-demo .plugin-secret button{flex:none;border:0;background:transparent;color:#0969da;cursor:pointer;font:inherit;font-size:.75rem;}
.plugin-feedback-sidecar-echo{padding:.625rem .75rem;border-radius:.5rem;font-size:.8125rem;margin-bottom:.75rem;background:#eff6ff;color:#1e40af;}
.plugin-feedback-sidecar-echo[data-tone=error]{background:#fef2f2;color:#b91c1c;}
.plugin-feedback-sidecar-echo[data-tone=warning]{background:#fff7ed;color:#9a3412;}
`;
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
    return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part) || [];
}
export default function SidecarCapabilitySettings() {
    const [state, setState] = useState(() => ({
        busy: '',
        environment: {},
        selectedFile: '',
        selectedFolder: '',
        programPath: '',
        programArgs: '',
        processResult: '尚未启动程序',
        url: 'https://httpbin.org/get?from=catrace-sidecar-demo',
        httpResult: '尚未发送请求',
        savedPath: 'Not selected',
        clipboardText: 'Catrace plugin clipboard demo',
        clipboardResult: 'Not read',
        clipboardImageResult: 'Not tested',
        storageKey: 'demo-state',
        storageValue: 'Hello from sidecar-echo',
        storageResult: 'No operation yet',
        pathResult: 'Not loaded',
        platformResult: 'Not loaded',
        screenResult: 'Not loaded'
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
    const environmentText = Object.entries(stateRef.current.environment)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') || '尚未读取';
    async function run(key, task) {
        updateState({
            busy: key
        });
        try {
            await task();
        }
        catch (error) {
            const text = errorText(error);
            notify("error", text);
            if (key === 'http')
                updateState({
                    httpResult: text
                });
            if (key === 'run')
                updateState({
                    processResult: text
                });
        }
        finally {
            updateState({
                busy: ''
            });
        }
    }
    async function loadEnvironment() {
        await run('env', async () => {
            updateState({
                environment: await plugin.env.getAll()
            });
            await plugin.log.info('environment loaded', { count: Object.keys(stateRef.current.environment).length });
            notify("success", `读取到 ${Object.keys(stateRef.current.environment).length} 个环境变量`);
        });
    }
    async function pickFile(forProgram = false) {
        await run(forProgram ? 'program-file' : 'file', async () => {
            const path = await plugin.dialog.pickFile();
            if (!path)
                return;
            if (forProgram)
                updateState({
                    programPath: path
                });
            else
                updateState({
                    selectedFile: path
                });
            await plugin.log.info('file selected', { path, forProgram });
        });
    }
    async function pickFolder() {
        await run('folder', async () => {
            const path = await plugin.dialog.pickFolder();
            if (path) {
                updateState({
                    selectedFolder: path
                });
                await plugin.log.info('folder selected', { path });
            }
        });
    }
    async function runProgram() {
        await run('run', async () => {
            const result = await plugin.process.spawn(stateRef.current.programPath, splitArgs(stateRef.current.programArgs));
            updateState({
                processResult: `已启动，PID=${result.pid}`
            });
            await plugin.log.info('program started', { path: stateRef.current.programPath, pid: result.pid });
            notify("success", stateRef.current.processResult);
        });
    }
    async function httpGet() {
        await run('http', async () => {
            const result = await plugin.http.get(stateRef.current.url);
            await plugin.log.info('HTTP GET completed', { url: result.url, status: result.status });
            updateState({
                httpResult: [
                    `HTTP ${result.status}`,
                    `URL: ${result.url}`,
                    `Content-Type: ${result.contentType || '-'}`,
                    '',
                    result.body,
                ].join('\n')
            });
        });
    }
    async function saveDialog() {
        await run('save', async () => {
            const path = await plugin.dialog.showSaveDialog({ title: 'Choose demo save location', fileName: 'catrace-plugin-demo.txt', filters: [{ name: 'Text', extensions: ['txt'] }] });
            if (path)
                updateState({
                    savedPath: path
                });
        });
    }
    async function writeClipboard() { await run('clipboard-write', async () => { await plugin.clipboard.writeText(stateRef.current.clipboardText); await plugin.log.info('clipboard text written'); notify("success", 'Copied to clipboard'); }); }
    async function readClipboard() {
        await run('clipboard-read', async () => {
            updateState({
                clipboardResult: await plugin.clipboard.readText()
            });
        });
    }
    async function writeClipboardImage() {
        await run('clipboard-image-write', async () => {
            await plugin.clipboard.writeImage({ width: 2, height: 2, rgba: [124, 58, 237, 255, 20, 184, 166, 255, 245, 158, 11, 255, 255, 255, 255, 255] });
            updateState({
                clipboardImageResult: 'Wrote a 2x2 RGBA image'
            });
        });
    }
    async function readClipboardImage() {
        await run('clipboard-image-read', async () => {
            const image = await plugin.clipboard.readImage();
            updateState({
                clipboardImageResult: JSON.stringify({ width: image.width, height: image.height, rgbaBytes: image.rgba.length }, null, 2)
            });
        });
    }
    async function clearClipboard() {
        await run('clipboard-clear', async () => {
            await plugin.clipboard.clear();
            updateState({
                clipboardResult: 'Clipboard cleared'
            });
            updateState({
                clipboardImageResult: 'Clipboard cleared'
            });
        });
    }
    async function setStorage() {
        await run('storage-set', async () => {
            await plugin.storage.set(stateRef.current.storageKey, { text: stateRef.current.storageValue, savedAt: new Date().toISOString() });
            updateState({
                storageResult: 'Saved'
            });
        });
    }
    async function getStorage() {
        await run('storage-get', async () => {
            updateState({
                storageResult: JSON.stringify(await plugin.storage.get(stateRef.current.storageKey), null, 2)
            });
        });
    }
    async function removeStorage() {
        await run('storage-remove', async () => {
            await plugin.storage.remove(stateRef.current.storageKey);
            updateState({
                storageResult: 'Removed'
            });
        });
    }
    async function loadPaths() {
        await run('paths', async () => {
            const names = ['appData', 'home', 'downloads', 'temp'];
            const values = await Promise.all(names.map(async (name) => [name, await plugin.path.get(name)]));
            updateState({
                pathResult: values.map(([name, path]) => `${name}: ${path}`).join('\n')
            });
        });
    }
    async function loadPlatform() {
        await run('platform', async () => {
            const [info, dark] = await Promise.all([plugin.platform.getInfo(), plugin.theme.isDark()]);
            updateState({
                platformResult: JSON.stringify({ ...info, dark }, null, 2)
            });
        });
    }
    async function showNotification() { await run('notification', () => plugin.notification.show({ title: 'Plugin host notification', body: 'sidecar-echo successfully called notification API', level: 'success' })); }
    async function loadScreenInfo() {
        await run('screen', async () => {
            const point = await plugin.screen.getCursorPoint();
            const [display, displays] = await Promise.all([
                plugin.screen.getDisplayNearestPoint(point),
                plugin.screen.getAllDisplays(),
            ]);
            updateState({
                screenResult: JSON.stringify({ point, display, displayCount: displays.length, displays }, null, 2)
            });
        });
    }
    async function hideMainBriefly() {
        await run('window', async () => {
            await plugin.window.hideMain();
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await plugin.window.showMain();
        });
    }
    const card = (title, tag, description, children) => h('section', {
        className: 'card'
    }, h('div', {
        className: 'head'
    }, h('h3', null, title), h("span", {
        className: "plugin-tag " + "",
        'data-tone': 'info'
    }, (() => tag)())), h('p', {
        className: 'desc'
    }, description), ...children);
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
    useEffect(() => {
        mountedRef.current = true;
        ensureStyles();
        return () => {
            mountedRef.current = false;
        };
    }, []);
    const panel = (() => (h('div', {
        className: 'cap-demo'
    }, h("div", {
        role: "status",
        className: "plugin-alert " + 'intro'
    }, null, (() => '这是可信本地插件能力演示。插件通过统一 plugin API 调用 Rust 宿主能力；sidecar 只负责自定义后台事件。')()), h('div', {
        className: 'grid'
    }, card('环境变量', 'ENV', '读取 Rust 宿主进程可见的环境变量并完整展示。', [
        h('div', {
            className: 'actions'
        }, button('重新读取', 'env', loadEnvironment)),
        h('pre', {
            className: 'value env'
        }, environmentText),
    ]), card('文件选择', 'FILE', '调用系统文件选择器，返回绝对路径。', [
        h('div', {
            className: 'actions'
        }, button('选择文件', 'file', () => pickFile(false))),
        h('pre', {
            className: 'value'
        }, state.selectedFile
            || '尚未选择'),
    ]), card('目录选择', 'FOLDER', '调用系统目录选择器，返回绝对路径。', [
        h('div', {
            className: 'actions'
        }, button('选择文件夹', 'folder', pickFolder)),
        h('pre', {
            className: 'value'
        }, state.selectedFolder
            || '尚未选择'),
    ]), card('启动本机程序', 'PROCESS', '选择 exe/可执行文件，输入可选参数后启动。双引号可包裹含空格的参数。', [
        h('div', {
            className: 'row'
        }, h("input", {
            value: state.programPath,
            placeholder: '可执行文件路径',
            onChange: event => ((value) => {
                updateState({
                    programPath: value
                });
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "\u53EF\u6267\u884C\u6587\u4EF6\u8DEF\u5F84"
        }), button('选择', 'program-file', () => pickFile(true))),
        h("input", {
            value: state.programArgs,
            placeholder: '参数，例如："C:\\My File.txt" --demo',
            onChange: event => ((value) => {
                updateState({
                    programArgs: value
                });
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "\u7A0B\u5E8F\u53C2\u6570"
        }),
        h('div', {
            className: 'actions'
        }, button('运行', 'run', runProgram, {
            disabled: !state.programPath || (!!state.busy && state.busy
                !== 'run'),
        })),
        h('pre', {
            className: 'value'
        }, state.processResult),
    ]), card('HTTP GET', 'NETWORK', '由 Rust 宿主发起 GET，并展示状态码、最终 URL、Content-Type 和响应正文。', [
        h("input", {
            value: state.url,
            placeholder: 'https://example.com',
            onChange: event => ((value) => {
                updateState({
                    url: value
                });
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "\u8BF7\u6C42URL"
        }),
        h('div', {
            className: 'actions'
        }, button('发送 GET', 'http', httpGet, {
            disabled: !state.url || (!!state.busy && state.busy
                !== 'http'),
        }), button('清空 URL', 'clear-url', () => updateState({ url: '' }))),
        h('pre', {
            className: 'value'
        }, state.httpResult),
    ]), card('Save dialog', 'SAVE', 'Choose a target path without writing the file.', [
        h('div', {
            className: 'actions'
        }, button('Choose save path', 'save', saveDialog)),
        h('pre', {
            className: 'value'
        }, state.savedPath),
    ]), card('Clipboard', 'CLIPBOARD', 'Read and write the system text clipboard.', [
        h("input", {
            value: state.clipboardText,
            onChange: event => ((value) => {
                updateState({
                    clipboardText: value
                });
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "\u526A\u8D34\u677F\u6587\u672C"
        }),
        h('div', {
            className: 'actions'
        }, button('Write text', 'clipboard-write', writeClipboard), button('Read text', 'clipboard-read', readClipboard), button('Write image', 'clipboard-image-write', writeClipboardImage), button('Read image', 'clipboard-image-read', readClipboardImage), button('Clear', 'clipboard-clear', clearClipboard)),
        h('pre', {
            className: 'value'
        }, state.clipboardResult),
        h('pre', {
            className: 'value'
        }, state.clipboardImageResult),
    ]), card('Plugin storage', 'STORAGE', 'JSON persistence isolated by plugin id.', [
        h("input", {
            value: state.storageKey,
            placeholder: 'key',
            onChange: event => ((value) => {
                updateState({
                    storageKey: value
                });
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "\u5B58\u50A8\u952E"
        }),
        h("input", {
            value: state.storageValue,
            placeholder: 'value',
            onChange: event => ((value) => {
                updateState({
                    storageValue: value
                });
            })(event.target.value),
            className: "plugin-input " + "",
            "aria-label": "\u5B58\u50A8\u503C"
        }),
        h('div', {
            className: 'actions'
        }, button('Save', 'storage-set', setStorage), button('Read', 'storage-get', getStorage), button('Remove', 'storage-remove', removeStorage)),
        h('pre', {
            className: 'value'
        }, state.storageResult),
    ]), card('Host paths and Shell', 'PATH', 'Resolve common paths, open folders and reveal files.', [
        h('div', {
            className: 'actions'
        }, button('Load paths', 'paths', loadPaths), button('Open folder', 'open-path', () => run('open-path', () => plugin.shell.openPath(state.selectedFolder)), { disabled: !state.selectedFolder }), button('Reveal file', 'reveal', () => run('reveal', () => plugin.shell.showItemInFolder(state.selectedFile)), { disabled: !state.selectedFile })),
        h('pre', {
            className: 'value'
        }, state.pathResult),
    ]), card('Platform, theme and notification', 'HOST', 'Inspect host info and publish a Toast through Event Bus.', [
        h('div', {
            className: 'actions'
        }, button('Refresh', 'platform', loadPlatform), button('Notify', 'notification', showNotification), button('Open URL', 'external', () => run('external', () => plugin.shell.openExternal(state.url)))),
        h('pre', {
            className: 'value'
        }, state.platformResult),
    ]), card('Screen, window and beep', 'DESKTOP', 'Read cursor/display information, control the main window and play the system beep.', [
        h('div', {
            className: 'actions'
        }, button('Refresh screen', 'screen', loadScreenInfo), button('Hide for 1s', 'window', hideMainBriefly), button('Beep', 'beep', () => run('beep', () => plugin.shell.beep()))),
        h('pre', {
            className: 'value'
        }, state.screenResult),
    ])))))();
    return h(React.Fragment, null, feedback ? h('div', { className: 'plugin-feedback-sidecar-echo', 'data-tone': feedback.tone, role: feedback.tone === 'error' ? 'alert' : 'status' }, feedback.text) : null, panel);
}
