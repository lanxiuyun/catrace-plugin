const { createElement: h, useEffect, useRef, useState } = globalThis.__CATRACE_REACT__ || {}
const { Button, Badge, SegmentedControl, Slider, Switch, TextField } = globalThis.__CATRACE_RADIX__ || {}
if (typeof h !== 'function' || !Button) throw new Error('Catrace React/Radix runtime missing')

const STYLE_ID = 'catrace-plugin-agent-notify-settings-css'
const CSS = `
.an-set { width:100%; display:flex; flex-direction:column; gap:1.25rem; }
.an-set .plugin-section { display:flex; flex-direction:column; gap:.75rem; }
.an-set .section-title { margin:0; font-size:.8125rem; font-weight:700; color:var(--ct-text-muted,#475569); letter-spacing:.02rem; }
.an-set .section-card { background:var(--ct-surface,#fff); border:1px solid var(--ct-border,#e2e8f0); border-radius:.875rem; padding:.75rem 1rem; box-shadow:0 .0625rem .125rem rgba(15,23,42,.03); }
.an-set .section-desc { margin:0 0 .5rem; font-size:.75rem; color:var(--ct-text-muted,#94a3b8); line-height:1.4; }
.an-set .event-row { display:flex; align-items:center; justify-content:space-between; gap:.75rem; padding:.5rem 0; flex-wrap:wrap; }
.an-set .event-row + .event-row { border-top:1px solid var(--ct-border,#f1f5f9); }
.an-set .event-name { font-size:.8125rem; font-weight:400; color:var(--ct-text,#334155); }
.an-set .agent-label { display:flex; align-items:center; gap:.5rem; min-width:0; }
.an-set .preview-row { display:flex; flex-wrap:wrap; gap:.5rem; }
.an-set .sound-path { display:flex; align-items:center; gap:.5rem; max-width:100%; justify-content:flex-end; }
.an-set .sound-input { width:12rem; max-width:100%; }
.an-set .sound-volume { display:flex; align-items:center; gap:.5rem; }
.an-set .ed-unit { font-size:.75rem; color:var(--ct-text-muted,#94a3b8); min-width:2.5rem; text-align:right; font-variant-numeric:tabular-nums; }
.an-set .an-feedback { padding:.5rem .75rem; border-radius:.5rem; background:var(--ct-surface-2,#f1f5f9); font-size:.75rem; overflow-wrap:anywhere; }
.an-set .an-feedback.is-error { color:#b91c1c; }
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
  return h('section', { className:'plugin-section', key:title }, h('h3',{className:'section-title'},title),
    h('div',{className:'section-card'},desc ? h('p',{className:'section-desc'},desc) : null,...children))
}
function row(label, control) {
  return h('div',{className:'event-row',key:label},h('span',{className:'event-name'},label),control)
}
function segments(value, options, onValueChange, disabled) {
  return h(SegmentedControl.Root,{value,onValueChange,size:'1',disabled},...options.map(([id,label]) =>
    h(SegmentedControl.Item,{value:id,key:id},label)))
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
    feedback ? h('div',{className:`an-feedback${feedback.error ? ' is-error' : ''}`,role:feedback.error ? 'alert' : 'status'},feedback.text,!ready && feedback.error ? h(Button,{size:'1',onClick:() => setLoadAttempt(value => value+1)},'重试') : null) : null,
    section('Agent 联动','检测到配置目录的 Agent 可一键写入 hook 配置；未检测到的只作标记，不提供安装。',[
      sidecarStale ? h('p',{className:'section-desc'},'插件进程的检测信息不完整，请关闭再开启本插件。') : null,
      ...detected.map(agent => h('div',{className:'event-row',key:agent.id},
        h('div',{className:'agent-label'},h('span',{className:'event-name'},NAMES[agent.id] || agent.id),h(Badge,{color:agent.installed ? 'green' : 'gray'},agent.installed ? '已安装' : '未安装')),
        h(Button,{size:'2',variant:'soft',color:agent.installed ? 'red' : 'blue',loading:busy === agent.id,disabled:!!busy,onClick:() => void toggle(agent)},agent.installed ? '卸载 Hook' : '安装 Hook'))),
      !detected.length ? h('p',{className:'section-desc'},'未检测到 AI Agent。需要存在 ~/.claude、~/.zcode/cli、~/.codex、~/.gemini 或 ~/.kimi 其中一个配置目录。') : null,
      undetected.length ? row('未检测到',h('div',{className:'preview-row'},...undetected.map(a => h(Badge,{key:a.id,color:'amber',title:'未检测到配置目录，无法写入 hook'},NAMES[a.id] || a.id)))) : null,
    ]),
    section('调试','卡片底部可看 hook stdin。常用为去重后的字段，原始保留对方传来的全文。',[
      row('调试显示',segments(config.debugView,[['off','关闭'],['common','常用'],['raw','原始']],debugView => update({debugView,showDebug:debugView !== 'off'}),!ready)),
      row('默认状态',segments(config.debugExpanded ? 'expanded' : 'collapsed',[['collapsed','折叠'],['expanded','展开']],value => update({debugExpanded:value === 'expanded'}),!ready)),
    ]),
    section('事件通知策略','默认只对「需要你回来」的事件常驻；可按事件改成不通知 / 自动消失 / 常驻。',[
      row('自动消失时间（秒）',h(TextField.Root,{type:'number',min:3,max:600,step:1,style:{width:'7.5rem'},value:config.autoHideSeconds,disabled:!ready,onChange:event => {
        const n=Number(event.target.value); if (Number.isFinite(n) && n >= 3 && n <= 600) update({autoHideSeconds:Math.round(n)},200)
      }})),
      ...EVENTS.map(([id,label]) => row(label,segments(config.eventModes[id],strategy,mode => update({eventModes:{...configRef.current.eventModes,[id]:mode}}),!ready))),
    ]),
    section('提示音','通知弹出时播放。自定义支持本地 wav / mp3 / ogg / flac。',[
      row('提示音模式',segments(config.soundMode,[['builtin','内置'],['custom','自定义'],['muted','静音']],soundMode => update({soundMode}),!ready)),
      config.soundMode !== 'muted' ? row('提示音音量',h('div',{className:'sound-volume'},h(Slider,{value:[config.soundVolume],min:0,max:1,step:.05,style:{width:'8rem'},disabled:!ready,onValueChange:([soundVolume]) => update({soundVolume},200)}),h('span',{className:'ed-unit'},`${Math.round(config.soundVolume*100)}%`))) : null,
      config.soundMode === 'custom' ? row('音频文件路径',h('div',{className:'sound-path'},h(TextField.Root,{className:'sound-input',value:config.soundPath,placeholder:'选择或输入本地音频文件',disabled:!ready,onChange:e => update({soundPath:e.target.value},500),onBlur:() => { if (dirty.current) void persist() }}),h(Button,{size:'2',onClick:() => void pickSoundFile(),disabled:!ready},'选择文件'))) : null,
      config.soundMode !== 'muted' ? row('试听',h(Button,{size:'2',onClick:() => void playPreview(),disabled:!ready},'预览')) : null,
    ]),
    section('调试卡片','弹出真实 Toast，方便看会话卡、工具批准和问答卡。问答卡可以点选项并提交。',[
      h('div',{className:'preview-row'},...[['stop','任务完成'],['working','调用工具中'],['tool','批准工具'],['ask','回答问题'],['ask-multi','多题问答']].map(([kind,label]) => h(Button,{key:kind,size:'2',loading:previewBusy === kind,disabled:!!previewBusy,onClick:() => void preview(kind)},label))),
    ]))
}
export { AgentNotifySettings as Settings }
