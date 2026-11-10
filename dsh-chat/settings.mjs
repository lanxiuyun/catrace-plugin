/** DSH settings: React controls, saved configuration and sidecar status. */
const { createElement: h, useState, useRef, useEffect } = globalThis.__CATRACE_REACT__ || {}
const { Button, Badge, Switch, TextField, TextArea, Tooltip } = globalThis.__CATRACE_RADIX__ || {}
if (typeof h !== 'function' || !Button) throw new Error('Catrace React/Radix runtime missing')

const STYLE_ID = 'dsh-chat-settings-style'

/** RPC 契约版本：与 runtime/main.mjs 的 CONTRACT_VERSION 必须一致（改动 RPC 就两边一起 +1） */
const CONTRACT_VERSION = 7

/**
 * 默认值（必须与 runtime/lib/config.mjs 的 DEFAULT_CONFIG 一致；
 * plugin-contract.test.mjs 会比对这两处，防止漂移）。
 */
const DEFAULTS = {
  dshHome: '',
  // 状态通知（与 runtime/lib/config.mjs 的 DEFAULT_CONFIG 逐键一致）
  noticeEnabled: true,
  noticePollMs: 2000,
  httpPort: 23457,
  guiPort: 23458,
  compactSpacing: false,
  // 小窗里"显示哪些元素"（true = 显示）；与 runtime/lib/config.mjs 的 DEFAULT_CONFIG 逐键一致
  showRail: false,
  showHeader: false,
  showTabs: false,
  showHeaderIcons: false,
  showHeaderMore: true,
  showHeaderPanel: true,
  showHeaderTitle: false,
  showHeaderChips: true,
  showComposerStatus: false,
  showMessageMeta: false,
  showHeaderLabels: false,
  customCss: '',
}

const LIMITS = {
  noticePollMs: { min: 500, max: 30000 },
  httpPort: { min: 0, max: 65535 },
  guiPort: { min: 0, max: 65535 },
}

