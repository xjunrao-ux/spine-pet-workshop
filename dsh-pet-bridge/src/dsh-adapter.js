// The DSH side of the bridge: every version-specific fact lives in this file.
//
// Verified against DeepSeek Harness 0.1.1-rc.2 (see COMPATIBILITY.md). The shape
// this module relies on:
//   ctx.sessions         SessionStore: live sessions keyed by SessionId
//   ctx.agents           AgentRegistry: live Agents; agent.followup/steer/cancel
//   ctx.sessionTitle     optional: durable session title snapshots
//   session.events       append-only committed log (deltas, tool calls, turns)
//   ctx.on('session/event', (session, event))   post-commit append feed
//   ctx.on('agent/inbox/claimed', {agent, message, turn})   claim boundary
//
// No Agent, Context, AbortSignal or raw internal event ever leaves this file.

import { basename } from 'node:path'

import { createUserMessage } from '@deepseek-ai/dsh-llm'

import { BridgeError, clampText, isIdentifier, sha256Hex } from './wire.js'
import {
  SessionProjection,
  activityIdFor,
  attemptIdFor,
  outcomeOf,
  toolFinishedEvent,
  toolStartedEvent,
} from './session-projection.js'

/** DSH `AgentCancelCause` for a human-initiated cancel from another front end. */
const CANCEL_CAUSE = Object.freeze({ kind: 'user' })

/**
 * Map DSH-internal ids onto wire ids, persisting the non-identity cases.
 *
 * `session-<uuid>` style ids are already legal wire ids, so they are used
 * verbatim (an identity mapping cannot collide). Anything else gets a stable
 * `w_<digest>` id backed by a persisted table; substituting characters would
 * risk two distinct internal ids colliding on one wire id, which is exactly the
 * failure the protocol forbids.
 */
export class WireIdMap {
  /**
   * @param {object} options options.
   * @param {() => Record<string, string>} options.load initial persisted pairs.
   * @param {(pairs: Record<string, string>) => void} options.save persistence sink.
   * @param {object} options.log logger.
   */
  constructor({ load, save, log }) {
    this.log = log
    this.save = save
    /** @type {Map<string, string>} internal → wire */
    this.forward = new Map()
    /** @type {Map<string, string>} wire → internal */
    this.reverse = new Map()
    for (const [internal, wire] of Object.entries(load() ?? {})) {
      this.forward.set(internal, wire)
      this.reverse.set(wire, internal)
    }
  }

  /**
   * @param {string} internalId DSH session/message id.
   * @returns {string} the stable wire id.
   */
  toWire(internalId) {
    const known = this.forward.get(internalId)
    if (known !== undefined) return known
    let wire
    if (isIdentifier(internalId)) {
      wire = internalId
    } else {
      wire = `w_${sha256Hex(internalId).slice(0, 40)}`
    }
    const existing = this.reverse.get(wire)
    if (existing !== undefined && existing !== internalId) {
      // Practically impossible (40 hex chars), but never hand two internal
      // sessions the same wire id.
      this.log.error('wireId 冲突：两个内部会话映射到同一个 wireId')
      throw new BridgeError('INTERNAL_ERROR', '会话标识映射冲突')
    }
    this.forward.set(internalId, wire)
    this.reverse.set(wire, internalId)
    this.#persist()
    return wire
  }

  /**
   * @param {string} wireId wire id.
   * @returns {string|undefined} the internal id when this wire id is known.
   */
  toInternal(wireId) {
    if (this.reverse.has(wireId)) return this.reverse.get(wireId)
    // An identity mapping is not stored; accept it when the internal session
    // exists, which the caller verifies against the live store.
    return wireId
  }

  /** @returns {Record<string, string>} non-identity pairs only. */
  persisted() {
    const out = {}
    for (const [internal, wire] of this.forward) {
      if (internal !== wire) out[internal] = wire
    }
    return out
  }

  /** Write the table through the injected sink. */
  #persist() {
    try {
      this.save(this.persisted())
    } catch (error) {
      this.log.warn(`wireId 映射持久化失败：${error.message}`)
    }
  }
}

/**
 * Cursor codec for `/sessions` pagination. Deliberately *not* the SSE cursor:
 * the protocol forbids mixing the two, and this one is bound to the client and
 * the instance so an offset cannot be transplanted.
 */
export class SessionPageCursor {
  /**
   * @param {string} instanceId this run's id.
   */
  constructor(instanceId) {
    this.instanceId = instanceId
  }

