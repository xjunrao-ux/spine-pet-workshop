// Client identity, connection tokens, session authorization, and capabilities.
//
// A client is identified by the *server side* record matched against a bearer
// token, never by anything the request claims about itself. The registry stores
// only SHA-256 digests of tokens: the plaintext exists once, in the operator's
// terminal, when `scripts/pet-bridge-admin.mjs token create` prints it.

import { readFileSync, statSync } from 'node:fs'
import { BridgeError, digestsEqual, randomHex, sha256Hex, TOKEN_RE } from './wire.js'

/** On-disk format marker for `clients.json`. */
export const CLIENTS_FORMAT = 'dsh-pet-bridge-clients/1'

/** Capabilities this build can actually serve. Anything else is rejected at load. */
export const IMPLEMENTED_CAPABILITIES = Object.freeze([
  'sessions.list',
  'session.snapshot',
  'message.send',
  'events.follow',
  'requests.lookup',
  'session.cancel',
  'message.steer',
])

/** Capabilities that are always available and cannot be switched off. */
export const BASE_CAPABILITIES = Object.freeze([
  'sessions.list',
  'session.snapshot',
  'message.send',
  'events.follow',
  'requests.lookup',
])

/**
 * Mint one connection token plus the record that authorizes it.
 * @param {number} [bytes] random bytes; the protocol requires at least 32.
 * @returns {{token: string, tokenSha256: string}} the plaintext (show once) and its digest.
 */
export function mintToken(bytes = 32) {
  if (!Number.isInteger(bytes) || bytes < 32) throw new TypeError('token 至少需要 32 个随机字节')
  // Hex keeps the value inside the pet host's accepted character set and makes
  // copy/paste from a terminal unambiguous.
  const token = randomHex(bytes)
  if (!TOKEN_RE.test(token)) throw new Error('生成的 token 不在桌宠接受的字符集内')
  return { token, tokenSha256: sha256Hex(token) }
}

/**
 * @param {unknown} value candidate capability name.
 * @returns {boolean} whether this build implements it.
 */
export function isImplementedCapability(value) {
  return typeof value === 'string' && IMPLEMENTED_CAPABILITIES.includes(value)
}

/**
 * Validate one client record from `clients.json`.
 * @param {unknown} raw record.
 * @param {number} index position, used in messages.
 * @returns {object} frozen normalized record.
 * @throws {TypeError} describing the first invalid field.
 */
function normalizeClient(raw, index) {
  const where = `clients[${index}]`
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`dsh-pet-bridge: ${where} 必须是对象`)
  }
  const allowed = new Set(['clientId', 'label', 'tokenSha256', 'sessions', 'capabilities', 'enabled', 'createdAt', 'note'])
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new TypeError(`dsh-pet-bridge: ${where} 含未知字段 ${key}`)
  }
  if (typeof raw.clientId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(raw.clientId)) {
    throw new TypeError(`dsh-pet-bridge: ${where}.clientId 必须是 1-64 个 [A-Za-z0-9._-] 字符`)
  }
  if (typeof raw.tokenSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.tokenSha256)) {
    throw new TypeError(`dsh-pet-bridge: ${where}.tokenSha256 必须是 64 位小写十六进制 SHA-256`)
  }
  if (!Array.isArray(raw.sessions) || raw.sessions.some((id) => typeof id !== 'string' || id === '')) {
    throw new TypeError(`dsh-pet-bridge: ${where}.sessions 必须是字符串数组`)
  }
  if (raw.sessions.length === 0) {
    throw new TypeError(`dsh-pet-bridge: ${where}.sessions 不能为空；默认不共享任何会话，请显式登记`)
  }
  const capabilities = raw.capabilities ?? [...BASE_CAPABILITIES]
  if (!Array.isArray(capabilities) || capabilities.some((cap) => typeof cap !== 'string')) {
    throw new TypeError(`dsh-pet-bridge: ${where}.capabilities 必须是字符串数组`)
  }
  for (const cap of capabilities) {
    if (!isImplementedCapability(cap)) {
      throw new TypeError(`dsh-pet-bridge: ${where}.capabilities 含本版本未实现的能力 ${cap}`)
    }
  }
  return Object.freeze({
    clientId: raw.clientId,
    label: typeof raw.label === 'string' ? raw.label : raw.clientId,
    tokenSha256: raw.tokenSha256,
    sessions: Object.freeze([...new Set(raw.sessions)]),
    capabilities: Object.freeze([...new Set(capabilities)]),
    enabled: raw.enabled !== false,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    note: typeof raw.note === 'string' ? raw.note : null,
  })
}

