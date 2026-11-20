const React = globalThis.__CATRACE_REACT__ || {}
const HeroUI = globalThis.__CATRACE_HEROUI__ || {}
const { SettingsCard, SettingsCardRow } = globalThis.__CATRACE_SETTINGS_UI__ || {}
const { createElement: h, useEffect, useRef, useState } = React
const {
  AlertContent, AlertDescription, AlertIndicator, AlertRoot,
  Button, Input, NumberField,
  SliderFill, SliderRoot, SliderThumb, SliderTrack,
  ToggleButton, ToggleButtonGroup, ToggleButtonGroupSeparator,
} = HeroUI
if (typeof h !== 'function' || !Button || !ToggleButtonGroup || !ToggleButtonGroupSeparator || !NumberField) throw new Error('Catrace React/HeroUI runtime missing')
if (!SettingsCard || !SettingsCardRow) throw new Error('Catrace settings UI runtime missing')

const STYLE_ID = 'catrace-plugin-agent-notify-settings-css'
const CSS = `
.an-set { width:100%; display:flex; flex-direction:column; gap:1.25rem; }
.an-set .an-card-preview { padding:.75rem 0; }
.an-set .section-note { margin:0; padding:.25rem 0; font-size:.75rem; color:var(--ct-text-muted); line-height:1.5; }

.an-set .agent-undetected { padding:.125rem .4375rem; border-radius:999rem; background:var(--ct-warning-soft); color:var(--ct-warning-strong); font-size:.75rem; line-height:1.5; }
.an-set .preview-row { display:flex; flex-wrap:wrap; gap:.5rem; }
.an-set .sound-path { display:flex; align-items:center; gap:.5rem; max-width:100%; justify-content:flex-end; }
.an-set .an-sound-input { width:12rem; max-width:100%; }
.an-set .sound-volume { display:flex; align-items:center; gap:.5rem; }
.an-set .ed-unit { font-size:.75rem; color:var(--ct-text-muted); min-width:2.5rem; text-align:right; font-variant-numeric:tabular-nums; }
.an-set .an-num { width:9rem; }
.an-set .an-slider { width:8rem; }
.an-set .an-alert { margin-bottom:.25rem; }
`
const EVENTS = [
  ['SessionStart', '会话开始'], ['UserPromptSubmit', '开始思考'], ['PreToolUse', '调用工具中'],
  ['PostToolUse', '工具调用完成'], ['PostToolUseFailure', '工具调用失败'], ['Stop', '任务完成'],
  ['StopFailure', '任务出错 / 异常'], ['Notification', '等待交互'], ['PermissionRequest', '权限请求'],
]
const NAMES = { claude:'Claude Code', zcode:'ZCode', codex:'Codex', gemini:'Gemini CLI', kimi:'Kimi', pi:'Pi' }
const DEFAULTS = {
  showDebug:false, debugView:'off', debugExpanded:false, autoHideSeconds:8,
  eventModes:{ SessionStart:'auto', UserPromptSubmit:'auto', PreToolUse:'off', PostToolUse:'off', PostToolUseFailure:'off', Stop:'sticky', StopFailure:'sticky', Notification:'sticky', PermissionRequest:'sticky' },
  soundMode:'builtin', soundPath:'', soundVolume:1,
}
function ensureStyles() {
  let el = document.getElementById(STYLE_ID)
  if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el) }
  if (el.textContent !== CSS) el.textContent = plugin.theme.css(CSS)
}
function section(title, desc, children) {
  return h(SettingsCard,{key:title,title,description:desc},...children)
}
/** 设置标题 + 右侧控件；说明文字走 description 字体，放在标题下方。 */
function row(title, control, desc) {
  return h(SettingsCardRow,{key:title,title,control,description:desc})
}
/** HeroUI NumberField 复合组件：−/+ 步进与 secondary 灰底由组件 anatomy/variant 提供。 */
function numberField({ value, min, max, step = 1, label, isDisabled, onChange }) {
  return h(NumberField, {
    className:'an-num',
    value, minValue:min, maxValue:max, step,
    formatOptions:{ useGrouping:false },
    isDisabled, 'aria-label':label,
    onChange:next => {
      if (!Number.isFinite(next)) return
      // 越界值先不落盘：react-aria 会在失焦时把输入夹回 min/max，再走一次 onChange。
      if (next < min || next > max) return
      onChange(Math.round(next))
    },
  },
    h(NumberField.Group, null,
      h(NumberField.DecrementButton, { 'aria-label':'减少' }),
      h(NumberField.Input, null),
      h(NumberField.IncrementButton, { 'aria-label':'增加' })))
}
/** Single-select segmented control; Selection from react-aria is a Set of keys.
 *  HeroUI 的分隔线要放进除第一项外的每个 ToggleButton 里（官方 anatomy），否则会少掉中间的细线。 */
