// Boots the plugin into a fake harness and gives tests raw HTTP/SSE access.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFakeHarness } from './fake-harness.js'

/**
 * Write a `clients.json` document.
 * @param {string} file absolute path.
 * @param {object[]} clients client records.
 */
export function writeClients(file, clients) {
  writeFileSync(file, JSON.stringify({ format: 'dsh-pet-bridge-clients/1', clients }, null, 2))
}

/**
 * Start a bridge instance over the fake harness.
 *
 * @param {object} [options] start options.
 * @param {object} [options.config] extra plugin config.
 * @param {object[]} [options.clients] client records; a default client is created when omitted.
 * @param {string} [options.token] bearer token shared with the default client.
 * @param {string} [options.sessionId] session id; a random one is generated when omitted.
 * @param {string} [options.dataDir] reuse a data directory (restart tests).
 * @param {(context: object) => void} [options.beforeApply] prepare the world before the plugin starts.
 * @returns {Promise<object>} the started bridge plus helpers.
 */
export async function startBridge(options = {}) {
  const harness = options.harness ?? createFakeHarness(options.harnessOptions)
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'pet-bridge-test-'))
  const clientsFile = join(dataDir, 'clients.json')

  const sessionId = options.sessionId ?? `session-${cryptoRandom()}`
  const client = options.clients?.[0] ?? {
    clientId: 'pet-test',
    label: 'test pet',
    tokenSha256: options.tokenSha256 ?? (await sha256HexOf(options.token ?? 'a'.repeat(64))),
    sessions: [sessionId],
    capabilities: options.capabilities ?? ['sessions.list', 'session.snapshot', 'message.send', 'events.follow', 'requests.lookup', 'session.cancel', 'message.steer'],
    enabled: true,
  }
  writeClients(clientsFile, options.clients ?? [client])

  const session = harness.createSession(sessionId, { cwd: options.cwd ?? 'C:\\projects\\demo' })
  const agent = options.agent === null ? null : harness.createAgent(sessionId)
  // The recovery tests need the world prepared (a message already committed, an
  // agent already busy) before the plugin starts and repairs its ledger.
  options.beforeApply?.({ harness, session, agent, dataDir })

  const plugin = await import('../../src/index.js')
  await plugin.apply(harness.ctx, {
    dataDir,
    clientsFile,
    port: 0,
    enableSteer: options.enableSteer ?? true,
    ...options.config,
  })

  const runtime = JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8'))
  const defaultToken = options.token ?? 'a'.repeat(64)

  return {
    harness,
    session,
    agent,
    client,
    dataDir,
    clientsFile,
    token: defaultToken,
    instanceId: runtime.instanceId,
    url: runtime.url,
    // Each helper fills in the token and base URL as defaults, and an explicit
    // field in the call always wins.
    /** @param {object} [overrides] see {@link rawRequest} */
    request: (overrides = {}) => rawRequest({ token: defaultToken, url: runtime.url, ...overrides }),
    /** @param {object} [overrides] see {@link openStream} */
    openStream: (overrides = {}) => openStream({ token: defaultToken, url: runtime.url, ...overrides }),
    /**
     * Stop the plugin and delete its data directory.
     * @param {{keepData?: boolean}} [stopOptions] keep the directory for inspection.
     * @returns {Promise<void>} resolves when stopped.
     */
    async stop(stopOptions = {}) {
      await harness.dispose()
      if (stopOptions.keepData !== true) {
        try {
          rmSync(dataDir, { recursive: true, force: true })
        } catch {
          /* best effort */
        }
      }
    },
  }
}

/**
 * @returns {string} a random hex fragment for session ids.
 */
function cryptoRandom() {
  return Math.random().toString(16).slice(2, 10)
}

/**
 * @param {string} text input.
 * @returns {Promise<string>} hex SHA-256.
 */
async function sha256HexOf(text) {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Perform one HTTP request and collect the whole response.
 *
 * Uses `node:http` rather than `fetch` so tests can set a hostile `Host` or an
 * `Origin` header, which a fetch implementation would rewrite or forbid.
 *
 * @param {object} options request shape.
 * @param {string} options.url absolute base URL (`http://127.0.0.1:port/pet-bridge/v1/`).
 * @param {string} [options.method] HTTP method.
 * @param {string} [options.path] path appended to the base URL.
 * @param {Record<string,string>} [options.headers] extra headers.
 * @param {string|object} [options.body] body (objects are JSON-encoded).
 * @param {boolean} [options.auth] send the bearer token (default true).
 * @param {string} [options.token] token override.
 * @returns {Promise<{status: number, headers: object, text: string, json: any}>} response.
 */
export function rawRequest({ url, method = 'GET', path = '', headers = {}, body, auth = true, token }) {
  const target = new URL(path, url)
  const payload = body === undefined
    ? undefined
    : typeof body === 'string' ? body : JSON.stringify(body)
  const requestHeaders = { ...headers }
  if (auth) {
    requestHeaders.authorization = `Bearer ${token ?? 'a'.repeat(64)}`
    requestHeaders['content-type'] = 'application/json'
  }
  if (payload !== undefined) requestHeaders['content-length'] = Buffer.byteLength(payload)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers: requestHeaders,
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json
          try {
            json = text === '' ? undefined : JSON.parse(text)
          } catch {
            json = undefined
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json })
        })
      },
    )
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

