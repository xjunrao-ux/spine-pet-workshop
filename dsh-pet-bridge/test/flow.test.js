// End-to-end bridge flow over a harness-compatible fake: the six endpoints, the
// send flow, receipts, events, cancellation, idempotency.

import assert from 'node:assert/strict'
import { after, test } from 'node:test'

import { startBridge, waitFor } from './helpers/bridge-host.js'

/**
 * @param {object} options start options.
 * @returns {Promise<object>} bridge.
 */
const start = (options) => startBridge(options)

test('info 声明基础能力与限额', async () => {
  const bridge = await start()
  after(() => bridge.stop())
  const res = await bridge.request({ path: 'info' })
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.deepEqual(res.json.protocols, ['pet-dsh/1'])
  assert.equal(res.json.instanceId, bridge.instanceId)
  assert.equal(res.json.dshVersion.includes('.'), true)
  for (const capability of ['sessions.list', 'session.snapshot', 'message.send', 'events.follow', 'requests.lookup']) {
    assert.ok(res.json.capabilities.includes(capability), `缺少基础能力 ${capability}`)
  }
  assert.equal(res.json.limits.requestBytes, 65536)
  assert.equal(res.json.limits.responseBytes, 262144)
  assert.equal(res.json.limits.eventBytes, 65536)
  assert.equal(res.json.limits.messageChars, 4000)
  assert.equal(res.json.limits.heartbeatMs, 15000)
})

test('sessions 只列出已授权会话并给出展示名', async () => {
  const bridge = await start()
  after(() => bridge.stop())
  const res = await bridge.request({ path: 'sessions' })
  assert.equal(res.status, 200)
  assert.equal(res.json.items.length, 1)
  const [item] = res.json.items
  assert.equal(item.sessionId, bridge.session.id)
  assert.equal(item.status, 'idle')
  assert.equal(item.available, true)
  assert.equal(item.workspace, 'demo')
  assert.equal(item.title, null)
  assert.equal(res.json.nextCursor, null)
})

test('snapshot 返回同一水位与空历史', async () => {
  const bridge = await start()
  after(() => bridge.stop())
  const res = await bridge.request({ path: `snapshot?sessionId=${bridge.session.id}` })
  assert.equal(res.status, 200)
  assert.equal(res.json.instanceId, bridge.instanceId)
  assert.equal(res.json.sessionId, bridge.session.id)
  assert.match(res.json.cursor, new RegExp(`^${bridge.instanceId}\\.\\d+$`))
  assert.deepEqual(res.json.messages, [])
  assert.equal(res.json.activity, null)
  assert.deepEqual(res.json.pendingInteractions, [])
  assert.deepEqual(res.json.pendingPetCalls, [])
  assert.equal(res.json.truncated, false)
})