  /**
   * @param {string} clientId authenticated client id.
   * @param {number} offset next item index.
   * @returns {string} opaque cursor.
   */
  encode(clientId, offset) {
    const payload = {
      v: 1,
      i: this.instanceId,
      c: sha256Hex(clientId).slice(0, 12),
      o: offset,
    }
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  }

  /**
   * @param {string} cursor opaque cursor from the request.
   * @param {string} clientId authenticated client id.
   * @returns {number} the offset.
   * @throws {BridgeError} INVALID_REQUEST when the cursor is not ours.
   */
  decode(cursor, clientId) {
    let payload
    try {
      payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    } catch {
      throw new BridgeError('INVALID_REQUEST', 'cursor 无法解析')
    }
    if (payload?.v !== 1 || payload.i !== this.instanceId || payload.c !== sha256Hex(clientId).slice(0, 12)) {
      throw new BridgeError('INVALID_REQUEST', 'cursor 不属于该客户端或该实例')
    }
    if (!Number.isSafeInteger(payload.o) || payload.o < 0) {
      throw new BridgeError('INVALID_REQUEST', 'cursor 偏移无效')
    }
    return payload.o
  }
}

/**
 * The bridge's DSH adapter.
 *
 * It owns the projection cache, the delta coalescer, and the mapping from
 * committed DSH facts to protocol events. The HTTP layer never touches DSH
 * objects; it calls the methods here.
 */
export class DshAdapter {
  /**
   * @param {object} options adapter options.
   * @param {object} options.ctx Cordis context that injects `agents`/`sessions`.
   * @param {object} options.config validated bridge config.
   * @param {object} options.hub SSE hub for publishing projected events.
   * @param {object} options.journal request ledger.
   * @param {WireIdMap} options.wireIds id mapping.
   * @param {(internalId: string) => ({title: string|null, workspace: string|null}|undefined)} options.readSessionCache
   * @param {(internalId: string, value: {title: string|null, workspace: string|null}) => void} options.writeSessionCache
   * @param {object} options.log logger.
   */
  constructor({ ctx, config, hub, journal, wireIds, readSessionCache, writeSessionCache, log }) {
    this.ctx = ctx
    this.config = config
    this.hub = hub
    this.journal = journal
    this.wireIds = wireIds
    this.readSessionCache = readSessionCache
    this.writeSessionCache = writeSessionCache
    this.log = log
    /** @type {Map<string, SessionProjection>} wire session id → projection */
    this.projections = new Map()
    /** @type {Map<string, {attemptId: string, activityId: string, index: number, text: string, timer: any}>} */
    this.deltas = new Map()
    /** messageId → {requestId, clientId} for messages this bridge submitted. */
    this.originated = new Map()
    /** @type {Array<() => void>} */
    this.unsubscribe = []
    this.closed = false
    /** Union of every configured session id, for cheap publish filtering. */
    this.observedSessions = new Set()
  }

  /**
   * Record the union of sessions any registered client may address. Events from
   * sessions outside this set are never projected or published.
   * @param {readonly object[]} clients authorized clients.
   */
  setObservedSessions(clients) {
    this.observedSessions = new Set()
    for (const client of clients) {
      if (!client.enabled) continue
      for (const sessionId of client.sessions) this.observedSessions.add(sessionId)
    }
  }

  /**
   * Resolve the live agent for a wire session id.
   *
   * The session shown here is taken from the **session store** when possible, not
   * from `agent.session`. The store is the owner of live sessions; the agent
   * handle is the execution surface, and a composition may hand back a facade
   * whose `events` accessor is missing (observed on a real GUI-driven session:
   * `/sessions` resolved the agent fine while `agent.session.events` was
   * `undefined`). Reading history through the store keeps the projection working
   * either way.
   *
   * @param {string} wireSessionId wire session id.
   * @returns {{agent: object, session: object, wireId: string}|null} live handles.
   */
  resolveLive(wireSessionId) {
    const internal = this.wireIds.toInternal(wireSessionId)
    if (internal === undefined) return null
    const agent = this.ctx.agents.get(internal)
    if (agent === undefined) return null
    const stored = this.ctx.sessions.get(internal)
    return { agent, session: stored ?? agent.session, wireId: wireSessionId }
  }

