/** React component/hook contract tests. No browser, WebView, server, network or installed DSH. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..','..')
const flush=async () => {for(let i=0;i<40;i++)await Promise.resolve()}
const read=file => readFileSync(join(ROOT,file),'utf8').replace(/\r\n/g,'\n')

function harness(api={}) {
  const globals=['__CATRACE_REACT__','__CATRACE_RADIX__','__CATRACE_HEROUI__','__CATRACE_CREATE_PLUGIN_API__','document','window','fetch','setTimeout','clearTimeout','setInterval','clearInterval']
  const before=new Map(globals.map(key => [key,{present:Object.hasOwn(globalThis,key),value:globalThis[key]}]))
  const instances=new Map()
  const timeouts=new Map()
  const intervals=new Map()
  let timerId=0,current=null,effects=[],disposed=false
  const changed=(left,right) => !left || !right || left.length!==right.length || right.some((value,index) => !Object.is(value,left[index]))
  globalThis.__CATRACE_REACT__={
    createElement:(type,props,...children) => ({type,key:props?.key,props:{...props,children}}),
    useState(initial) {
      const instance=current,index=instance.cursor++
      if(!instance.slots[index])instance.slots[index]={value:typeof initial==='function' ? initial() : initial}
      const slot=instance.slots[index]
      return [slot.value,next => {slot.value=typeof next==='function' ? next(slot.value) : next}]
    },
    useRef(initial) {const index=current.cursor++;return current.slots[index] ||= {current:initial}},
    useEffect(effect,deps) {
      const instance=current,index=instance.cursor++,old=instance.slots[index]
      if(!old || changed(old.deps,deps)) {
        const slot={deps};instance.slots[index]=slot
        effects.push(() => {old?.cleanup?.();slot.cleanup=effect()})
      }
    },
  }
  globalThis.__CATRACE_RADIX__={Button:'RadixButton',Badge:'RadixBadge',Switch:'RadixSwitch',TextField:{Root:'RadixTextField'},TextArea:'RadixTextArea',Tooltip:'RadixTooltip'}
  // 设置页走宿主注入的 HeroUI 扁平导出；stub 成字符串组件类型即可按类型断言。
  globalThis.__CATRACE_HEROUI__={
    AlertRoot:'HeroAlert',AlertIndicator:'HeroAlertIndicator',AlertContent:'HeroAlertContent',AlertDescription:'HeroAlertDescription',
    Button:'HeroButton',Chip:'HeroChip',Input:'HeroInput',
    NumberFieldRoot:'HeroNumberFieldRoot',NumberFieldGroup:'HeroNumberFieldGroup',NumberFieldInput:'HeroNumberFieldInput',
    NumberFieldIncrementButton:'HeroNumberFieldIncrementButton',NumberFieldDecrementButton:'HeroNumberFieldDecrementButton',
    SwitchRoot:'HeroSwitchRoot',SwitchContent:'HeroSwitchContent',SwitchControl:'HeroSwitchControl',SwitchThumb:'HeroSwitchThumb',
    TextArea:'HeroTextArea',ToggleButton:'HeroToggleButton',TooltipRoot:'HeroTooltipRoot',TooltipContent:'HeroTooltipContent',
  }
  globalThis.__CATRACE_CREATE_PLUGIN_API__=() => ({
    config:{get:async () => ({}),set:async () => {}},sidecar:{request:async () => ({contract:7,config:{},flat:[]})},
    dialog:{pickFolder:async () => null},shell:{openExternal:async () => {}},theme:{css:css => css},...api,
  })
  globalThis.document={visibilityState:'visible',head:{appendChild:() => {}},getElementById:() => null,createElement:() => ({})}
  globalThis.setTimeout=fn => {const id=++timerId;timeouts.set(id,fn);return id}
  globalThis.clearTimeout=id => timeouts.delete(id)
  globalThis.setInterval=fn => {const id=++timerId;intervals.set(id,fn);return id}
  globalThis.clearInterval=id => intervals.delete(id)
  globalThis.window={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval}
  globalThis.fetch=async () => {throw new Error('Unexpected real HTTP request')}
  function expand(node,path) {
    if(Array.isArray(node))return node.map((child,index) => expand(child,`${path}/${child?.key ?? index}`))
    if(!node || typeof node!=='object')return node
    if(typeof node.type==='function') {
      const id=`${path}:${node.type.name}:${node.key ?? ''}`
      const instance=instances.get(id) || {cursor:0,slots:[]}
      instances.set(id,instance);instance.cursor=0
      const parent=current;current=instance
      let result
      try {result=node.type(node.props)}finally {current=parent}
      return expand(result,`${id}/output`)
    }
    return {...node,props:{...node.props,children:expand(node.props?.children,`${path}/children`)}}
  }
  return {
    async load(file) {
      const source=`const plugin=globalThis.__CATRACE_CREATE_PLUGIN_API__('dsh-chat')\n${read(file)}\n// ${Math.random()}`
      return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
    },
    render(component,props={}) {
      const tree=expand({type:component,props},'root')
      const pending=effects;effects=[];for(const effect of pending)effect()
      return tree
    },
    async timers() {const pending=[...timeouts.values()];timeouts.clear();for(const fn of pending)fn();await flush()},
    async dispose() {
      if(disposed)return
      disposed=true
      for(const instance of instances.values())for(const slot of instance.slots)slot?.cleanup?.()
      await flush()
      assert.equal(intervals.size,0,'component unmount must dispose polling')
      for(const [key,previous] of before) {if(previous.present)globalThis[key]=previous.value;else delete globalThis[key]}
    },
  }
}
function nodes(node,predicate,found=[]) {
  if(Array.isArray(node)){for(const child of node)nodes(child,predicate,found);return found}
  if(!node || typeof node!=='object')return found
  if(predicate(node))found.push(node)
  nodes(node.props?.children,predicate,found)
  return found
}
function text(node) {
  if(node==null || node===false)return ''
  if(typeof node==='string'||typeof node==='number')return String(node)
  if(Array.isArray(node))return node.map(text).join(' ')
  return [node.props?.className,node.props?.title,node.props?.placeholder,text(node.props?.children)].filter(Boolean).join(' ')
}
const click=node => node.props.onClick?.({stopPropagation(){},preventDefault(){}})
const button=(tree,label) => nodes(tree,node => node.type==='HeroButton' || node.type==='RadixButton' || node.type==='button').find(node => text(node.props.children)===label)
const chips=tree => nodes(tree,node => typeof node.props?.['aria-pressed']==='boolean' && String(node.props.className || '').includes('__chip'))
const controls=(tree,type) => nodes(tree,node => node.type===type)

async function settingsHarness(t,api={}) {
  const h=harness(api);t.after(() => h.dispose())
  const mod=await h.load('settings.mjs')
  assert.equal(typeof mod.default,'function')
  assert.equal(mod.Settings,mod.default)
  h.render(mod.default);await flush()
  return {...h,mod,render:() => h.render(mod.default)}
}

test('React window card: missing GUI URL gives actionable fallback; GUI iframe and callbacks remain intact',async t => {
  let closed=0
  const opened=[]
  const h=harness({shell:{openExternal:async url => opened.push(url)}});t.after(() => h.dispose())
  const mod=await h.load('ui.mjs')
  assert.equal(typeof mod.default,'function');assert.equal(mod.Card,mod.default)
  const fallback=h.render(mod.default,{event:{title:'DSH 对话',payload:{}},onClose:() => closed++})
  assert.match(text(fallback),/dsh-chat-card/);assert.match(text(fallback),/重新展开官方界面/)
  assert.equal(nodes(fallback,node => node.type==='iframe').length,0)
  click(button(fallback,'×'));assert.equal(closed,1)
  const url='http://127.0.0.1:23458/?dshw-session=s1'
  const tree=h.render(mod.default,{event:{title:'第二个会话',payload:{guiUrl:url,guiTitle:'第二个会话',guiSessionId:'s1'}}})
  assert.match(text(tree),/第二个会话/)
  const frame=nodes(tree,node => node.type==='iframe')[0]
  assert.equal(frame.props.src,url);assert.equal(frame.props.allow,'clipboard-read; clipboard-write')
  assert.equal(frame.props.sandbox,undefined)
  click(button(tree,'↗'));await flush();assert.deepEqual(opened,[url])
})

test('React notice card: running/error labels, preview, iframe expansion and manual collapse survive republishing',async t => {
  const calls=[]
  let closed=0
  const h=harness();t.after(() => h.dispose())
  globalThis.fetch=async (url,init) => {
    calls.push({url,init,body:JSON.parse(init.body)})
    return {ok:true,json:async () => ({ok:true,result:url.endsWith('/gui') ? {guiUrl:'http://127.0.0.1:23458/?dshw-session=s1'} : {ok:true}})}
  }
  const mod=await h.load('ui.mjs')
  const event={event_type:'dsh-chat.notice',title:'整理三点结论',payload:{notice:true,sessionId:'s1',status:'running',preview:'最新的输出文本',httpPort:23457,httpToken:'secret'}}
  const props=() => ({event,onClose:() => closed++})
  let tree=h.render(mod.default,props())
  for(const keyword of ['整理三点结论','进行中','is-running','dsh-chat-notice__statusline','最新的输出文本'])assert.ok(text(tree).includes(keyword),keyword)
  assert.ok(!text(tree).includes('发送'))
  event.payload={...event.payload,status:'error'}
  tree=h.render(mod.default,props());assert.match(text(tree),/is-error/);assert.match(text(tree),/处理失败/)
  event.payload={...event.payload,status:'waiting',statusLabel:'等你审批',waitKind:'approval',autoExpand:true}
  h.render(mod.default,props());await flush();tree=h.render(mod.default,props())
  assert.equal(nodes(tree,node => node.type==='iframe').length,1,'waiting automatically opens official GUI')
  assert.equal(calls.find(call => call.url.endsWith('/gui')).init.headers['X-Dsh-Chat-Token'],'secret')
  click(button(tree,'收起'));await flush();tree=h.render(mod.default,props())
  assert.equal(nodes(tree,node => node.type==='iframe').length,0)
  event.payload={...event.payload,autoExpand:false};h.render(mod.default,props())
  event.payload={...event.payload,autoExpand:true};tree=h.render(mod.default,props());await flush();tree=h.render(mod.default,props())
  assert.equal(nodes(tree,node => node.type==='iframe').length,0,'same waiting reason must not override manual collapse')
  const preview=nodes(tree,node => String(node.props?.className || '').includes('__preview'))[0]
  click(preview);await flush();tree=h.render(mod.default,props())
  assert.equal(nodes(tree,node => node.type==='iframe').length,1,'manual reopen obtains fresh URL')
  assert.equal(calls.filter(call => call.url.endsWith('/gui')).length,2)
  assert.ok(calls.some(call => call.url.endsWith('/notice/view') && call.body.expanded===false))
  click(button(tree,'×'));assert.equal(closed,1)
})

test('React settings: all appearance keys and custom CSS are loaded, edited, saved and pushed without duplicate writes',async t => {
  const saved=[],rpc=[]
  const h=await settingsHarness(t,{
    config:{get:async () => ({}),set:async config => saved.push(config)},
    sidecar:{request:async (method,params) => {rpc.push({method,params});return {contract:7,config:{},flat:[{group:'整体',selector:'[class*="_header"]',desc:'官方顶栏'}]}}},
  })
  let tree=h.render()
  assert.equal(chips(tree).length,4);assert.equal(controls(tree,'HeroToggleButton').length,4);assert.equal(controls(tree,'HeroSwitchRoot').length,2)
  const chipByLabel=label => chips(h.render()).find(node => text(node.props.children)===label)
  assert.ok(!text(tree).includes('对话/轨迹 标签'))
  chipByLabel('官方顶栏').props.onChange(true);tree=h.render();assert.ok(text(tree).includes('对话/轨迹 标签'))
  assert.ok(!text(tree).includes('「…」更多操作'))
  chipByLabel('顶栏右侧图标').props.onChange(true);tree=h.render();assert.equal(chips(tree).length,11)
  // 数字输入是 HeroUI 默认 NumberField：三个字段、secondary、−/+ 步进范围正确；越界值不落盘。
  const numRoots=controls(tree,'HeroNumberFieldRoot')
  assert.equal(numRoots.length,3)
  const numByKey=key => controls(h.render(),'HeroNumberFieldRoot').find(node => node.props['aria-label']===key)
  const portField=numByKey('httpPort')
  assert.equal(portField.props.value,23457);assert.equal(portField.props.variant,'secondary')
  assert.equal(portField.props.minValue,0);assert.equal(portField.props.maxValue,65535);assert.equal(portField.props.step,1)
  assert.equal(numByKey('noticePollMs').props.step,100)
  assert.equal(numByKey('noticePollMs').props.minValue,500);assert.equal(numByKey('noticePollMs').props.maxValue,30000)
  for(const input of controls(tree,'HeroNumberFieldInput'))assert.equal(typeof input.props.onBlur,'function')
  numByKey('noticePollMs').props.onChange(3000)
  numByKey('httpPort').props.onChange(99999) // 越界：不写表单（等失焦夹回）
  for(const chip of chips(tree))if(chip.props['aria-pressed'])chip.props.onChange(false)
  for(const control of controls(h.render(),'HeroSwitchRoot'))control.props.onChange(false)
  const cssInput=controls(h.render(),'HeroTextArea')[0]
  assert.ok(cssInput);cssInput.props.onChange({target:{value:'/* marker */'}})
  await h.timers()
  assert.ok(saved.length>0)
  const last=saved.at(-1)
  const expected=['showRail','showHeader','showTabs','showHeaderIcons','showHeaderMore','showHeaderPanel','showHeaderTitle','showHeaderChips','showComposerStatus','showMessageMeta','showHeaderLabels','compactSpacing','noticeEnabled']
  for(const key of expected)assert.equal(last[key],false,`must persist ${key}=false`)
  assert.equal(last.noticePollMs,3000,'NumberField 改动要能落盘')
  assert.equal(last.httpPort,23457,'越界数字不应落盘')
  assert.equal(last.customCss,'/* marker */')
  const block=read('settings.mjs').match(/const DEFAULTS = \{([\s\S]*?)\n\}/)[1]
  const keys=[...block.matchAll(/^\s*([A-Za-z]\w*):/gm)].map(match => match[1])
  assert.ok(keys.length>=10);for(const key of keys)assert.ok(key in last,`missing default key ${key}`)
  assert.deepEqual(rpc.filter(call => call.method==='applyConfig').at(-1).params.config,last)
  const count=saved.length
  controls(h.render(),'HeroTextArea')[0].props.onChange({target:{value:'/* marker */'}})
  await h.timers();assert.equal(saved.length,count,'same normalized config must not write again')
  click(button(h.render(),'插入'));await h.timers();assert.match(saved.at(-1).customCss,/\[class\*="_header"\] \{/)
  click(button(h.render(),'清空'));await h.timers();assert.equal(saved.at(-1).customCss,'')
})