test('message.send 返回 202 回执，事件流按协议顺序到达', async () => {
  const bridge = await start({ harnessOptions: { deltaChunks: 3 } })
  after(() => bridge.stop())

  const snapshot = await bridge.request({ path: `snapshot?sessionId=${bridge.session.id}` })
  const stream = await bridge.openStream({ path: `events?sessionId=${bridge.session.id}`, headers: { 'last-event-id': snapshot.json.cursor } })
  after(() => stream.close())

  const requestId = 'req-flow-1'
  const send = await bridge.request({
    method: 'POST',
    path: 'commands',
    body: {
      protocol: 'pet-dsh/1',
      instanceId: bridge.instanceId,
      requestId,
      op: 'message.send',
      sessionId: bridge.session.id,
      data: { mode: 'followup', text: '分析测试结构。' },
    },
  })
  assert.equal(send.status, 202)
  assert.equal(send.json.ok, true)
  assert.equal(send.json.requestId, requestId)
  assert.equal(send.json.data.status, 'accepted')
  assert.match(send.json.data.messageId, /^[A-Za-z0-9._-]{1,100}$/)

  const claimed = await stream.next((frame) => frame.data?.type === 'message.claimed')
  assert.equal(claimed.event, 'bridge')
  assert.equal(claimed.id, claimed.data.cursor)
  assert.equal(claimed.data.sessionId, bridge.session.id)
  assert.equal(claimed.data.requestId, requestId)
  assert.equal(claimed.data.data.messageId, send.json.data.messageId)
  assert.equal(claimed.data.data.requestId, requestId)
  assert.equal(claimed.data.data.turn, 1)

  const deltas = await stream.until((frame) => frame.data?.type === 'assistant.message')
  const deltaFrames = deltas.filter((frame) => frame.data?.type === 'assistant.delta')
  assert.ok(deltaFrames.length >= 1, '至少应有一个 assistant.delta')
  const indices = deltaFrames.map((frame) => frame.data.data.index)
  assert.deepEqual(indices, indices.map((_, index) => index), 'bridge index 必须从 0 连续递增')
  const attemptIds = new Set(deltaFrames.map((frame) => frame.data.data.attemptId))
  assert.equal(attemptIds.size, 1, '同一 attempt 内 attemptId 不变')

  const message = deltas.at(-1)
  assert.equal(message.data.type, 'assistant.message')
  assert.equal(message.data.data.text, '项目包含单元测试和界面验证。')
  assert.equal(message.data.data.turn, 1)

  const ended = await stream.next((frame) => frame.data?.type === 'activity.ended')
  assert.equal(ended.data.data.outcome, 'completed')

  // The cursor must be strictly increasing across the whole stream.
  const cursors = stream.frames.filter((frame) => frame.id !== undefined).map((frame) => Number(frame.id.split('.')[1]))
  for (let i = 1; i < cursors.length; i += 1) assert.ok(cursors[i] > cursors[i - 1], 'cursor 必须严格递增')

  const lookup = await bridge.request({ path: `requests?requestId=${requestId}` })
  assert.equal(lookup.status, 200)
  assert.equal(lookup.json.data.status, 'ended')
  assert.equal(lookup.json.data.outcome, 'completed')
  assert.equal(lookup.json.data.op, 'message.send')
  assert.equal(lookup.json.data.messageId, send.json.data.messageId)
  assert.match(lookup.json.data.activityId, /^act\./)
})

test('相同 requestId 同内容只执行一次，不同内容 REQUEST_CONFLICT', async () => {
  const bridge = await start()
  after(() => bridge.stop())
  const envelope = {
    protocol: 'pet-dsh/1',
    instanceId: bridge.instanceId,
    requestId: 'req-idem-1',
    op: 'message.send',
    sessionId: bridge.session.id,
    data: { mode: 'followup', text: '只执行一次' },
  }
  const first = await bridge.request({ method: 'POST', path: 'commands', body: envelope })
  assert.equal(first.status, 202)
  await waitFor(() => bridge.agent.status === 'idle', 3000, 'agent idle')

  const turnsBefore = bridge.session.events.filter((event) => event.type === 'turn/start').length
  const second = await bridge.request({ method: 'POST', path: 'commands', body: envelope })
  assert.equal(second.status, 202)
  assert.equal(second.json.data.messageId, first.json.data.messageId)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const turnsAfter = bridge.session.events.filter((event) => event.type === 'turn/start').length
  assert.equal(turnsAfter, turnsBefore, '重复提交不得再执行一轮')

  const conflict = await bridge.request({
    method: 'POST',
    path: 'commands',
    body: { ...envelope, data: { mode: 'followup', text: '不一样的内容' } },
  })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.json.error.code, 'REQUEST_CONFLICT')
})

