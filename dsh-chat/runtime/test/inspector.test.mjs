/**
 * 状态巡检状态机单元测试：NoticeTracker 是纯逻辑，直接喂事件流断言发布动作。
 * 覆盖：回合流转、完成停留、×静默与解除、审批 waiting/decided、展开持有、
 * 首见快进（历史会话不轰炸）、预览节流、日志重写重置。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { NoticeTracker } from '../lib/inspector.mjs'

/** 快速造事件 */
const ev = (type, data, seq = 1) => ({ type, seq, time: 1700000000000 + seq * 1000, data })

const TURN_START = (turn, seq) => ev('turn/start', { turn }, seq)
const TURN_END = (turn, seq) => ev('turn/end', { turn, reason: { kind: 'completed' } }, seq)
const ASSISTANT = (text, seq) =>
  ev('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text }] } }, seq)
const ASKED = (id, seq) => ev('approval/asked', { id }, seq)
const DECIDED = (id, seq) => ev('approval/decided', { id, outcome: 'allowed-once' }, seq)
const TITLE = (title, seq) => ev('session/title', { title }, seq)
const USER = (text, seq) =>
  ev('user/message', { content: [{ type: 'text', text }], source: { kind: 'user' }, role: 'user', id: `u${seq}` }, seq)

/** 固定时钟：step 手动推进，避免节流逻辑依赖真实时间 */
function fixedClock() {
  let now = 1000000
  return {
    now: () => now,
    advance: (ms) => {
      now += ms
    },
  }
}

test('新回合出「进行中」，预览节流刷新，turn/end 转「已完成」', () => {
  const clock = fixedClock()
  const tracker = new NoticeTracker({ doneHoldMs: 30000, now: clock.now })
  const events = [
    ev('session', { id: 's1' }, 0),
    TITLE('修登录页', 1),
    TURN_START(1, 2),
    USER('帮我修登录页', 3),
    ASSISTANT('我先看看代码。', 4),
  ]

  // 第一拍：新回合 → 进行中（sticky，无 auto_hide）。首见快进要求 fresh（日志仍在写）
  let actions = tracker.ingest('s1', events, { now: clock.now(), fresh: true })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].status, 'running')
  assert.equal(actions[0].sticky, true)
  assert.equal(actions[0].autoHideMs, null)
  assert.equal(actions[0].title, '修登录页')
  assert.equal(actions[0].preview, '我先看看代码。')

  // 预览更新但间隔不足 → 节流不发布
  clock.advance(1000)
  events.push(ASSISTANT('找到了，是 token 过期。', 5))
  actions = tracker.ingest('s1', events, { now: clock.now() })
  assert.equal(actions.length, 0, '4s 内的预览更新不该刷屏')

  // 间隔够了 → 发布刷新
  clock.advance(5000)
  actions = tracker.ingest('s1', events, { now: clock.now() })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].status, 'running')
  assert.equal(actions[0].preview, '找到了，是 token 过期。')

  // turn/end → 已完成：非 sticky + 停留时长交给宿主
  clock.advance(1000)
  events.push(TURN_END(1, 6))
  actions = tracker.ingest('s1', events, { now: clock.now() })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].status, 'done')
  assert.equal(actions[0].sticky, false)
  assert.equal(actions[0].autoHideMs, 30000)
})

test('完成后继续追问 → 下一轮循环；× 静默到新回合解除', () => {
  const clock = fixedClock()
  const tracker = new NoticeTracker({ doneHoldMs: 30000, now: clock.now })
  const events = [TURN_START(1, 1), ASSISTANT('第一轮结论。', 2), TURN_END(1, 3)]
  tracker.ingest('s1', events, { now: clock.now(), fresh: true })

  tracker.markDismissed('s1')
  // × 之后：连新预览都不发
  clock.advance(10000)
  events.push(ASSISTANT('补充一句。', 4))
  assert.equal(tracker.ingest('s1', events, { now: clock.now() }).length, 0, '× 后要静默')

  // 新回合解除静默
  clock.advance(1000)
  events.push(TURN_START(2, 5))
  const actions = tracker.ingest('s1', events, { now: clock.now() })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].status, 'running')
  assert.equal(actions[0].sticky, true)
})

test('审批：asked → waiting（自动展开），decided → 回 running；turn/end 不越过 waiting', () => {
  const clock = fixedClock()
  const tracker = new NoticeTracker({ doneHoldMs: 30000, now: clock.now })
  const events = [TURN_START(1, 1)]

  let actions = tracker.ingest('s1', events, { now: clock.now(), fresh: true })
  assert.equal(actions[0].status, 'running')

  events.push(ASKED('apm-1', 2))
  actions = tracker.ingest('s1', events, { now: clock.now() })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].status, 'waiting')
  assert.equal(actions[0].autoExpand, true)
  assert.equal(actions[0].sticky, true)

  // 回合结束了但审批还没答：保持 waiting（任务卡死在等人的状态）
  events.push(TURN_END(1, 3))
  assert.equal(tracker.ingest('s1', events, { now: clock.now() }).length, 0)

  // 拒绝后回合已结束 → 直接转 done
  events.push(DECIDED('apm-1', 4))
  actions = tracker.ingest('s1', events, { now: clock.now() })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].status, 'done')
  assert.equal(actions[0].autoExpand, false)
})

