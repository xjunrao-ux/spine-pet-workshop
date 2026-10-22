// SSE: frame shape, UTF-8 boundaries, heartbeat, replay, cursor refusal.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { startBridge, waitFor } from './helpers/bridge-host.js'

/**
 * @param {object} bridge bridge handle.
 * @param {string} requestId request id.
 * @param {string} text message text.
 * @returns {Promise<object>} HTTP response.
 */
const send = (bridge, requestId, text) => bridge.request({
  method: 'POST',
  path: 'commands',
  body: {
    protocol: 'pet-dsh/1',
    instanceId: bridge.instanceId,
    requestId,
    op: 'message.send',
    sessionId: bridge.session.id,
    data: { mode: 'followup', text },
  },
})

test('中文与 emoji 跨字节边界正确还原', async () => {
  const bridge = await startBridge({
    harnessOptions: { reply: '桌宠🐾与 DSH 同步：\r\n第二行\n第三行', deltaChunks: 7 },
  })
  try {
    const stream = await bridge.openStream({ path: `events?sessionId=${bridge.session.id}` })
    await send(bridge, 'req-utf8', '请回答')
    const frames = await stream.until((frame) => frame.data?.type === 'assistant.message')
    stream.close()
    const deltas = frames.filter((frame) => frame.data?.type === 'assistant.delta')
    assert.ok(deltas.length > 0)
    const joined = deltas.map((frame) => frame.data.data.text).join('')
    assert.equal(joined, '桌宠🐾与 DSH 同步：\r\n第二行\n第三行')
    // The committed message carries the same text verbatim.
    assert.equal(frames.at(-1).data.data.text, '桌宠🐾与 DSH 同步：\r\n第二行\n第三行')
    for (const frame of frames) {
      assert.ok(Buffer.byteLength(JSON.stringify(frame.data), 'utf8') <= 65536)
      assert.equal(frame.id, frame.data.cursor, 'id 必须等于信封 cursor')
      assert.equal(frame.event, 'bridge')
    }
  } finally {
    await bridge.stop()
  }
})

test('心跳是注释行且不推进游标', async () => {
  const bridge = await startBridge({ config: { limits: { heartbeatMs: 1000 } } })
  try {
    const stream = await bridge.openStream({ path: `events?sessionId=${bridge.session.id}` })
    const connected = await stream.next((frame) => frame.comment)
    assert.equal(connected.commentText, 'connected')
    assert.equal(connected.id, undefined)
    const ping = await stream.next((frame) => frame.commentText === 'ping', 3000)
    assert.equal(ping.id, undefined, '心跳不得带 SSE id')
    assert.equal(ping.data, undefined, '心跳不得带 data')
    stream.close()
  } finally {
    await bridge.stop()
  }
})

test('没有 Last-Event-ID 时不回放历史', async () => {
  const bridge = await startBridge()
  try {
    await send(bridge, 'req-before-stream', '先产生一条事件')
    await waitFor(() => bridge.agent.status === 'idle', 3000, 'agent idle')
    const stream = await bridge.openStream({ path: `events?sessionId=${bridge.session.id}` })
    // Give the server a moment to (incorrectly) replay if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 80))
    const businessFrames = stream.frames.filter((frame) => frame.data !== undefined)
    assert.deepEqual(businessFrames, [])
    stream.close()
  } finally {
    await bridge.stop()
  }
})

test('带快照游标订阅只接收其后的事件（快照与流衔接）', async () => {
  const bridge = await startBridge()
  try {
    const snapshot = await bridge.request({ path: `snapshot?sessionId=${bridge.session.id}` })
    const stream = await bridge.openStream({
      path: `events?sessionId=${bridge.session.id}`,
      headers: { 'last-event-id': snapshot.json.cursor },
    })
    await send(bridge, 'req-after-snapshot', '快照之后的消息')
    const frames = await stream.until((frame) => frame.data?.type === 'activity.ended')
    stream.close()
    const firstSeq = Number(frames[0].data.cursor.split('.')[1])
    const snapshotSeq = Number(snapshot.json.cursor.split('.')[1])
    assert.ok(firstSeq > snapshotSeq, '重放游标必须严格晚于快照水位')
    // The first live fact after a followup is the agent status change; the turn
    // opening follows it.
    assert.ok(frames.some((frame) => frame.data.type === 'activity.state'))
    assert.ok(frames.some((frame) => frame.data.type === 'message.claimed'))
  } finally {
    await bridge.stop()
  }
})

