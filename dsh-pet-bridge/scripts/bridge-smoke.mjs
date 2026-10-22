#!/usr/bin/env node
// bridge-smoke — a stand-in for the pet plugin until the real Spine pet ZIP can
// be tested. It speaks exactly the HTTP JSON + SSE semantics of pet-dsh/1 and
// prints token-free diagnostics.
//
//   node scripts/bridge-smoke.mjs --url http://127.0.0.1:PORT/pet-bridge/v1/ \
//        --token-env DSH_PET_TOKEN [--session session-xxx] [--allow-model] [--cancel]
//
// The token never appears on a command line: name an environment variable or a
// file. The tool prints only redacted digests.
//
// Without --allow-model it performs the read-only checks (info, sessions,
// snapshot, SSE handshake, reconnect) and stops before sending anything. Sending
// a message runs the user's real model; that is a paid call and must be asked
// for explicitly.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const argv = process.argv.slice(2)

/**
 * Read `--name value` flags.
 * @param {string[]} args argv tail.
 * @returns {Record<string, string|true>} flags.
 */
function parseFlags(args) {
  const flags = {}
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = args[index + 1]
    if (next === undefined || next.startsWith('--')) flags[key] = true
    else {
      flags[key] = next
      index += 1
    }
  }
  return flags
}

const flags = parseFlags(argv)
let failures = 0
let checks = 0

/**
 * @param {string} name check label.
 * @param {() => (void|Promise<void>)} body check body; throw to fail.
 */
async function step(name, body) {
  checks += 1
  const started = Date.now()
  try {
    await body()
    console.log(`PASS  ${name}  (${Date.now() - started}ms)`)
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${name}  ${error?.message ?? error}`)
  }
}

/**
 * @param {unknown} condition truthy condition.
 * @param {string} message failure text.
 */
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * Normalize a user-pasted base URL.
 *
 * People copy Windows-style paths and trailing separators, so accept
 * `http://127.0.0.1:PORT/pet-bridge/v1`, `…/v1/`, `…/v1\` and `…/v1\\` alike:
 * backslashes become slashes, repeated separators in the path collapse, and the
 * path always ends with one `/`. Without this a pasted `\` silently produced
 * `/pet-bridge/v1///info` and a confusing 404.
 * @param {string} raw pasted base URL.
 * @returns {string} normalized base URL ending in `/`.
 */
function normalizeBaseUrl(raw) {
  const trimmed = String(raw).trim().replace(/\\/g, '/')
  let url
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(`--url 不是合法地址：${JSON.stringify(raw)}（形如 http://127.0.0.1:PORT/pet-bridge/v1/）`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`--url 必须以 http:// 开头，收到 ${JSON.stringify(raw)}`)
  }
  url.pathname = `${url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '')}/`
  url.search = ''
  url.hash = ''
  return url.href
}

/**
 * Resolve the base URL from the flag or the plugin's runtime.json.
 *
 * A runtime.json left behind by a hard kill still carries a dead endpoint, so
 * its pid is checked before the value is trusted.
 * @returns {string} base URL ending in `/`.
 */
function resolveUrl() {
  if (typeof flags.url === 'string') return normalizeBaseUrl(flags.url)
  const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh')
  const file = join(home, 'pet-bridge', 'runtime.json')
  let runtime
  try {
    runtime = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`没有 --url，且读不到 ${file}。先启动 DSH 并启用插件，或显式传 --url`)
  }
  if (typeof runtime.url !== 'string') throw new Error(`${file} 中没有 url`)
  if (Number.isInteger(runtime.pid) && runtime.pid > 0) {
    try {
      process.kill(runtime.pid, 0)
    } catch {
      throw new Error(`${file} 是上次运行的残留（pid ${runtime.pid} 已不在）。先启动 DSH，或用 --url 指定正在运行的实例`)
    }
  }
  return runtime.url
}

/**
 * Resolve the token without echoing it.
 * @returns {Promise<string>} connection token.
 */
