// Safe session projection: durable DSH events → the pet's display vocabulary.
//
// The projection is a pure fold over one session's committed event log. It never
// reads live Agent objects and never re-serializes one: only scalar display text
// leaves this module, which is what keeps private reasoning, raw tool arguments,
// internal prompts and environment data off the wire.

import {
  asTurn,
  charLength,
  clampText,
  sha256Hex,
  textOfContent,
  utf8Length,
} from './wire.js'

/** How many messages the fold keeps in memory; snapshots take the newest slice. */
const RING_SIZE = 64

/** Turn-end reasons that mean "the activity ended normally". */
const COMPLETED_REASONS = new Set(['completed', 'max-tokens'])

/**
 * Stable, short activity id derived from the wire session and the DSH turn.
 * Turn numbers restart per session, so the session contributes a digest prefix;
 * the result stays inside the identifier grammar and well under 100 characters.
 * @param {string} wireSessionId wire session id.
 * @param {number} turn DSH turn number.
 * @returns {string} activity id such as `act.3f2a1c09.12`.
 */
export function activityIdFor(wireSessionId, turn) {
  return `act.${sha256Hex(wireSessionId).slice(0, 8)}.${turn}`
}

/**
 * Attempt id for one model step: a retry inside a step keeps its id, a new step
 * gets a new one, which is exactly the protocol's "重试换 attemptId" rule.
 * @param {number} turn DSH turn number.
 * @param {number} step DSH step number.
 * @returns {string} attempt id such as `att.12.3`.
 */
export function attemptIdFor(turn, step) {
  return `att.${turn}.${step}`
}

/**
 * Map a DSH `turn/end` reason to a protocol `activity.ended` outcome.
 *
 * `completed` means the activity ended normally — not that tests passed or the
 * work was correct (protocol §11). `max-tokens` still closed the turn normally.
 * @param {unknown} reason `TurnEndReason` from the session log.
 * @returns {'completed'|'failed'|'cancelled'|'interrupted'} wire outcome.
 */
export function outcomeOf(reason) {
  const kind = reason && typeof reason === 'object' && typeof reason.kind === 'string' ? reason.kind : 'unknown'
  if (COMPLETED_REASONS.has(kind)) return 'completed'
  if (kind === 'aborted') return 'cancelled'
  if (kind === 'interrupted') return 'interrupted'
  return 'failed'
}

/**
 * Bounded summary of a tool name for `tool.started`/`tool.finished`. Arguments and
 * terminal output are deliberately absent.
 * @param {string} name tool name.
 * @returns {string} summary text.
 */
function toolSummary(name) {
  return clampText(`调用工具 ${name}`, 120)
}

/**
 * Incremental fold of one session's committed events.
 *
 * `sync()` folds only events it has not seen; `snapshot()` reads the folded state.
 * Both are synchronous, which is what lets the HTTP layer capture the projection
 * and the hub watermark inside one critical section (protocol §12).
 */
export class SessionProjection {
  /**
   * @param {string} wireSessionId wire session id.
   * @param {number} [startSeq] first unfold seq (0 when folding from the log start).
   */
  constructor(wireSessionId, startSeq = 0) {
    this.sessionId = wireSessionId
    /** Seq after the last folded event. */
    this.nextSeq = startSeq
    /** Turn opened by the last `turn/start` that has not closed. */
    this.currentTurn = null
    /** @type {{activityId: string, turn: number, status: string}|null} */
    this.activity = null
    /** @type {Array<{messageId: string, role: string, text: string, turn: number, clamped?: boolean}>} */
    this.messages = []
    /** @type {Map<string, {toolName: string, outcome: string|null, callId: string|null}>} */
    this.approvals = new Map()
    /** Outcome of the last closed turn, for `activity.ended` replay decisions. */
    this.lastOutcome = null
    /** Bumped whenever any state the snapshot exposes changes. */
    this.revision = 0
  }

  /**
   * Fold every event at or after `nextSeq`.
   *
   * `session.events` is contiguous from seq 0 and append-only, so the fold
   * position is simply a count. The defensive branch below only exists for a
   * log that was replaced wholesale (which DSH never does in-process); it
   * resynchronizes instead of spinning.
   * @param {readonly object[]} events the session's immutable event log.
   * @returns {object[]} the events folded in this call (empty when up to date).
   */
  sync(events) {
    const folded = []
    while (this.nextSeq < events.length) {
      const event = events[this.nextSeq]
      if (!event || event.seq !== this.nextSeq) {
        const next = typeof event?.seq === 'number' ? event.seq : this.nextSeq + 1
        this.nextSeq = next > this.nextSeq ? next : this.nextSeq + 1
        continue
      }
      this.#apply(event)
      this.nextSeq += 1
      folded.push(event)
    }
    if (folded.length > 0) this.revision += 1
    return folded
  }

