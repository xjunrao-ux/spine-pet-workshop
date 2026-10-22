// pet-dsh/1 wire vocabulary: identifiers, envelopes, error mapping, hashing.
//
// Everything in this module is pure (no DSH, no I/O) so the contract can be
// unit-tested against protocol/schemas/dsh-bridge-v1.schema.json without a
// running harness.

import { createHash, randomBytes } from 'node:crypto'

/** The only protocol revision this build speaks. */
export const PROTOCOL = 'pet-dsh/1'

/** Identifier grammar shared by every wire id (schema `$defs.identifier`). */
export const IDENTIFIER_RE = /^[A-Za-z0-9._-]{1,100}$/

/** Connection-token grammar accepted by the pet host (LOCAL_SERVICE_API.md §授权与配置). */
export const TOKEN_RE = /^[A-Za-z0-9._~+/-]{16,512}$/

/** Hard ceilings from the shared protocol (§8) and the pet host (§预算与生命周期). */
export const LIMITS = Object.freeze({
  requestBytes: 65536,
  responseBytes: 262144,
  eventBytes: 65536,
  messageChars: 4000,
  eventsPerSecond: 30,
  heartbeatMs: 15000,
  journalRetentionHours: 24,
  sessionPageSize: 20,
  snapshotMessageLimit: 20,
  snapshotMessageChars: 16000,
  /** Protocol §2: ordinary request and SSE handshake budget. */
  requestTimeoutMs: 15000,
  /** LOCAL_SERVICE_API.md: the pet closes a stream after 45 s of silence. */
  petStreamIdleMs: 45000,
})

/** HTTP status per protocol error code (protocol §4). */
const STATUS_BY_CODE = Object.freeze({
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  VERSION_MISMATCH: 400,
  INSTANCE_CHANGED: 409,
  SESSION_NOT_FOUND: 404,
  SESSION_BUSY: 409,
  UNSUPPORTED_CAPABILITY: 501,
  REQUEST_CONFLICT: 409,
  REQUEST_UNKNOWN: 404,
  RESULT_UNKNOWN: 409,
  EXPIRED: 409,
  CANCELLED: 409,
  INTERNAL_ERROR: 500,
  BODY_TOO_LARGE: 413,
  OVERLOADED: 429,
})

/** Error codes that a client may retry without changing state. */
const RETRYABLE = new Set(['INTERNAL_ERROR', 'OVERLOADED'])

/**
 * One protocol-shaped failure. Carries the wire code, the HTTP status the code
 * maps to, and the `retryable` hint that reaches the pet.
 */
export class BridgeError extends Error {
  /**
   * @param {string} code protocol error code (`INVALID_REQUEST`, …).
   * @param {string} message short operator-safe message; never contains secrets.
   * @param {object} [options] `retryable` override, HTTP `status` override, cause.
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'BridgeError'
    this.code = code
    this.status = options.status ?? STATUS_BY_CODE[code] ?? 500
    this.retryable = options.retryable ?? RETRYABLE.has(code)
  }

  /** @returns {{code: string, message: string, retryable: boolean}} */
  toWire() {
    return { code: this.code, message: clampText(this.message, 1000), retryable: this.retryable }
  }
}

/**
 * @param {string} code protocol error code.
 * @param {string} message operator-safe message.
 * @param {object} [options] see {@link BridgeError}.
 * @returns {BridgeError} the constructed error.
 */
export function bridgeError(code, message, options) {
  return new BridgeError(code, message, options)
}

/**
 * Count Unicode code points (the protocol's "字符", not UTF-16 units).
 * @param {string} text any string.
 * @returns {number} code-point count.
 */
export function charLength(text) {
  let count = 0
  for (const _ of text) count += 1
  return count
}

/**
 * UTF-8 byte length, the unit every size budget in the protocol uses.
 * @param {string} text any string.
 * @returns {number} byte length.
 */