/**
 * Parse and validate a whole `clients.json` document.
 * @param {unknown} doc parsed JSON.
 * @returns {readonly object[]} frozen records.
 */
export function parseClientsDocument(doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new TypeError('dsh-pet-bridge: clients.json 顶层必须是对象')
  }
  if (doc.format !== CLIENTS_FORMAT) {
    throw new TypeError(`dsh-pet-bridge: clients.json format 必须是 ${CLIENTS_FORMAT}（收到 ${String(doc.format)}）`)
  }
  if (!Array.isArray(doc.clients)) throw new TypeError('dsh-pet-bridge: clients.json 缺少 clients 数组')
  const clients = doc.clients.map(normalizeClient)
  const ids = new Set()
  for (const client of clients) {
    if (ids.has(client.clientId)) throw new TypeError(`dsh-pet-bridge: clientId ${client.clientId} 重复`)
    ids.add(client.clientId)
  }
  return Object.freeze(clients)
}

/**
 * The client registry: authoritative authorization state, reloaded from disk
 * when the operator changes it.
 *
 * Reload is checked at most once per `reloadIntervalMs` on the request path, so
 * a revoked token stops working within about a second without a filesystem
 * watcher (watchers are unreliable across the Windows editors operators use).
 */
export class ClientRegistry {
  /**
   * @param {object} options registry options.
   * @param {string} options.file absolute path of `clients.json`.
   * @param {object} options.log C ords-compatible logger (`info`/`warn`/`error`).
   * @param {number} [options.reloadIntervalMs] stat throttle.
   */
  constructor({ file, log, reloadIntervalMs = 1000 }) {
    this.file = file
    this.log = log
    this.reloadIntervalMs = reloadIntervalMs
    /** @type {readonly object[]} */
    this.clients = Object.freeze([])
    /** @type {Map<string, Set<Function>>} change listeners */
    this.listeners = new Set()
    this.lastStat = { mtimeMs: -1, size: -1 }
    this.lastCheck = 0
    this.loaded = false
  }

  /**
   * Subscribe to authorization changes (add/remove/disable/replace).
   * @param {(clients: readonly object[]) => void} listener callback.
   * @returns {() => void} disposer.
   */
  onChange(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Read the file now. A missing file is the valid "no client is authorized"
   * state; an unreadable or invalid file throws, because silently treating a
   * broken authorization file as "nobody" hides a configuration failure.
   * @param {{throwOnError?: boolean}} [options] `throwOnError` rethrows parse failures.
   * @returns {readonly object[]} the loaded clients.
   */
  reload({ throwOnError = true } = {}) {
    let stat
    try {
      stat = statSync(this.file)
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.lastStat = { mtimeMs: -1, size: -1 }
        this.#replace(Object.freeze([]))
        this.loaded = true
        return this.clients
      }
      if (throwOnError) throw error
      this.log.warn(`无法读取 clients.json（${error.code}），已授权客户端保持不变`)
      return this.clients
    }
    try {
      const text = readFileSync(this.file, 'utf8')
      const clients = parseClientsDocument(JSON.parse(text))
      this.lastStat = { mtimeMs: stat.mtimeMs, size: stat.size }
      this.#replace(clients)
      this.loaded = true
      return this.clients
    } catch (error) {
      this.lastStat = { mtimeMs: stat.mtimeMs, size: stat.size }
      if (throwOnError) throw new Error(`dsh-pet-bridge: 无法加载 ${this.file}: ${error.message}`, { cause: error })
      this.log.error(`clients.json 无效，已授权客户端保持不变：${error.message}`)
      return this.clients
    }
  }

