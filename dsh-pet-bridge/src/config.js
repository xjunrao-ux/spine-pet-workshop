// Configuration validation for the pet-dsh/1 bridge.
//
// The plugin is configured through the DSH profile patch layer
// (`- id: dsh-pet-bridge / config: {...}`). Validation is explicit here rather
// than delegated to a schema library so the package keeps a zero-dependency
// runtime: the only imports are `node:` builtins plus the harness' own message
// factory.

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** Loopback bind addresses the protocol allows (protocol §2). */
export const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', '::1'])

/**
 * Resolve the Harness home the same way `@deepseek-ai/dsh-home-paths` does for
 * the shipped launcher, without importing it: an explicit `DSH_HOME`, else
 * `~/.dsh`.
 * @param {NodeJS.ProcessEnv} [env] process environment.
 * @returns {string} absolute Harness home directory.
 */
export function resolveDshHome(env = process.env) {
  const configured = env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return resolve(configured)
  return join(homedir(), '.dsh')
}

/**
 * @param {unknown} value candidate.
 * @param {string} path dotted config path used in the failure message.
 * @param {number} fallback default value.
 * @param {{min?: number, max?: number, integer?: boolean}} [bounds] accepted range.
 * @returns {number} the validated number.
 */
function numberAt(value, path, fallback, bounds = {}) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`dsh-pet-bridge: ${path} 必须是数字，收到 ${JSON.stringify(value)}`)
  }
  if (bounds.integer === true && !Number.isInteger(value)) {
    throw new TypeError(`dsh-pet-bridge: ${path} 必须是整数，收到 ${value}`)
  }
  if (bounds.min !== undefined && value < bounds.min) {
    throw new TypeError(`dsh-pet-bridge: ${path} 不能小于 ${bounds.min}，收到 ${value}`)
  }
  if (bounds.max !== undefined && value > bounds.max) {
    throw new TypeError(`dsh-pet-bridge: ${path} 不能大于 ${bounds.max}，收到 ${value}`)
  }
  return value
}

/**
 * @param {unknown} value candidate.
 * @param {string} path dotted config path.
 * @param {boolean} fallback default value.
 * @returns {boolean} the validated boolean.
 */
