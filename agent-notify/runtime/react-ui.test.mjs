/** React component/hook contract tests. No browser, WebView, server, network or installed DSH. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..')
const flush=async () => {for(let i=0;i<40;i++)await Promise.resolve()}
const read=file => readFileSync(join(ROOT,file),'utf8').replace(/\r\n/g,'\n')

function harness(api={}) {
  const globals=['__CATRACE_REACT__','__CATRACE_RADIX__','__CATRACE_HEROUI__','__CATRACE_SETTINGS_UI__','__CATRACE_CREATE_PLUGIN_API__','document','window','fetch','setTimeout','clearTimeout','setInterval','clearInterval']
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
  globalThis.__CATRACE_RADIX__={Button:'RadixButton',Badge:'RadixBadge',Switch:'RadixSwitch',TextField:{Root:'RadixTextField'},TextArea:'RadixTextArea',Tooltip:'RadixTooltip',Slider:'RadixSlider',SegmentedControl:{Root:'RadixSegments',Item:'RadixSegment'}}
  const HeroNumberField=Object.assign('HeroNumberField',{Group:'HeroNumberFieldGroup',Input:'HeroNumberFieldInput',IncrementButton:'HeroNumberFieldIncrement',DecrementButton:'HeroNumberFieldDecrement'})
  globalThis.__CATRACE_HEROUI__={AlertRoot:'HeroAlert',AlertIndicator:'HeroAlertIndicator',AlertContent:'HeroAlertContent',AlertDescription:'HeroAlertDescription',Button:'HeroButton',Chip:'HeroChip',Input:'HeroInput',NumberField:HeroNumberField,SliderRoot:'HeroSlider',SliderTrack:'HeroSliderTrack',SliderFill:'HeroSliderFill',SliderThumb:'HeroSliderThumb',ToggleButton:'HeroToggleButton',ToggleButtonGroup:'HeroToggleButtonGroup',ToggleButtonGroupSeparator:'HeroToggleButtonGroupSeparator'}
  globalThis.__CATRACE_SETTINGS_UI__={
    SettingsCard:'HostSettingsCard',
    SettingsCardRow:props => globalThis.__CATRACE_REACT__.createElement('HostSettingsCardRow',props,props.control,...props.children),
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
      const source=`const plugin=globalThis.__CATRACE_CREATE_PLUGIN_API__('agent-notify')\n${read(file)}\n// ${Math.random()}`
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
const labelText=node => node==null || node===false ? '' : Array.isArray(node) ? node.map(labelText).join('') : typeof node==='object' ? labelText(node.props?.children) : String(node)
const button=(tree,label) => nodes(tree,node => node.type==='HeroButton' || node.type==='RadixButton' || node.type==='button').find(node => labelText(node.props.children)===label)
const chips=tree => nodes(tree,node => typeof node.props?.['aria-pressed']==='boolean' && String(node.props.className || '').includes('__chip'))
const controls=(tree,type) => nodes(tree,node => node.type===type)

test('Agent React surfaces are self-contained functions, with reactive settings and all Hook/config controls',async t => {
  const saved=[],rpc=[]
  const h=harness({
    config:{get:async () => ({customMarker:'keep',soundVolume:0}),set:async config => saved.push(config)},
    sidecar:{request:async (method,params) => {rpc.push({method,params});return method==='listAgents' ? [{id:'claude',detected:true,installed:false},{id:'kimi',detected:false,installed:false}] : {}}},
  });t.after(() => h.dispose())
  const mod=await h.load('settings.mjs')
  assert.equal(typeof mod.default,'function');assert.equal(mod.Settings,mod.default)
  h.render(mod.default);await flush()
  let tree=h.render(mod.default)
  for(const label of ['Agent 联动','事件通知策略','调试','提示音','任务完成','调用工具中','批准工具','回答问题','多题问答','Claude Code','Kimi'])assert.ok(text(tree).includes(label),label)
  assert.equal(controls(tree,'HeroSlider')[0].props.value,0)
  const segment=controls(tree,'HeroToggleButtonGroup')[0]
  segment.props.onSelectionChange(new Set(['raw']));await flush()
  assert.equal(saved.at(-1).debugView,'raw');assert.equal(saved.at(-1).showDebug,true)
  assert.equal(saved.at(-1).customMarker,'keep')
  assert.equal(Object.keys(saved.at(-1).eventModes).length,9)
  assert.ok(rpc.some(call => call.method==='setConfig'))
  click(button(tree,'安装 Hook'));await flush();assert.ok(rpc.some(call => call.method==='install'&&call.params.agent==='claude'))
  click(button(tree,'多题问答'));await flush();assert.ok(rpc.some(call => call.method==='testCard'&&call.params.kind==='ask-multi'))
  for(const file of ['settings.mjs','ui.mjs']) {
    assert.match(read(file),/export default function/)
    assert.doesNotMatch(read(file),/__CATRACE_VUE__|__CATRACE_NAIVE__|^import\s/m)
  }
})

test('Agent settings use shared cards and rows without wrapping native notes or previews',async t => {
  const h=harness({sidecar:{request:async () => [{id:'claude',detected:true,installed:false},{id:'kimi',detected:false,installed:false}]}})
  t.after(() => h.dispose())
  const mod=await h.load('settings.mjs')
  h.render(mod.default);await flush()
  const tree=h.render(mod.default)
  const cards=controls(tree,'HostSettingsCard')
  assert.deepEqual(cards.map(card => card.props.title),['Agent 联动','调试','事件通知策略','提示音','调试卡片'])
  assert.ok(cards.every(card => typeof card.props.description==='string' && card.props.description.length>0))
  const rows=card => controls(card,'HostSettingsCardRow')
  assert.deepEqual(rows(cards[0]).map(row => row.props.title),['Claude Code','未检测到'])
  assert.deepEqual(rows(cards[1]).map(row => row.props.title),['调试显示','默认状态'])
  assert.equal(rows(cards[2]).length,10)
  assert.deepEqual(rows(cards[3]).map(row => row.props.title),['提示音模式','提示音音量','试听'])
  assert.ok(rows(tree).every(row => row.props.control))
  assert.equal(rows(cards[4]).length,0)
  assert.equal(controls(cards[4],'HeroButton').length,5)
  assert.equal(cards[4].props.children.filter(Boolean)[0].type,'div')
  assert.doesNotMatch(read('settings.mjs'),/section-card|section-head|section-title|section-desc|event-row|event-copy|event-title|event-desc|--an-card-bg/)
})

test('Agent settings keep native empty-detection notes outside shared rows',async t => {
  const h=harness({sidecar:{request:async () => []}});t.after(() => h.dispose())
  const mod=await h.load('settings.mjs')
  h.render(mod.default);await flush()
  const card=controls(h.render(mod.default),'HostSettingsCard')[0]
  assert.equal(controls(card,'HostSettingsCardRow').length,0)
  assert.match(text(card),/未检测到 AI Agent/)
  assert.equal(card.props.children.filter(Boolean)[0].type,'p')
})

test('Agent settings label controls and keep custom audio input disabled semantics and saving',async t => {
  const saved=[]
  const h=harness({config:{get:async () => ({soundMode:'custom',soundPath:'old.wav',customMarker:'keep'}),set:async value => saved.push(value)}})
  t.after(() => h.dispose())
  const mod=await h.load('settings.mjs')
  const initial=h.render(mod.default)
  const groups=controls(initial,'HeroToggleButtonGroup')
  assert.deepEqual(groups.map(node => node.props['aria-label']),['调试显示','默认状态',...['会话开始','开始思考','调用工具中','工具调用完成','工具调用失败','任务完成','任务出错 / 异常','等待交互','权限请求'],'提示音模式'])
  assert.ok(groups.every(node => node.props.isDisabled===true))
  assert.equal(controls(initial,'HeroSlider')[0].props['aria-label'],'提示音音量')
  assert.equal(controls(initial,'HeroSlider')[0].props.isDisabled,true)
  await flush()
  const ready=h.render(mod.default)
  const input=controls(ready,'HeroInput')[0]
  assert.equal(input.props['aria-label'],'音频文件路径')
  assert.equal(input.props.disabled,false)
  assert.equal(Object.hasOwn(input.props,'isDisabled'),false)
  assert.ok(controls(ready,'HeroToggleButtonGroup').every(node => node.props.isDisabled===false))
  input.props.onChange({target:{value:'new.wav'}})
  assert.equal(saved.length,0,'file path still uses debounced saving')
  input.props.onBlur();await flush()
  assert.equal(saved.at(-1).soundPath,'new.wav')
  assert.equal(saved.at(-1).soundMode,'custom')
  assert.equal(saved.at(-1).customMarker,'keep')
})

test('Agent settings require the latest shared settings UI runtime',async t => {
  const h=harness();t.after(() => h.dispose())
  delete globalThis.__CATRACE_SETTINGS_UI__
  await assert.rejects(h.load('settings.mjs'),/Catrace settings UI runtime missing/)
})

test('Agent React Card preserves multi-question answers, custom text and HTTP permission decision',async t => {
  const decided=[]
  let closed=0
  const h=harness();t.after(() => h.dispose())
  globalThis.fetch=async (url,init) => {decided.push({url,body:JSON.parse(init.body)});return {ok:true,status:200,json:async () => ({ok:true})}}
  const mod=await h.load('ui.mjs')
  const props={event:{event_type:'agent-notify.permission',payload:{requestId:'req-7',entry:{agentId:'claude',sessionTitle:'审批会话',permission:{toolName:'AskUserQuestion',toolInput:{questions:[{question:'第一题',options:['A','B']},{question:'第二题',multiSelect:true,options:['C','D']}]}}}}},onClose:() => closed++}
  h.render(mod.default,props)
  let tree=h.render(mod.default,props)
  assert.match(text(tree),/第一题/)
  click(button(tree,'A'));tree=h.render(mod.default,props);click(button(tree,'下一题'));tree=h.render(mod.default,props)
  assert.match(text(tree),/第二题/)
  click(button(tree,'C'));tree=h.render(mod.default,props);click(button(tree,'D'));tree=h.render(mod.default,props)
  click(button(tree,'上一题'));tree=h.render(mod.default,props)
  controls(tree,'textarea')[0].props.onChange({target:{value:'自定义回答'}})
  tree=h.render(mod.default,props);click(button(tree,'下一题'));tree=h.render(mod.default,props)
  click(button(tree,'提交'));await flush()
  assert.equal(closed,1)
  assert.deepEqual(decided[0].body,{id:'req-7',decision:'allow',answers:{'0':'自定义回答','1':'C, D'}})
})

test('Agent React Card preserves action callbacks, debug raw copy, timestamps and all merged sessions',async t => {
  const actions=[],copied=[]
  let closed=0
  const h=harness({clipboard:{writeText:async value => copied.push(value)}});t.after(() => h.dispose())
  const mod=await h.load('ui.mjs')
  assert.equal(typeof mod.default,'function');assert.equal(mod.Card,mod.default)
  const props={event:{event_type:'agent-notify.permission',payload:{requestId:'deny-1',entry:{permission:{toolName:'Bash',toolInput:{command:'echo hi'}}}}},onClose:() => closed++,onAction:value => actions.push(value)}
  h.render(mod.default,props);let tree=h.render(mod.default,props)
  click(button(tree,'拒绝'));assert.deepEqual(actions,['deny:deny-1']);assert.equal(closed,1)
  const event={payload:{debugView:'raw',debugExpanded:true,raw:{stdin:'原始内容'},entries:[{sessionId:'s1',sessionTitle:'会话一',event:'Stop',message:'第一条正文',timestamp:new Date().toISOString()},{sessionId:'s2',sessionTitle:'会话二',event:'Notification',message:'第二条正文'}]}}
  tree=h.render(mod.default,{event})
  assert.match(text(tree),/会话一/);assert.match(text(tree),/会话二/);assert.match(text(tree),/第一条正文/);assert.match(text(tree),/第二条正文/)
  // Debug preference is initialized on mount; open it explicitly when this instance began as permission.
  const dumpToggle=nodes(tree,node => node.props?.className==='dump-toggle')[0]
  if(dumpToggle && !dumpToggle.props['aria-expanded']){click(dumpToggle);tree=h.render(mod.default,{event})}
  if(button(tree,'原始')){click(button(tree,'原始'));tree=h.render(mod.default,{event})}
  click(button(tree,'复制'));await flush();assert.match(copied[0],/原始内容/)
  assert.match(read('ui.mjs'),/user-select: text !important/)
})