function segments(label, value, options, onValueChange, disabled) {
  return h(ToggleButtonGroup,{
    'aria-label':label,
    size:'sm',
    selectionMode:'single',
    disallowEmptySelection:true,
    selectedKeys:[value],
    isDisabled:disabled,
    onSelectionChange(keys) {
      const next = keys instanceof Set ? [...keys][0] : Array.isArray(keys) ? keys[0] : keys
      if (next != null) onValueChange(String(next))
    },
  },...options.map(([id,label], index) => h(ToggleButton,{id,key:id},
    index > 0 ? h(ToggleButtonGroupSeparator,{key:'separator'}) : null, label)))
}

async function requestSidecar(method, params = {}) {
  const reply = await plugin.sidecar.request(method, params)
  if (reply?.ok === false) throw new Error(reply.error || '后台操作失败')
  return reply?.result ?? reply
}

function waitForPiPoll(signal) {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return }
    const timer = setTimeout(finish, 500)
    function finish() {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    signal.addEventListener('abort', finish, { once:true })
  })
}

async function installPiHook(signal) {
  await requestSidecar('install', { agent:'pi' })
  const deadline = Date.now() + 120_000
  while (!signal.aborted && Date.now() < deadline) {
    await waitForPiPoll(signal)
    if (signal.aborted) return
    const task = await requestSidecar('piInstallStatus')
    if (task.error) throw new Error(task.error)
    if (!task.running) return
  }
  if (!signal.aborted) throw new Error('安装仍在后台进行，请稍后重新打开设置')
}