  /**
   * Resolve a session that may exist without a live agent (history).
   * @param {string} wireSessionId wire session id.
   * @returns {{session: object|null, agent: object|null, live: boolean}} session facts.
   */
  resolveAny(wireSessionId) {
    const internal = this.wireIds.toInternal(wireSessionId)
    if (internal === undefined) return { session: null, agent: null, live: false }
    const stored = this.ctx.sessions.get(internal)
    const agent = this.ctx.agents.get(internal)
    if (agent !== undefined) return { session: stored ?? agent.session, agent, live: true }
    if (stored !== undefined) return { session: stored, agent: null, live: false }
    return { session: null, agent: null, live: false }
  }

  /**
   * The committed event log of a session, from whichever handle actually carries
   * it.
   *
   * `Session.events` is the documented accessor, but a live GUI-driven session
   * reached through either handle has been observed with `events === undefined`
   * while the object is still a `Session`. The log is the same array the class
   * keeps in `eventsSnapshot` / `log`, so those are tried before giving up.
   * Returns `undefined` (never a guess) when nothing carries a log, so the caller
   * can report exactly what it saw.
   * @param {object|undefined} session session handle.
   * @returns {readonly object[]|undefined} the committed events.
   */
  eventsOf(session) {
    const fromHandle = (value) => {
      for (const candidate of [value?.events, value?.eventsSnapshot, value?.log]) {
        if (Array.isArray(candidate)) return candidate
      }
      return undefined
    }
    const direct = fromHandle(session)
    if (direct !== undefined) return direct
    const id = session?.id
    if (typeof id === 'string') return fromHandle(this.ctx.sessions.get(id))
    return undefined
  }

  /**
   * Describe why a session's log is unusable, for the wire error message.
   *
   * Keeps only member names, prototypes and type names — never contents, paths or
   * values — so a bug report names the exact shape that was missing.
   * @param {object|undefined} session session handle.
   * @returns {string} short diagnostic.
   */
  describeSession(session) {
    const describe = (value, label) => {
      if (value === undefined || value === null) return `${label}=${String(value)}`
      const proto = Object.getPrototypeOf(value)
      const protoName = proto === null ? 'null' : proto.constructor?.name ?? 'anonymous'
      const kind = (key) => {
        try {
          if (!(key in value)) return 'absent'
          const member = value[key]
          return Array.isArray(member) ? `array(${member.length})` : typeof member
        } catch {
          return 'throws'
        }
      }
      const own = Object.getOwnPropertyNames(value).slice(0, 10).join(',')
      const members = proto === null ? '' : Object.getOwnPropertyNames(proto).slice(0, 14).join(',')
      return `${label} 原型=${protoName} events=${kind('events')} log=${kind('log')} seq=${kind('seq')} own=[${own}] proto=[${members}]`
    }
    const stored = typeof session?.id === 'string' ? this.ctx.sessions.get(session.id) : undefined
    return `${describe(session, 'session')}；${describe(stored, 'store')}`
  }

  /**
   * @param {string} internalId DSH session id.
   * @returns {string} wire session id.
   */
  wireIdOf(internalId) {
    return this.wireIds.toWire(internalId)
  }

