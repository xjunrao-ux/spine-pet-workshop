// Crash recovery: the ledger states a killed process can leave behind.
//
// Each case starts from a hand-written `received` record — exactly what the
// journal would hold if the process died between journaling an intent and
// recording its acceptance — and asserts the verdict the adapter can *prove*.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { startBridge } from './helpers/bridge-host.js'

/**
 * Seed a `received` record into a fresh data directory.
 * @param {string} dataDir plugin data directory.
 * @param {object} record journal record.
 */
function seedJournal(dataDir, record) {
  const journalDir = join(dataDir, 'journal')
  mkdirSync(journalDir, { recursive: true })
  writeFileSync(join(journalDir, 'requests.jsonl'), `${JSON.stringify(record)}\n`)
}

/**
 * @param {object} overrides record fields.
 * @returns {object} a journal `received` record.
 */
const receivedRecord = (overrides) => ({
  format: 'dsh-pet-bridge-journal/1',
  n: 1,
  t: Date.now() - 60000,
  kind: 'received',
  clientId: 'pet-test',
  requestId: 'req-recover-1',
  payloadHash: 'a'.repeat(64),
  op: 'message.send',
  sessionId: 'session-recover',
  messageId: 'msg-unknown',
  ...overrides,
})

test('已出现在会话日志中的消息恢复为 accepted', async () => {
  const sessionId = 'session-recover'
  const messageId = '11111111-2222-4333-8444-555555555555'
  const seen = []
  const bridge = await startBridge({
    sessionId,
    beforeApply: ({ session, dataDir }) => {
      // The message committed before the crash: the loop claimed and logged it.
      session.append('turn/start', { turn: 1 })
      session.append('user/message', { id: messageId, role: 'user', content: [{ type: 'text', text: '已入队' }], source: { kind: 'user' } })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      seedJournal(dataDir, receivedRecord({ sessionId, messageId }))
    },
  })
  try {
    const lookup = await bridge.request({ path: 'requests?requestId=req-recover-1' })
    seen.push(lookup.status)
    assert.equal(lookup.status, 200)
    assert.ok(['accepted', 'running'].includes(lookup.json.data.status), `实际 ${lookup.json.data.status}`)
  } finally {
    await bridge.stop()
  }
})

test('仍在 inbox 中的消息恢复为 accepted', async () => {
  const bridge = await startBridge({
    sessionId: 'session-recover',
    beforeApply: ({ agent, dataDir }) => {
      agent.inbox.nextTurn.push({
        id: 'msg-in-inbox',
        role: 'user',
        content: [{ type: 'text', text: '排队中' }],
        source: { kind: 'user' },
      })
      seedJournal(dataDir, receivedRecord({ messageId: 'msg-in-inbox' }))
    },
  })
  try {
    const lookup = await bridge.request({ path: 'requests?requestId=req-recover-1' })
    assert.equal(lookup.status, 200)
    assert.ok(['accepted', 'running'].includes(lookup.json.data.status))
  } finally {
    await bridge.stop()
  }
})

test('日志与 inbox 都没有该消息且 Agent 空闲时证明为 rejected', async () => {
  const bridge = await startBridge({
    sessionId: 'session-recover',
    beforeApply: ({ dataDir }) => {
      seedJournal(dataDir, receivedRecord({ messageId: 'msg-never-delivered' }))
    },
  })
  try {
    const lookup = await bridge.request({ path: 'requests?requestId=req-recover-1' })
    assert.equal(lookup.status, 200)
    assert.equal(lookup.json.data.status, 'rejected')
    assert.equal(lookup.json.data.error.code, 'CANCELLED')
  } finally {
    await bridge.stop()
  }
})

test('无法证明时返回 unknown，不自动重发', async () => {
  const bridge = await startBridge({
    sessionId: 'session-recover',
    beforeApply: ({ agent, dataDir }) => {
      agent.status = 'running'
      seedJournal(dataDir, receivedRecord({ messageId: 'msg-maybe' }))
    },
  })
  try {
    const lookup = await bridge.request({ path: 'requests?requestId=req-recover-1' })
    assert.equal(lookup.status, 200)
    assert.equal(lookup.json.data.status, 'unknown')
    assert.equal(lookup.json.data.error.code, 'RESULT_UNKNOWN')

    // A retry with the same requestId gets the recorded verdict, not a resend.
    const turnsBefore = bridge.session.events.filter((event) => event.type === 'turn/start').length
    const retry = await bridge.request({
      method: 'POST',
      path: 'commands',
      body: {
        protocol: 'pet-dsh/1',
        instanceId: bridge.instanceId,
        requestId: 'req-recover-1',
        op: 'message.send',
        sessionId: bridge.session.id,
        data: { mode: 'followup', text: '重发' },
      },
    })
    // Different payload for the same requestId is a conflict; the point is that
    // nothing executed.
    assert.equal(retry.status, 409)
    assert.equal(retry.json.error.code, 'REQUEST_CONFLICT')
    const turnsAfter = bridge.session.events.filter((event) => event.type === 'turn/start').length
    assert.equal(turnsAfter, turnsBefore)
  } finally {
    await bridge.stop()
  }
})

test('会话既不在注册表也不在存储中时返回 unknown', async () => {
  const bridge = await startBridge({
    sessionId: 'session-recover',
    beforeApply: ({ dataDir }) => {
      seedJournal(dataDir, receivedRecord({ sessionId: 'session-gone-forever', messageId: 'msg-x' }))
    },
  })
  try {
    const lookup = await bridge.request({ path: 'requests?requestId=req-recover-1' })
    assert.equal(lookup.status, 200)
    assert.equal(lookup.json.data.status, 'unknown')
  } finally {
    await bridge.stop()
  }
})