function booleanAt(value, path, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw new TypeError(`dsh-pet-bridge: ${path} 必须是布尔值，收到 ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * @param {unknown} value candidate.
 * @param {string} path dotted config path.
 * @param {string} fallback default value.
 * @returns {string} the validated non-empty string.
 */
function stringAt(value, path, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`dsh-pet-bridge: ${path} 必须是非空字符串`)
  }
  return value
}

/**
 * Normalize `basePath` to `/segment/` form.
 * @param {string} raw configured base path.
 * @returns {string} normalized base path.
 */
function normalizeBasePath(raw) {
  const trimmed = raw.trim()
  if (/[\\%\s]/.test(trimmed)) {
    throw new TypeError('dsh-pet-bridge: basePath 不能包含反斜杠、百分号编码或空白')
  }
  let path = trimmed
  if (!path.startsWith('/')) path = `/${path}`
  if (!path.endsWith('/')) path = `${path}/`
  if (path.includes('//')) throw new TypeError('dsh-pet-bridge: basePath 不能包含连续斜杠')
  if (path.includes('..')) throw new TypeError('dsh-pet-bridge: basePath 不能包含 ..')
  if (path.length > 100) throw new TypeError('dsh-pet-bridge: basePath 过长')
  return path
}

/**
 * Validate one config object and return it frozen with defaults applied.
 * @param {object|undefined} raw config from the Cordis patch row.
 * @param {NodeJS.ProcessEnv} [env] environment used to resolve the Harness home.
 * @returns {object} frozen, fully populated config.
 * @throws {TypeError} on any invalid value; the message names the config path.
 */
export function parseConfig(raw, env = process.env) {
  if (raw === undefined || raw === null) raw = {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('dsh-pet-bridge: 插件 config 必须是对象')
  }
  const known = new Set([
    'host',
    'port',
    'basePath',
    'dataDir',
    'clientsFile',
    'enableCancel',
    'enableSteer',
    'limits',
    'replay',
    'journal',
    'eventRate',
    'snapshot',
    'concurrency',
    'trustedHosts',
  ])
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw new TypeError(`dsh-pet-bridge: 未知配置项 ${key}`)
  }

  const host = stringAt(raw.host, 'host', '127.0.0.1')
  if (!LOOPBACK_HOSTS.includes(host)) {
    throw new TypeError(`dsh-pet-bridge: host 只能是 ${LOOPBACK_HOSTS.join(' 或 ')}，收到 ${host}`)
  }
  const port = numberAt(raw.port, 'port', 0, { min: 0, max: 65535, integer: true })
  const basePath = normalizeBasePath(stringAt(raw.basePath, 'basePath', '/pet-bridge/v1/'))

  const dataDirRaw = stringAt(raw.dataDir, 'dataDir', join(resolveDshHome(env), 'pet-bridge'))
  const dataDir = isAbsolute(dataDirRaw) ? resolve(dataDirRaw) : resolve(dataDirRaw)
  if (!isAbsolute(dataDir)) throw new TypeError('dsh-pet-bridge: dataDir 必须是绝对路径')

  const clientsFileRaw = stringAt(raw.clientsFile, 'clientsFile', join(dataDir, 'clients.json'))
  const clientsFile = isAbsolute(clientsFileRaw) ? resolve(clientsFileRaw) : resolve(dataDir, clientsFileRaw)

  const limitsRaw = raw.limits ?? {}
  if (typeof limitsRaw !== 'object' || Array.isArray(limitsRaw)) {
    throw new TypeError('dsh-pet-bridge: limits 必须是对象')
  }
  const limits = Object.freeze({
    requestBytes: numberAt(limitsRaw.requestBytes, 'limits.requestBytes', 65536, { min: 1024, max: 65536, integer: true }),
    responseBytes: numberAt(limitsRaw.responseBytes, 'limits.responseBytes', 262144, { min: 4096, max: 262144, integer: true }),
    eventBytes: numberAt(limitsRaw.eventBytes, 'limits.eventBytes', 65536, { min: 2048, max: 65536, integer: true }),
    messageChars: numberAt(limitsRaw.messageChars, 'limits.messageChars', 4000, { min: 1, max: 4000, integer: true }),
    eventsPerSecond: numberAt(limitsRaw.eventsPerSecond, 'limits.eventsPerSecond', 30, { min: 1, max: 240, integer: true }),
    heartbeatMs: numberAt(limitsRaw.heartbeatMs, 'limits.heartbeatMs', 15000, { min: 1000, max: 30000, integer: true }),
    journalRetentionHours: numberAt(limitsRaw.journalRetentionHours, 'limits.journalRetentionHours', 24, { min: 24, max: 8760 }),
    sessionPageSize: numberAt(limitsRaw.sessionPageSize, 'limits.sessionPageSize', 20, { min: 1, max: 100, integer: true }),
    snapshotMessageLimit: numberAt(limitsRaw.snapshotMessageLimit, 'limits.snapshotMessageLimit', 20, { min: 1, max: 200, integer: true }),
    snapshotMessageChars: numberAt(limitsRaw.snapshotMessageChars, 'limits.snapshotMessageChars', 16000, { min: 100, max: 16000, integer: true }),
  })

  const replayRaw = raw.replay ?? {}
  if (typeof replayRaw !== 'object' || Array.isArray(replayRaw)) {
    throw new TypeError('dsh-pet-bridge: replay 必须是对象')
  }
  const replay = Object.freeze({
    windowMs: numberAt(replayRaw.windowMs, 'replay.windowMs', 300000, { min: 1000, max: 3600000, integer: true }),
    maxEvents: numberAt(replayRaw.maxEvents, 'replay.maxEvents', 2000, { min: 16, max: 100000, integer: true }),
    maxBytes: numberAt(replayRaw.maxBytes, 'replay.maxBytes', 8388608, { min: 65536, max: 268435456, integer: true }),
  })

  const journalRaw = raw.journal ?? {}
  if (typeof journalRaw !== 'object' || Array.isArray(journalRaw)) {
    throw new TypeError('dsh-pet-bridge: journal 必须是对象')
  }
  const journal = Object.freeze({
    compactBytes: numberAt(journalRaw.compactBytes, 'journal.compactBytes', 4194304, { min: 65536, max: 67108864, integer: true }),
    sweepIntervalMs: numberAt(journalRaw.sweepIntervalMs, 'journal.sweepIntervalMs', 600000, { min: 60000, max: 3600000, integer: true }),
    fsync: booleanAt(journalRaw.fsync, 'journal.fsync', true),
  })

  const eventRateRaw = raw.eventRate ?? {}
  if (typeof eventRateRaw !== 'object' || Array.isArray(eventRateRaw)) {
    throw new TypeError('dsh-pet-bridge: eventRate 必须是对象')
  }
  const eventRate = Object.freeze({
    deltaFlushMs: numberAt(eventRateRaw.deltaFlushMs, 'eventRate.deltaFlushMs', 80, { min: 20, max: 1000, integer: true }),
    deltaFlushChars: numberAt(eventRateRaw.deltaFlushChars, 'eventRate.deltaFlushChars', 2048, { min: 64, max: 16000, integer: true }),
  })

  const snapshotRaw = raw.snapshot ?? {}
  if (typeof snapshotRaw !== 'object' || Array.isArray(snapshotRaw)) {
    throw new TypeError('dsh-pet-bridge: snapshot 必须是对象')
  }
  const snapshot = Object.freeze({
    messageLimit: numberAt(snapshotRaw.messageLimit, 'snapshot.messageLimit', limits.snapshotMessageLimit, { min: 1, max: 200, integer: true }),
    messageChars: numberAt(snapshotRaw.messageChars, 'snapshot.messageChars', limits.snapshotMessageChars, { min: 100, max: 16000, integer: true }),
  })

  const concurrencyRaw = raw.concurrency ?? {}
  if (typeof concurrencyRaw !== 'object' || Array.isArray(concurrencyRaw)) {
    throw new TypeError('dsh-pet-bridge: concurrency 必须是对象')
  }
  const concurrency = Object.freeze({
    /** The pet host allows 4 concurrent HTTP transfers per plugin. */
    maxHttp: numberAt(concurrencyRaw.maxHttp, 'concurrency.maxHttp', 4, { min: 1, max: 16, integer: true }),
    /** …and exactly one SSE. This build never opens a second one. */
    maxSse: numberAt(concurrencyRaw.maxSse, 'concurrency.maxSse', 1, { min: 1, max: 1, integer: true }),
    maxConnections: numberAt(concurrencyRaw.maxConnections, 'concurrency.maxConnections', 16, { min: 1, max: 128, integer: true }),
  })

  const trustedHostsRaw = raw.trustedHosts ?? []
  if (!Array.isArray(trustedHostsRaw) || trustedHostsRaw.some((entry) => typeof entry !== 'string')) {
    throw new TypeError('dsh-pet-bridge: trustedHosts 必须是字符串数组')
  }

  return Object.freeze({
    host,
    port,
    basePath,
    dataDir,
    clientsFile,
    enableCancel: booleanAt(raw.enableCancel, 'enableCancel', true),
    enableSteer: booleanAt(raw.enableSteer, 'enableSteer', false),
    limits,
    replay,
    journal,
    eventRate,
    snapshot,
    concurrency,
    trustedHosts: Object.freeze([...trustedHostsRaw]),
  })
}

/**
 * The `Host` header authorities this listener accepts. A loopback bind does not
 * authenticate anything, so an unexpected Host (DNS-rebinding style) is refused
 * before authentication runs.
 * @param {object} options address facts.
 * @param {string} options.host bound address.
 * @param {number} options.port bound port.
 * @param {readonly string[]} [options.extra] operator-added authorities.
 * @returns {Set<string>} accepted lowercase authorities.
 */
export function acceptedHosts({ host, port, extra = [] }) {
  const authorities = new Set()
  const portText = String(port)
  if (host === '::1') {
    authorities.add(`[::1]:${portText}`)
  } else {
    authorities.add(`127.0.0.1:${portText}`)
  }
  // A client may name loopback by its literal or by the reserved name; both
  // resolve to this listener only. Never accept an arbitrary LAN authority.
  authorities.add(`localhost:${portText}`)
  for (const entry of extra) {
    const normalized = entry.trim().toLowerCase()
    if (normalized !== '') authorities.add(normalized)
  }
  return authorities
}