const SETTINGS_CSS = `
.dsh-chat-settings { display: flex; flex-direction: column; gap: 1rem; font-size: 0.8125rem; min-width: 0; }
.dsh-chat-settings__card {
  border: 1px solid var(--ct-border, rgba(0,0,0,0.08)); border-radius: 0.75rem;
  padding: 0.25rem 1rem 0.75rem; display: flex; flex-direction: column;
  background: var(--ct-surface, #fff); min-width: 0;
}
.dsh-chat-settings__head { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 0 0.25rem; }
.dsh-chat-settings__head-title { font-weight: 600; font-size: 0.875rem; color: var(--ct-text, #2e1065); }
.dsh-chat-settings__head-actions { margin-left: auto; display: flex; align-items: center; gap: 0.25rem; }
.dsh-chat-settings__head-desc { color: var(--ct-text-muted, #8a94a6); font-size: 0.75rem; padding-bottom: 0.375rem; line-height: 1.5; }
/* 小窗外观：chip 分组 */
.dsh-chat-settings__group { padding: 0.375rem 0 0.25rem; }
.dsh-chat-settings__tags { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.5rem; padding: 0.25rem 0 0.375rem; }
/* 外观 chip 的描边与底色在浅色和深色主题下都保持可辨。 */
.dsh-chat-settings__chip {
  border-radius: 999px !important;
  padding: 0.125rem 0.625rem !important;
  line-height: 1.6 !important;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s, color 0.15s;
}
.dsh-chat-settings__chip:not(.is-on) {
  border: 1px solid rgba(124, 58, 237, 0.38) !important;
  background: rgba(124, 58, 237, 0.07) !important;
  color: var(--ct-text, #2e1065) !important;
}
.dsh-chat-settings__chip:not(.is-on):hover { border-color: rgba(124, 58, 237, 0.8) !important; background: rgba(124, 58, 237, 0.14) !important; }
.dsh-chat-settings__chip.is-on { border: 1px solid transparent !important; }
/* 全宽块（自定义 CSS 区这类内容用） */
.dsh-chat-settings__block { display: flex; flex-direction: column; gap: 0.375rem; }
.dsh-chat-settings__block-title { font-weight: 600; font-size: 0.8125rem; color: var(--ct-text, #2e1065); }
.dsh-chat-settings__block-desc { font-size: 0.75rem; color: var(--ct-text-muted, #8a94a6); line-height: 1.5; overflow-wrap: anywhere; }
.dsh-chat-settings__block-actions { display: flex; gap: 0.375rem; }
/* class 速查表 */
.dsh-chat-settings__cls-note { font-size: 0.75rem; color: var(--ct-text-muted, #8a94a6); line-height: 1.5; padding-bottom: 0.375rem; }
.dsh-chat-settings__cls-note.is-warn { color: #b45309; background: rgba(245, 158, 11, 0.08); border-radius: 0.375rem; padding: 0.5rem 0.625rem; margin-top: 0.5rem; }
.dsh-chat-settings__cls-group { font-size: 0.75rem; font-weight: 600; color: var(--ct-text-muted, #8a94a6); padding: 0.5rem 0 0.125rem; }
.dsh-chat-settings__cls-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.125rem 0; min-width: 0; }
.dsh-chat-settings__cls-selector { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.6875rem; color: var(--ct-text, #2e1065); flex: 0 0 auto; }
.dsh-chat-settings__cls-desc { font-size: 0.6875rem; color: var(--ct-text-muted, #8a94a6); flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.dsh-chat-settings__code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; overflow-wrap: anywhere; }
.dsh-chat-settings__muted { color: var(--ct-text-muted, #8a94a6); font-size: 0.75rem; overflow-wrap: anywhere; }
/* 带输入框的行：标题/控件一行，说明整行长在下面（对窄面板安全，见 settings.mjs 的 field() 注释） */
.dsh-chat-settings__field { padding: 0.625rem 0; display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
.dsh-chat-settings__field-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-width: 0; }
.dsh-chat-settings__field-title { font-size: 0.875rem; font-weight: 600; color: var(--ct-text, #2e1065); min-width: 0; }
.dsh-chat-settings__field-control { display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem; flex: 0 1 auto; min-width: 0; max-width: 100%; }
.dsh-chat-settings__field-desc { font-size: 0.75rem; color: var(--ct-text-muted, #8a94a6); line-height: 1.5; overflow-wrap: anywhere; }
.dsh-chat-settings__fold { min-width: 0; }
.dsh-chat-settings__fold > summary {
  cursor: pointer; list-style: none; color: var(--ct-text-muted, #8a94a6); font-size: 0.6875rem;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-chat-settings__fold > summary::-webkit-details-marker { display: none; }
.dsh-chat-settings__fold > summary::before { content: '▸ '; }
.dsh-chat-settings__fold[open] > summary::before { content: '▾ '; }
.dsh-chat-settings__fold-body {
  margin: 0.1875rem 0 0 0.5rem; padding-left: 0.5rem;
  border-left: 2px solid var(--ct-border, rgba(0,0,0,0.12));
  color: var(--ct-text-muted, #8a94a6); font-size: 0.75rem;
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
}
`

function ensureStyle() {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ID)
  if (existing) {
    if (existing.textContent !== SETTINGS_CSS) existing.textContent = plugin.theme.css(SETTINGS_CSS)
    return
  }
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = plugin.theme.css(SETTINGS_CSS)
  document.head.appendChild(style)
}