/**
 * Open an SSE stream and expose the parsed frames.
 * @param {object} options stream options (`url`, `path`, `headers`, `token`).
 * @returns {Promise<object>} the stream handle.
 */
export function openStream({ url, path = 'events', headers = {}, token }) {
  const target = new URL(path, url)
  const requestHeaders = {
    ...headers,
    authorization: `Bearer ${token ?? 'a'.repeat(64)}`,
    accept: 'text/event-stream',
  }
  for (const key of Object.keys(requestHeaders)) {
    if (requestHeaders[key] === undefined) delete requestHeaders[key]
  }
  return new Promise((resolve, reject) => {
    const frames = []
    const waiters = []
    let buffer = ''
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: requestHeaders,
      },
      (res) => {
        if (res.statusCode !== 200) {
          const chunks = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            reject(new Error(`SSE 握手失败：${res.statusCode} ${Buffer.concat(chunks).toString('utf8')}`))
          })
          return
        }
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          buffer += chunk
          let index
          while ((index = buffer.indexOf('\n\n')) !== -1) {
            const raw = buffer.slice(0, index)
            buffer = buffer.slice(index + 2)
            const frame = parseFrame(raw)
            frames.push(frame)
            for (const waiter of [...waiters]) {
              const consumed = waiter(frame)
              if (consumed === true) waiters.splice(waiters.indexOf(waiter), 1)
            }
          }
        })
        resolve({
          status: res.statusCode,
          headers: res.headers,
          frames,
          /**
           * Wait for the next frame matching `predicate`.
           * @param {(frame: object) => boolean} [predicate] filter.
           * @param {number} [timeoutMs] wait budget.
           * @returns {Promise<object>} the matching frame.
           */
          next(predicate = () => true, timeoutMs = 3000) {
            const existing = frames.find((frame) => predicate(frame) && !frame.consumed)
            if (existing !== undefined) {
              existing.consumed = true
              return Promise.resolve(existing)
            }
            return new Promise((resolveNext, rejectNext) => {
              const timer = setTimeout(() => {
                waiters.splice(waiters.indexOf(check), 1)
                rejectNext(new Error(`等待 SSE 事件超时（${timeoutMs}ms）；已收到 ${JSON.stringify(frames)}`))
              }, timeoutMs)
              timer.unref?.()
              const check = (frame) => {
                if (!predicate(frame)) return false
                clearTimeout(timer)
                frame.consumed = true
                resolveNext(frame)
                return true
              }
              waiters.push(check)
            })
          },
          /**
           * Collect business frames (those with `data`) until `predicate` matches.
           * Comment frames — heartbeat and lifecycle markers — are skipped.
           * @param {(frame: object) => boolean} predicate stop condition.
           * @param {number} [timeoutMs] wait budget.
           * @returns {Promise<object[]>} collected frames including the last.
           */
          async until(predicate, timeoutMs = 3000) {
            const collected = []
            const start = Date.now()
            for (;;) {
              const remaining = timeoutMs - (Date.now() - start)
              const frame = await this.next((candidate) => candidate.data !== undefined, Math.max(remaining, 1))
              collected.push(frame)
              if (predicate(frame)) return collected
            }
          },
          close() {
            try {
              req.destroy()
            } catch {
              /* already gone */
            }
          },
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

/**
 * @param {string} raw one SSE frame block.
 * @returns {object} parsed frame fields.
 */
export function parseFrame(raw) {
  const frame = { comment: false, event: undefined, id: undefined, data: undefined, raw }
  const dataLines = []
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) {
      frame.comment = true
      frame.commentText = line.slice(1).trim()
      continue
    }
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon)
    const value = line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') frame.event = value
    else if (field === 'id') frame.id = value
    else if (field === 'data') dataLines.push(value)
  }
  if (dataLines.length > 0) {
    frame.dataText = dataLines.join('\n')
    try {
      frame.data = JSON.parse(frame.dataText)
    } catch {
      frame.data = undefined
    }
  }
  return frame
}

/**
 * Wait until `predicate` holds, polling on the microtask/macrotask queue.
 * @param {() => boolean} predicate condition.
 * @param {number} [timeoutMs] wait budget.
 * @param {string} [what] label used in the failure message.
 * @returns {Promise<void>} resolves when the condition holds.
 */
export async function waitFor(predicate, timeoutMs = 3000, what = 'condition') {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`等待 ${what} 超时（${timeoutMs}ms）`)
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}
