// Projection: what leaves the bridge, in which order, and with which ids.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import { startBridge } from './helpers/bridge-host.js'
import { SessionProjection, outcomeOf } from '../src/session-projection.js'

/**
 * Append a committed assistant step to the fake session.
 * @param {object} session fake session.
 * @param {number} turn turn number.
 * @param {number} step step number.
 * @param {string} text reply text.
 */
function appendStep(session, turn, step, text) {
  session.append('step/start', { turn, step })
  session.append('assistant/message', {
    turn,
    step,
    message: {
      id: `assistant-${turn}-${step}`,
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'fake', model: 'fake-model' },
    },
  })
  session.append('step/end', { turn, step })
}

test('插件注入的上下文与私密推理不进入 snapshot', async () => {
  const bridge = await startBridge()
  try {
    const session = bridge.harness.sessions.get(bridge.session.id)
    session.append('turn/start', { turn: 1 })
    // Internal model-facing context: same event type, different source.
    session.append('user/message', {
      id: 'internal-1',
      role: 'user',
      content: [{ type: 'text', text: '内部提示词：你是…' }],
      source: { kind: 'plugin', plugin: 'dsh-agent-instructions' },
    })
    session.append('user/message', {
      id: 'human-1',
      role: 'user',
      content: [{ type: 'text', text: '用户可见的问题' }],
      source: { kind: 'user' },
    })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: '私密推理' },
    })
    appendStep(session, 1, 1, '用户可见的回答')
    session.append('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'pwsh', arguments: '{"command":"Get-Secret"}' })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: {
        id: 'tool-1',
        role: 'user',
        content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: '机密终端输出' }] }],
        source: { kind: 'tool', callId: 'call-1' },
      },
    })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const res = await bridge.request({ path: `snapshot?sessionId=${bridge.session.id}` })
    assert.equal(res.status, 200)
    const texts = res.json.messages.map((message) => message.text)
    assert.deepEqual(texts, ['用户可见的问题', '用户可见的回答'])
    assert.equal(res.text.includes('内部提示词'), false)
    assert.equal(res.text.includes('私密推理'), false)
    assert.equal(res.text.includes('Get-Secret'), false)
    assert.equal(res.text.includes('机密终端输出'), false)
  } finally {
    await bridge.stop()
  }
})

test('每次生成使用独立 attemptId，index 从 0 重新计数', async () => {
  const bridge = await startBridge()
  try {
    const stream = await bridge.openStream({ path: `events?sessionId=${bridge.session.id}` })
    const session = bridge.harness.sessions.get(bridge.session.id)
    session.append('turn/start', { turn: 1 })
    for (const text of ['第一', '段']) {
      session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text } })
    }
    appendStep(session, 1, 1, '第一段')
    await new Promise((resolve) => setTimeout(resolve, 150))
    for (const text of ['第二', '段']) {
      session.append('assistant/chunk', { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text } })
    }
    appendStep(session, 1, 2, '第二段')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const frames = await stream.until((frame) => frame.data?.type === 'activity.ended', 4000)
    stream.close()
    const deltas = frames.filter((frame) => frame.data?.type === 'assistant.delta')
    assert.ok(deltas.length >= 2)
    const attempts = [...new Set(deltas.map((frame) => frame.data.data.attemptId))]
    assert.deepEqual(attempts.sort(), ['att.1.1', 'att.1.2'])
    for (const attemptId of attempts) {
      const indices = deltas.filter((frame) => frame.data.data.attemptId === attemptId).map((frame) => frame.data.data.index)
      assert.deepEqual(indices, indices.map((_, index) => index), `${attemptId} 的 index 必须从 0 连续`)
    }
    const messages = frames.filter((frame) => frame.data?.type === 'assistant.message')
    assert.equal(messages.length, 2)
    assert.equal(messages[0].data.data.text, '第一段')
    assert.equal(messages[1].data.data.text, '第二段')
  } finally {
    await bridge.stop()
  }
})