  /** @param {readonly object[]} clients new client table. */
  #replace(clients) {
    this.clients = clients
    for (const listener of this.listeners) {
      try {
        listener(clients)
      } catch (error) {
        this.log.warn(`授权变更监听器失败：${error.message}`)
      }
    }
  }

  /** Cheap stat-based reload check used on the request path. */
  maybeReload() {
    const now = Date.now()
    if (now - this.lastCheck < this.reloadIntervalMs) return
    this.lastCheck = now
    let stat
    try {
      stat = statSync(this.file)
    } catch {
      if (this.lastStat.mtimeMs !== -1 || !this.loaded) this.reload({ throwOnError: false })
      return
    }
    if (stat.mtimeMs !== this.lastStat.mtimeMs || stat.size !== this.lastStat.size) {
      this.reload({ throwOnError: false })
    }
  }

  /**
   * Match a bearer token to an enabled client record.
   * @param {string|undefined} token plaintext token from the Authorization header.
   * @returns {object|undefined} the client, or undefined when unknown/disabled.
   */
  authenticate(token) {
    if (typeof token !== 'string' || token.length === 0) return undefined
    this.maybeReload()
    const digest = sha256Hex(token)
    let match
    for (const client of this.clients) {
      if (!client.enabled) continue
      if (digestsEqual(digest, client.tokenSha256)) match = client
    }
    // Scanning every record even after a match keeps the timing profile flat.
    return match
  }

  /**
   * @param {object} client authenticated client.
   * @param {string} sessionId wire session id.
   * @returns {boolean} whether this client may address that session.
   */
  allowsSession(client, sessionId) {
    return client.sessions.includes(sessionId)
  }

  /**
   * Capability check that also applies the operator's global gates.
   * @param {object} client authenticated client.
   * @param {string} capability capability name.
   * @param {{cancel: boolean, steer: boolean}} gates operator switches.
   * @returns {boolean} whether the capability is in force.
   */
  hasCapability(client, capability, gates) {
    if (capability === 'session.cancel' && !gates.cancel) return false
    if (capability === 'message.steer' && !gates.steer) return false
    return client.capabilities.includes(capability)
  }

  /**
   * Assert a session is authorized, mapping every refusal to `FORBIDDEN` so a
   * client cannot probe which session ids exist.
   * @param {object} client authenticated client.
   * @param {string} sessionId wire session id.
   * @returns {void} returns when allowed.
   * @throws {BridgeError} FORBIDDEN.
   */
  assertSessionAllowed(client, sessionId) {
    if (!this.allowsSession(client, sessionId)) {
      throw new BridgeError('FORBIDDEN', '该会话未授权给此客户端')
    }
  }

  /**
   * Assert a capability is in force for this client and build.
   * @param {object} client authenticated client.
   * @param {string} capability capability name.
   * @param {{cancel: boolean, steer: boolean}} gates operator switches.
   * @returns {void} returns when allowed.
   * @throws {BridgeError} UNSUPPORTED_CAPABILITY.
   */
  assertCapability(client, capability, gates) {
    if (!this.hasCapability(client, capability, gates)) {
      throw new BridgeError('UNSUPPORTED_CAPABILITY', `未启用能力 ${capability}`)
    }
  }

  /**
   * The capability list advertised to one client in `info`. It reflects what
   * this build and this client can actually do right now — never a global list.
   * @param {object} client authenticated client.
   * @param {{cancel: boolean, steer: boolean}} gates operator switches.
   * @returns {string[]} sorted capability names.
   */
  capabilitiesFor(client, gates) {
    const result = []
    for (const capability of IMPLEMENTED_CAPABILITIES) {
      if (this.hasCapability(client, capability, gates)) result.push(capability)
    }
    return result
  }
}