  /**
   * The display title for one session: the durable `session/title` fold when the
   * session is live, else the last title this bridge observed.
   * @param {object|null} session live session, or null.
   * @param {string} internalId DSH session id.
   * @returns {string|null} title text.
   */
  #titleOf(session, internalId) {
    if (session !== null) {
      const service = this.ctx.get?.('sessionTitle')
      if (service !== undefined && typeof service.get === 'function') {
        try {
          const snapshot = service.get(session)
          if (snapshot !== undefined && typeof snapshot.title === 'string' && snapshot.title !== '') {
            return snapshot.title
          }
        } catch (error) {
          this.log.debug(`读取会话标题失败：${error.message}`)
        }
      }
    }
    return this.readSessionCache(internalId)?.title ?? null
  }

  /**
   * The display workspace for one session: the directory *name*, never the
   * absolute path (protocol §8.2).
   * @param {object|null} session live session, or null.
   * @param {string} internalId DSH session id.
   * @returns {string|null} workspace display name.
   */
  #workspaceOf(session, internalId) {
    if (session !== null) {
      const cwd = session.header?.cwd
      if (typeof cwd === 'string' && cwd !== '') return basename(cwd)
    }
    return this.readSessionCache(internalId)?.workspace ?? null
  }

  /**
   * Capture the current title/workspace of a live session so a later listing can
   * still describe it after the agent is gone.
   * @param {object} session live session.
   * @param {string} internalId DSH session id.
   */
  rememberSessionFacts(session, internalId) {
    const title = this.#titleOf(session, internalId)
    const workspace = this.#workspaceOf(session, internalId)
    const previous = this.readSessionCache(internalId)
    if (previous?.title === title && previous?.workspace === workspace) return
    this.writeSessionCache(internalId, { title, workspace })
  }

  /**
   * List the sessions this client may address, paginated.
   * @param {object} client authenticated client.
   * @param {{cursor?: string, pageSize: number}} options pagination.
   * @returns {{items: object[], nextCursor: string|null}} page.
   */
  listSessions(client, { cursor, pageSize }) {
    const pager = new SessionPageCursor(this.hub.instanceId)
    const offset = cursor === undefined || cursor === '' ? 0 : pager.decode(cursor, client.clientId)
    const all = []
    for (const wireSessionId of client.sessions) {
      const internal = this.wireIds.toInternal(wireSessionId)
      const live = this.resolveLive(wireSessionId)
      const session = live === null ? this.resolveAny(wireSessionId).session : live.session
      if (session !== null) this.rememberSessionFacts(session, internal ?? wireSessionId)
      const status = live === null ? 'unavailable' : live.agent.status === 'running' ? 'running' : 'idle'
      all.push({
        sessionId: wireSessionId,
        title: this.#titleOf(session, internal ?? wireSessionId),
        workspace: this.#workspaceOf(session, internal ?? wireSessionId),
        status,
        available: live !== null,
      })
    }
    const items = all.slice(offset, offset + pageSize)
    const nextOffset = offset + items.length
    return {
      items,
      nextCursor: nextOffset < all.length ? pager.encode(client.clientId, nextOffset) : null,
    }
  }

  /**
   * Fold one session's log into its projection, priming from history when the
   * projection does not exist yet.
   * @param {string} wireSessionId wire session id.
   * @param {object} session session handle (a live `Session`, or a facade).
   * @returns {SessionProjection} the projection.
   * @throws {BridgeError} INTERNAL_ERROR describing the handles when no usable log exists.
   */
  ensureProjection(wireSessionId, session) {
    const events = this.eventsOf(session)
    if (events === undefined) {
      throw new BridgeError('INTERNAL_ERROR', `会话日志不可读：${this.describeSession(session)}`)
    }
    let projection = this.projections.get(wireSessionId)
    if (projection === undefined) {
      projection = new SessionProjection(wireSessionId, 0)
      // Priming must not publish: history is not a live event stream.
      projection.sync(events)
      this.projections.set(wireSessionId, projection)
      return projection
    }
    projection.sync(events)
    return projection
  }

  /**
   * Build the `snapshot` payload. The caller supplies the cursor it captured in
   * the same synchronous block (protocol §12 requires one consistent cut).
   * @param {string} wireSessionId wire session id.
   * @param {string} cursor watermark captured by the caller.
   * @returns {object} snapshot response data.
   */
  snapshot(wireSessionId, cursor) {
    const live = this.resolveLive(wireSessionId)
    const resolved = live === null ? this.resolveAny(wireSessionId) : live
    if (resolved.session === null) {
      throw new BridgeError('SESSION_NOT_FOUND', '会话不存在或尚未装载')
    }
    const projection = live === null
      ? this.#historyProjection(wireSessionId, resolved.session)
      : this.ensureProjection(wireSessionId, resolved.session)
    const body = projection.buildSnapshot({
      limit: this.config.snapshot.messageLimit,
      chars: this.config.snapshot.messageChars,
      byteBudget: this.config.limits.responseBytes,
      activityActive: live !== null,
    })
    return {
      instanceId: this.hub.instanceId,
      sessionId: wireSessionId,
      cursor,
      messages: body.messages,
      activity: body.activity,
      pendingInteractions: body.pendingInteractions,
      pendingPetCalls: body.pendingPetCalls,
      truncated: body.truncated,
    }
  }

  /**
   * A projection for a session with no live agent. Kept out of the live cache so
   * a later resume starts from a clean prime.
   * @param {string} wireSessionId wire session id.
   * @param {object} session session object.
   * @returns {SessionProjection} projection folded over the stored log.
   */
  #historyProjection(wireSessionId, session) {
    const projection = new SessionProjection(wireSessionId, 0)
    const events = this.eventsOf(session)
    if (events !== undefined) projection.sync(events)
    return projection
  }

  /**
   * Record that a message id belongs to a bridge request, so a later session
   * event can be attributed to exactly that request.
   * @param {string} messageId DSH message id.
   * @param {{clientId: string, requestId: string}} origin origin request.
   */
  trackOriginated(messageId, origin) {
    this.originated.set(messageId, origin)
    if (this.originated.size > 512) {
      const oldest = this.originated.keys().next()
      if (!oldest.done) this.originated.delete(oldest.value)
    }
  }

  /**
   * @param {string} messageId DSH message id.
   * @returns {{clientId: string, requestId: string}|undefined} the origin request.
   */
  originOf(messageId) {
    return this.originated.get(messageId)
  }

  /**
   * The pre-submission checks of protocol §9 step 2: the session must have a live
   * agent, and an ordinary follow-up must not race an activity that is already
   * running. Runs before anything is journaled, so a busy session leaves no
   * ledger record behind.
   * @param {string} wireSessionId wire session id.
   * @param {'followup'|'steer'} mode delivery mode.
   * @returns {{agent: object, session: object, activityId: string|null}} live handles.
   */
  assertReady(wireSessionId, mode) {
    const live = this.resolveLive(wireSessionId)
    if (live === null) {
      throw new BridgeError('SESSION_NOT_FOUND', '该会话当前没有活跃的 DSH Agent，无法发送')
    }
    if (mode === 'followup' && live.agent.status === 'running') {
      throw new BridgeError('SESSION_BUSY', '会话正在执行，请稍后再发送，或使用已确认的追加指令')
    }
    const projection = this.projections.get(wireSessionId)
    return { agent: live.agent, session: live.session, activityId: projection === undefined ? null : projection.currentActivityId() }
  }

  /**
   * Build the identified user message the harness' own factory would build.
   *
   * Using `createUserMessage` (rather than hand-rolling a shape) keeps the id,
   * role, content blocks and `source.kind` identical to every other front end's
   * messages, and gives us a durable id to journal before delivery.
   * @param {string} text validated message text.
   * @returns {object} frozen DSH `UserMessage`.
   */
  prepareMessage(text) {
    return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  }

  /**
   * Hand one already-journaled message to the existing agent. The caller writes
   * the intent to the ledger before calling this, so an acknowledged send can
   * never be replayed after a crash.
   * @param {object} input delivery facts.
   * @param {string} input.wireSessionId wire session id.
   * @param {object} input.message DSH `UserMessage` from {@link prepareMessage}.
   * @param {'followup'|'steer'} input.mode delivery mode.
   * @returns {{status: string, messageId: string, activityId: string|null}} acceptance receipt.
   */
  deliver({ wireSessionId, message, mode }) {
    const live = this.resolveLive(wireSessionId)
    if (live === null) {
      throw new BridgeError('SESSION_NOT_FOUND', '该会话当前没有活跃的 DSH Agent，无法发送')
    }
    if (mode === 'followup') live.agent.followup(message)
    else live.agent.steer(message)
    const projection = this.projections.get(wireSessionId)
    return {
      status: 'accepted',
      messageId: message.id,
      activityId: projection === undefined ? null : projection.currentActivityId(),
    }
  }

  /**
   * Cancel the activity the client believes it is cancelling.
   *
   * `keepInbox` is deliberate: the default DSH cancel also clears queued and
   * steering input, which would silently drop work another front end queued.
   * @param {object} input cancel facts.
   * @param {string} input.wireSessionId wire session id.
   * @param {string} input.expectedActivityId activity the client observed.
   * @returns {{status: string, activityId: string}} the cancelling receipt.
   */
  cancel({ wireSessionId, expectedActivityId }) {
    const live = this.resolveLive(wireSessionId)
    if (live === null) throw new BridgeError('SESSION_NOT_FOUND', '该会话没有活跃的 DSH Agent')
    const projection = this.ensureProjection(wireSessionId, live.session)
    const current = projection.currentActivityId()
    if (current === null) throw new BridgeError('EXPIRED', '当前没有可取消的活动')
    if (current !== expectedActivityId) {
      throw new BridgeError('EXPIRED', 'activityId 已过期：当前活动与请求不匹配')
    }
    live.agent.cancel(CANCEL_CAUSE, { keepInbox: true })
    return { status: 'cancelling', activityId: current }
  }

  /**
   * Subscribe to the harness' durable and live feeds. Called once during plugin
   * start, before the HTTP listener opens, so no event is missed after startup.
   */
  subscribe() {
    const on = (name, handler) => {
      this.ctx.on(name, handler)
      this.unsubscribe.push(() => {
        // Cordis disposers are fiber-owned; the plugin fiber teardown removes
        // these listeners. Recording them keeps the intent explicit.
      })
    }
    on('session/event', (session, event) => this.#onSessionEvent(session, event))
    on('agent/inbox/claimed', (payload) => this.#onInboxClaimed(payload))
    on('agent/inbox/discarded', (payload) => this.#onInboxDiscarded(payload))
    on('agent/status', (payload) => this.#onAgentStatus(payload))
  }

  /**
   * @param {object} session live session.
   * @param {object} event committed session event.
   */
  #onSessionEvent(session, event) {
    if (this.closed) return
    const internalId = session.id
    const wireSessionId = this.wireIds.toWire(internalId)
    if (!this.observedSessions.has(wireSessionId)) return
    let projection
    try {
      projection = this.ensureProjection(wireSessionId, session)
    } catch (error) {
      // A listener must never throw into the harness' append path: contain it and
      // keep the stream alive for every other session.
      this.log.error(`会话事件投影失败（${wireSessionId}）：${error?.message ?? error}`)
      return
    }
    // `ensureProjection` already folded this event (it was committed before the
    // feed fired), so project the one event that is now visible for the first
    // time by looking at the freshly folded tail.
    this.#projectEvent(wireSessionId, projection, event)
  }

  /**
   * Map one committed event to zero or more bridge events and publish them.
   * @param {string} wireSessionId wire session id.
   * @param {SessionProjection} projection the session projection.
   * @param {object} event committed session event.
   */
  #projectEvent(wireSessionId, projection, event) {
    const data = event.data ?? {}
    switch (event.type) {
      case 'assistant/chunk': {
        const chunk = data.chunk
        if (!chunk || chunk.type !== 'text-delta' || typeof chunk.text !== 'string' || chunk.text === '') return
        this.#accumulateDelta(wireSessionId, data.turn, data.step, chunk.text)
        return
      }
      case 'assistant/message': {
        this.flushDeltas(wireSessionId)
        const message = data.message ?? {}
        const messageId = typeof message.id === 'string' ? message.id : null
        if (messageId === null) return
        const text = Array.isArray(message.content)
          ? message.content.filter((block) => block?.type === 'text').map((block) => block.text).join('')
          : ''
        const origin = this.originOf(messageId)
        this.hub.publish({
          sessionId: wireSessionId,
          type: 'assistant.message',
          data: {
            messageId,
            turn: Number.isSafeInteger(data.turn) ? data.turn : -1,
            text: clampText(text, this.config.snapshot.messageChars),
            attemptId: attemptIdFor(Number.isSafeInteger(data.turn) ? data.turn : 0, Number.isSafeInteger(data.step) ? data.step : 0),
          },
          requestId: origin?.requestId,
        })
        return
      }
      case 'tool/call': {
        this.flushDeltas(wireSessionId)
        const projected = toolStartedEvent(event, wireSessionId)
        if (projected !== null) this.hub.publish({ sessionId: wireSessionId, type: projected.type, data: projected.data })
        return
      }
      case 'tool/result': {
        this.flushDeltas(wireSessionId)
        const projected = toolFinishedEvent(event, wireSessionId)
        if (projected !== null) this.hub.publish({ sessionId: wireSessionId, type: projected.type, data: projected.data })
        return
      }
      case 'turn/start': {
        this.hub.publish({
          sessionId: wireSessionId,
          type: 'activity.state',
          data: { activityId: activityIdFor(wireSessionId, data.turn), status: 'running' },
        })
        return
      }
      case 'turn/end': {
        this.flushDeltas(wireSessionId)
        const activityId = activityIdFor(wireSessionId, data.turn)
        const outcome = outcomeOf(data.reason)
        this.hub.publish({
          sessionId: wireSessionId,
          type: 'activity.ended',
          data: { activityId, outcome },
        })
        this.#settleRequests(wireSessionId, activityId, outcome)
        this.hub.publish({
          sessionId: wireSessionId,
          type: 'session.changed',
          data: { status: 'idle' },
        })
        return
      }
      case 'approval/asked': {
        this.hub.publish({
          sessionId: wireSessionId,
          type: 'activity.state',
          data: { activityId: projection.currentActivityId() ?? activityIdFor(wireSessionId, -1), status: 'waiting-approval' },
        })
        return
      }
      case 'approval/decided': {
        this.hub.publish({
          sessionId: wireSessionId,
          type: 'activity.state',
          data: { activityId: projection.currentActivityId() ?? activityIdFor(wireSessionId, -1), status: 'running' },
        })
        return
      }
      case 'user/message': {
        const source = data.source ?? {}
        if (source.kind !== 'user') return
        const messageId = typeof data.id === 'string' ? data.id : null
        if (messageId !== null && this.originOf(messageId) !== undefined) {
          // A message this bridge submitted is attributed when the loop claims
          // it, which is the moment that proves the real turn association.
          return
        }
        this.hub.publish({
          sessionId: wireSessionId,
          type: 'session.changed',
          data: { status: 'input' },
        })
        return
      }
      case 'session/title': {
        this.hub.publish({
          sessionId: wireSessionId,
          type: 'session.changed',
          data: { status: 'title' },
        })
        return
      }
      default:
        return
    }
  }

  /**
   * Attribute a finished turn to the bridge request whose message it ran, so
   * `requests` can report `ended` with the real outcome.
   * @param {string} wireSessionId wire session id.
   * @param {string} activityId the ended activity.
   * @param {string} outcome wire outcome.
   */
  #settleRequests(wireSessionId, activityId, outcome) {
    for (const entry of this.journal.entries.values()) {
      if (entry.sessionId !== wireSessionId) continue
      if (entry.status === 'ended' || entry.status === 'rejected') continue
      if (entry.activityId !== activityId) continue
      try {
        this.journal.markEnded(entry, outcome, { activityId })
      } catch (error) {
        this.log.error(`台账写入失败：${error.message}`)
      }
    }
  }

  /**
   * Buffer one text delta and schedule a coalesced flush (protocol §12 asks for
   * ~50-100 ms merging so a fast model cannot exceed the event budget).
   * @param {string} wireSessionId wire session id.
   * @param {number} turn DSH turn.
   * @param {number} step DSH step.
   * @param {string} text delta text.
   */
  #accumulateDelta(wireSessionId, turn, step, text) {
    const attemptId = attemptIdFor(Number.isSafeInteger(turn) ? turn : 0, Number.isSafeInteger(step) ? step : 0)
    const activityId = activityIdFor(wireSessionId, Number.isSafeInteger(turn) ? turn : 0)
    let state = this.deltas.get(wireSessionId)
    if (state === undefined || state.attemptId !== attemptId) {
      if (state !== undefined) this.flushDeltas(wireSessionId)
      state = { attemptId, activityId, index: 0, text: '', timer: null }
      this.deltas.set(wireSessionId, state)
    }
    state.text += text
    if (state.text.length >= this.config.eventRate.deltaFlushChars) {
      this.flushDeltas(wireSessionId)
      return
    }
    if (state.timer === null) {
      state.timer = setTimeout(() => {
        state.timer = null
        this.flushDeltas(wireSessionId)
      }, this.config.eventRate.deltaFlushMs)
      state.timer.unref?.()
    }
  }

  /**
   * Publish whatever text has accumulated for one session's current attempt.
   * Must be called before any event that must follow the deltas.
   * @param {string} wireSessionId wire session id.
   */
  flushDeltas(wireSessionId) {
    const state = this.deltas.get(wireSessionId)
    if (state === undefined) return
    if (state.timer !== null) {
      clearTimeout(state.timer)
      state.timer = null
    }
    if (state.text === '') {
      this.deltas.delete(wireSessionId)
      return
    }
    const text = state.text
    state.text = ''
    this.hub.publish({
      sessionId: wireSessionId,
      type: 'assistant.delta',
      data: {
        activityId: state.activityId,
        attemptId: state.attemptId,
        index: state.index,
        text: clampText(text, this.config.limits.eventBytes / 4),
      },
    })
    state.index += 1
  }

  /**
   * The claim boundary: this is the only place a `message.claimed` event is
   * produced, because it is the only DSH fact that proves which turn ran which
   * message.
   * @param {{agent: object, message: object, turn: number}} payload claim payload.
   */
  #onInboxClaimed(payload) {
    if (this.closed) return
    const message = payload?.message
    const messageId = typeof message?.id === 'string' ? message.id : null
    if (messageId === null) return
    const origin = this.originOf(messageId)
    if (origin === undefined) return
    const session = payload.agent?.session
    if (session === undefined) return
    const wireSessionId = this.wireIds.toWire(session.id)
    if (!this.observedSessions.has(wireSessionId)) return
    const turn = Number.isSafeInteger(payload.turn) ? payload.turn : -1
    const activityId = activityIdFor(wireSessionId, turn)
    const entry = this.journal.lookup(origin.clientId, origin.requestId)
    if (entry !== undefined) {
      try {
        this.journal.markRunning(entry, { activityId, turn })
      } catch (error) {
        this.log.error(`台账写入失败：${error.message}`)
      }
    }
    this.hub.publish({
      sessionId: wireSessionId,
      type: 'message.claimed',
      requestId: origin.requestId,
      data: { requestId: origin.requestId, messageId, activityId, turn },
    })
  }

  /**
   * A queued message was discarded before it ran (for example a cancellation).
   * @param {{agent: object, message: object}} payload discard payload.
   */
  #onInboxDiscarded(payload) {
    if (this.closed) return
    const messageId = typeof payload?.message?.id === 'string' ? payload.message.id : null
    if (messageId === null) return
    const origin = this.originOf(messageId)
    if (origin === undefined) return
    const entry = this.journal.lookup(origin.clientId, origin.requestId)
    if (entry === undefined) return
    try {
      this.journal.markRejected(entry, 'CANCELLED', '消息在进入执行前被取消')
    } catch (error) {
      this.log.error(`台账写入失败：${error.message}`)
    }
    const session = payload.agent?.session
    if (session === undefined) return
    const wireSessionId = this.wireIds.toWire(session.id)
    if (!this.observedSessions.has(wireSessionId)) return
    this.hub.publish({
      sessionId: wireSessionId,
      type: 'session.changed',
      data: { status: 'discarded' },
    })
  }

  /**
   * Agent status transitions are the cheap "something changed here" signal the
   * pet uses to refresh its snapshot when another front end drives the session.
   * @param {{agent: object, status: string}} payload status payload.
   */
  #onAgentStatus(payload) {
    if (this.closed) return
    const session = payload?.agent?.session
    if (session === undefined) return
    const wireSessionId = this.wireIds.toWire(session.id)
    if (!this.observedSessions.has(wireSessionId)) return
    this.hub.publish({
      sessionId: wireSessionId,
      type: 'session.changed',
      data: { status: payload.status === 'running' ? 'running' : 'idle' },
    })
  }

  /**
   * Decide the fate of a ledger entry that was open when the process died
   * (protocol §10 table). Runs before the listener accepts new submissions.
   * @param {object} entry ledger entry.
   * @returns {{decision: 'accepted'|'rejected'|'unknown', detail: string}} verdict.
   */
  recoverEntry(entry) {
    const live = this.resolveLive(entry.sessionId)
    const resolved = live === null ? this.resolveAny(entry.sessionId) : live
    const session = resolved.session
    const messageId = entry.messageId
    if (messageId === null || messageId === undefined) {
      return { decision: 'unknown', detail: '台账没有预分配 messageId' }
    }
    if (session === null) {
      return { decision: 'unknown', detail: '会话既不在活跃注册表也不在会话存储中' }
    }
    const inLog = session.events.some((event) => event.type === 'user/message' && event.data?.id === messageId)
    if (inLog) {
      // The message committed, so it was delivered. Its turn association is
      // recovered by the normal projection on the next event.
      return { decision: 'accepted', detail: '用户的 messageId 已出现在持久会话日志' }
    }
    if (live !== null) {
      const inbox = live.agent.inbox
      const pending = [...(inbox?.nextTurn ?? []), ...(inbox?.nextStep ?? [])]
      if (pending.some((message) => message.id === messageId)) {
        return { decision: 'accepted', detail: '消息仍在 DSH inbox 中等待' }
      }
      if (live.agent.status === 'idle') {
        return { decision: 'rejected', detail: '日志与 inbox 都没有该消息，且 Agent 空闲' }
      }
    }
    return { decision: 'unknown', detail: 'Agent 正在执行，无法证明该消息是否被认领' }
  }

  /** Flush every pending delta (used before shutdown and by tests). */
  flushAllDeltas() {
    for (const wireSessionId of [...this.deltas.keys()]) this.flushDeltas(wireSessionId)
  }

  /** Release adapter-owned state. Borrowed agents are never touched. */
  close() {
    this.closed = true
    this.flushAllDeltas()
    for (const state of this.deltas.values()) {
      if (state.timer !== null) clearTimeout(state.timer)
    }
    this.deltas.clear()
    this.projections.clear()
    this.originated.clear()
    for (const dispose of this.unsubscribe) dispose()
    this.unsubscribe = []
  }
}