export default function DshChatSettings() {
  const [form,setForm] = useState(() => ({...DEFAULTS,noticePollMs:String(DEFAULTS.noticePollMs),httpPort:String(DEFAULTS.httpPort),guiPort:String(DEFAULTS.guiPort)}))
  const formRef = useRef(form)
  const [ready,setReady] = useState(false)
  const [loadError,setLoadError] = useState('')
  const [status,setStatus] = useState(null)
  const [noticeInfo,setNoticeInfo] = useState(null)
  const [guiClasses,setGuiClasses] = useState([])
  const [guiClassesError,setGuiClassesError] = useState('')
  const [feedback,setFeedback] = useState(null)
  const alive = useRef(true)
  const saveTimer = useRef(null)
  const savedJson = useRef(null)
  const saveQueue = useRef(Promise.resolve())
  const dirty = useRef(false)
  const numKeys = ['noticePollMs','httpPort','guiPort']
  const message = (text,error=false) => { if(alive.current)setFeedback({text,error}) }
  const errorText = error => error?.message || String(error)
  async function call(method,params={}) {
    if(typeof plugin.sidecar?.request !== 'function') throw new Error('插件运行时不可用（sidecar 未连接）')
    return plugin.sidecar.request(method,params)
  }
  function clamp(text,key) {
    const value=Number(String(text).trim())
    return Number.isFinite(value) ? Math.min(LIMITS[key].max,Math.max(LIMITS[key].min,Math.round(value))) : DEFAULTS[key]
  }
  function compose() {
    const output={}
    for(const [key,fallback] of Object.entries(DEFAULTS)) {
      output[key]=numKeys.includes(key) ? clamp(formRef.current[key],key) : typeof fallback === 'boolean' ? Boolean(formRef.current[key]) : String(formRef.current[key] ?? fallback).trim()
    }
    return output
  }
  function saveNow() {
    if(saveTimer.current)clearTimeout(saveTimer.current)
    saveTimer.current=null
    const sourceForm={...formRef.current}
    const snapshot=compose()
    const json=JSON.stringify(snapshot)
    dirty.current=false
    const save=saveQueue.current.catch(() => {}).then(async () => {
      if(json === savedJson.current)return
      await plugin.config.set(snapshot)
      try { await call('applyConfig',{config:snapshot}) }
      catch(error) { message(`配置已保存，但推给 sidecar 失败（可能需要重开插件）：${errorText(error)}`,true) }
      savedJson.current=json
      if(alive.current) {
        const normalized={...formRef.current}
        for(const key of numKeys) if(formRef.current[key] === sourceForm[key])normalized[key]=String(snapshot[key])
        formRef.current=normalized
        setForm(normalized)
      }
    })
    saveQueue.current=save
    return save.catch(error => message(`保存失败：${errorText(error)}`,true))
  }
  function scheduleSave() {
    dirty.current=true
    if(saveTimer.current)clearTimeout(saveTimer.current)
    saveTimer.current=setTimeout(() => void saveNow(),500)
  }
  function update(patch) {
    formRef.current={...formRef.current,...patch}
    setForm(formRef.current)
    scheduleSave()
  }
  async function loadConfig() {
    if(alive.current)setLoadError('')
    try {
      const stored=await plugin.config.get()
      let effective=null
      try { effective=(await call('status'))?.config ?? null } catch {}
      const merged={...DEFAULTS,...(stored && typeof stored === 'object' ? stored : {}),...(effective || {})}
      const loaded={}
      for(const [key,fallback] of Object.entries(DEFAULTS))loaded[key]=numKeys.includes(key) ? String(merged[key] ?? fallback) : typeof fallback === 'boolean' ? Boolean(merged[key] ?? fallback) : String(merged[key] ?? fallback)
      if(!alive.current)return
      formRef.current=loaded
      setForm(loaded)
      savedJson.current=JSON.stringify(compose())
      setReady(true)
    } catch(error) { if(alive.current)setLoadError(errorText(error)) }
  }
  async function loadStatus() {
    try { const result=await call('status');if(alive.current)setStatus(result) }
    catch(error) { if(alive.current)setStatus({lastError:errorText(error)}) }
  }
  async function loadNoticeStatus() {
    try { const result=await call('noticeStatus');if(alive.current)setNoticeInfo(result) }
    catch(error) { if(alive.current)setNoticeInfo({error:errorText(error)}) }
  }
  async function loadGuiClasses() {
    try {
      const result=await call('guiClasses')
      const rows=Array.isArray(result?.flat) ? result.flat : []
      if(alive.current){setGuiClasses(rows);setGuiClassesError(rows.length ? '' : 'sidecar 返回了空清单')}
    } catch(error) { if(alive.current){setGuiClasses([]);setGuiClassesError(errorText(error))} }
  }
  useEffect(() => {
    alive.current=true
    ensureStyle()
    void loadConfig()
    void loadStatus()
    void loadNoticeStatus()
    void loadGuiClasses()
    const timer=setInterval(() => {
      if(document.visibilityState === 'hidden')return
      void loadStatus();void loadNoticeStatus()
    },4000)
    return () => {alive.current=false;clearInterval(timer);if(saveTimer.current)clearTimeout(saveTimer.current);if(dirty.current)void saveNow()}
  },[])
  async function pickFolder() {
    try { const dir=await plugin.dialog.pickFolder();if(dir && alive.current){update({dshHome:dir});void saveNow()} }
    catch(error){message(errorText(error),true)}
  }
  async function sendNoticeDemo(kind) {
    try { await call('noticeDemo',{status:kind});message(`已发送「${{running:'进行中',done:'已完成',waiting:'等你处理',error:'处理失败'}[kind]}」测试卡到右下角`) }
    catch(error){message(`发送测试卡失败：${errorText(error)}`,true)}
  }
  const button=(label,onClick,options={}) => h(Button,{size:'2',variant:'soft',...options,onClick},label)
  const smallButton=(label,onClick) => button(label,onClick,{size:'1',variant:'ghost'})
  const tag=(label,color='gray') => h(Badge,{color},label)
  const field=(title,control,desc) => h('div',{className:'dsh-chat-settings__field',key:title},
    h('div',{className:'dsh-chat-settings__field-head'},h('div',{className:'dsh-chat-settings__field-title'},title),h('div',{className:'dsh-chat-settings__field-control'},...(Array.isArray(control) ? control : [control]))),
    desc ? h('div',{className:'dsh-chat-settings__field-desc'},desc) : null)
  const card=(title,desc,children,actions=[]) => h('section',{className:'dsh-chat-settings__card',key:title},
    h('div',{className:'dsh-chat-settings__head'},h('div',{className:'dsh-chat-settings__head-title'},title),h('div',{className:'dsh-chat-settings__head-actions'},...actions)),
    desc ? h('div',{className:'dsh-chat-settings__head-desc'},desc) : null,...children)
  const textInput=(key,placeholder='',width='16rem') => h(TextField.Root,{
    value:form[key],placeholder,size:'2',disabled:!ready,style:{width,minWidth:'7rem',flex:'0 1 auto'},
    onChange:event => update({[key]:event.target.value}),onBlur:() => {if(dirty.current)void saveNow()},
  })
  const numberInput=key => h(TextField.Root,{
    value:form[key],size:'2',inputMode:'numeric',disabled:!ready,style:{width:'8rem',flex:'0 1 auto'},
    onChange:event => update({[key]:event.target.value.replace(/[^\d]/g,'')}),
    onBlur:() => {const next=String(clamp(formRef.current[key],key));formRef.current={...formRef.current,[key]:next};setForm(formRef.current);if(dirty.current)void saveNow()},
  })
  const switchInput=key => h(Switch,{checked:Boolean(form[key]),disabled:!ready,'aria-label':key,onCheckedChange:value => update({[key]:value})})
  const ttlLabel=value => {
    const minutes=Math.round(Number(value)/60000)
    return !Number.isFinite(minutes)||minutes<=0 ? '—' : minutes>=1440 ? `${Math.round(minutes/1440)} 天` : minutes>=60 ? `${Math.round(minutes/60)} 小时` : `${minutes} 分钟`
  }
  const s=status || {}
  const actualPort=Number(s.httpPort)
  const changedPort=Number.isFinite(actualPort)&&actualPort>0&&actualPort!==Number(form.httpPort)
  const info=noticeInfo || {}
  const summary=info.error ? `读取状态失败：${info.error}` : info.loopRunning ? `正在盯着 DSH（每 ${info.pollMs ?? '—'}ms 看一眼，盯着 ${Array.isArray(info.sessions) ? info.sessions.length : 0} 个会话）` : info.enabled===false ? '状态通知已关闭' : '还没开始看（插件启用后自动开始）'
  const groups=[
    {items:[
      {key:'showRail',label:'左侧栏',tip:'官方左侧 56px 图标栏：鲸鱼 logo、新建会话、搜索、设置…'},
      {key:'showHeader',label:'官方顶栏',tip:'顶栏整条：会话标题、子智能体提示、对话/轨迹标签和右侧图标'},
      {key:'showComposerStatus',label:'输入区状态条',tip:'输入框下方的 tok/s、缓存命中、费用明细和上下文占比'},
      {key:'showMessageMeta',label:'消息操作行',tip:'每条消息的复制、点赞、分享、时间和本轮费用'},
    ]},
    {title:'顶栏内部：',visible:form.showHeader,items:[
      {key:'showTabs',label:'对话/轨迹 标签',tip:'顶栏里的两个页签'},
      {key:'showHeaderTitle',label:'官方标题',tip:'会话面包屑，与卡片标题重复，默认隐藏'},
      {key:'showHeaderChips',label:'子智能体/后台任务',tip:'子智能体和后台任务运行中提示'},
      {key:'showHeaderIcons',label:'顶栏右侧图标',tip:'文件夹下拉、更多操作和面板开关'},
      {key:'showHeaderLabels',label:'强制文字标签',tip:'窄宽时仍显示官方折叠为图标的文字，可能较挤'},
    ]},
    {title:'顶栏右侧图标内部：',visible:form.showHeader&&form.showHeaderIcons,items:[
      {key:'showHeaderMore',label:'「…」更多操作',tip:'仅更多操作按钮，文件夹下拉不受影响'},
      {key:'showHeaderPanel',label:'面板开关',tip:'打开右侧边栏按钮'},
    ]},
  ]
  const appearanceKeys=groups.flatMap(group => group.items.map(item => item.key))
  const appearance=(recommended=false) => update(Object.fromEntries(appearanceKeys.map(key => [key,recommended ? Boolean(DEFAULTS[key]) : true])))
  function insertCss(selector) {
    const skeleton=`${selector} {\n  \n}`
    update({customCss:formRef.current.customCss ? `${formRef.current.customCss.trimEnd()}\n${skeleton}` : skeleton})
  }
  const classRows=[]
  let currentGroup=''
  for(const item of guiClasses) {
    if(item.group!==currentGroup){currentGroup=item.group;classRows.push(h('div',{className:'dsh-chat-settings__cls-group',key:`group:${currentGroup}`},currentGroup))}
    classRows.push(h('div',{className:'dsh-chat-settings__cls-row',key:item.selector},h('code',{className:'dsh-chat-settings__cls-selector'},item.selector),h('span',{className:'dsh-chat-settings__cls-desc'},item.desc),button('插入',() => insertCss(item.selector),{size:'1',variant:'ghost',disabled:!ready})))
  }
  return h('div',{className:'dsh-chat-settings'},
    loadError ? h('div',{className:'dsh-chat-settings__cls-note is-warn',role:'alert'},`读取配置失败：${loadError}`,button('重试',() => void loadConfig())) : null,
    feedback ? h('div',{className:`dsh-chat-settings__cls-note${feedback.error ? ' is-warn' : ''}`,role:feedback.error ? 'alert' : 'status'},feedback.text) : null,
    status && Number(status.contract)!==CONTRACT_VERSION ? h('div',{className:'dsh-chat-settings__cls-note is-warn'},'插件侧车（runtime）的契约版本不一致：请关闭再开启插件以加载当前代码。') : null,
    card('运行状态','插件在后台观察 DSH；这里的信息每几秒自动刷新。端口与目录一般不用改。',[
      field('状态卡端口',numberInput('httpPort'),`状态卡与插件后台的数据通道（不是网页）。${changedPort ? `原端口被占用，现在实际在用 ${actualPort}。` : '被占用时自动换一个。'}0 = 自动分配。`),
      field('小窗页面端口',numberInput('guiPort'),'官方页面挂在这个端口上。固定端口可以保留页面状态；0 = 每次随机分配（页面状态会重置）。'),
      field('DSH 数据目录',[textInput('dshHome','留空 = 自动找 ~/.dsh','20rem'),button('选择',() => void pickFolder(),{disabled:!ready})],'会话日志和凭据都从这里读。'),
      field('运行环境',[tag(`Node ${s.node || '—'}`),tag(s.zstd===false ? 'zstd 不可用' : 'zstd 正常',s.zstd===false ? 'red' : 'green'),s.gui?.cookieTtlMs ? tag(`小窗票据 ${ttlLabel(s.gui.cookieTtlMs)}`) : null,s.gui?.cookieRefreshes>0 ? tag(`小窗票据已自动续期 ${s.gui.cookieRefreshes} 次`) : null],s.zstd===false ? 'zstd 用来解压 DSH 会话日志，需要 Node ≥ 22.15。' : 'zstd 用来解压 DSH 的会话日志。'),
      s.lastError ? h('div',{className:'dsh-chat-settings__cls-note is-warn',role:'alert'},`最近一次错误：${s.lastError}`) : null,
    ],[smallButton('刷新',() => {void loadStatus();void loadNoticeStatus();void loadGuiClasses()})]),
    card('状态通知','DSH 开始干活时弹可折叠状态卡；点正文原地展开官方界面，等你审批时自动展开。进行中、等你处理、已完成、处理失败均常驻，点 × 或下一轮开始时收场。',form.noticeEnabled ? [
      field('检查间隔(ms)',numberInput('noticePollMs'),`500–30000，当前 ${form.noticePollMs}`),
      field('测试卡',[['running','进行中'],['done','已完成'],['waiting','等你处理'],['error','处理失败']].map(([kind,label]) => h(Button,{key:kind,size:'2',variant:'soft',onClick:() => void sendNoticeDemo(kind)},label)),'发一张测试卡到右下角，观察折叠和展开。'),
      h('div',{className:'dsh-chat-settings__muted'},summary),
    ] : [],[switchInput('noticeEnabled')]),
    card('小窗外观','点亮 = 在小窗里显示，灰掉 = 隐藏。悬停看说明；改动在下次展开状态卡时生效。',[
      field('紧凑留白',switchInput('compactSpacing'),'把官方滚动区、输入框和消息间距收到小窗尺度，每侧留白从 32px 收到 16px，消息间距从 16px 收到 10px。'),
      ...groups.filter(group => group.visible!==false).map((group,index) => h('div',{className:'dsh-chat-settings__group',key:index},group.title ? h('div',{className:'dsh-chat-settings__group-title'},group.title) : null,
        h('div',{className:'dsh-chat-settings__tags'},...group.items.map(item => h(Tooltip,{key:item.key,content:`${item.label}：${item.tip}。点亮 = 在小窗里显示`,style:{maxWidth:'17rem',whiteSpace:'normal',overflowWrap:'anywhere'}},
          h(Button,{size:'1',variant:form[item.key] ? 'solid' : 'soft',className:`dsh-chat-settings__chip${form[item.key] ? ' is-on' : ''}`,'aria-pressed':Boolean(form[item.key]),disabled:!ready,onClick:() => update({[item.key]:!formRef.current[item.key]})},item.label)))))),
      h('details',{className:'dsh-chat-settings__fold'},h('summary',null,'自定义样式（CSS）与 class 速查'),h('div',{className:'dsh-chat-settings__fold-body'},
        h('div',{className:'dsh-chat-settings__block'},
          h('div',{className:'dsh-chat-settings__block-desc'},'追加注入到官方页面，排在内置规则之后。选择器用语义后缀，例如 [class*="_headerCorner"]。'),
          h(TextArea,{value:form.customCss,rows:6,resize:'vertical',disabled:!ready,placeholder:'例：\n[class*="_headerCorner"] { display: none !important; }',onChange:event => update({customCss:event.target.value}),onBlur:() => {if(dirty.current)void saveNow()}}),
          h('div',{className:'dsh-chat-settings__block-actions'},button('插入示例',() => update({customCss:`${formRef.current.customCss}${formRef.current.customCss ? '\n' : ''}[class*="_header"] { padding: 0 !important; }`}),{size:'1',disabled:!ready}),button('清空',() => update({customCss:''}),{size:'1',disabled:!ready})),
          guiClasses.length ? h('div',{className:'dsh-chat-settings__block'},h('div',{className:'dsh-chat-settings__cls-note'},'官方 class 带构建哈希前缀，用 [class*="_语义名"] 匹配；点「插入」添加规则骨架。'),...classRows)
            : h('div',{className:'dsh-chat-settings__cls-note is-warn'},`class 速查表没加载出来${guiClassesError ? `：${guiClassesError}` : ''}。请确认后台已运行当前代码。`,smallButton('重试',() => void loadGuiClasses()))))),
    ],[button('全部显示',() => appearance(false),{size:'1',variant:'ghost',disabled:!ready}),button('恢复推荐',() => appearance(true),{size:'1',variant:'ghost',disabled:!ready})]))
}
export { DshChatSettings as Settings }
