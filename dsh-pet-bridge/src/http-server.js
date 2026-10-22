// Loopback HTTP surface: Host/Origin fence, bearer authentication, limits, routes.
//
// The listener is created by this plugin rather than registered on the DSH web
// carrier on purpose: the bridge must work in a desktop/headless profile with no
// web server, and its address must not move when the GUI's port changes
// (protocol §2, development guide §4).

import { createServer } from 'node:http'

import {
  BridgeError,
  LIMITS,
  PROTOCOL,
  clampText,
  errorEnvelope,
  okEnvelope,
  serializeBounded,
  utf8Length,
} from './wire.js'

/** Paths under `basePath`, in route-table form. */
const ROUTES = Object.freeze({
  info: { method: 'GET' },
  sessions: { method: 'GET' },
  snapshot: { method: 'GET' },
  commands: { method: 'POST' },
  requests: { method: 'GET' },
  events: { method: 'GET' },
})

/**
 * Token bucket used to bound request rate per authenticated client.
 */
class RateLimiter {
  /**
   * @param {{capacity: number, refillPerSecond: number}} options bucket shape.
   */
  constructor({ capacity, refillPerSecond }) {
    this.capacity = capacity
    this.refillPerSecond = refillPerSecond
    /** @type {Map<string, {tokens: number, updatedAt: number}>} */
    this.buckets = new Map()
  }

  /**
   * @param {string} key bucket key (client id).
   * @returns {boolean} whether one token was available.
   */
  take(key) {
    const now = Date.now()
    let bucket = this.buckets.get(key)
    if (bucket === undefined) {
      bucket = { tokens: this.capacity, updatedAt: now }
      this.buckets.set(key, bucket)
    }
    const elapsed = (now - bucket.updatedAt) / 1000
    if (elapsed > 0) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSecond)
      bucket.updatedAt = now
    }
    if (bucket.tokens < 1) return false
    bucket.tokens -= 1
    return true
  }
}

/**
 * Read the request body with a hard byte ceiling, before any JSON parsing.
 * @param {import('node:http').IncomingMessage} req request.
 * @param {number} limitBytes maximum accepted bytes.
 * @param {number} timeoutMs read budget.
 * @returns {Promise<Buffer>} the body.
 * @throws {BridgeError} BODY_TOO_LARGE / INVALID_REQUEST.
 */
function readBody(req, limitBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new BridgeError('OVERLOADED', '读取请求体超时', { retryable: true }))
      req.destroy()
    }, timeoutMs)
    timer.unref?.()
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limitBytes) {
        // Stop consuming, but do not destroy the socket: the caller still owes
        // the client a JSON 413. The response marks `Connection: close` and the
        // unread remainder is dropped by the server.
        finish(new BridgeError('BODY_TOO_LARGE', `请求体超过 ${limitBytes} 字节`, { status: 413 }))
        req.pause()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(null, Buffer.concat(chunks)))
    req.on('error', (error) => finish(new BridgeError('INVALID_REQUEST', `读取请求体失败：${error.code ?? 'IO'}`)))
    req.on('aborted', () => finish(new BridgeError('INVALID_REQUEST', '请求被中断')))
  })
}

/**
 * Write one JSON response with the protocol's mandatory headers.
 * @param {import('node:http').ServerResponse} res response.
 * @param {number} status HTTP status.
 * @param {object} body envelope.
 * @param {number} budget response byte budget.
 * @param {object} log logger.
 */
function writeJson(res, status, body, budget, log) {
  let text
  try {
    text = serializeBounded(body, budget, '响应')
  } catch (error) {
    log.error(error.message)
    status = 500
    text = JSON.stringify(errorEnvelope(new BridgeError('INTERNAL_ERROR', '响应超出预算')))
  }
  if (res.headersSent || res.writableEnded) return
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text, 'utf8'),
    'x-content-type-options': 'nosniff',
  }
  // An oversized request may still be uploading: answer and close, rather than
  // waiting for a body the client should stop sending.
  if (status === 413) headers.connection = 'close'
  res.writeHead(status, headers)
  res.end(text)
}

/**
 * Turn an unexpected failure into a short, safe, actionable wire message.
 *
 * Keeps the error class and message (which is what a bug report needs), drops
 * everything that could leak host detail: newlines, absolute paths, and anything
 * past 200 characters. A stack never leaves the process.
 * @param {unknown} error the thrown value.
 * @returns {string} sanitized description.
 */