export function utf8Length(text) {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Trim a string to at most `max` code points, appending `…` only when cut.
 * @param {string} text source text.
 * @param {number} max maximum code points to keep.
 * @returns {string} the (possibly shortened) text.
 */
export function clampText(text, max) {
  if (typeof text !== 'string') return ''
  if (charLength(text) <= max) return text
  let out = ''
  let count = 0
  for (const char of text) {
    if (count >= max - 1) break
    out += char
    count += 1
  }
  return `${out}…`
}

/**
 * Canonical JSON: object keys sorted, no whitespace, `undefined` dropped the way
 * `JSON.stringify` drops it. Two payloads that differ only in key order hash
 * identically, which is what makes the idempotency ledger survive restarts.
 * @param {unknown} value any lossless-JSON value.
 * @returns {string} canonical text.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
  const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
  return `{${parts.join(',')}}`
}

/**
 * @param {string} text input.
 * @returns {string} lowercase hex SHA-256.
 */
export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Constant-time comparison of two equal-purpose hex digests.
 * @param {string} a left digest.
 * @param {string} b right digest.
 * @returns {boolean} whether they are equal.
 */
export function digestsEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * @param {number} bytes count of random bytes.
 * @returns {string} hex-encoded cryptographically random value.
 */
export function randomHex(bytes) {
  return randomBytes(bytes).toString('hex')
}

/**
 * @param {unknown} value candidate.
 * @returns {boolean} whether it satisfies the wire identifier grammar.
 */
export function isIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_RE.test(value)
}

/**
 * Serialize `value` and prove it fits the byte budget.
 * @param {unknown} value JSON value.
 * @param {number} budget maximum UTF-8 bytes.
 * @param {string} what label used in the failure message.
 * @returns {string} the serialized JSON.
 * @throws {BridgeError} INTERNAL_ERROR when the payload cannot fit.
 */
export function serializeBounded(value, budget, what) {
  const text = JSON.stringify(value)
  if (utf8Length(text) > budget) {
    throw new BridgeError('INTERNAL_ERROR', `${what}超出 ${budget} 字节预算`, { status: 500 })
  }
  return text
}

/**
 * Success envelope (schema `$defs.response`, ok:true).
 * @param {string} instanceId this run's id.
 * @param {string|undefined} requestId echoed request id.
 * @param {object} data response payload.
 * @returns {object} envelope.
 */
export function okEnvelope(instanceId, requestId, data) {
  const envelope = { protocol: PROTOCOL, instanceId, ok: true, data }
  if (requestId !== undefined) envelope.requestId = requestId
  return envelope
}

/**
 * Failure envelope (schema `$defs.response`, ok:false). Never carries `data`.
 * @param {BridgeError} error the failure.
 * @param {object} [context] optional `instanceId`/`requestId` to echo.
 * @returns {object} envelope.
 */
export function errorEnvelope(error, context = {}) {
  const envelope = { protocol: PROTOCOL }
  if (context.instanceId !== undefined) envelope.instanceId = context.instanceId
  if (context.requestId !== undefined) envelope.requestId = context.requestId
  envelope.ok = false
  envelope.error = error.toWire()
  return envelope
}

/**
 * SSE event envelope (schema `$defs.event`).
 * @param {object} input envelope fields.
 * @returns {object} envelope with a stable key order.
 */
export function eventEnvelope(input) {
  const envelope = {
    protocol: PROTOCOL,
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    cursor: input.cursor,
    type: input.type,
    data: input.data,
  }
  if (input.requestId !== undefined) envelope.requestId = input.requestId
  return envelope
}

/**
 * @param {string} instanceId this run's id.
 * @param {number} seq bridge event sequence number.
 * @returns {string} wire cursor.
 */
export function formatCursor(instanceId, seq) {
  return `${instanceId}.${seq}`
}

/**
 * Parse a cursor, rejecting foreign instances and malformed values.
 * @param {unknown} cursor candidate cursor.
 * @param {string} instanceId this run's id.
 * @returns {number|undefined} the sequence number, or undefined when unusable.
 */
export function parseCursor(cursor, instanceId) {
  if (typeof cursor !== 'string') return undefined
  const prefix = `${instanceId}.`
  if (!cursor.startsWith(prefix)) return undefined
  const tail = cursor.slice(prefix.length)
  if (!/^\d{1,12}$/.test(tail)) return undefined
  const seq = Number(tail)
  return Number.isSafeInteger(seq) ? seq : undefined
}

/**
 * Join the `text` blocks of a DSH content array. Reasoning and tool blocks never
 * reach the pet: private reasoning and raw tool arguments are out of scope.
 * @param {unknown} content DSH content blocks.
 * @returns {string} display text.
 */
export function textOfContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('')
}

/**
 * Validate the request envelope before any business check (protocol §3).
 * @param {unknown} body parsed JSON body.
 * @param {string} instanceId this run's instance id.
 * @returns {{requestId: string, op: string, sessionId: string, data: object}} validated fields.
 * @throws {BridgeError} INVALID_REQUEST / VERSION_MISMATCH / INSTANCE_CHANGED.
 */