test('高频文字按时间窗合并，避免超出事件预算', async () => {
  const bridge = await startBridge()
  try {
    const stream = await bridge.openStream({ path: `events?sessionId=${bridge.session.id}` })
    const session = bridge.harness.sessions.get(bridge.session.id)
    session.append('turn/start', { turn: 1 })
    // 200 provider chunks in one synchronous burst.
    for (let index = 0; index < 200; index += 1) {
      session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '字' } })
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
    appendStep(session, 1, 1, '字'.repeat(200))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const frames = await stream.until((frame) => frame.data?.type === 'activity.ended', 4000)
    stream.close()
    const deltas = frames.filter((frame) => frame.data?.type === 'assistant.delta')
    assert.ok(deltas.length < 20, `合并后的事件数应远小于 200，实际 ${deltas.length}`)
    assert.equal(deltas.map((frame) => frame.data.data.text).join(''), '字'.repeat(200))
  } finally {
    await bridge.stop()
  }
})

test('等待审批时 activity 状态为 waiting-approval，判定后回到 running', async () => {
  const bridge = await startBridge()
  try {
    const stream = await bridge.openStream({ path: `events?sessionId=${bridge.session.id}` })
    const session = bridge.harness.sessions.get(bridge.session.id)
    session.append('turn/start', { turn: 1 })
    session.append('approval/asked', { id: 'ap-1', toolName: 'pwsh', reason: '需要权限' })
    const asked = await stream.next((frame) => frame.data?.type === 'activity.state' && frame.data.data.status === 'waiting-approval', 3000)
    assert.equal(asked.data.data.activityId, `act.${expectedPrefix(bridge.session.id)}.1`)
    const snapshot = await bridge.request({ path: `snapshot?sessionId=${bridge.session.id}` })
    assert.equal(snapshot.json.activity.status, 'waiting-approval')
    // The bridge has no answer channel: it must not offer pendingInteractions.
    assert.deepEqual(snapshot.json.pendingInteractions, [])

    session.append('approval/decided', { id: 'ap-1', outcome: 'allowed-once' })
    const resumed = await stream.next((frame) => frame.data?.type === 'activity.state' && frame.data.data.status === 'running', 3000)
    assert.equal(resumed.data.data.activityId, asked.data.data.activityId)
    stream.close()
  } finally {
    await bridge.stop()
  }
})

test('终态映射：completed / cancelled / failed / interrupted', () => {
  assert.equal(outcomeOf({ kind: 'completed' }), 'completed')
  assert.equal(outcomeOf({ kind: 'max-tokens' }), 'completed')
  assert.equal(outcomeOf({ kind: 'aborted', reason: { kind: 'user' } }), 'cancelled')
  assert.equal(outcomeOf({ kind: 'error', error: { message: 'x', code: 'E' } }), 'failed')
  assert.equal(outcomeOf({ kind: 'interrupted' }), 'interrupted')
  assert.equal(outcomeOf({ kind: 'blocked' }), 'failed')
  assert.equal(outcomeOf(undefined), 'failed')
})

test('投影对日志做增量折叠，不重复计数', () => {
  const events = []
  const push = (type, data) => events.push({ type, seq: events.length, time: Date.now(), data })
  push('turn/start', { turn: 1 })
  push('user/message', { id: 'u1', role: 'user', content: [{ type: 'text', text: '问' }], source: { kind: 'user' } })
  push('assistant/message', {
    turn: 1,
    step: 1,
    message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '答' }], source: { kind: 'model', provider: 'p', model: 'm' } },
  })
  push('turn/end', { turn: 1, reason: { kind: 'completed' } })

  const projection = new SessionProjection('session-x', 0)
  assert.equal(projection.sync(events).length, 4)
  assert.equal(projection.sync(events).length, 0, '第二次同步不得重复折叠')
  const snapshot = projection.buildSnapshot({ limit: 20, chars: 16000, byteBudget: 262144, activityActive: true })
  assert.equal(snapshot.messages.length, 2)
  assert.equal(snapshot.activity, null)
  assert.equal(projection.lastOutcome, 'completed')
})

/**
 * @param {string} sessionId wire session id.
 * @returns {string} the digest prefix the bridge uses in activity ids.
 */
function expectedPrefix(sessionId) {
  return createHash('sha256').update(sessionId, 'utf8').digest('hex').slice(0, 8)
}