export default function AgentNotifySettings() {
  const [config,setConfig] = useState(() => ({...DEFAULTS,eventModes:{...DEFAULTS.eventModes}}))
  const configRef = useRef(config)
  const [agents,setAgents] = useState([])
  const [busy,setBusy] = useState('')
  const [previewBusy,setPreviewBusy] = useState('')
  const [sidecarStale,setSidecarStale] = useState(false)
  const [ready,setReady] = useState(false)
  const [loadAttempt,setLoadAttempt] = useState(0)
  const [feedback,setFeedback] = useState(null)
  const alive = useRef(true)
  const saveTimer = useRef(null)
  const dirty = useRef(false)
  const saveQueue = useRef(Promise.resolve())
  const hookOperation = useRef(null)
  const notify = (text,error=false) => { if (alive.current) setFeedback({text,error}) }
  const errorText = error => error instanceof Error ? error.message : String(error)

  async function loadAgents(signal) {
    const rows = await requestSidecar('listAgents')
    if (!Array.isArray(rows)) throw new Error('插件后台未返回 Agent 列表')
    if (alive.current && !signal.aborted) {
      setAgents(rows)
      setSidecarStale(rows.some(a => a.detected === undefined))
    }
    return rows
  }
  function persist() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    dirty.current = false
    const snapshot = {...configRef.current,eventModes:{...configRef.current.eventModes}}
    const next = saveQueue.current.catch(() => {}).then(async () => {
      await plugin.config.set(snapshot)
      try { await plugin.sidecar.request('setConfig',snapshot) }
      catch (error) { notify(`配置已保存，但后台同步失败：${errorText(error)}`,true) }
    })
    saveQueue.current = next
    return next.catch(error => notify(errorText(error),true))
  }
  function update(patch,debounce=0) {
    const next = {...configRef.current,...patch}
    configRef.current = next
    setConfig(next)
    dirty.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (debounce) saveTimer.current = setTimeout(() => void persist(),debounce)
    else void persist()
  }
  useEffect(() => {
    alive.current = true
    const load = new AbortController()
    ensureStyles()
    void (async () => {
      try {
        const raw = await plugin.config.get() || {}
        const debugView = ['off','common','raw'].includes(raw.debugView) ? raw.debugView : raw.showDebug ? 'raw' : 'off'
        const seconds = Number(raw.autoHideSeconds)
        const volume = Number(raw.soundVolume)
        const loaded = {...DEFAULTS,...raw,
          eventModes:{...DEFAULTS.eventModes,...raw.eventModes},
          debugView,showDebug:debugView !== 'off',debugExpanded:raw.debugExpanded === true,
          autoHideSeconds:Number.isFinite(seconds) && seconds >= 3 && seconds <= 600 ? Math.round(seconds) : 8,
          soundMode:['builtin','custom','muted'].includes(raw.soundMode) ? raw.soundMode : 'builtin',
          soundPath:String(raw.soundPath || ''),soundVolume:Number.isFinite(volume) ? Math.min(1,Math.max(0,volume)) : 1,
        }
        if (load.signal.aborted) return
        configRef.current = loaded
        setConfig(loaded)
      } catch (error) {
        if (!load.signal.aborted) notify(`读取配置失败：${errorText(error)}`,true)
        return
      }
      setReady(true)
      try { await loadAgents(load.signal) }
      catch (error) {
        if (!load.signal.aborted) { setSidecarStale(true); notify(`读取 Agent 联动失败：${errorText(error)}`,true) }
      }
    })()
    return () => {
      alive.current = false
      load.abort()
      hookOperation.current?.abort()
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (dirty.current) void persist()
    }
  },[loadAttempt])
  async function toggle(agent) {
    if (hookOperation.current) return
    const operation = new AbortController()
    hookOperation.current = operation
    setBusy(agent.id)
    const installing = !agent.installed
    const isPi = agent.id === 'pi'
    try {
      if (isPi && installing) await installPiHook(operation.signal)
      else await requestSidecar(installing ? 'install' : 'uninstall',{agent:agent.id})
      if (operation.signal.aborted) return
      const rows = await loadAgents(operation.signal)
      if (operation.signal.aborted) return
      const updated = rows.find(a => a.id === agent.id)
      if (!updated || updated.installed !== installing) notify('未能确认 Hook 配置已更新',true)
      else if (isPi) notify(installing ? 'Pi Hook 已配置，请重启 Pi 或 pi-web 生效' : 'Pi Hook 已卸载，请在 Pi 中执行 /webhook reload')
      else notify(installing ? 'Hook 已安装' : 'Hook 已卸载')
    } catch (error) { if (!operation.signal.aborted) notify(errorText(error),true) }
    finally { hookOperation.current = null; if (!operation.signal.aborted && alive.current) setBusy('') }
  }
  async function preview(kind) {
    setPreviewBusy(kind)
    try { await plugin.sidecar.request('testCard',{kind}); notify('已弹出测试卡片') }
    catch (error) { notify(errorText(error),true) }
    finally { if (alive.current) setPreviewBusy('') }
  }
  async function pickSoundFile() {
    try {
      const path = await plugin.dialog.showOpenDialog({filters:[{name:'Audio',extensions:['wav','mp3','ogg','flac']},{name:'All',extensions:['*']}]})
      if (path && alive.current) update({soundPath:Array.isArray(path) ? path[0] : path})
    } catch (error) { notify(errorText(error),true) }
  }
  async function playPreview() {
    try {
      const cfg = configRef.current
      if (cfg.soundMode === 'muted') return
      const dir = await plugin.path.getPluginDir()
      const path = cfg.soundMode === 'custom' ? cfg.soundPath.trim() : `${String(dir || '').replace(/[\\/]+$/,'')}/assets/agent-notify.wav`
      if (!path) { notify('请先选择音频文件',true); return }
      await plugin.audio.play(path,{volume:cfg.soundVolume})
    } catch (error) { notify(errorText(error),true) }
  }
  const detected = agents.filter(a => a.detected !== false)
  const undetected = agents.filter(a => a.detected === false)
  const strategy = [['off','不通知'],['auto','自动消失'],['sticky','常驻']]
  return h('div',{className:'an-set'},
    feedback ? h(AlertRoot,{status:feedback.error ? 'danger' : 'accent',className:'an-alert',role:feedback.error ? 'alert' : 'status'},
      h(AlertIndicator),
      h(AlertContent,null,h(AlertDescription,null,feedback.text)),
      !ready && feedback.error ? h(Button,{size:'sm',variant:'secondary',onClick:() => setLoadAttempt(value => value+1)},'重试') : null) : null,
    section('Agent 联动','检测到配置目录的 Agent 可一键写入 hook 配置；未检测到的只作标记，不提供安装。',[
      sidecarStale ? h('p',{className:'section-note'},'插件进程的检测信息不完整，请关闭再开启本插件。') : null,
      ...detected.map(agent => row(NAMES[agent.id] || agent.id,
        h(Button,{size:'sm',variant:agent.installed ? 'danger-soft' : 'secondary',isDisabled:!!busy,onClick:() => void toggle(agent)},
          busy === agent.id ? (agent.installed ? '正在卸载…' : '正在安装…') : agent.installed ? '卸载 Hook' : '安装 Hook'),
        agent.id === 'pi' ? (agent.installed ? '已配置 · Webhook 仅用于状态提醒' : '通过 Webhook 接收 Pi / pi-web 状态提醒') : undefined)),
      !detected.length && ready && !sidecarStale ? h('p',{className:'section-note'},'未检测到 AI Agent。请先安装对应 Agent 并初始化其配置目录。') : null,
      undetected.length ? row('未检测到',h('div',{className:'preview-row'},...undetected.map(a => h('span',{key:a.id,className:'agent-undetected',title:'未检测到配置目录，无法写入 hook'},NAMES[a.id] || a.id)))) : null,
    ]),
    section('调试','卡片底部可看 hook stdin。常用为去重后的字段，原始保留对方传来的全文。',[
      row('调试显示',segments('调试显示',config.debugView,[['off','关闭'],['common','常用'],['raw','原始']],debugView => update({debugView,showDebug:debugView !== 'off'}),!ready)),
      row('默认状态',segments('默认状态',config.debugExpanded ? 'expanded' : 'collapsed',[['collapsed','折叠'],['expanded','展开']],value => update({debugExpanded:value === 'expanded'}),!ready)),
    ]),
    section('事件通知策略','默认只对「需要你回来」的事件常驻；可按事件改成不通知 / 自动消失 / 常驻。',[
      row('自动消失时间（秒）',numberField({value:config.autoHideSeconds,min:3,max:600,step:1,label:'自动消失时间',isDisabled:!ready,onChange:seconds => update({autoHideSeconds:seconds},200)})),
      ...EVENTS.map(([id,label]) => row(label,segments(label,config.eventModes[id],strategy,mode => update({eventModes:{...configRef.current.eventModes,[id]:mode}}),!ready))),
    ]),
    section('提示音','通知弹出时播放。自定义支持本地 wav / mp3 / ogg / flac。',[
      row('提示音模式',segments('提示音模式',config.soundMode,[['builtin','内置'],['custom','自定义'],['muted','静音']],soundMode => update({soundMode}),!ready)),
      config.soundMode !== 'muted' ? row('提示音音量',h('div',{className:'sound-volume'},h(SliderRoot,{'aria-label':'提示音音量',className:'an-slider',value:config.soundVolume,minValue:0,maxValue:1,step:.05,isDisabled:!ready,onChange:value => { if (typeof value === 'number') update({soundVolume:value},200) }},h(SliderTrack,null,h(SliderFill),h(SliderThumb))),h('span',{className:'ed-unit'},`${Math.round(config.soundVolume*100)}%`))) : null,
      config.soundMode === 'custom' ? row('音频文件路径',h('div',{className:'sound-path'},h(Input,{className:'an-sound-input','aria-label':'音频文件路径',value:config.soundPath,placeholder:'选择本地音频文件',disabled:!ready,readOnly:true}),h(Button,{size:'sm',variant:'secondary',isDisabled:!ready,onClick:() => void pickSoundFile()},'选择文件'),h(Button,{size:'sm',variant:'tertiary',isDisabled:!ready,onClick:() => void playPreview()},'试听'))) : null,
    ]),
    section('调试卡片','弹出真实 Toast，方便看会话卡、工具批准和问答卡。问答卡可以点选项并提交。',[
      h('div',{className:'preview-row an-card-preview'},...[['stop','任务完成'],['working','调用工具中'],['tool','批准工具'],['ask','回答问题'],['ask-multi','多题问答']].map(([kind,label]) => h(Button,{key:kind,size:'sm',variant:'tertiary',isDisabled:!!previewBusy,onClick:() => void preview(kind)},label))),
    ]))
}
export { AgentNotifySettings as Settings }
