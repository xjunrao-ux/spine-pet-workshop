// SSE hub: instance-scoped cursors, bounded replay, one live stream, backpressure.
//
// Cursor design (protocol §12): every published bridge event takes the next
// integer of one per-instance counter, so a snapshot can capture "everything up
// to here" as a single watermark and the following events line up as C+1, C+2…
// Comparing cursors across instances is meaningless by construction, which is
// why a foreign or expired cursor ends the stream with `resync.required` instead
// of a silent replay.

import { formatCursor, parseCursor, utf8Length } from './wire.js'

/** How long a superseded stream gets to flush before it is destroyed. */
const CLOSE_GRACE_MS = 250

/**
 * One SSE subscriber.
 */
class Subscriber {
  /**
   * @param {object} options subscriber options.
   * @param {string} options.clientId authenticated client id.
   * @param {string} options.sessionId wire session id being followed.
   * @param {import('node:http').ServerResponse} options.res the response to write frames to.
   * @param {object} options.log logger.
   */
  constructor({ clientId, sessionId, res, log }) {
    this.clientId = clientId
    this.sessionId = sessionId
    this.res = res
    this.log = log
    this.closed = false
    this.heartbeat = null
    this.bytesWritten = 0
  }

  /**
   * Write one pre-framed chunk.
   * @param {string} chunk frame text.
   * @returns {boolean} false when the stream is gone.
   */
  write(chunk) {
    if (this.closed) return false
    try {
      const flushed = this.res.write(chunk)
      this.bytesWritten += Buffer.byteLength(chunk, 'utf8')
      // `false` only means the kernel buffer is full; the response object keeps
      // queuing. The hard bound is the queue depth, checked by the hub.
      void flushed
      return true
    } catch (error) {
      this.log.warn(`SSE 写入失败：${error.message}`)
      this.destroy()
      return false
    }
  }

  /** Close politely: end the response when it is safe to. */
  end() {
    if (this.closed) return
    this.closed = true
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    try {
      this.res.end()
    } catch {
      /* already gone */
    }
  }

  /** Drop the connection without a graceful flush. */
  destroy() {
    if (this.closed) return
    this.closed = true
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    try {
      this.res.destroy()
    } catch {
      /* already gone */
    }
  }

  /** @returns {number} bytes currently queued inside the response. */
  queuedBytes() {
    return this.res.writableLength ?? 0
  }
}

/**
 * The event hub.
 */
export class EventHub {
  /**
   * @param {object} options hub options.
   * @param {string} options.instanceId this run's id.
   * @param {object} options.limits validated limits.
   * @param {object} options.replay validated replay budgets.
   * @param {object} options.log logger.
   */
  constructor({ instanceId, limits, replay, log }) {
    this.instanceId = instanceId
    this.limits = limits
    this.replayConfig = replay
    this.log = log
    /** Next sequence number to hand out. */
    this.seq = 0
    /** @type {Array<{seq: number, cursor: string, sessionId: string, type: string, data: object, requestId?: string, bytes: number, at: number}>} */
    this.buffer = []
    this.bufferBytes = 0
    /** @type {Subscriber|null} the single live SSE stream. */
    this.subscriber = null
    /** @type {Set<Subscriber>} every stream the hub has handed out (for shutdown). */
    this.streams = new Set()
    this.closed = false
    /** Mirror of the hub's slowest point, for diagnostics only. */
    this.droppedFrames = 0
  }

  /**
   * @returns {string} the cursor that covers every event published so far.
   */
  cursorNow() {
    return formatCursor(this.instanceId, this.seq)
  }

  /**
   * Publish one bridge event: assign the cursor, keep it in the bounded replay
   * window, and push it to the live stream when that stream follows the session.
   * @param {object} input event fields.
   * @returns {string|null} the assigned cursor, or null when the event was refused.
   */
  publish(input) {
    if (this.closed) return null
    const { sessionId, type, data, requestId } = input
    const seq = this.seq + 1
    const cursor = formatCursor(this.instanceId, seq)
    const envelope = {
      protocol: 'pet-dsh/1',
      instanceId: this.instanceId,
      sessionId,
      cursor,
      type,
      data,
    }
    if (requestId !== undefined) envelope.requestId = requestId
    const json = JSON.stringify(envelope)
    const bytes = utf8Length(json) + cursor.length + 32
    if (bytes > this.limits.eventBytes) {
      this.log.warn(`事件 ${type} 超过 ${this.limits.eventBytes} 字节预算，已丢弃`)
      return null
    }
    // The sequence number is consumed even when nobody is listening: a snapshot
    // watermark captured after this point must never replay it as new.
    this.seq = seq
    const record = { seq, cursor, sessionId, type, data, requestId, bytes, at: Date.now(), json }
    this.#remember(record)
    const subscriber = this.subscriber
    if (subscriber !== null && !subscriber.closed && subscriber.sessionId === sessionId) {
      this.#send(subscriber, record)
    }
    return cursor
  }