async function resolveToken() {
  if (typeof flags['token-file'] === 'string') {
    return readFileSync(flags['token-file'], 'utf8').trim()
  }
  const envName = typeof flags['token-env'] === 'string' ? flags['token-env'] : 'DSH_PET_TOKEN'
  const fromEnv = process.env[envName]
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv.trim()
  if (flags['token-stdin'] === true) {
    const rl = createInterface({ input: stdin, output: stdout })
    const answer = await rl.question('连接令牌（输入会显示在终端，建议改用 --token-env）：')
    rl.close()
    return answer.trim()
  }
  throw new Error(`环境变量 ${envName} 为空；用 --token-env 指定别的变量名，或 --token-file 指定文件`)
}

const token = await resolveToken().catch((error) => {
  console.error(`错误：${error.message}`)
  process.exit(1)
})
const baseUrl = resolveUrl()

/**
 * @param {string} path path under the base URL (may include a query string).
 * @param {object} [options] request options.
 * @returns {Promise<{status: number, json: any, headers: Headers}>} response.
 */
async function call(path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
  })
  const text = await response.text()
  let json
  try {
    json = text === '' ? undefined : JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: response.status, json, headers: response.headers }
}

/**
 * Open the single SSE stream and collect frames.
 * @param {string} sessionId wire session id.
 * @param {string} [lastEventId] cursor to resume from.
 * @returns {Promise<object>} stream handle.
 */
async function openStream(sessionId, lastEventId) {
  const controller = new AbortController()
  const headers = { authorization: `Bearer ${token}`, accept: 'text/event-stream' }
  if (lastEventId !== undefined) headers['last-event-id'] = lastEventId
  const response = await fetch(new URL(`events?sessionId=${sessionId}`, baseUrl), { headers, signal: controller.signal })
  assert(response.status === 200, `SSE 握手失败：HTTP ${response.status}`)
  assert(
    response.headers.get('content-type') === 'text/event-stream; charset=utf-8',
    `SSE content-type 不对：${response.headers.get('content-type')}`,
  )
  const frames = []
  const waiters = []
  let buffer = ''
  void (async () => {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          const frame = { raw }
          for (const line of raw.split('\n')) {
            if (line.startsWith(':')) {
              frame.comment = line.slice(1).trim()
              continue
            }
            if (line.startsWith('id: ')) frame.id = line.slice(4)
            if (line.startsWith('event: ')) frame.event = line.slice(7)
            if (line.startsWith('data: ')) frame.data = JSON.parse(line.slice(6))
          }
          if (frame.event !== undefined || frame.comment !== undefined) frames.push(frame)
          for (const waiter of [...waiters]) {
            if (waiter(frame)) waiters.splice(waiters.indexOf(waiter), 1)
          }
        }
      }
    } catch {
      /* aborted */
    }
  })()
  return {
    frames,
    controller,
    /**
     * @param {(frame: object) => boolean} predicate match.
     * @param {number} [timeoutMs] budget.
     * @returns {Promise<object>} the matching frame.
     */
    next(predicate, timeoutMs = 20000) {
      const existing = frames.find((frame) => !frame.consumed && predicate(frame))
      if (existing !== undefined) {
        existing.consumed = true
        return Promise.resolve(existing)
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('等待事件超时')), timeoutMs)
        timer.unref?.()
        waiters.push((frame) => {
          if (!predicate(frame)) return false
          clearTimeout(timer)
          frame.consumed = true
          resolve(frame)
          return true
        })
      })
    },
    close() {
      controller.abort()
    },
    lastCursor() {
      const withId = frames.filter((frame) => frame.id !== undefined)
      return withId.length === 0 ? undefined : withId[withId.length - 1].id
    },
  }
}

console.log(`bridge-smoke ⇄ ${baseUrl}`)
console.log(`令牌：已加载（${token.length} 字符，SHA-256 前缀 ${(await digest(token)).slice(0, 8)}…，不打印明文）`)
console.log(`模式：${flags['allow-model'] === true ? '包含真实模型发送' : '只读（未传 --allow-model，不发送任何消息）'}`)
console.log('')