test('跨实例游标触发 resync.required 并关闭流', async () => {
  const bridge = await startBridge()
  try {
    const stream = await bridge.openStream({
      path: `events?sessionId=${bridge.session.id}`,
      headers: { 'last-event-id': 'instance-ffffffffffff.3' },
    })
    const frame = await stream.next((candidate) => candidate.data?.type === 'resync.required', 2000)
    assert.equal(frame.data.data.reason, 'cursor-invalid')
    stream.close()
  } finally {
    await bridge.stop()
  }
})

test('过期游标触发 resync.required', async () => {
  const bridge = await startBridge({ config: { replay: { maxEvents: 16 } } })
  try {
    // Publish more than the replay window holds.
    for (let index = 0; index < 30; index += 1) {
      bridge.harness.emit('agent/status', { agent: bridge.agent, status: index % 2 === 0 ? 'running' : 'idle' })
    }
    const stream = await bridge.openStream({
      path: `events?sessionId=${bridge.session.id}`,
      headers: { 'last-event-id': `${bridge.instanceId}.1` },
    })
    const frame = await stream.next((candidate) => candidate.data?.type === 'resync.required', 2000)
    assert.equal(frame.data.data.reason, 'cursor-expired')
    stream.close()
  } finally {
    await bridge.stop()
  }
})

test('重放窗口内的事件按序补发且不重复', async () => {
  const bridge = await startBridge()
  try {
    const snapshot = await bridge.request({ path: `snapshot?sessionId=${bridge.session.id}` })
    const first = await bridge.openStream({
      path: `events?sessionId=${bridge.session.id}`,
      headers: { 'last-event-id': snapshot.json.cursor },
    })
    await send(bridge, 'req-replay', '重放测试')
    const frames = await first.until((frame) => frame.data?.type === 'activity.ended')
    first.close()
    const seenCursors = frames.map((frame) => frame.id)

    // Reattach from the snapshot watermark: every one of those events must be
    // replayed exactly once, in the same order.
    const second = await bridge.openStream({
      path: `events?sessionId=${bridge.session.id}`,
      headers: { 'last-event-id': snapshot.json.cursor },
    })
    await waitFor(() => second.frames.filter((frame) => frame.data !== undefined).length >= frames.length, 2000, 'replay')
    second.close()
    const replayed = second.frames.filter((frame) => frame.data !== undefined).map((frame) => frame.id)
    assert.deepEqual(replayed.slice(0, frames.length), seenCursors)
    const sequences = replayed.map((cursor) => Number(cursor.split('.')[1]))
    for (let index = 1; index < sequences.length; index += 1) {
      assert.equal(sequences[index], sequences[index - 1] + 1, '重放必须连续且不重复')
    }

    // Reattaching with the CURRENT watermark replays nothing.
    await waitFor(() => bridge.agent.status === 'idle', 3000, 'agent idle')
    const newest = await bridge.request({ path: `snapshot?sessionId=${bridge.session.id}` })
    const third = await bridge.openStream({
      path: `events?sessionId=${bridge.session.id}`,
      headers: { 'last-event-id': newest.json.cursor },
    })
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(third.frames.filter((frame) => frame.data !== undefined).length, 0)
    third.close()
  } finally {
    await bridge.stop()
  }
})

test('第二个流取代第一个流（一插件只有一条 SSE）', async () => {
  const bridge = await startBridge()
  try {
    const first = await bridge.openStream({ path: `events?sessionId=${bridge.session.id}` })
    const second = await bridge.openStream({ path: `events?sessionId=${bridge.session.id}` })
    const superseded = await first.next((frame) => frame.commentText === 'superseded', 2000)
    assert.equal(superseded.commentText, 'superseded')
    await send(bridge, 'req-second-stream', '第二条流')
    const frame = await second.next((candidate) => candidate.data?.type === 'message.claimed', 3000)
    assert.equal(frame.data.data.requestId, 'req-second-stream')
    first.close()
    second.close()
  } finally {
    await bridge.stop()
  }
})
