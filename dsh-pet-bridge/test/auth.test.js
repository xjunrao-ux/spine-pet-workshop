// Authentication, authorization, Host/Origin fences, and capability gates.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'

import { startBridge } from './helpers/bridge-host.js'

const TOKEN = 'k'.repeat(64)
const hashOf = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

test('缺少 token 返回 401 且不回显任何凭据', async () => {
  const bridge = await startBridge({ token: TOKEN })
  try {
    const res = await bridge.request({ path: 'info', auth: false })
    assert.equal(res.status, 401)
    assert.equal(res.json.ok, false)
    assert.equal(res.json.error.code, 'UNAUTHORIZED')
    assert.equal(res.headers['www-authenticate'], 'Bearer')
    assert.equal(res.text.includes(TOKEN), false)
  } finally {
    await bridge.stop()
  }
})

test('错误 token 与撤销后的 token 都返回 401', async () => {
  const bridge = await startBridge({ token: TOKEN })
  try {
    const wrong = await bridge.request({ path: 'info', token: 'z'.repeat(64) })
    assert.equal(wrong.status, 401)

    // Revoke: replace the registry with an empty client list.
    writeFileSync(bridge.clientsFile, JSON.stringify({ format: 'dsh-pet-bridge-clients/1', clients: [] }))
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const revoked = await bridge.request({ path: 'info' })
    assert.equal(revoked.status, 401)
    assert.equal(revoked.json.error.code, 'UNAUTHORIZED')
  } finally {
    await bridge.stop()
  }
})

test('撤销 token 关闭对应 SSE 流，但不取消已提交任务', async () => {
  const bridge = await startBridge({ token: TOKEN })
  try {
    const stream = await bridge.openStream({ path: `events?sessionId=${bridge.session.id}`, token: TOKEN })
    const connected = await stream.next((frame) => frame.comment)
    assert.equal(connected.commentText, 'connected')
    writeFileSync(bridge.clientsFile, JSON.stringify({ format: 'dsh-pet-bridge-clients/1', clients: [] }))
    const revokedFrame = await stream.next((frame) => frame.commentText === 'revoked', 3000)
    assert.equal(revokedFrame.commentText, 'revoked')
    stream.close()
    // The plugin keeps running; a new request is refused, not crashed.
    const after = await bridge.request({ path: 'info', token: TOKEN })
    assert.equal(after.status, 401)
  } finally {
    await bridge.stop()
  }
})

test('跨客户端暴露未授权会话一律 403', async () => {
  const tokenA = 'a'.repeat(64)
  const tokenB = 'b'.repeat(64)
  const bridge = await startBridge({ token: tokenA })
  try {
    // Register a second client allowed only on a different session id.
    writeFileSync(bridge.clientsFile, JSON.stringify({
      format: 'dsh-pet-bridge-clients/1',
      clients: [
        {
          clientId: 'pet-a',
          tokenSha256: hashOf(tokenA),
          sessions: [bridge.session.id],
          capabilities: ['sessions.list', 'session.snapshot', 'message.send', 'events.follow', 'requests.lookup'],
          enabled: true,
        },
        {
          clientId: 'pet-b',
          tokenSha256: hashOf(tokenB),
          sessions: ['session-somebody-else'],
          capabilities: ['sessions.list', 'session.snapshot', 'message.send', 'events.follow', 'requests.lookup'],
          enabled: true,
        },
      ],
    }))
    await new Promise((resolve) => setTimeout(resolve, 1200))

    const listing = await bridge.request({ path: 'sessions', token: tokenB })
    assert.equal(listing.status, 200)
    assert.deepEqual(listing.json.items.map((item) => item.sessionId), ['session-somebody-else'])
    assert.equal(listing.json.items[0].available, false)
    assert.equal(listing.json.items[0].status, 'unavailable')

    for (const path of [`snapshot?sessionId=${bridge.session.id}`, `events?sessionId=${bridge.session.id}`]) {
      const res = await bridge.request({ path, token: tokenB })
      assert.equal(res.status, 403, path)
      assert.equal(res.json.error.code, 'FORBIDDEN')
    }
    const command = await bridge.request({
      method: 'POST',
      path: 'commands',
      token: tokenB,
      body: {
        protocol: 'pet-dsh/1',
        instanceId: bridge.instanceId,
        requestId: 'req-cross',
        op: 'message.send',
        sessionId: bridge.session.id,
        data: { mode: 'followup', text: '越权' },
      },
    })
    assert.equal(command.status, 403)
    assert.equal(command.json.error.code, 'FORBIDDEN')
  } finally {
    await bridge.stop()
  }
})