test('React settings: status, polling controls, notices, appearance and CSS help remain present',async t => {
  const h=await settingsHarness(t)
  const tree=h.render(),output=text(tree)
  for(const keyword of ['运行状态','小窗外观','状态通知','测试卡','状态卡端口','小窗页面端口','DSH 数据目录','运行环境','处理失败','紧凑留白','全部显示','恢复推荐','自定义样式（CSS）与 class 速查'])assert.ok(output.includes(keyword),keyword)
  for(const removed of ['对话（向 DSH 提问）','DSH 会话','跟随最新','固定到镜像卡','展开默认','显示条数','轮询间隔','打开小窗','小窗标题','启用即弹出','GUI 复用状态','已连上 DSH','本机服务','本机端口','官方界面端口','DSH 主目录','巡检间隔','后台服务','完成后停留','刷新状态'])assert.ok(!output.includes(removed),removed)
  for(const input of controls(tree,'HeroInput')) {assert.equal(typeof input.props.onChange,'function');assert.equal(typeof input.props.onBlur,'function');assert.ok('value' in input.props)}
  // 数字输入：HeroUI 扁平 NumberField（Root 受控 value/onChange，Input 负责 onBlur 保存）。
  const numRoots=controls(tree,'HeroNumberFieldRoot')
  assert.equal(numRoots.length,3)
  for(const num of numRoots) {assert.equal(num.props.variant,'secondary');assert.equal(typeof num.props.onChange,'function');assert.ok('value' in num.props);assert.equal(typeof num.props.minValue,'number');assert.equal(typeof num.props.maxValue,'number')}
  for(const input of controls(tree,'HeroNumberFieldInput'))assert.equal(typeof input.props.onBlur,'function')
  for(const type of ['HeroNumberFieldGroup','HeroNumberFieldDecrementButton','HeroNumberFieldIncrementButton'])assert.ok(controls(tree,type).length>=3,type)
})

test('React settings: unmount flushes dirty config and stops polling',async t => {
  const saved=[]
  const h=await settingsHarness(t,{config:{get:async () => ({}),set:async config => saved.push(config)}})
  controls(h.render(),'HeroTextArea')[0].props.onChange({target:{value:'/* pending */'}})
  await h.dispose()
  assert.equal(saved.at(-1).customCss,'/* pending */')
})
