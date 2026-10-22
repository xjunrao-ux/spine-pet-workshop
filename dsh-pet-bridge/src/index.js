// dsh-pet-bridge — the DSH Host plugin for the pet-dsh/1 bridge protocol.
//
// One Cordis plugin row. It owns:
//   - its own loopback HTTP listener (never the GUI's web carrier),
//   - the client registry and capability gates,
//   - the durable request ledger,
//   - the session projection and the single SSE stream,
//   - the adapter that turns committed DSH session facts into protocol events.
//
// It borrows the user's existing Agent: it never creates, resets, forks or
// disposes one, and it never touches the DSH core.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { ClientRegistry } from './auth.js'
import { acceptedHosts, parseConfig } from './config.js'
import { DshAdapter, WireIdMap } from './dsh-adapter.js'
import { EventHub } from './event-hub.js'
import { bridgeBaseUrl, createBridgeServer } from './http-server.js'
import { RequestJournal } from './request-journal.js'
import {
  BridgeError,
  PROTOCOL,
  clampText,
  isIdentifier,
  okEnvelope,
  payloadHashOf,
  parseCommandEnvelope,
  parseMessageSend,
  parseSessionCancel,
  randomHex,
} from './wire.js'

/** Cordis plugin name shown in loader diagnostics. */
export const name = 'pet-bridge'

/**
 * Hard dependencies. Both are provided by `@deepseek-ai/dsh-base`, so the plugin
 * waits (rather than guessing) if a composition omits them.
 */
export const inject = ['agents', 'sessions']

/** This package's version, read from its own manifest. */
const SERVER_VERSION = '1.0.0'

const require = createRequire(import.meta.url)

/**
 * Resolve the version of the harness packages actually loaded in this process.
 * Evidence-based: it reads the manifest of the resolved `@deepseek-ai/dsh-agent`,
 * not a constant in this file.
 * @returns {string} version string, or 'unknown'.
 */
function resolveDshVersion() {
  try {
    const manifest = require.resolve('@deepseek-ai/dsh-agent/package.json')
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
    return typeof parsed.version === 'string' ? parsed.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * @param {string} file absolute path.
 * @param {unknown} fallback value when the file is absent or unreadable.
 * @param {object} log logger.
 * @returns {any} parsed JSON or the fallback.
 */
function readJsonFileSync(file, fallback, log) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') log.warn(`无法读取 ${file}：${error.message}`)
    return fallback
  }
}

/**
 * Replace a JSON file atomically (write temp, rename). Never leaves a half file.
 * @param {string} file absolute path.
 * @param {unknown} value JSON value.
 */