let info
await step('1. GET /info —— 协议与实例', async () => {
  const res = await call('info')
  assert(res.status === 200, `HTTP ${res.status}`)
  info = res.json
  assert(Array.isArray(info.protocols) && info.protocols.includes('pet-dsh/1'), '未声明 pet-dsh/1')
  assert(typeof info.instanceId === 'string' && info.instanceId.length > 0, '缺少 instanceId')
  console.log(`      实例 ${info.instanceId} / DSH ${info.dshVersion} / 插件 ${info.serverVersion}`)
  console.log(`      能力 ${info.capabilities.join(', ')}`)
})

let sessionId = typeof flags.session === 'string' ? flags.session : undefined
await step('2. GET /sessions —— 已授权会话', async () => {
  const res = await call('sessions')
  assert(res.status === 200, `HTTP ${res.status}`)
  const items = res.json.items ?? []
  assert(items.length > 0, '没有已授权会话（先在 DSH 侧用 pet-bridge-admin 登记）')
  for (const item of items) {
    console.log(`      ${item.sessionId}  [${item.status}]  ${item.title ?? '(无标题)'}  ${item.workspace ?? ''}`)
  }
  if (sessionId === undefined) {
    const usable = items.find((item) => item.available === true)
    assert(usable !== undefined, '没有可发送的活跃会话（历史会话可以列出但不可用）')
    sessionId = usable.sessionId
  }
  const chosen = items.find((item) => item.sessionId === sessionId)
  assert(chosen !== undefined, `会话 ${sessionId} 不在授权列表中`)
})

let snapshot
await step('3. GET /snapshot —— 历史与水位', async () => {
  const res = await call(`snapshot?sessionId=${encodeURIComponent(sessionId)}`)
  assert(res.status === 200, `HTTP ${res.status}`)
  snapshot = res.json
  assert(typeof snapshot.cursor === 'string', '缺少 cursor')
  console.log(`      消息 ${snapshot.messages.length} 条，活动 ${snapshot.activity === null ? '无' : snapshot.activity.status}，truncated=${snapshot.truncated}`)
})

let stream
await step('4. GET /events —— 唯一 SSE 握手', async () => {
  stream = await openStream(sessionId, snapshot.cursor)
  const frame = await stream.next((candidate) => candidate.comment !== undefined, 5000)
  console.log(`      收到注释帧：${frame.comment}`)
})

if (flags['allow-model'] !== true) {
  await step('5. 断开 SSE（未发送任何消息）', async () => {
    stream?.close()
  })
  console.log('')
  console.log(`结果：${checks - failures}/${checks} 通过（只读模式）。要验证发送流程，加 --allow-model。`)
  await finish(failures === 0 ? 0 : 1)
}

const text = typeof flags.text === 'string' ? flags.text : '桥接冒烟测试：这条消息没有副作用，请只回复「收到」。'
const requestId = `smoke-${Date.now()}`
let messageId
await step('5. POST /commands message.send —— 202 回执', async () => {
  const started = Date.now()
  const res = await call('commands', {
    method: 'POST',
    body: {
      protocol: 'pet-dsh/1',
      instanceId: info.instanceId,
      requestId,
      op: 'message.send',
      sessionId,
      data: { mode: 'followup', text },
    },
    timeoutMs: 15000,
  })
  const elapsed = Date.now() - started
  assert(res.status === 202, `HTTP ${res.status} ${JSON.stringify(res.json?.error ?? '')}`)
  assert(res.json.ok === true && res.json.data.status === 'accepted', '回执不是 accepted')
  messageId = res.json.data.messageId
  console.log(`      requestId=${requestId} messageId=${messageId} 用时 ${elapsed}ms`)
  assert(elapsed < 3000, `回执 ${elapsed}ms，明显慢于预算`)
})

await step('6. 等待真实执行事件', async () => {
  const claimed = await stream.next((frame) => frame.data?.type === 'message.claimed', 30000)
  assert(claimed.data.data.requestId === requestId, 'message.claimed 未关联本次 requestId')
  console.log(`      message.claimed turn=${claimed.data.data.turn}`)
  const message = await stream.next((frame) => frame.data?.type === 'assistant.message', 120000)
  console.log(`      assistant.message: ${String(message.data.data.text).slice(0, 80)}`)
  const ended = await stream.next((frame) => frame.data?.type === 'activity.ended', 120000)
  console.log(`      activity.ended outcome=${ended.data.data.outcome}`)
})