test('拒绝浏览器 Origin（含 null）与陌生 Host', async () => {
  const bridge = await startBridge({ token: TOKEN })
  try {
    for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:19387']) {
      const res = await bridge.request({ path: 'info', headers: { origin } })
      assert.equal(res.status, 403, origin)
      assert.equal(res.json.error.code, 'FORBIDDEN')
    }
    const badHost = await bridge.request({ path: 'info', headers: { host: 'evil.example:80' } })
    assert.equal(badHost.status, 403)
    assert.equal(badHost.json.error.code, 'FORBIDDEN')
    // The real loopback authority is accepted.
    const good = await bridge.request({ path: 'info' })
    assert.equal(good.status, 200)
  } finally {
    await bridge.stop()
  }
})

test('未启用的可选能力不出现在 info 且被拒绝', async () => {
  const bridge = await startBridge({ token: TOKEN, enableSteer: false })
  try {
    const info = await bridge.request({ path: 'info' })
    assert.equal(info.json.capabilities.includes('message.steer'), false)
    assert.equal(info.json.capabilities.includes('session.cancel'), true)
    const steer = await bridge.request({
      method: 'POST',
      path: 'commands',
      body: {
        protocol: 'pet-dsh/1',
        instanceId: bridge.instanceId,
        requestId: 'req-steer-off',
        op: 'message.send',
        sessionId: bridge.session.id,
        data: { mode: 'steer', text: '追加' },
      },
    })
    assert.equal(steer.status, 501)
    assert.equal(steer.json.error.code, 'UNSUPPORTED_CAPABILITY')
  } finally {
    await bridge.stop()
  }
})

test('客户端未获授的能力不出现在 info 且被拒绝', async () => {
  const bridge = await startBridge({
    token: TOKEN,
    capabilities: ['sessions.list', 'session.snapshot'],
  })
  try {
    const info = await bridge.request({ path: 'info' })
    assert.deepEqual(info.json.capabilities.sort(), ['session.snapshot', 'sessions.list'])
    const send = await bridge.request({
      method: 'POST',
      path: 'commands',
      body: {
        protocol: 'pet-dsh/1',
        instanceId: bridge.instanceId,
        requestId: 'req-nocap',
        op: 'message.send',
        sessionId: bridge.session.id,
        data: { mode: 'followup', text: 'x' },
      },
    })
    assert.equal(send.status, 501)
    assert.equal(send.json.error.code, 'UNSUPPORTED_CAPABILITY')
  } finally {
    await bridge.stop()
  }
})

test('方法不符返回 405，未知端点为 404，路径必须带 basePath', async () => {
  const bridge = await startBridge({ token: TOKEN })
  try {
    const method = await bridge.request({ method: 'GET', path: 'commands' })
    assert.equal(method.status, 405)
    assert.equal(method.headers.allow, 'POST')

    const unknown = await bridge.request({ path: 'nothing-here' })
    assert.equal(unknown.status, 404)

    const outside = await bridge.request({ url: bridge.url.replace('/pet-bridge/v1/', '/'), path: 'info' })
    assert.equal(outside.status, 404)
  } finally {
    await bridge.stop()
  }
})