test('× 之后审批照样弹出（审批优先级最高）', () => {
  const clock = fixedClock()
  const tracker = new NoticeTracker({ now: clock.now })
  const events = [TURN_START(1, 1), ASKED('apm-1', 2)]
  tracker.ingest('s1', events, { now: clock.now(), fresh: true })
  tracker.markDismissed('s1')

  events.push(DECIDED('apm-1', 3))
  const actions = tracker.ingest('s1', events, { now: clock.now() })
  // decided 回 running：被 × 压住不发；再 asked 一次必须穿透
  assert.equal(actions.length, 0)
  events.push(ASKED('apm-2', 4))
  const again = tracker.ingest('s1', events, { now: clock.now() })
  assert.equal(again.length, 1)
  assert.equal(again[0].status, 'waiting')
  assert.equal(again[0].autoExpand, true)
})

test('展开持有：done + expanded 是 sticky，收起后重新带停留时长', () => {
  const clock = fixedClock()
  const tracker = new NoticeTracker({ doneHoldMs: 30000, now: clock.now })
  const events = [TURN_START(1, 1)]

  tracker.ingest('s1', events, { now: clock.now(), fresh: true })
  assert.ok(tracker.setExpanded('s1', true), '展开要触发一次补发（sticky 持有）')

  // 用户正在看时回合结束：完成也不自动收
  events.push(ASSISTANT('答案。', 2), TURN_END(1, 3))
  const doneActions = tracker.ingest('s1', events, { now: clock.now() })
  assert.equal(doneActions.length, 1)
  assert.equal(doneActions[0].status, 'done')
  assert.equal(doneActions[0].sticky, true, '用户正在看：完成也不自动收')
  assert.equal(doneActions[0].autoHideMs, null)

  // 收起 → 重新发布，带停留时长
  const collapse = tracker.setExpanded('s1', false)
  assert.ok(collapse)
  assert.equal(collapse.status, 'done')
  assert.equal(collapse.sticky, false)
  assert.equal(collapse.autoHideMs, 30000)

  // 未知会话 / 重复收起：不炸、不发布
  assert.equal(tracker.setExpanded('nope', true), null)
  assert.equal(tracker.setExpanded('s1', false), null, '重复收起不需要再补发')
})

test('首见快进：历史会话闭嘴，只有「确实在跑」或「审批未决」补卡', () => {
  const clock = fixedClock()
  const tracker = new NoticeTracker({ now: clock.now })

  // 已完结的陈旧会话：不出卡
  const doneEvents = [TURN_START(1, 1), TURN_END(1, 2)]
  assert.equal(tracker.ingest('done', doneEvents, { now: clock.now(), fresh: false }).length, 0)

  // 还在跑但日志不新鲜（DSH 可能已经崩了）：不出卡
  const staleRunning = [TURN_START(1, 1)]
  assert.equal(tracker.ingest('stale', staleRunning, { now: clock.now(), fresh: false }).length, 0)

  // 还在跑且日志新鲜：补一张进行中
  const freshRunning = [TURN_START(1, 1), ASSISTANT('跑着呢。', 2)]
  const actions = tracker.ingest('fresh', freshRunning, { now: clock.now(), fresh: true })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].status, 'running')

  // 审批未决：无论新鲜与否都要补
  const pendingApproval = [TURN_START(1, 1), ASKED('apm-1', 2)]
  const waiting = tracker.ingest('blocked', pendingApproval, { now: clock.now(), fresh: false })
  assert.equal(waiting.length, 1)
  assert.equal(waiting[0].status, 'waiting')

  // 快进后增量照常：fresh 会话 turn/end 正常出完成卡
  freshRunning.push(TURN_END(1, 3))
  const doneActions = tracker.ingest('fresh', freshRunning, { now: clock.now(), fresh: true })
  assert.equal(doneActions.length, 1)
  assert.equal(doneActions[0].status, 'done')
})

test('日志被重写（事件变少）→ 状态重置后重新快进，不误报', () => {
  const clock = fixedClock()
  const tracker = new NoticeTracker({ now: clock.now })
  const full = [TURN_START(1, 1), ASSISTANT('a', 2), TURN_END(1, 3)]
  tracker.ingest('s1', full, { now: clock.now(), fresh: true })

  // 日志缩短（压缩/搬移）：重置后快进，完结会话不出卡
  const rewritten = [TURN_START(1, 1), TURN_END(1, 2)]
  const actions = tracker.ingest('s1', rewritten, { now: clock.now(), fresh: false })
  assert.equal(actions.length, 0)
  assert.equal(tracker.stateOf('s1').seen, rewritten.length)
  assert.equal(tracker.stateOf('s1').phase, 'done')
})

test('标题回退：无 title 事件时取首条真人输入；注入上下文不算', () => {
  const clock = fixedClock()
  const tracker = new NoticeTracker({ now: clock.now })
  const events = [
    TURN_START(1, 1),
    USER('<system-reminder>注入内容</system-reminder>', 2),
    USER('帮我看看 zstd 多帧怎么拆', 3),
  ]
  const actions = tracker.ingest('s1', events, { now: clock.now(), fresh: true })
  assert.equal(actions[0].title, '帮我看看 zstd 多帧怎么拆')
})

test('summary：跟踪状态可导出（设置页展示用）', () => {
  const clock = fixedClock()
  const tracker = new NoticeTracker({ now: clock.now })
  tracker.ingest('s1', [TURN_START(1, 1), ASKED('a', 2)], { now: clock.now(), fresh: true })
  const rows = tracker.summary()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 's1')
  assert.equal(rows[0].phase, 'waiting')
  assert.equal(rows[0].pendingApprovals, 1)
})