function writeJsonFileSync(file, value) {
  const temp = `${file}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temp, file)
}

/**
 * The bridge instance: all mutable state for one plugin activation.
 */
class PetBridge {
  /**
   * @param {object} ctx Cordis context.
   * @param {object} rawConfig plugin config from the patch row.
   */
  constructor(ctx, rawConfig) {
    this.ctx = ctx
    this.config = parseConfig(rawConfig)
    this.instanceId = `instance-${randomHex(6)}`
    this.dshVersion = resolveDshVersion()
    this.log = ctx.logger('pet-bridge')
    this.logger = ctx.logger
    this.startedAt = new Date().toISOString()
    this.address = null
    this.server = null
    this.journal = null
    this.registry = null
    this.adapter = null
    this.hub = null
    this.sweepTimer = null
    this.authTimer = null
    /** Set once the listener is up; teardown only announces a stop when this is true. */
    this.started = false
    /** @type {Record<string, {title: string|null, workspace: string|null}>} */
    this.sessionCache = {}
    this.paths = {
      runtime: join(this.config.dataDir, 'runtime.json'),
      sessionCache: join(this.config.dataDir, 'session-cache.json'),
      wireIds: join(this.config.dataDir, 'wire-ids.json'),
    }
    this.gates = { cancel: this.config.enableCancel, steer: this.config.enableSteer }
  }

  /** Prepare the data directory and every persisted store, then bind. */
  async start() {
    mkdirSync(this.config.dataDir, { recursive: true })
    this.sessionCache = readJsonFileSync(this.paths.sessionCache, {}, this.logger) ?? {}

    this.journal = RequestJournal.open({
      dir: join(this.config.dataDir, 'journal'),
      retentionHours: this.config.limits.journalRetentionHours,
      compactBytes: this.config.journal.compactBytes,
      fsync: this.config.journal.fsync,
      log: this.logger,
    })

    this.registry = new ClientRegistry({ file: this.config.clientsFile, log: this.logger })
    // A broken authorization file must NOT be read as "no client is authorized"
    // silently — but it must not stop DSH from booting either (the loader treats a
    // failed entry as a failed tree). So: log loudly, serve nothing (fail closed),
    // and let the 2 s watcher pick up the fix without a restart.
    this.registry.reload({ throwOnError: false })
    if (this.registry.loaded === false) {
      this.log.error(`授权表 ${this.config.clientsFile} 无法使用；桥接以「无授权客户端」启动，修好后 2 秒内自动生效`)
    }

    this.hub = new EventHub({
      instanceId: this.instanceId,
      limits: this.config.limits,
      replay: this.config.replay,
      log: this.logger,
    })

    this.adapter = new DshAdapter({
      ctx: this.ctx,
      config: this.config,
      hub: this.hub,
      journal: this.journal,
      wireIds: new WireIdMap({
        load: () => readJsonFileSync(this.paths.wireIds, {}, this.logger) ?? {},
        save: (pairs) => writeJsonFileSync(this.paths.wireIds, { format: 'dsh-pet-bridge-wire-ids/1', pairs }),
        log: this.logger,
      }),
      readSessionCache: (internalId) => this.sessionCache[internalId],
      writeSessionCache: (internalId, value) => this.#updateSessionCache(internalId, value),
      log: this.logger,
    })
    this.adapter.setObservedSessions(this.registry.clients)
    this.registry.onChange((clients) => this.#onClientsChanged(clients))

    // Subscribe to the harness BEFORE accepting submissions (guide §9): a
    // message delivered before observation starts would lose its claim event.
    this.adapter.subscribe()
    this.#recoverLedger()

    const { port, host } = this.config
    this.hosts = acceptedHosts({ host, port, extra: this.config.trustedHosts })
    this.server = createBridgeServer({
      config: this.config,
      instanceId: this.instanceId,
      registry: this.registry,
      hub: this.hub,
      routes: this.#routes(),
      // Read through the mutable field: `config.port` may be 0 (OS-assigned), so
      // the accepted authority set is rebuilt once the real port is known.
      isHostAccepted: (authority) => this.hosts.has(authority),
      log: this.logger,
    })
    const bound = await this.server.listen()
    this.address = { host: bound.address, port: bound.port }
    this.hosts = acceptedHosts({ host, port: bound.port, extra: this.config.trustedHosts })

    this.url = bridgeBaseUrl(bound.address, bound.port, this.config.basePath)
    this.sweepTimer = setInterval(() => {
      try {
        const removed = this.journal.sweep()
        if (removed > 0) this.log.info(`台账清理：删除 ${removed} 条过期终态记录`)
      } catch (error) {
        this.log.warn(`台账清理失败：${error.message}`)
      }
    }, this.config.journal.sweepIntervalMs)
    this.sweepTimer.unref?.()

    // A revoked token must stop working and must close its open stream even when
    // the pet is idle (an SSE consumer issues no requests to notice the change).
    this.authTimer = setInterval(() => {
      try {
        this.registry.maybeReload()
      } catch (error) {
        this.log.warn(`授权表检查失败：${error.message}`)
      }
    }, 2000)
    this.authTimer.unref?.()

    writeJsonFileSync(this.paths.runtime, {
      format: 'dsh-pet-bridge-runtime/1',
      instanceId: this.instanceId,
      serverVersion: SERVER_VERSION,
      dshVersion: this.dshVersion,
      url: this.url,
      host: bound.address,
      port: bound.port,
      basePath: this.config.basePath,
      pid: process.pid,
      startedAt: this.startedAt,
      authorizedClients: this.registry.clients.filter((client) => client.enabled).length,
      authorizedSessions: this.registry.clients.reduce((sum, client) => sum + (client.enabled ? client.sessions.length : 0), 0),
      // Never write a token here: this file only publishes the non-secret address.
    })

    this.log.info(`pet-dsh/1 桥接已监听 ${this.url}（实例 ${this.instanceId}，DSH ${this.dshVersion}）`)
    this.log.info(`授权客户端 ${this.registry.clients.filter((client) => client.enabled).length} 个；未登记客户端时所有请求返回 401`)
    this.started = true
  }

  /**
   * Resolve the fate of ledger entries left open by a previous process.
   * Runs synchronously before the listener accepts anything.
   */
  #recoverLedger() {
    const pending = this.journal.pendingRecovery()
    if (pending.length === 0) return
    let recovered = 0
    for (const entry of pending) {
      try {
        const verdict = this.adapter.recoverEntry(entry)
        if (verdict.decision === 'accepted') {
          this.journal.markAccepted(entry, { activityId: entry.activityId ?? null, turn: entry.turn ?? null, instanceId: this.instanceId })
          recovered += 1
        } else if (verdict.decision === 'rejected') {
          this.journal.markRejected(entry, 'CANCELLED', '进程重启后确认该消息从未交给 DSH')
          recovered += 1
        } else {
          this.journal.markUnknown(entry, 'RESULT_UNKNOWN', verdict.detail)
          recovered += 1
        }
      } catch (error) {
        this.log.error(`台账恢复失败（${entry.requestId}）：${error.message}`)
      }
    }
    if (recovered > 0) this.log.info(`台账恢复：处理 ${recovered} 条上次运行遗留的请求`)
  }

  /**
   * React to an authorization change: refresh the observed session set and close
   * streams whose client disappeared or was disabled.
   * @param {readonly object[]} clients current client table.
   */
  #onClientsChanged(clients) {
    this.adapter?.setObservedSessions(clients)
    const active = new Set(clients.filter((client) => client.enabled).map((client) => client.clientId))
    const revoked = new Set()
    for (const subscriber of [...(this.hub?.streams ?? [])]) {
      if (active.has(subscriber.clientId)) continue
      revoked.add(subscriber.clientId)
    }
    for (const clientId of revoked) this.hub.dropClient(clientId)
    if (revoked.size > 0) this.log.info(`授权变更：关闭 ${revoked.size} 个已撤销客户端的 SSE 流`)
  }

  /**
   * @param {string} internalId DSH session id.
   * @param {{title: string|null, workspace: string|null}} value facts to remember.
   */
  #updateSessionCache(internalId, value) {
    this.sessionCache[internalId] = value
    try {
      writeJsonFileSync(this.paths.sessionCache, this.sessionCache)
    } catch (error) {
      this.log.warn(`会话缓存写入失败：${error.message}`)
    }
  }

  /**
   * @param {object} client authenticated client.
   * @param {number} index page offset.
   * @returns {object} `info` payload.
   */
  #infoFor(client) {
    return {
      protocols: [PROTOCOL],
      instanceId: this.instanceId,
      serverVersion: SERVER_VERSION,
      dshVersion: this.dshVersion,
      capabilities: this.registry.capabilitiesFor(client, this.gates),
      limits: {
        requestBytes: this.config.limits.requestBytes,
        responseBytes: this.config.limits.responseBytes,
        eventBytes: this.config.limits.eventBytes,
        messageChars: this.config.limits.messageChars,
        eventsPerSecond: this.config.limits.eventsPerSecond,
        heartbeatMs: this.config.limits.heartbeatMs,
        journalRetentionHours: this.config.limits.journalRetentionHours,
        sessionPageSize: this.config.limits.sessionPageSize,
        snapshotMessageLimit: this.config.snapshot.messageLimit,
      },
    }
  }

  /**
   * Build the route table handed to the HTTP layer.
   * @returns {object} route handlers.
   */
  #routes() {
    return {
      info: ({ client }) => this.#infoFor(client),

      sessions: ({ client, query }) => {
        this.registry.assertCapability(client, 'sessions.list', this.gates)
        const cursor = query.get('cursor') ?? undefined
        const page = this.adapter.listSessions(client, { cursor, pageSize: this.config.limits.sessionPageSize })
        return { instanceId: this.instanceId, items: page.items, nextCursor: page.nextCursor }
      },

      snapshot: ({ client, query }) => {
        this.registry.assertCapability(client, 'session.snapshot', this.gates)
        const sessionId = query.get('sessionId')
        if (!isIdentifier(sessionId)) throw new BridgeError('INVALID_REQUEST', 'sessionId 缺失或非法')
        this.registry.assertSessionAllowed(client, sessionId)
        // One synchronous cut: fold the log, then take the watermark. No await in
        // between, so no committed event can be missed or replayed (protocol §12).
        const cursor = this.hub.cursorNow()
        return this.adapter.snapshot(sessionId, cursor)
      },

      commands: ({ client, body }) => {
        const result = this.#handleCommand(client, body)
        return {
          status: result.status,
          body: okEnvelope(this.instanceId, result.requestId, result.data),
        }
      },

      requests: ({ client, query }) => {
        this.registry.assertCapability(client, 'requests.lookup', this.gates)
        const requestId = query.get('requestId')
        if (!isIdentifier(requestId)) throw new BridgeError('INVALID_REQUEST', 'requestId 缺失或非法')
        const entry = this.journal.lookup(client.clientId, requestId)
        if (entry === undefined) {
          throw new BridgeError('REQUEST_UNKNOWN', '该 requestId 没有台账记录（或已超出保留期）')
        }
        return { status: 200, body: okEnvelope(this.instanceId, requestId, this.#requestView(entry)) }
      },

      events: async ({ req, res, client, query }) => {
        this.registry.assertCapability(client, 'events.follow', this.gates)
        const sessionId = query.get('sessionId')
        if (!isIdentifier(sessionId)) throw new BridgeError('INVALID_REQUEST', 'sessionId 缺失或非法')
        this.registry.assertSessionAllowed(client, sessionId)
        const resolved = this.adapter.resolveAny(sessionId)
        if (resolved.session === null && !this.hub.buffer.some((record) => record.sessionId === sessionId)) {
          throw new BridgeError('SESSION_NOT_FOUND', '会话不存在或尚未装载')
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        res.flushHeaders?.()
        req.socket?.setTimeout?.(0)
        const lastEventId = typeof req.headers['last-event-id'] === 'string' ? req.headers['last-event-id'] : undefined
        const attached = this.hub.attach({ clientId: client.clientId, sessionId, lastEventId, res })
        const subscriber = attached.subscriber
        const cleanup = () => {
          if (subscriber !== undefined) this.hub.detach(subscriber)
        }
        req.on('close', cleanup)
        req.on('error', cleanup)
        res.on('close', cleanup)
      },
    }
  }

  /**
   * Project one ledger entry into the `requests` DTO. Unknown fields are omitted
   * rather than invented (protocol §8.5).
   * @param {object} entry ledger entry.
   * @returns {object} response data.
   */
  #requestView(entry) {
    const data = {
      status: entry.status,
      op: entry.op,
      sessionId: entry.sessionId,
    }
    if (entry.messageId !== null && entry.messageId !== undefined) data.messageId = entry.messageId
    if (entry.activityId !== null && entry.activityId !== undefined) data.activityId = entry.activityId
    if (entry.acceptedInstanceId !== null && entry.acceptedInstanceId !== undefined) {
      data.acceptedInstanceId = entry.acceptedInstanceId
    }
    if (entry.status === 'ended' && entry.outcome !== null) data.outcome = entry.outcome
    if (entry.status === 'rejected' || entry.status === 'unknown') {
      data.error = {
        code: entry.errorCode ?? (entry.status === 'unknown' ? 'RESULT_UNKNOWN' : 'CANCELLED'),
        message: clampText(entry.errorMessage ?? (entry.status === 'unknown' ? '无法证明执行结果' : '请求被拒绝'), 200),
        retryable: false,
      }
    }
    data.receivedAt = new Date(entry.receivedAt).toISOString()
    data.updatedAt = new Date(entry.updatedAt).toISOString()
    if (entry.endedAt !== null) data.endedAt = new Date(entry.endedAt).toISOString()
    return data
  }

  /**
   * Handle one `POST /commands` envelope.
   *
   * Order of operations is the protocol's: authenticate (done by the HTTP layer),
   * authorize the session, validate the envelope, consult the idempotency ledger,
   * then execute. Nothing is handed to DSH before its intent is durable.
   * @param {object} client authenticated client.
   * @param {unknown} body parsed request body.
   * @returns {{status: number, data: object, requestId: string}} response pieces.
   */
  #handleCommand(client, body) {
    const envelope = parseCommandEnvelope(body, this.instanceId)
    this.registry.assertSessionAllowed(client, envelope.sessionId)
    const payloadHash = payloadHashOf(envelope)

    const existing = this.journal.lookup(client.clientId, envelope.requestId)
    if (existing !== undefined) {
      if (existing.payloadHash !== payloadHash) {
        throw new BridgeError('REQUEST_CONFLICT', '同一 requestId 已用于不同内容')
      }
      return this.#replayReceipt(existing, envelope)
    }

    if (envelope.op === 'message.send') {
      return this.#messageSend(client, envelope, payloadHash)
    }
    if (envelope.op === 'session.cancel') {
      return this.#sessionCancel(client, envelope, payloadHash)
    }
    throw new BridgeError('UNSUPPORTED_CAPABILITY', `未实现的操作 ${String(envelope.op)}`)
  }

  /**
   * Replay the receipt of an already-recorded identical request. This is the
   * idempotency guarantee: the same client+requestId+content never executes a
   * second time, and the client still learns what happened.
   * @param {object} entry ledger entry.
   * @param {object} envelope the repeated command envelope.
   * @returns {{status: number, data: object, requestId: string}} recorded receipt.
   */
  #replayReceipt(entry, envelope) {
    if (entry.status === 'rejected') {
      throw new BridgeError(entry.errorCode ?? 'CANCELLED', entry.errorMessage ?? '该请求已按拒绝记录')
    }
    if (entry.status === 'unknown') {
      throw new BridgeError('RESULT_UNKNOWN', entry.errorMessage ?? '该请求的结果无法确认，不自动重试')
    }
    if (entry.op === 'session.cancel') {
      return {
        status: 200,
        requestId: envelope.requestId,
        data: { status: 'cancelling', activityId: entry.activityId ?? undefined },
      }
    }
    return {
      status: 202,
      requestId: envelope.requestId,
      data: { status: 'accepted', messageId: entry.messageId },
    }
  }

  /**
   * @param {object} client authenticated client.
   * @param {object} envelope validated command envelope.
   * @param {string} payloadHash canonical content digest.
   * @returns {{status: number, data: object, requestId: string}} 202 receipt.
   */
  #messageSend(client, envelope, payloadHash) {
    this.registry.assertCapability(client, 'message.send', this.gates)
    const { mode, text } = parseMessageSend(envelope.data, {
      steer: this.gates.steer,
      messageChars: this.config.limits.messageChars,
    })
    if (mode === 'steer') this.registry.assertCapability(client, 'message.steer', this.gates)
    // Step 2 of the send flow: fail on a busy session before any durable record,
    // so a retryable condition does not burn the client's requestId.
    this.adapter.assertReady(envelope.sessionId, mode)
    const message = this.adapter.prepareMessage(text)
    // Step 3: the intent is durable before DSH sees the message.
    const entry = this.journal.begin({
      clientId: client.clientId,
      requestId: envelope.requestId,
      payloadHash,
      op: envelope.op,
      sessionId: envelope.sessionId,
      messageId: message.id,
    })
    this.adapter.trackOriginated(message.id, { clientId: client.clientId, requestId: envelope.requestId })
    try {
      // Step 4-5: hand to the same agent, confirm the acceptance boundary.
      const receipt = this.adapter.deliver({ wireSessionId: envelope.sessionId, message, mode })
      this.journal.markAccepted(entry, { activityId: receipt.activityId, turn: null, instanceId: this.instanceId })
      return { status: 202, requestId: envelope.requestId, data: { status: 'accepted', messageId: receipt.messageId } }
    } catch (error) {
      const code = error instanceof BridgeError ? error.code : 'INTERNAL_ERROR'
      this.journal.markRejected(entry, code, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  /**
   * @param {object} client authenticated client.
   * @param {object} envelope validated command envelope.
   * @param {string} payloadHash canonical content digest.
   * @returns {{status: number, data: object, requestId: string}} 200 control receipt.
   */
  #sessionCancel(client, envelope, payloadHash) {
    this.registry.assertCapability(client, 'session.cancel', this.gates)
    const { activityId } = parseSessionCancel(envelope.data)
    const receipt = this.adapter.cancel({ wireSessionId: envelope.sessionId, expectedActivityId: activityId })
    const entry = this.journal.begin({
      clientId: client.clientId,
      requestId: envelope.requestId,
      payloadHash,
      op: envelope.op,
      sessionId: envelope.sessionId,
      messageId: null,
    })
    this.journal.markAccepted(entry, { activityId: receipt.activityId, turn: null, instanceId: this.instanceId })
    return {
      status: 200,
      requestId: envelope.requestId,
      data: { status: receipt.status, activityId: receipt.activityId },
    }
  }

  /** Stop accepting work, release every resource, keep DSH sessions untouched. */
  async stop() {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
    if (this.authTimer !== null) {
      clearInterval(this.authTimer)
      this.authTimer = null
    }
    // 1. Stop new submissions, then close streams and heartbeats.
    this.hub?.close()
    // 2. End this plugin's own waits and release subscriptions.
    this.adapter?.close()
    // 3. Flush and close the ledger before the listener goes away, so an
    //    operator reading it after unload sees the final states.
    this.journal?.checkpoint()
    this.journal?.close()
    // 4. Close the listener last: in-flight requests still get their answer.
    if (this.server !== null) {
      try {
        await this.server.close()
      } catch (error) {
        this.log.warn(`关闭监听失败：${error.message}`)
      }
      this.server = null
    }
    try {
      rmSync(this.paths.runtime, { force: true })
    } catch {
      /* the file may already be gone */
    }
    if (this.started) this.log.info('pet-dsh/1 桥接已停止；已提交的 DSH 任务未被取消')
    this.started = false
  }
}

/**
 * Cordis plugin entry point.
 *
 * Blast-radius rule: this plugin must never be able to stop DSH from starting.
 * The loader treats one failed entry as a failed plugin tree, so a typo in the
 * bridge config or an unwritable data directory would otherwise lock the user out
 * of their own GUI. Instead, a setup failure:
 *   1. allocates nothing (every partial resource is rolled back), and
 *   2. logs one loud error naming the reason, and
 *   3. leaves the fiber ACTIVE with **no listener** — the bridge is closed, not
 *      half-open, and `runtime.json` is absent so `pet-bridge-admin status` says
 *      "not running".
 * The user fixes the cause and reloads (or restarts DSH); nothing is left in a
 * state that could serve an unauthenticated or non-durable request.
 *
 * @param {object} ctx plugin context with `agents` and `sessions` injected.
 * @param {object} [rawConfig] config from the loader row.
 */
export async function apply(ctx, rawConfig) {
  const log = ctx.logger('pet-bridge')
  let bridge
  try {
    bridge = new PetBridge(ctx, rawConfig)
  } catch (error) {
    log.error(`配置无效，桥接未启动（DSH 继续运行）：${error.message}`)
    return
  }
  ctx.effect(() => async () => {
    await bridge.stop()
  }, 'pet-bridge:lifecycle')
  try {
    await bridge.start()
  } catch (error) {
    log.error(`启动失败，桥接未开放（DSH 继续运行）：${error.stack ?? error.message}`)
    await bridge.stop()
  }
}

export { PROTOCOL }