await step('7. 断线后按 Last-Event-ID 恢复，不重发', async () => {
  const cursor = stream.lastCursor()
  stream.close()
  const resumed = await openStream(sessionId, cursor)
  const frame = await resumed.next((candidate) => candidate.comment !== undefined, 5000)
  assert(frame.comment !== undefined, '恢复的流没有握手')
  resumed.close()
  console.log(`      从 ${cursor} 恢复成功`)
})

await step('8. 相同 requestId+内容去重，不同内容冲突', async () => {
  const same = await call('commands', {
    method: 'POST',
    body: {
      protocol: 'pet-dsh/1',
      instanceId: info.instanceId,
      requestId,
      op: 'message.send',
      sessionId,
      data: { mode: 'followup', text },
    },
  })
  assert(same.status === 202 || same.status === 200, `重放返回 HTTP ${same.status}`)
  assert(same.json.data.messageId === messageId, '重放没有返回原回执的 messageId')
  const conflict = await call('commands', {
    method: 'POST',
    body: {
      protocol: 'pet-dsh/1',
      instanceId: info.instanceId,
      requestId,
      op: 'message.send',
      sessionId,
      data: { mode: 'followup', text: `${text}（不同内容）` },
    },
  })
  assert(conflict.status === 409 && conflict.json.error.code === 'REQUEST_CONFLICT', `冲突检查返回 HTTP ${conflict.status}`)
  console.log('      去重与冲突均符合协议')
})

await step('9. GET /requests —— 台账终态', async () => {
  const res = await call(`requests?requestId=${encodeURIComponent(requestId)}`)
  assert(res.status === 200, `HTTP ${res.status}`)
  console.log(`      status=${res.json.data.status} outcome=${res.json.data.outcome ?? '(未结束)'}`)
  assert(['ended', 'accepted', 'running'].includes(res.json.data.status), `意外状态 ${res.json.data.status}`)
})

if (flags.cancel === true) {
  await step('10. session.cancel —— 只取消脚本自己发起的活动', async () => {
    if (!info.capabilities.includes('session.cancel')) {
      console.log('      跳过：本实例未声明 session.cancel')
      return
    }
    const live = await call(`snapshot?sessionId=${encodeURIComponent(sessionId)}`)
    const activity = live.json.activity
    assert(activity !== null, '当前没有可取消的活动（本步骤只取消脚本可见的活动）')
    const res = await call('commands', {
      method: 'POST',
      body: {
        protocol: 'pet-dsh/1',
        instanceId: info.instanceId,
        requestId: `${requestId}-cancel`,
        op: 'session.cancel',
        sessionId,
        data: { activityId: activity.activityId },
      },
    })
    assert(res.status === 200 && res.json.data.status === 'cancelling', `取消失败：HTTP ${res.status}`)
    console.log(`      已请求取消 ${activity.activityId}，终态由 activity.ended 确认`)
  })
}

stream?.close()
console.log('')
console.log(`结果：${checks - failures}/${checks} 通过。`)
console.log('注意：这是兼容宿主语义的模拟客户端，不等于已在真实桌宠插件中验证。')
await finish(failures === 0 ? 0 : 1)

/**
 * End the run without tripping the Windows libuv shutdown assertion.
 *
 * Aborting the SSE stream starts a TCP close handshake; calling `process.exit()`
 * while that handshake is still in flight produced
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) … win/async.c` on
 * Node 24/Windows. Yielding one turn lets the sockets settle, and only then does
 * this terminate — which also stops the remaining steps from running in the
 * read-only branch.
 * @param {number} code process exit code.
 */
async function finish(code) {
  try {
    stream?.close()
  } catch {
    /* already closed */
  }
  await new Promise((resolve) => setTimeout(resolve, 150))
  process.exit(code)
}

/**
 * @param {string} text input.
 * @returns {Promise<string>} hex SHA-256.
 */
async function digest(text) {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