test('忙碌会话返回 SESSION_BUSY 且不写台账', async () => {
  const bridge = await start()
  after(() => bridge.stop())
  bridge.agent.gate(true)
  const first = await bridge.request({
    method: 'POST',
    path: 'commands',
    body: {
      protocol: 'pet-dsh/1',
      instanceId: bridge.instanceId,
      requestId: 'req-busy-1',
      op: 'message.send',
      sessionId: bridge.session.id,
      data: { mode: 'followup', text: '占用会话' },
    },
  })
  assert.equal(first.status, 202)
  await waitFor(() => bridge.session.events.some((event) => event.type === 'turn/start'), 2000, 'turn start')

  const busy = await bridge.request({
    method: 'POST',
    path: 'commands',
    body: {
      protocol: 'pet-dsh/1',
      instanceId: bridge.instanceId,
      requestId: 'req-busy-2',
      op: 'message.send',
      sessionId: bridge.session.id,
      data: { mode: 'followup', text: '第二轮' },
    },
  })
  assert.equal(busy.status, 409)
  assert.equal(busy.json.error.code, 'SESSION_BUSY')
  const lookup = await bridge.request({ path: 'requests?requestId=req-busy-2' })
  assert.equal(lookup.status, 404)
  assert.equal(lookup.json.error.code, 'REQUEST_UNKNOWN')
})

test('session.cancel 校验 activityId 并呈现真实终态', async () => {
  const bridge = await start()
  after(() => bridge.stop())
  const stream = await bridge.openStream({ path: `events?sessionId=${bridge.session.id}` })
  after(() => stream.close())
  bridge.agent.gate(true)

  await bridge.request({
    method: 'POST',
    path: 'commands',
    body: {
      protocol: 'pet-dsh/1',
      instanceId: bridge.instanceId,
      requestId: 'req-cancel-1',
      op: 'message.send',
      sessionId: bridge.session.id,
      data: { mode: 'followup', text: '将被取消' },
    },
  })
  const state = await stream.next((frame) => frame.data?.type === 'activity.state')
  const activityId = state.data.data.activityId

  const stale = await bridge.request({
    method: 'POST',
    path: 'commands',
    body: {
      protocol: 'pet-dsh/1',
      instanceId: bridge.instanceId,
      requestId: 'req-cancel-stale',
      op: 'session.cancel',
      sessionId: bridge.session.id,
      data: { activityId: 'act.deadbeef.99' },
    },
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.error.code, 'EXPIRED')

  // The fake agent streams its reply asynchronously; cancel before it closes.
  const cancel = await bridge.request({
    method: 'POST',
    path: 'commands',
    body: {
      protocol: 'pet-dsh/1',
      instanceId: bridge.instanceId,
      requestId: 'req-cancel-2',
      op: 'session.cancel',
      sessionId: bridge.session.id,
      data: { activityId },
    },
  })
  assert.equal(cancel.status, 200)
  assert.equal(cancel.json.data.status, 'cancelling')
  assert.equal(cancel.json.data.activityId, activityId)
})

test('GUI 侧输入通过 session.changed 提示刷新', async () => {
  const bridge = await start()
  after(() => bridge.stop())
  const stream = await bridge.openStream({ path: `events?sessionId=${bridge.session.id}` })
  after(() => stream.close())
  bridge.harness.guiSend(bridge.agent, '我在 GUI 里输入的内容')
  const frame = await stream.next((candidate) => candidate.data?.type === 'session.changed')
  assert.equal(frame.data.sessionId, bridge.session.id)
  assert.equal(typeof frame.data.data.status, 'string')
})

test('snapshot 包含已提交历史且不含原生工具结果', async () => {
  const bridge = await start()
  after(() => bridge.stop())
  await bridge.request({
    method: 'POST',
    path: 'commands',
    body: {
      protocol: 'pet-dsh/1',
      instanceId: bridge.instanceId,
      requestId: 'req-history-1',
      op: 'message.send',
      sessionId: bridge.session.id,
      data: { mode: 'followup', text: '写入历史' },
    },
  })
  await waitFor(() => bridge.agent.status === 'idle', 3000, 'agent idle')
  const snapshot = await bridge.request({ path: `snapshot?sessionId=${bridge.session.id}` })
  assert.equal(snapshot.status, 200)
  assert.equal(snapshot.json.messages.length, 2)
  assert.equal(snapshot.json.messages[0].role, 'user')
  assert.equal(snapshot.json.messages[0].text, '写入历史')
  assert.equal(snapshot.json.messages[0].turn, 1)
  assert.equal(snapshot.json.messages[1].role, 'assistant')
  assert.equal(snapshot.json.messages[1].text, '项目包含单元测试和界面验证。')
})
