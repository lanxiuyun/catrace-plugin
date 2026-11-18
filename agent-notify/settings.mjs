const React = globalThis.__CATRACE_REACT__ || {}
const HeroUI = globalThis.__CATRACE_HEROUI__ || {}
const { createElement: h, useEffect, useRef, useState } = React
const {
  AlertContent, AlertDescription, AlertIndicator, AlertRoot,
  Button, Input, NumberField,
  SliderFill, SliderRoot, SliderThumb, SliderTrack,
  ToggleButton, ToggleButtonGroup, ToggleButtonGroupSeparator,
} = HeroUI
if (typeof h !== 'function' || !Button || !ToggleButtonGroup || !ToggleButtonGroupSeparator || !NumberField) throw new Error('Catrace React/HeroUI runtime missing')

const STYLE_ID = 'catrace-plugin-agent-notify-settings-css'
const CSS = `
.an-set { width:100%; display:flex; flex-direction:column; gap:1.25rem; --an-card-bg:#fbfbfb; }
/* 浅色卡片底固定 #fbfbfb；深色回到主题表面色，否则整页会亮出一块白卡。 */
[data-theme='dark'] .an-set { --an-card-bg:var(--ct-surface); }
.an-set .plugin-section { display:flex; flex-direction:column; gap:.75rem; }
.an-set .section-head { display:flex; flex-direction:column; gap:.25rem; min-width:0; }
/* 组标题在卡片外，删掉 color 后继承正文黑；不要再落回 --ct-text-muted。 */
.an-set .section-title { margin:0; font-size:.8125rem; font-weight:700; letter-spacing:.02rem; }
/* 组说明是 description 字体：比标题小一档、灰色，位置在标题下方、卡片外。 */
.an-set .section-desc { margin:0; font-size:.75rem; color:var(--ct-text-muted); line-height:1.5; }
.an-set .section-card { background:var(--an-card-bg); border:1px solid var(--ct-border-card,var(--ct-border)); border-radius:1rem; padding:0 1rem; box-shadow:0 .0625rem .125rem rgba(15,23,42,.03); }
.an-set .section-card > .preview-row { padding:.75rem 0; }
.an-set .section-note { margin:0; padding:.25rem 0; font-size:.75rem; color:var(--ct-text-muted); line-height:1.5; }
.an-set .event-row { display:flex; align-items:center; justify-content:space-between; gap:.75rem; padding:.5rem 0; flex-wrap:wrap; }
.an-set .event-row + .event-row { border-top:1px solid var(--ct-border); }
.an-set .event-copy { display:flex; flex-direction:column; gap:.1875rem; min-width:0; }
/* 设置项标题：和组标题同为 13px，但用常规字重，读起来比 700 的组标题轻一档。 */
.an-set .event-title { font-size:.8125rem; font-weight:400; line-height:1.35; color:var(--ct-text); }
.an-set .event-desc { font-size:.75rem; line-height:1.5; color:var(--ct-text-muted); }
.an-set .agent-label { display:flex; align-items:center; gap:.5rem; min-width:0; }
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
const NAMES = { claude:'Claude Code', zcode:'ZCode', codex:'Codex', gemini:'Gemini CLI', kimi:'Kimi' }
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
  return h('section', { className:'plugin-section', key:title },
    h('div',{className:'section-head'},
      h('h3',{className:'section-title'},title),
      desc ? h('p',{className:'section-desc'},desc) : null),
    h('div',{className:'section-card'},...children))
}
/** 设置标题 + 右侧控件；说明文字走 description 字体，放在标题下方。 */
function row(title, control, desc) {
  return h('div',{className:'event-row',key:title},
    h('div',{className:'event-copy'},
      h('span',{className:'event-title'},title),
      desc ? h('span',{className:'event-desc'},desc) : null),
    control)
}
/** HeroUI NumberField 复合组件：−/+ 步进与 secondary 灰底由组件 anatomy/variant 提供。 */
function numberField({ value, min, max, step = 1, label, isDisabled, onChange }) {
  return h(NumberField, {
    variant:'secondary', className:'an-num',
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
function segments(value, options, onValueChange, disabled) {
  return h(ToggleButtonGroup,{
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
  const hookOperation = useRef(false)
  const notify = (text,error=false) => { if (alive.current) setFeedback({text,error}) }
  const errorText = error => error instanceof Error ? error.message : String(error)

  async function loadAgents() {
    try {
      const list = await plugin.sidecar.request('listAgents',{})
      const result = list?.result ?? list
      const rows = Array.isArray(result) ? result : []
      if (alive.current) { setAgents(rows); setSidecarStale(rows.some(a => a.detected === undefined)) }
      return rows
    } catch {
      const rows = Object.keys(NAMES).map(id => ({id,installed:false,detected:true}))
      if (alive.current) setAgents(rows)
      return rows
    }
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
        if (!alive.current) return
        configRef.current = loaded
        setConfig(loaded)
      } catch (error) { notify(`读取配置失败：${errorText(error)}`,true); return }
      if (alive.current) setReady(true)
      await loadAgents()
    })()
    return () => {
      alive.current = false
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (dirty.current) void persist()
    }
  },[loadAttempt])
  async function toggle(agent) {
    if (hookOperation.current) return
    hookOperation.current = true
    setBusy(agent.id)
    const installing = !agent.installed
    try {
      await plugin.sidecar.request(installing ? 'install' : 'uninstall',{agent:agent.id})
      const rows = await loadAgents()
      if (installing && !rows.find(a => a.id === agent.id)?.installed) notify('没有写入成功（该 Agent 的配置目录可能不存在）',true)
      else notify(installing ? 'Hook 已安装' : 'Hook 已卸载')
    } catch (error) { notify(errorText(error),true) }
    finally { hookOperation.current = false; if (alive.current) setBusy('') }
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
      ...detected.map(agent => h('div',{className:'event-row',key:agent.id},
        h('div',{className:'agent-label'},h('span',{className:'event-title'},NAMES[agent.id] || agent.id)),
        h(Button,{size:'sm',variant:agent.installed ? 'danger-soft' : 'secondary',isDisabled:!!busy,onClick:() => void toggle(agent)},agent.installed ? '卸载 Hook' : '安装 Hook'))),
      !detected.length ? h('p',{className:'section-note'},'未检测到 AI Agent。需要存在 ~/.claude、~/.zcode/cli、~/.codex、~/.gemini 或 ~/.kimi 其中一个配置目录。') : null,
      undetected.length ? row('未检测到',h('div',{className:'preview-row'},...undetected.map(a => h('span',{key:a.id,className:'agent-undetected',title:'未检测到配置目录，无法写入 hook'},NAMES[a.id] || a.id)))) : null,
    ]),
    section('调试','卡片底部可看 hook stdin。常用为去重后的字段，原始保留对方传来的全文。',[
      row('调试显示',segments(config.debugView,[['off','关闭'],['common','常用'],['raw','原始']],debugView => update({debugView,showDebug:debugView !== 'off'}),!ready)),
      row('默认状态',segments(config.debugExpanded ? 'expanded' : 'collapsed',[['collapsed','折叠'],['expanded','展开']],value => update({debugExpanded:value === 'expanded'}),!ready)),
    ]),
    section('事件通知策略','默认只对「需要你回来」的事件常驻；可按事件改成不通知 / 自动消失 / 常驻。',[
      row('自动消失时间（秒）',numberField({value:config.autoHideSeconds,min:3,max:600,step:1,label:'自动消失时间',isDisabled:!ready,onChange:seconds => update({autoHideSeconds:seconds},200)})),
      ...EVENTS.map(([id,label]) => row(label,segments(config.eventModes[id],strategy,mode => update({eventModes:{...configRef.current.eventModes,[id]:mode}}),!ready))),
    ]),
    section('提示音','通知弹出时播放。自定义支持本地 wav / mp3 / ogg / flac。',[
      row('提示音模式',segments(config.soundMode,[['builtin','内置'],['custom','自定义'],['muted','静音']],soundMode => update({soundMode}),!ready)),
      config.soundMode !== 'muted' ? row('提示音音量',h('div',{className:'sound-volume'},h(SliderRoot,{className:'an-slider',value:config.soundVolume,minValue:0,maxValue:1,step:.05,isDisabled:!ready,onChange:value => { if (typeof value === 'number') update({soundVolume:value},200) }},h(SliderTrack,null,h(SliderFill),h(SliderThumb))),h('span',{className:'ed-unit'},`${Math.round(config.soundVolume*100)}%`))) : null,
      config.soundMode === 'custom' ? row('音频文件路径',h('div',{className:'sound-path'},h(Input,{variant:'secondary',className:'an-sound-input',value:config.soundPath,placeholder:'选择或输入本地音频文件',isDisabled:!ready,onChange:e => update({soundPath:e.target.value},500),onBlur:() => { if (dirty.current) void persist() }}),h(Button,{size:'sm',variant:'secondary',isDisabled:!ready,onClick:() => void pickSoundFile()},'选择文件'))) : null,
      config.soundMode !== 'muted' ? row('试听',h(Button,{size:'sm',variant:'tertiary',isDisabled:!ready,onClick:() => void playPreview()},'预览')) : null,
    ]),
    section('调试卡片','弹出真实 Toast，方便看会话卡、工具批准和问答卡。问答卡可以点选项并提交。',[
      h('div',{className:'preview-row'},...[['stop','任务完成'],['working','调用工具中'],['tool','批准工具'],['ask','回答问题'],['ask-multi','多题问答']].map(([kind,label]) => h(Button,{key:kind,size:'sm',variant:'tertiary',isDisabled:!!previewBusy,onClick:() => void preview(kind)},label))),
    ]))
}
export { AgentNotifySettings as Settings }
