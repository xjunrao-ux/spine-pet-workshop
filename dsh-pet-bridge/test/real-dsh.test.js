// Real-DSH integration: boots the actual DeepSeek Harness 0.1.1-rc.2 plugin
// tree (the `@deepseek-ai/dsh-base` bundle only — no web app, no GUI, no
// network) with this bridge mounted as a real Cordis row, creates a real Agent
// through `ctx.agents.create`, and drives the six endpoints over real loopback
// HTTP + SSE.
//
// Run it with:
//   $env:DSH_BRIDGE_REAL_DSH = '1'; node --test test/real-dsh.test.js
//
// Deliberately NOT part of the default suite: it needs the installed harness
// packages (the repository's `node_modules/@deepseek-ai` junction) and it boots
// the user's real plugin composition. It never calls a paid model: a scripted
// in-memory adapter is registered for a `fake` provider route, and the whole
// tree runs against a throwaway `DSH_HOME`, so no user session, setting or
// credential is read or written.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const enabled = process.env.DSH_BRIDGE_REAL_DSH === '1'

/**
 * A scripted model adapter: text chunks with a configurable delay, honoring the
 * request's abort signal exactly as a real provider would.
 */
function createScriptedAdapter({ text, chunkDelayMs = 40, chunks = 6 }) {
  const { LlmAdapter } = require('@deepseek-ai/dsh-llm')
  return new (class extends LlmAdapter {
    providerInfo(provider) {
      return { id: provider, name: 'scripted' }
    }

    async *stream(options) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      const size = Math.max(1, Math.ceil([...text].length / chunks))
      const chars = [...text]
      for (let index = 0; index < chars.length; index += size) {
        if (options.signal?.aborted === true) {
          const aborted = new Error('aborted by the caller')
          aborted.name = 'AbortError'
          throw aborted
        }
        await new Promise((resolve) => setTimeout(resolve, chunkDelayMs))
        yield { type: 'text-delta', index: 0, text: chars.slice(index, index + size).join('') }
      }
      if (options.signal?.aborted === true) {
        const aborted = new Error('aborted by the caller')
        aborted.name = 'AbortError'
        throw aborted
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 8 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  })()
}

/**
 * @param {string} url base URL.
 * @param {object} options request options.
 * @returns {Promise<{status: number, json: any}>} parsed response.
 */
async function call(url, { method = 'GET', path = '', token, body } = {}) {
  const res = await fetch(new URL(path, url), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, json: text === '' ? undefined : JSON.parse(text) }
}

/**
 * Read SSE frames until `predicate` matches.
 * @param {string} url base URL.
 * @param {string} path stream path.
 * @param {string} token bearer token.
 * @param {(frame: object) => boolean} predicate stop condition.
 * @param {number} [timeoutMs] budget.
 * @returns {Promise<object[]>} business frames collected.
 */
async function readStream(url, path, token, predicate, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const collected = []
  const res = await fetch(new URL(path, url), {
    headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
    signal: controller.signal,
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const dataLine = raw.split('\n').find((line) => line.startsWith('data: '))
        if (dataLine === undefined) continue
        const envelope = JSON.parse(dataLine.slice('data: '.length))
        collected.push(envelope)
        if (predicate(envelope)) return collected
      }
    }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
  return collected
}

test('真实 DSH：六端点驱动的既有会话', { skip: enabled ? false : '设置 DSH_BRIDGE_REAL_DSH=1 才运行' }, async (t) => {
  const realHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE, '.dsh')
  const installAnchor = require.resolve('@deepseek-ai/dsh/package.json')
  const dshDir = join(installAnchor, '..')
  const appBoot = await import('@deepseek-ai/dsh-app-boot')
  const baseLayer = appBoot.loadProfile('dsh', 'desktop', installAnchor, realHome, { userLayer: false })
    .layers.find((layer) => layer.packageName === '@deepseek-ai/dsh-base')
  assert.ok(baseLayer !== undefined, '必须能在真实 profile 中找到 dsh-base 层')

  const work = mkdtempSync(join(tmpdir(), 'pet-bridge-real-'))
  const tempHome = join(work, 'home')
  const projectDir = join(work, 'project')
  mkdirSync(tempHome, { recursive: true })
  mkdirSync(projectDir, { recursive: true })

  const sessionId = `session-${randomUUID()}`
  const token = 'r'.repeat(64)
  const dataDir = join(work, 'bridge')
  mkdirSync(dataDir, { recursive: true })
  const clientsFile = join(dataDir, 'clients.json')
  const { createHash } = require('node:crypto')
  writeFileSync(clientsFile, JSON.stringify({
    format: 'dsh-pet-bridge-clients/1',
    clients: [{
      clientId: 'pet-real',
      label: 'real harness test',
      tokenSha256: createHash('sha256').update(token, 'utf8').digest('hex'),
      sessions: [sessionId],
      capabilities: ['sessions.list', 'session.snapshot', 'message.send', 'events.follow', 'requests.lookup', 'session.cancel'],
      enabled: true,
    }],
  }))

  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = tempHome
  const configPath = join(work, 'cordis.yml')
  writeFileSync(configPath, '# empty root: the whole tree is composed from patch layers\n[]\n')

  const patches = [
    ...baseLayer.patches,
    {
      id: 'agent-presets',
      config: { roots: [{ path: join(dshDir, 'config', 'agent-presets'), trust: 'system' }] },
    },
    {
      insert: [{
        id: 'dsh-pet-bridge',
        name: pathToFileURL(join(import.meta.dirname, '..', 'src', 'index.js')).href,
        config: { dataDir, clientsFile, port: 0, enableSteer: false },
      }],
    },
  ]

  let ctx
  try {
    // Bare package names in the bundle patches resolve from the shared fallback
    // directory the launcher uses, expressed as a file URL (the loader's baseUrl).
    const bareModuleBaseUrl = pathToFileURL(`${join(realHome, 'profiles')}/`).href
    ctx = await appBoot.boot('dsh', configPath, patches, undefined, bareModuleBaseUrl)
    t.diagnostic(`booted DSH tree; services: agents=${ctx.get('agents') !== undefined} sessions=${ctx.get('sessions') !== undefined}`)

    // Scripted model route: no network, no credential, no cost.
    const adapter = createScriptedAdapter({ text: '真实 DSH 集成测试：这条回复由脚本化适配器产生。', chunkDelayMs: 30, chunks: 5 })
    const registration = ctx.llm.registerAdapter(['scripted'], adapter)
    t.after(() => registration())

    const handle = await ctx.agents.create({
      sessionId,
      meta: { cwd: projectDir },
      agentOptions: { provider: 'scripted', model: 'scripted-model' },
    })
    assert.equal(typeof handle.agent.followup, 'function')

    const runtime = JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8'))
    const url = runtime.url
    t.diagnostic(`bridge listening at ${url}`)
    assert.equal(runtime.dshVersion, require('@deepseek-ai/dsh-agent/package.json').version)

    // 1. info
    const info = await call(url, { path: 'info', token })
    assert.equal(info.status, 200)
    assert.deepEqual(info.json.protocols, ['pet-dsh/1'])
    assert.equal(info.json.dshVersion, '0.1.1-rc.2')
    assert.ok(info.json.capabilities.includes('session.cancel'))
    assert.equal(info.json.capabilities.includes('message.steer'), false)

    // 2. sessions — the authorized session is listed as a live, idle agent
    const sessions = await call(url, { path: 'sessions', token })
    assert.equal(sessions.status, 200)
    assert.equal(sessions.json.items.length, 1)
    assert.equal(sessions.json.items[0].sessionId, sessionId)
    assert.equal(sessions.json.items[0].available, true)
    assert.equal(sessions.json.items[0].status, 'idle')
    assert.equal(sessions.json.items[0].workspace, 'project')

    // 3. snapshot — one consistent watermark over real committed history
    const snapshot = await call(url, { path: `snapshot?sessionId=${sessionId}`, token })
    assert.equal(snapshot.status, 200)
    assert.equal(snapshot.json.sessionId, sessionId)
    assert.match(snapshot.json.cursor, new RegExp(`^${info.json.instanceId}\\.\\d+$`))
    assert.deepEqual(snapshot.json.messages, [])

    // 4. message.send → 202, then real turn events on the stream
    const requestId = `req-real-${Date.now()}`
    const streamPromise = readStream(url, `events?sessionId=${sessionId}`, token, (envelope) => envelope.type === 'activity.ended')
    // Give the SSE handshake a moment before submitting.
    await new Promise((resolve) => setTimeout(resolve, 150))
    const send = await call(url, {
      method: 'POST',
      path: 'commands',
      token,
      body: {
        protocol: 'pet-dsh/1',
        instanceId: info.json.instanceId,
        requestId,
        op: 'message.send',
        sessionId,
        data: { mode: 'followup', text: '请用一句话确认你收到了这条来自桌宠的消息。' },
      },
    })
    assert.equal(send.status, 202)
    assert.equal(send.json.data.status, 'accepted')

    const events = await streamPromise
    const types = events.map((envelope) => envelope.type)
    t.diagnostic(`events: ${types.join(', ')}`)
    assert.ok(types.includes('message.claimed'), '未收到 message.claimed')
    assert.ok(types.includes('assistant.delta'), '未收到 assistant.delta')
    assert.ok(types.includes('assistant.message'), '未收到 assistant.message')
    const ended = events.find((envelope) => envelope.type === 'activity.ended')
    assert.equal(ended.data.outcome, 'completed')
    const claimed = events.find((envelope) => envelope.type === 'message.claimed')
    assert.equal(claimed.data.requestId, requestId)
    assert.equal(claimed.requestId, requestId)
    assert.equal(claimed.data.messageId, send.json.data.messageId)
    const message = events.find((envelope) => envelope.type === 'assistant.message')
    assert.equal(message.data.text, '真实 DSH 集成测试：这条回复由脚本化适配器产生。')
    // Every frame carries the real instance and session.
    for (const envelope of events) {
      assert.equal(envelope.instanceId, info.json.instanceId)
      assert.equal(envelope.sessionId, sessionId)
    }

    // 5. requests — the ledger knows the real outcome
    const lookup = await call(url, { path: `requests?requestId=${requestId}`, token })
    assert.equal(lookup.status, 200)
    assert.equal(lookup.json.data.status, 'ended')
    assert.equal(lookup.json.data.outcome, 'completed')
    assert.equal(lookup.json.data.acceptedInstanceId, info.json.instanceId)

    // 6. snapshot now contains the committed exchange
    const after = await call(url, { path: `snapshot?sessionId=${sessionId}`, token })
    assert.equal(after.json.messages.length, 2)
    assert.equal(after.json.messages[0].role, 'user')
    assert.equal(after.json.messages[1].role, 'assistant')

    // 7. idempotent replay of the same request
    const replay = await call(url, {
      method: 'POST',
      path: 'commands',
      token,
      body: {
        protocol: 'pet-dsh/1',
        instanceId: info.json.instanceId,
        requestId,
        op: 'message.send',
        sessionId,
        data: { mode: 'followup', text: '请用一句话确认你收到了这条来自桌宠的消息。' },
      },
    })
    assert.equal(replay.status, 202)
    assert.equal(replay.json.data.messageId, send.json.data.messageId)

    // 8. session.cancel against the real agent loop
    const slowRequestId = `req-cancel-${Date.now()}`
    const cancelStream = readStream(url, `events?sessionId=${sessionId}`, token, (envelope) => envelope.type === 'activity.ended')
    await new Promise((resolve) => setTimeout(resolve, 150))
    const slowSend = await call(url, {
      method: 'POST',
      path: 'commands',
      token,
      body: {
        protocol: 'pet-dsh/1',
        instanceId: info.json.instanceId,
        requestId: slowRequestId,
        op: 'message.send',
        sessionId,
        data: { mode: 'followup', text: '请输出一段足够长的文字以便中途取消。' },
      },
    })
    assert.equal(slowSend.status, 202)
    // Wait until the activity is observable, then cancel it.
    let activityId
    for (let attempt = 0; attempt < 60 && activityId === undefined; attempt += 1) {
      const live = await call(url, { path: `snapshot?sessionId=${sessionId}`, token })
      if (live.json.activity !== null) activityId = live.json.activity.activityId
      else await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.ok(activityId !== undefined, '未能观察到正在执行的活动')
    const cancel = await call(url, {
      method: 'POST',
      path: 'commands',
      token,
      body: {
        protocol: 'pet-dsh/1',
        instanceId: info.json.instanceId,
        requestId: `${slowRequestId}-cancel`,
        op: 'session.cancel',
        sessionId,
        data: { activityId },
      },
    })
    assert.equal(cancel.status, 200)
    assert.equal(cancel.json.data.status, 'cancelling')
    const cancelEvents = await cancelStream
    const cancelEnd = cancelEvents.find((envelope) => envelope.type === 'activity.ended')
    assert.equal(cancelEnd.data.outcome, 'cancelled')
    assert.equal(cancelEnd.data.activityId, activityId)

    // 9. the underlying session is intact and still usable afterwards
    assert.equal(ctx.sessions.get(sessionId)?.events.length > 0, true)
    const finalLookup = await call(url, { path: `requests?requestId=${slowRequestId}`, token })
    assert.equal(finalLookup.json.data.status, 'ended')
    assert.equal(finalLookup.json.data.outcome, 'cancelled')

    // 10. lifecycle: unloading the plugin releases the port and its runtime file
    //     while the DSH session it borrowed survives.
    const eventsBeforeUnload = ctx.sessions.get(sessionId).events.length
    await handle.dispose()
    await ctx.fiber.dispose()
    const disposed = ctx
    ctx = undefined
    t.diagnostic('tree disposed; bridge teardown assertions follow')
    assert.equal(existsSync(join(dataDir, 'runtime.json')), false, '停止后必须删除 runtime.json')
    await assert.rejects(
      fetch(new URL('info', url), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) }),
      '停止后端口必须关闭',
    )
    assert.ok(eventsBeforeUnload > 0)
  } finally {
    try {
      await ctx?.fiber.dispose()
    } catch {
      /* teardown of a partially booted tree */
    }
    process.env.DSH_HOME = previousHome
    try {
      rmSync(work, { recursive: true, force: true })
    } catch {
      /* temp dir */
    }
  }
})
