// Budgets: request size, JSON shape, text length, snapshot truncation, rate.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { startBridge } from './helpers/bridge-host.js'

/** @param {object} bridge bridge handle. @param {object} data command data. */
const send = (bridge, requestId, data) => bridge.request({
  method: 'POST',
  path: 'commands',
  body: {
    protocol: 'pet-dsh/1',
    instanceId: bridge.instanceId,
    requestId,
    op: 'message.send',
    sessionId: bridge.session.id,
    data,
  },
})

test('超过 64 KiB 的请求体在解析前被拒绝', async () => {
  const bridge = await startBridge()
  try {
    const res = await bridge.request({
      method: 'POST',
      path: 'commands',
      body: JSON.stringify({ padding: 'x'.repeat(70000) }),
    })
    assert.equal(res.status, 413)
    assert.equal(res.json.error.code, 'BODY_TOO_LARGE')
  } finally {
    await bridge.stop()
  }
})

test('畸形 JSON 与错误类型返回 400', async () => {
  const bridge = await startBridge()
  try {
    const malformed = await bridge.request({ method: 'POST', path: 'commands', body: '{not json' })
    assert.equal(malformed.status, 400)
    assert.equal(malformed.json.error.code, 'INVALID_REQUEST')

    const empty = await bridge.request({ method: 'POST', path: 'commands', body: '' })
    assert.equal(empty.status, 400)

    const wrongText = await send(bridge, 'req-type', { mode: 'followup', text: { a: 1 } })
    assert.equal(wrongText.status, 400)

    const longText = await send(bridge, 'req-long', { mode: 'followup', text: '字'.repeat(4001) })
    assert.equal(longText.status, 400)
    assert.match(longText.json.error.message, /4000/)

    const okText = await send(bridge, 'req-edge', { mode: 'followup', text: '字'.repeat(4000) })
    assert.equal(okText.status, 202)
  } finally {
    await bridge.stop()
  }
})

test('未知 op 返回 501 且不落台账', async () => {
  const bridge = await startBridge()
  try {
    const res = await bridge.request({
      method: 'POST',
      path: 'commands',
      body: {
        protocol: 'pet-dsh/1',
        instanceId: bridge.instanceId,
        requestId: 'req-unknown-op',
        op: 'shell.exec',
        sessionId: bridge.session.id,
        data: { command: 'calc' },
      },
    })
    assert.equal(res.status, 501)
    assert.equal(res.json.error.code, 'UNSUPPORTED_CAPABILITY')
    const lookup = await bridge.request({ path: 'requests?requestId=req-unknown-op' })
    assert.equal(lookup.status, 404)
  } finally {
    await bridge.stop()
  }
})

test('snapshot 按条数与字节裁剪并标记 truncated', async () => {
  const bridge = await startBridge({ config: { snapshot: { messageLimit: 20, messageChars: 200 } } })
  try {
    const session = bridge.harness.sessions.get(bridge.session.id)
    // Directly commit history: this is the same log shape the loop writes.
    session.append('turn/start', { turn: 1 })
    for (let index = 0; index < 30; index += 1) {
      session.append('user/message', {
        id: `user-${index}`,
        role: 'user',
        content: [{ type: 'text', text: `问题 ${index} ` + '甲'.repeat(300) }],
        source: { kind: 'user' },
      })
      session.append('assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: `assistant-${index}`,
          role: 'assistant',
          content: [{ type: 'text', text: `回答 ${index} ` + '乙'.repeat(300) }],
          source: { kind: 'model', provider: 'fake', model: 'fake-model' },
        },
      })
    }
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const res = await bridge.request({ path: `snapshot?sessionId=${bridge.session.id}` })
    assert.equal(res.status, 200)
    assert.equal(res.json.truncated, true)
    assert.ok(res.json.messages.length <= 20)
    for (const message of res.json.messages) {
      assert.ok([...message.text].length <= 200, '单条文本必须被裁剪到配置上限')
      assert.ok(typeof message.messageId === 'string' && message.messageId.length > 0, '裁剪必须保留 ID')
    }
    assert.ok(Buffer.byteLength(res.text, 'utf8') <= 262144)

    // The retained messages are the newest ones, in order.
    const ids = res.json.messages.map((message) => message.messageId)
    assert.equal(ids.at(-1), 'assistant-29')
    assert.ok(ids.length >= 2)
  } finally {
    await bridge.stop()
  }
})

test('请求速率受限时返回 429', async () => {
  const bridge = await startBridge({ config: { limits: { responseBytes: 4096 } } })
  try {
    const results = []
    for (let index = 0; index < 40; index += 1) {
      results.push(await bridge.request({ path: 'info' }))
    }
    assert.ok(results.some((res) => res.status === 429), '高频请求应触发限流')
    const limited = results.find((res) => res.status === 429)
    assert.equal(limited.json.error.code, 'OVERLOADED')
    assert.equal(limited.json.error.retryable, true)
  } finally {
    await bridge.stop()
  }
})