  /**
   * @param {object} record buffered event record.
   */
  #remember(record) {
    this.buffer.push(record)
    this.bufferBytes += record.bytes
    const now = record.at
    while (
      this.buffer.length > 1
      && (this.buffer.length > this.replayConfig.maxEvents
        || this.bufferBytes > this.replayConfig.maxBytes
        || now - this.buffer[0].at > this.replayConfig.windowMs)
    ) {
      const dropped = this.buffer.shift()
      this.bufferBytes -= dropped.bytes
    }
  }

  /**
   * Write one event to one subscriber, enforcing the outbound queue bound.
   * @param {Subscriber} subscriber target stream.
   * @param {object} record event record.
   */
  #send(subscriber, record) {
    if (subscriber.queuedBytes() > Math.max(this.limits.eventBytes, 262144)) {
      // The client stopped draining. Do not let its backlog grow: end the stream
      // and make it re-read a snapshot instead of pretending it kept up.
      this.droppedFrames += 1
      this.log.warn('SSE 客户端缓冲超限，关闭该流并要求重新同步')
      this.#terminateWithResync(subscriber, 'slow-client')
      return
    }
    const frame = `id: ${record.cursor}\nevent: bridge\ndata: ${record.json}\n\n`
    subscriber.write(frame)
  }

  /**
   * Send a `resync.required` event and close the stream.
   * @param {Subscriber} subscriber target stream.
   * @param {string} reason short machine-readable reason.
   */
  #terminateWithResync(subscriber, reason) {
    if (subscriber.closed) return
    const seq = this.seq + 1
    this.seq = seq
    const cursor = formatCursor(this.instanceId, seq)
    const envelope = {
      protocol: 'pet-dsh/1',
      instanceId: this.instanceId,
      sessionId: subscriber.sessionId,
      cursor,
      type: 'resync.required',
      data: { reason },
    }
    const frame = `id: ${cursor}\nevent: bridge\ndata: ${JSON.stringify(envelope)}\n\n`
    subscriber.write(frame)
    if (this.subscriber === subscriber) this.subscriber = null
    // Give the frame a moment to flush, then close.
    const stream = subscriber
    setTimeout(() => stream.end(), CLOSE_GRACE_MS).unref?.()
  }

  /**
   * Attach the (single) live stream for one client and session.
   *
   * Replay happens before the stream becomes live, and the subscriber is
   * installed synchronously in the same tick, so no event can slip between
   * replay and live delivery (protocol §12).
   * @param {object} options stream options.
   * @param {string} options.clientId authenticated client id.
   * @param {string} options.sessionId wire session id.
   * @param {string|undefined} options.lastEventId `Last-Event-ID` header value.
   * @param {import('node:http').ServerResponse} options.res SSE response.
   * @returns {{ok: boolean, replaced: boolean, subscriber: Subscriber|undefined}} attachment result.
   */
  attach({ clientId, sessionId, lastEventId, res }) {
    if (this.closed) return { ok: false, replaced: false, subscriber: undefined }
    const log = this.log
    const previous = this.subscriber
    if (previous !== null) {
      // The pet host allows one SSE per plugin. A new attach supersedes the old
      // stream instead of opening a second one.
      previous.write(': superseded\n\n')
      previous.end()
      this.subscriber = null
      this.streams.delete(previous)
    }
    const subscriber = new Subscriber({ clientId, sessionId, res, log })
    this.subscriber = subscriber
    this.streams.add(subscriber)

    let replayFrom = null
    if (lastEventId !== undefined && lastEventId !== '') {
      const parsed = parseCursor(lastEventId, this.instanceId)
      if (parsed === undefined || parsed > this.seq) {
        // Foreign instance, malformed cursor, or a cursor from the future: the
        // client must re-read info/snapshot rather than receive a guessed slice.
        this.#terminateWithResync(subscriber, 'cursor-invalid')
        return { ok: true, replaced: previous !== null, subscriber }
      }
      const oldest = this.buffer.length > 0 ? this.buffer[0].seq : this.seq + 1
      if (this.buffer.length > 0 && parsed + 1 < oldest) {
        this.#terminateWithResync(subscriber, 'cursor-expired')
        return { ok: true, replaced: previous !== null, subscriber }
      }
      replayFrom = parsed
    }

    if (replayFrom !== null) {
      for (const record of this.buffer) {
        if (record.seq <= replayFrom) continue
        if (record.sessionId !== sessionId) continue
        this.#send(subscriber, record)
      }
    }

    subscriber.heartbeat = setInterval(() => {
      if (subscriber.closed) return
      // A comment line refreshes the pet host's 45 s idle timer and never
      // advances the cursor.
      if (!subscriber.write(': ping\n\n')) return
      if (subscriber.queuedBytes() > Math.max(this.limits.eventBytes, 262144)) {
        this.#terminateWithResync(subscriber, 'slow-client')
      }
    }, this.limits.heartbeatMs)
    subscriber.heartbeat.unref?.()

    // Prove the stream is live immediately, without consuming a business cursor.
    subscriber.write(': connected\n\n')
    return { ok: true, replaced: previous !== null, subscriber }
  }

  /**
   * Detach a specific stream (client disconnected).
   * @param {Subscriber} subscriber the stream to forget.
   */
  detach(subscriber) {
    this.streams.delete(subscriber)
    if (this.subscriber === subscriber) this.subscriber = null
    subscriber.end()
  }

  /**
   * Close every stream belonging to one client (token revoked, client disabled).
   * Already-committed DSH work is not cancelled.
   * @param {string} clientId client identity.
   * @returns {number} how many streams were closed.
   */
  dropClient(clientId) {
    let closed = 0
    for (const subscriber of [...this.streams]) {
      if (subscriber.clientId !== clientId) continue
      subscriber.write(': revoked\n\n')
      this.detach(subscriber)
      closed += 1
    }
    return closed
  }

  /** Close every stream (plugin unload). */
  close() {
    this.closed = true
    for (const subscriber of [...this.streams]) {
      subscriber.end()
    }
    this.streams.clear()
    this.subscriber = null
    this.buffer = []
    this.bufferBytes = 0
  }
}