  /**
   * Apply one committed event to the folded state.
   * @param {object} event `SessionEvent`.
   */
  #apply(event) {
    const data = event.data ?? {}
    switch (event.type) {
      case 'turn/start': {
        const turn = asTurn(data.turn)
        if (turn < 0) return
        this.currentTurn = turn
        this.activity = { activityId: activityIdFor(this.sessionId, turn), turn, status: 'running' }
        return
      }
      case 'turn/end': {
        const turn = asTurn(data.turn)
        this.lastOutcome = outcomeOf(data.reason)
        if (this.activity !== null && this.activity.turn === turn) this.activity = null
        this.currentTurn = null
        return
      }
      case 'user/message': {
        // Only a real human prompt is display material. `agent.inject()` context
        // (file-change notices, skill text, subdirectory instructions, goal
        // rounds) shares this event type but is internal model-facing input.
        const source = data.source ?? {}
        if (source.kind !== 'user') return
        this.#pushMessage({
          messageId: typeof data.id === 'string' ? data.id : null,
          role: 'user',
          text: textOfContent(data.content),
          turn: this.currentTurn ?? -1,
        })
        return
      }
      case 'assistant/message': {
        const message = data.message ?? {}
        const id = typeof message.id === 'string' ? message.id : null
        this.#pushMessage({
          messageId: id,
          role: 'assistant',
          text: textOfContent(message.content),
          turn: asTurn(data.turn) >= 0 ? data.turn : this.currentTurn ?? -1,
        })
        return
      }
      case 'approval/asked': {
        if (typeof data.id !== 'string') return
        this.approvals.set(data.id, {
          toolName: typeof data.toolName === 'string' ? data.toolName : 'unknown',
          callId: typeof data.callId === 'string' ? data.callId : null,
          outcome: null,
        })
        return
      }
      case 'approval/decided': {
        if (typeof data.id !== 'string') return
        const existing = this.approvals.get(data.id) ?? { toolName: 'unknown', callId: null, outcome: null }
        existing.outcome = typeof data.outcome === 'string' ? data.outcome : 'unavailable'
        this.approvals.set(data.id, existing)
        return
      }
      default:
        return
    }
  }

  /**
   * @param {{messageId: string|null, role: string, text: string, turn: number}} message message to keep.
   */
  #pushMessage(message) {
    if (message.messageId === null) return
    // A non-string body would surface later as an opaque failure inside the
    // budget arithmetic; refuse it at the fold boundary instead.
    if (typeof message.text !== 'string') return
    if (message.text === '') return
    this.messages.push(message)
    if (this.messages.length > RING_SIZE) this.messages.splice(0, this.messages.length - RING_SIZE)
  }

  /**
   * The activity id this session is currently executing, if any.
   * @returns {string|null} activity id.
   */
  currentActivityId() {
    return this.activity === null ? null : this.activity.activityId
  }

  /**
   * Activity status for `activity.state`/snapshot, including the derived
   * "waiting for a human" states this bridge can observe without an answer channel.
   * @returns {'running'|'waiting-approval'|'waiting-input'|'cancelling'} status.
   */
  activityStatus() {
    for (const approval of this.approvals.values()) {
      if (approval.outcome === null) return 'waiting-approval'
    }
    return 'running'
  }

  /**
   * @returns {string[]} approval ids that were asked and not yet decided.
   */
  pendingApprovalIds() {
    const ids = []
    for (const [id, approval] of this.approvals) {
      if (approval.outcome === null) ids.push(id)
    }
    return ids
  }

  /**
   * Build the `snapshot` payload for this session.
   *
   * Messages are the newest `limit`, each clamped to `chars` code points; the
   * total JSON size is then reduced by dropping the oldest entries until the
   * budget holds. A dropped or clamped message keeps its id and sets
   * `truncated`, so the client can point the user at the DSH GUI for the rest.
   * @param {{limit: number, chars: number, byteBudget: number, activityActive: boolean}} options budgets.
   * @returns {object} snapshot fields without `cursor`.
   */
  buildSnapshot({ limit, chars, byteBudget, activityActive }) {
    const selected = this.messages.slice(-limit)
    let truncated = false
    const messages = selected.map((message) => {
      const clamped = charLength(message.text) > chars
      if (clamped) truncated = true
      return {
        messageId: message.messageId,
        role: message.role,
        text: clamped ? clampText(message.text, chars) : message.text,
        turn: message.turn,
      }
    })
    // Shrink from the oldest end until the serialized payload fits the budget.
    // 512 bytes stay reserved for the envelope around `messages`.
    while (messages.length > 1 && utf8Length(JSON.stringify(messages)) > byteBudget - 512) {
      messages.shift()
      truncated = true
    }
    const activity = this.activity === null || !activityActive
      ? null
      : { activityId: this.activity.activityId, status: this.activityStatus() }
    return {
      messages,
      activity,
      pendingInteractions: [],
      pendingPetCalls: [],
      truncated,
    }
  }
}

/**
 * Project one already-committed tool call into a `tool.started` payload.
 * @param {object} event `tool/call` session event.
 * @param {string} sessionId wire session id.
 * @returns {{type: string, data: object}|null} bridge event, or null when unusable.
 */
export function toolStartedEvent(event, sessionId) {
  const data = event.data ?? {}
  if (typeof data.name !== 'string' || typeof data.callId !== 'string') return null
  return {
    type: 'tool.started',
    data: {
      activityId: activityIdFor(sessionId, asTurn(data.turn)),
      callId: data.callId,
      name: clampText(data.name, 100),
      summary: toolSummary(data.name),
    },
  }
}

/**
 * Project one committed tool result into a `tool.finished` payload. The raw
 * result text is intentionally not forwarded; only the outcome and a fixed,
 * bounded summary.
 * @param {object} event `tool/result` session event.
 * @param {string} sessionId wire session id.
 * @returns {{type: string, data: object}|null} bridge event, or null when unusable.
 */
export function toolFinishedEvent(event, sessionId) {
  const data = event.data ?? {}
  const message = data.message ?? {}
  const callId = message.source && typeof message.source.callId === 'string' ? message.source.callId : null
  if (callId === null) return null
  const failed = message.content?.[0]?.isError === true || typeof data.error === 'object'
  return {
    type: 'tool.finished',
    data: {
      activityId: activityIdFor(sessionId, asTurn(data.turn)),
      callId,
      status: failed ? 'failed' : 'completed',
      summary: clampText(failed ? '工具返回失败' : '工具返回结果', 120),
    },
  }
}
