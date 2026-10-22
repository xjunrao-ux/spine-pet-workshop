// Ledger: durability across restarts, conflict detection, corruption handling.

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { startBridge } from './helpers/bridge-host.js'
import { RequestJournal } from '../src/request-journal.js'

const quietLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

/** @param {object} bridge bridge handle. @param {string} requestId id. @param {string} text body. */
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

test('台账跨重启保留回执与终态', async () => {
  const first = await startBridge({ sessionId: `session-journal-${Date.now()}` })
  let dataDir
  let sessionId
  try {
    dataDir = first.dataDir
    sessionId = first.session.id
    const res = await send(first, 'req-persist-1', '持久化测试')
    assert.equal(res.status, 202)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const before = await first.request({ path: 'requests?requestId=req-persist-1' })
    assert.equal(before.json.data.status, 'ended')
  } finally {
    await first.stop({ keepData: true })
  }

  const second = await startBridge({ dataDir, sessionId })
  try {
    const after = await second.request({ path: 'requests?requestId=req-persist-1' })
    assert.equal(after.status, 200)
    assert.equal(after.json.data.status, 'ended')
    assert.equal(after.json.data.outcome, 'completed')
    assert.equal(after.json.data.op, 'message.send')
    assert.equal(after.json.data.acceptedInstanceId !== undefined, true)
    // A fresh instance id proves this is a new run reading an old record.
    assert.notEqual(after.json.instanceId, first.instanceId)
  } finally {
    await second.stop()
  }
})

test('中断写入的尾记录被截断且不影响已提交状态', async () => {
  const first = await startBridge({ sessionId: `session-torn-${Date.now()}` })
  let dataDir
  let sessionId
  try {
    dataDir = first.dataDir
    sessionId = first.session.id
    await send(first, 'req-torn-1', '正常记录')
    await new Promise((resolve) => setTimeout(resolve, 150))
  } finally {
    await first.stop({ keepData: true })
  }

  const logPath = join(dataDir, 'journal', 'requests.jsonl')
  const original = readFileSync(logPath, 'utf8')
  writeFileSync(logPath, `${original}{"format":"dsh-pet-bridge-journal/1","n":99,"kind":"rec`)

  const second = await startBridge({ dataDir, sessionId })
  try {
    const repaired = readFileSync(logPath, 'utf8')
    assert.equal(repaired, original, '只截断未写完的尾记录，不重写已有内容')
    const lookup = await second.request({ path: 'requests?requestId=req-torn-1' })
    assert.equal(lookup.status, 200)
    assert.equal(lookup.json.data.status, 'ended')
    // The journal still accepts new work after the repair.
    const res = await send(second, 'req-torn-2', '修复后的新请求')
    assert.equal(res.status, 202)
  } finally {
    await second.stop()
  }
})

test('中间记录损坏时台账转只读并拒绝新副作用', async () => {
  const first = await startBridge({ sessionId: `session-corrupt-${Date.now()}` })
  let dataDir
  let sessionId
  try {
    dataDir = first.dataDir
    sessionId = first.session.id
    await send(first, 'req-corrupt-1', '第一条')
    await new Promise((resolve) => setTimeout(resolve, 150))
    await send(first, 'req-corrupt-2', '第二条')
    await new Promise((resolve) => setTimeout(resolve, 150))
  } finally {
    await first.stop({ keepData: true })
  }

  const logPath = join(dataDir, 'journal', 'requests.jsonl')
  const lines = readFileSync(logPath, 'utf8').split('\n')
  const corrupted = [lines[0], '{"broken":true}', ...lines.slice(1)].join('\n')
  writeFileSync(logPath, corrupted)
  const preserved = readFileSync(logPath, 'utf8')

  const second = await startBridge({ dataDir, sessionId })
  try {
    const res = await send(second, 'req-corrupt-3', '应被拒绝')
    assert.equal(res.status, 500)
    assert.equal(res.json.error.code, 'INTERNAL_ERROR')
    assert.equal(readFileSync(logPath, 'utf8'), preserved, '损坏文件必须保留原件')
    // Previously recorded terminal states are still readable.
    const lookup = await second.request({ path: 'requests?requestId=req-corrupt-1' })
    assert.equal(lookup.status, 200)
  } finally {
    await second.stop()
  }
})

test('保留期满清理终态记录，不清理不确定记录', () => {
  const dir = join(process.env.TEMP ?? '/tmp', `pet-bridge-journal-${Date.now()}`)
  const journal = RequestJournal.open({ dir, retentionHours: 24, compactBytes: 1 << 20, fsync: false, log: quietLog })
  const old = Date.now() - 25 * 3600 * 1000
  try {
    const ended = journal.begin({ clientId: 'c', requestId: 'ended-1', payloadHash: 'h', op: 'message.send', sessionId: 's', messageId: 'm1' })
    journal.markEnded(ended, 'completed', { activityId: 'act.1' })
    ended.endedAt = old
    const unknown = journal.begin({ clientId: 'c', requestId: 'unknown-1', payloadHash: 'h', op: 'message.send', sessionId: 's', messageId: 'm2' })
    journal.markUnknown(unknown, 'RESULT_UNKNOWN', 'unprovable')
    unknown.updatedAt = old

    const removed = journal.sweep()
    assert.equal(removed, 1, '只清理超过保留期的终态记录')
    assert.equal(journal.lookup('c', 'ended-1'), undefined)
    assert.notEqual(journal.lookup('c', 'unknown-1'), undefined, '不确定记录必须保留')
  } finally {
    journal.close()
  }
})

test('相同内容再次 begin 不会产生第二条记录', () => {
  const dir = join(process.env.TEMP ?? '/tmp', `pet-bridge-journal2-${Date.now()}`)
  const journal = RequestJournal.open({ dir, retentionHours: 24, compactBytes: 1 << 20, fsync: true, log: quietLog })
  try {
    const entry = journal.begin({ clientId: 'c', requestId: 'r1', payloadHash: 'h', op: 'message.send', sessionId: 's', messageId: 'm' })
    assert.equal(entry.status, 'received')
    assert.throws(
      () => journal.begin({ clientId: 'c', requestId: 'r1', payloadHash: 'h', op: 'message.send', sessionId: 's', messageId: 'm' }),
      /requestId 已存在/,
    )
    journal.markAccepted(entry, { activityId: 'act.1', instanceId: 'instance-a' })
    assert.equal(journal.lookup('c', 'r1').status, 'accepted')
    journal.markEnded(entry, 'cancelled', { activityId: 'act.1' })
    assert.equal(journal.lookup('c', 'r1').status, 'ended')
    assert.equal(journal.lookup('c', 'r1').outcome, 'cancelled')
  } finally {
    journal.close()
  }
})