export function parseCommandEnvelope(body, instanceId) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BridgeError('INVALID_REQUEST', '请求体必须是 JSON 对象')
  }
  const allowed = new Set(['protocol', 'instanceId', 'requestId', 'op', 'sessionId', 'data'])
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new BridgeError('INVALID_REQUEST', `请求信封包含未知字段：${key}`)
  }
  if (body.protocol !== PROTOCOL) {
    throw new BridgeError('VERSION_MISMATCH', `协议必须是 ${PROTOCOL}`)
  }
  if (!isIdentifier(body.requestId)) {
    throw new BridgeError('INVALID_REQUEST', 'requestId 必须是 1-100 个 [A-Za-z0-9._-] 字符')
  }
  if (typeof body.op !== 'string' || body.op.length === 0) {
    throw new BridgeError('INVALID_REQUEST', 'op 缺失')
  }
  if (!isIdentifier(body.sessionId)) {
    throw new BridgeError('INVALID_REQUEST', 'sessionId 必须是 1-100 个 [A-Za-z0-9._-] 字符')
  }
  if (body.data === null || typeof body.data !== 'object' || Array.isArray(body.data)) {
    throw new BridgeError('INVALID_REQUEST', 'data 必须是 JSON 对象')
  }
  if (!isIdentifier(body.instanceId)) {
    throw new BridgeError('INVALID_REQUEST', 'instanceId 必须是 1-100 个 [A-Za-z0-9._-] 字符')
  }
  // The envelope names the instance the client believes it is talking to. A
  // stale instanceId means a restarted server, which must not re-run old work.
  if (body.instanceId !== instanceId) {
    throw new BridgeError('INSTANCE_CHANGED', '实例已重启；请重新读取 info/snapshot 后再提交')
  }
  return { requestId: body.requestId, op: body.op, sessionId: body.sessionId, data: body.data }
}

/**
 * Validate `message.send` data.
 * @param {object} data command data.
 * @param {{steer: boolean, messageChars?: number}} options capability gates and text budget.
 * @returns {{mode: 'followup'|'steer', text: string}} normalized payload.
 * @throws {BridgeError} INVALID_REQUEST / UNSUPPORTED_CAPABILITY.
 */
export function parseMessageSend(data, options) {
  for (const key of Object.keys(data)) {
    if (key !== 'mode' && key !== 'text') throw new BridgeError('INVALID_REQUEST', `message.send 不支持字段：${key}`)
  }
  const mode = data.mode
  if (mode !== 'followup' && mode !== 'steer') {
    throw new BridgeError('INVALID_REQUEST', 'mode 必须是 followup 或 steer')
  }
  if (mode === 'steer' && options.steer !== true) {
    throw new BridgeError('UNSUPPORTED_CAPABILITY', '未启用 message.steer')
  }
  if (typeof data.text !== 'string') throw new BridgeError('INVALID_REQUEST', 'text 必须是字符串')
  const text = data.text
  if (text.trim().length === 0) throw new BridgeError('INVALID_REQUEST', 'text 不能为空')
  const maxChars = options.messageChars ?? LIMITS.messageChars
  if (charLength(text) > maxChars) {
    throw new BridgeError('INVALID_REQUEST', `text 超过 ${maxChars} 字符`)
  }
  return { mode, text }
}

/**
 * Validate `session.cancel` data.
 * @param {object} data command data.
 * @returns {{activityId: string}} normalized payload.
 * @throws {BridgeError} INVALID_REQUEST.
 */
export function parseSessionCancel(data) {
  for (const key of Object.keys(data)) {
    if (key !== 'activityId') throw new BridgeError('INVALID_REQUEST', `session.cancel 不支持字段：${key}`)
  }
  if (!isIdentifier(data.activityId)) {
    throw new BridgeError('INVALID_REQUEST', 'activityId 必须是 1-100 个 [A-Za-z0-9._-] 字符')
  }
  return { activityId: data.activityId }
}

/**
 * Deterministic idempotency hash of one command's semantic content.
 * @param {object} input `{op, sessionId, data}`.
 * @returns {string} hex digest.
 */
export function payloadHashOf(input) {
  return sha256Hex(canonicalJson({ op: input.op, sessionId: input.sessionId, data: input.data }))
}

/**
 * @param {unknown} value candidate.
 * @returns {number} `value` when it is a non-negative safe integer, else -1.
 */
export function asTurn(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : -1
}