function describeFailure(error) {
  const name = typeof error?.name === 'string' ? error.name : 'Error'
  const raw = typeof error?.message === 'string' ? error.message : String(error)
  const flattened = raw.replace(/\s+/g, ' ').replace(/(?:[A-Za-z]:)?[\\/][^\s'"]+/g, '<path>')
  return clampText(`内部错误 ${name}: ${flattened}`, 200)
}

/**
 * @param {import('node:http').IncomingMessage} req request.
 * @returns {string|undefined} the bearer token, when the header is well formed.
 */
function bearerToken(req) {
  const header = req.headers.authorization
  if (typeof header !== 'string') return undefined
  if (!header.startsWith('Bearer ')) return undefined
  const token = header.slice('Bearer '.length)
  return token === '' ? undefined : token
}

/**
 * Build the bridge's HTTP server.
 *
 * @param {object} options server options.
 * @param {object} options.config validated bridge config.
 * @param {string} options.instanceId this run's id.
 * @param {object} options.registry {@link import('./auth.js').ClientRegistry}.
 * @param {object} options.hub {@link import('./event-hub.js').EventHub}.
 * @param {object} options.routes route handlers, see the module comment above.
 * @param {(authority: string) => boolean} options.isHostAccepted validates the `Host` authority.
 * @param {object} options.log logger.
 * @returns {{server: import('node:http').Server, listen: () => Promise<{address: string, port: number}>, close: () => Promise<void>, stats: () => object}} the server handle.
 */
export function createBridgeServer({ config, instanceId, registry, hub, routes, isHostAccepted, log }) {
  const limits = config.limits
  const limiter = new RateLimiter({ capacity: 20, refillPerSecond: 10 })
  let activeHttp = 0
  let closing = false
  const openSockets = new Set()

  const server = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      log.error(`未处理的请求错误：${error?.stack ?? error}`)
      if (!res.headersSent) {
        writeJson(res, 500, errorEnvelope(new BridgeError('INTERNAL_ERROR', '内部错误')), limits.responseBytes, log)
      } else {
        res.destroy()
      }
    })
  })

  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.on('close', () => openSockets.delete(socket))
    socket.setNoDelay(true)
  })
  // Body/header timeouts stay inside the protocol's 15 s request budget; the SSE
  // response clears its own socket timeout once headers are out.
  server.headersTimeout = LIMITS.requestTimeoutMs
  server.requestTimeout = LIMITS.requestTimeoutMs
  server.keepAliveTimeout = 5000
  server.timeout = 0
  server.maxHeadersCount = 64

  /**
   * @param {import('node:http').IncomingMessage} req request.
   * @param {import('node:http').ServerResponse} res response.
   */
  async function handle(req, res) {
    if (closing) {
      writeJson(res, 429, errorEnvelope(new BridgeError('OVERLOADED', '插件正在停止')), limits.responseBytes, log)
      return
    }
    const started = Date.now()
    const url = typeof req.url === 'string' ? req.url : '/'
    // The pet host composes `basePath + path`; it never sends an absolute URL.
    if (!url.startsWith(config.basePath)) {
      writeJson(res, 404, errorEnvelope(new BridgeError('INVALID_REQUEST', '未知路径')), limits.responseBytes, log)
      return
    }

    // 1. Host fence. A loopback bind authenticates nothing on its own: any local
    //    process (or a DNS-rebinding page) can reach the socket.
    const host = req.headers.host
    if (typeof host !== 'string' || !isHostAccepted(host.toLowerCase())) {
      writeJson(res, 403, errorEnvelope(new BridgeError('FORBIDDEN', 'Host 头不被接受')), limits.responseBytes, log)
      return
    }
    // 2. Browser-origin requests are refused outright, including `Origin: null`.
    if (req.headers.origin !== undefined) {
      writeJson(res, 403, errorEnvelope(new BridgeError('FORBIDDEN', '不接受浏览器 Origin 的业务请求')), limits.responseBytes, log)
      return
    }

    const relative = url.slice(config.basePath.length)
    const pathPart = relative.split('?')[0]
    const route = Object.hasOwn(ROUTES, pathPart) ? ROUTES[pathPart] : undefined
    if (route === undefined) {
      writeJson(res, 404, errorEnvelope(new BridgeError('INVALID_REQUEST', '未知端点')), limits.responseBytes, log)
      return
    }

    // 3. Authentication before any session lookup.
    const token = bearerToken(req)
    const client = registry.authenticate(token)
    if (client === undefined) {
      res.setHeader('www-authenticate', 'Bearer')
      writeJson(res, 401, errorEnvelope(new BridgeError('UNAUTHORIZED', '连接 token 无效或未注册')), limits.responseBytes, log)
      return
    }
    if (!limiter.take(client.clientId)) {
      writeJson(res, 429, errorEnvelope(new BridgeError('OVERLOADED', '请求过于频繁', { retryable: true })), limits.responseBytes, log)
      return
    }
    if (req.method !== route.method) {
      res.setHeader('allow', route.method)
      writeJson(res, 405, errorEnvelope(new BridgeError('INVALID_REQUEST', `该端点只接受 ${route.method}`)), limits.responseBytes, log)
      return
    }

    const query = new URL(url, `http://${host}`).searchParams

    if (pathPart === 'events') {
      if (typeof routes.events !== 'function') {
        writeJson(res, 501, errorEnvelope(new BridgeError('UNSUPPORTED_CAPABILITY', '未启用事件流')), limits.responseBytes, log)
        return
      }
      try {
        await routes.events({ req, res, client, query, hub })
      } catch (error) {
        const bridgeError = error instanceof BridgeError
          ? error
          : new BridgeError('INTERNAL_ERROR', '内部错误', { cause: error })
        if (!(error instanceof BridgeError)) log.error(`事件流处理失败：${error?.stack ?? error}`)
        // Headers may already be out if the failure came from the stream itself.
        writeJson(res, bridgeError.status, errorEnvelope(bridgeError, { instanceId }), limits.responseBytes, log)
      }
      return
    }

    activeHttp += 1
    if (activeHttp > config.concurrency.maxHttp) {
      activeHttp -= 1
      writeJson(res, 429, errorEnvelope(new BridgeError('OVERLOADED', '并发请求过多', { retryable: true })), limits.responseBytes, log)
      return
    }
    try {
      if (pathPart === 'commands') {
        const body = await readBody(req, limits.requestBytes, LIMITS.requestTimeoutMs)
        let parsed
        try {
          parsed = body.length === 0 ? null : JSON.parse(body.toString('utf8'))
        } catch {
          throw new BridgeError('INVALID_REQUEST', '请求体不是合法 JSON')
        }
        const result = await routes.commands({ client, body: parsed })
        writeJson(res, result?.status ?? 202, result.body, limits.responseBytes, log)
        return
      }
      const handler = routes[pathPart]
      if (typeof handler !== 'function') {
        writeJson(res, 501, errorEnvelope(new BridgeError('UNSUPPORTED_CAPABILITY', '该端点未实现')), limits.responseBytes, log)
        return
      }
      // Read endpoints answer with their DTO directly (protocol §8: /info,
      // /sessions and /snapshot are bare objects, not envelopes).
      const result = await handler({ client, query, req })
      const payload = result !== null && typeof result === 'object' && Object.hasOwn(result, 'body') ? result.body : result
      writeJson(res, result?.status ?? 200, payload, limits.responseBytes, log)
    } catch (error) {
      // An unexpected failure is still reported to the pet as INTERNAL_ERROR, but
      // with a bounded, sanitized reason instead of an opaque "内部错误": without
      // it an operator has no way to tell a budget problem from a bug, and every
      // report turns into a guessing game. No stack, no paths, no secrets.
      const bridgeError = error instanceof BridgeError
        ? error
        : new BridgeError('INTERNAL_ERROR', describeFailure(error), { cause: error })
      if (!(error instanceof BridgeError)) log.error(`请求处理失败：${error?.stack ?? error}`)
      writeJson(res, bridgeError.status, errorEnvelope(bridgeError, { instanceId }), limits.responseBytes, log)
    } finally {
      activeHttp -= 1
      log.debug?.(`${pathPart} ${req.method} ${Date.now() - started}ms`)
    }
  }

  /**
   * Bind the listener and report the effective address.
   * @returns {Promise<{address: string, port: number}>} bound address facts.
   */
  function listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        const address = server.address()
        if (address === null || typeof address === 'string') {
          reject(new Error('dsh-pet-bridge: 无法确定监听地址'))
          return
        }
        resolve({ address: address.address, port: address.port })
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(config.port, config.host)
    })
  }

  /**
   * Stop accepting work and release every socket.
   * @returns {Promise<void>} resolves when the listener is closed.
   */
  async function close() {
    closing = true
    for (const socket of openSockets) {
      try {
        socket.destroy()
      } catch {
        /* already gone */
      }
    }
    openSockets.clear()
    await new Promise((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections?.()
    })
  }

  /**
   * @returns {object} non-secret runtime counters.
   */
  function stats() {
    return { activeHttp, openSockets: openSockets.size, sseAttached: hub.subscriber !== null }
  }

  return { server, listen, close, stats }
}

/**
 * Build the public base URL for one bound address.
 * @param {string} host bound host.
 * @param {number} port bound port.
 * @param {string} basePath normalized base path.
 * @returns {string} absolute base URL.
 */
export function bridgeBaseUrl(host, port, basePath) {
  const authority = host === '::1' ? `[::1]:${port}` : `${host}:${port}`
  return `http://${authority}${basePath}`
}

/** Re-exported for the route layer. */
export { PROTOCOL, utf8Length }
