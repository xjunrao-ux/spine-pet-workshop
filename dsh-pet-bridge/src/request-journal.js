// Persistent request ledger: idempotency keys, state machine, crash recovery.
//
// Storage choice: a serial append-only JSONL journal plus an atomically replaced
// snapshot. Node has no portable built-in database, and the protocol only needs
// "record one intent durably, then advance its state" per client+requestId, so a
// single-writer append log with `fsync` is exactly the required primitive and
// adds no dependency to a plugin that must load inside the user's DSH process.
//
// Durability contract (protocol §10):
//   - `begin()` returns only after the intent record is on disk (fsync when
//     `journal.fsync` is enabled). Nothing is handed to DSH before that.
//   - every later transition is also appended before the HTTP response that
//     reports it, so an accepted receipt survives a crash right after the 202.
//   - a torn tail line (process killed mid-write) is truncated back to the last
//     complete record; corruption in the *middle* of the file is never repaired
//     in place: the journal is marked read-only and refuses new operations, so a
//     damaged ledger cannot silently re-execute work.

import { closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Journal record format version. */
const RECORD_VERSION = 1

/** Terminal states — the only ones an operator may have swept away. */
const TERMINAL = new Set(['ended', 'rejected'])

/**
 * Map one internal entry to the wire `status` vocabulary (protocol §6):
 * received / accepted / running / ended / rejected / unknown.
 * @param {object} entry internal entry.
 * @returns {string} wire status.
 */
export function wireStatusOf(entry) {
  return entry.status
}

/**
 * @param {string} clientId client identity.
 * @param {string} requestId client request identity.
 * @returns {string} map key.
 */
function keyOf(clientId, requestId) {
  return `${clientId}\u0000${requestId}`
}

/**
 * The request ledger.
 */
export class RequestJournal {
  /**
   * @param {object} options journal options.
   * @param {string} options.dir absolute directory owned by this plugin.
   * @param {number} options.retentionHours minimum retention for terminal records.
   * @param {number} options.compactBytes append-log size that triggers a snapshot.
   * @param {boolean} options.fsync whether to fsync every record.
   * @param {object} options.log Cordis logger.
   */
  constructor({ dir, retentionHours, compactBytes, fsync, log }) {
    this.dir = dir
    this.logPath = join(dir, 'requests.jsonl')
    this.snapshotPath = join(dir, 'requests.snapshot.json')
    this.retentionMs = retentionHours * 3600 * 1000
    this.compactBytes = compactBytes
    this.fsyncEnabled = fsync
    this.log = log
    /** @type {Map<string, object>} */
    this.entries = new Map()
    this.sequence = 0
    this.fd = -1
    /** Set when the ledger proved corrupt; every write then refuses. */
    this.readOnlyReason = null
    this.closed = false
  }

  /**
   * Open the journal: replay snapshot, then the append log, repairing only a
   * torn tail.
   * @param {object} options see the constructor.
   * @returns {RequestJournal} the opened journal.
   */
  static open(options) {
    const journal = new RequestJournal(options)
    journal.#load()
    return journal
  }

  /** Replay persisted state into memory and prepare the append handle. */
  #load() {
    mkdirSync(this.dir, { recursive: true })
    let lastSeq = 0
    if (existsSync(this.snapshotPath)) {
      const snapshot = JSON.parse(readFileSync(this.snapshotPath, 'utf8'))
      if (snapshot?.format !== 'dsh-pet-bridge-journal/1') {
        throw new Error(`dsh-pet-bridge: 未知的台账快照格式 ${JSON.stringify(snapshot?.format)}`)
      }
      if (!Array.isArray(snapshot.entries)) throw new Error('dsh-pet-bridge: 台账快照缺少 entries 数组')
      for (const entry of snapshot.entries) this.entries.set(keyOf(entry.clientId, entry.requestId), entry)
      lastSeq = Number.isSafeInteger(snapshot.lastSeq) ? snapshot.lastSeq : 0
    }
    this.sequence = lastSeq

    if (!existsSync(this.logPath)) {
      writeFileSync(this.logPath, '')
      this.fd = openSync(this.logPath, 'a')
      return
    }

    const raw = readFileSync(this.logPath, 'utf8')
    let offset = 0
    /** Byte offset just past the last record that replayed completely. */
    let complete = 0
    /** Byte offset where replay stopped because a record was unusable. */
    let brokenAt = -1
    while (offset < raw.length) {
      const newline = raw.indexOf('\n', offset)
      if (newline === -1) {
        // No terminator: the process died inside this write. It was never
        // acknowledged, so dropping it cannot lose an acknowledged state change.
        brokenAt = offset
        break
      }
      const line = raw.slice(offset, newline)
      let record
      let usable = line.trim() !== ''
      if (usable) {
        try {
          record = JSON.parse(line)
        } catch {
          usable = false
        }
        if (usable && record?.format !== 'dsh-pet-bridge-journal/1') usable = false
      }
      if (!usable) {
        brokenAt = offset
        break
      }
      offset = newline + 1
      if (record !== undefined && !(Number.isSafeInteger(record.n) && record.n <= this.sequence)) {
        this.#applyRecord(record)
      }
      complete = offset
    }

    if (brokenAt !== -1) {
      const remainder = raw.slice(brokenAt)
      const firstNewline = remainder.indexOf('\n')
      const tailIsOnlyWhitespace = firstNewline === -1 || remainder.slice(firstNewline + 1).trim() === ''
      if (tailIsOnlyWhitespace) {
        // Only the final, unterminated write is lost. It was never acknowledged,
        // so dropping it cannot lose an acknowledged state change.
        this.log?.warn?.(`dsh-pet-bridge: 截断未写完的台账尾记录（字节 ${brokenAt}）`)
        const handle = openSync(this.logPath, 'r+')
        try {
          ftruncateSync(handle, brokenAt)
          fsyncSync(handle)
        } finally {
          closeSync(handle)
        }
      } else {
        // A malformed record with further records after it is corruption in the
        // middle of the ledger. Keep the file intact and stop writing.
        this.readOnlyReason = `requests.jsonl 在字节 ${brokenAt} 之后仍有记录，中间记录损坏`
        this.log?.error?.(`dsh-pet-bridge: ${this.readOnlyReason}；台账转为只读，拒绝新的提交`)
      }
    }
    this.fd = openSync(this.logPath, 'a')
    this.#sweepExpiredInMemory()
  }

  /**
   * Apply one persisted record to the in-memory table.
   * @param {object} record journal record.
   */
  #applyRecord(record) {
    const key = keyOf(record.clientId, record.requestId)
    const entry = this.entries.get(key) ?? {
      clientId: record.clientId,
      requestId: record.requestId,
      payloadHash: record.payloadHash,
      op: record.op,
      sessionId: record.sessionId,
      messageId: record.messageId ?? null,
      activityId: null,
      turn: null,
      acceptedInstanceId: null,
      status: 'received',
      outcome: null,
      errorCode: null,
      errorMessage: null,
      receivedAt: record.t ?? Date.now(),
      updatedAt: record.t ?? Date.now(),
      endedAt: null,
      attempts: 0,
    }
    if (record.kind === 'received') {
      entry.payloadHash = record.payloadHash ?? entry.payloadHash
      entry.op = record.op ?? entry.op
      entry.sessionId = record.sessionId ?? entry.sessionId
      entry.messageId = record.messageId ?? entry.messageId
      entry.status = 'received'
    } else if (record.kind === 'accepted') {
      // The acceptance record can arrive AFTER the loop already claimed the
      // message (the claim event fires synchronously inside `followup`), so this
      // must never walk a `running` entry backwards.
      if (entry.status === 'received' || entry.status === 'accepted') entry.status = 'accepted'
      entry.activityId = record.activityId ?? entry.activityId
      entry.turn = record.turn ?? entry.turn
      entry.acceptedInstanceId = record.instanceId ?? entry.acceptedInstanceId
    } else if (record.kind === 'running') {
      if (entry.status !== 'ended' && entry.status !== 'rejected') entry.status = 'running'
      entry.activityId = record.activityId ?? entry.activityId
      entry.turn = record.turn ?? entry.turn
    } else if (record.kind === 'ended') {
      entry.status = 'ended'
      entry.outcome = record.outcome ?? 'interrupted'
      entry.activityId = record.activityId ?? entry.activityId
      entry.endedAt = record.t ?? Date.now()
    } else if (record.kind === 'rejected') {
      entry.status = 'rejected'
      entry.errorCode = record.errorCode ?? 'INVALID_REQUEST'
      entry.errorMessage = record.errorMessage ?? null
      entry.endedAt = record.t ?? Date.now()
    } else if (record.kind === 'unknown') {
      if (!TERMINAL.has(entry.status)) entry.status = 'unknown'
      entry.errorCode = record.errorCode ?? 'RESULT_UNKNOWN'
      entry.errorMessage = record.errorMessage ?? null
    } else if (record.kind === 'attempt') {
      entry.attempts = (entry.attempts ?? 0) + 1
    } else {
      this.readOnlyReason = `未知的台账记录类型 ${String(record.kind)}`
      return
    }
    if (Number.isSafeInteger(record.n)) this.sequence = Math.max(this.sequence, record.n)
    entry.updatedAt = record.t ?? Date.now()
    this.entries.set(key, entry)
  }

  /**
   * Append one record. Returns only after the write (and optional fsync).
   * @param {object} record partial record; `format`/`n`/`t` are filled here.
   * @throws {Error} when the ledger is read-only or the write fails (e.g. ENOSPC).
   */
  #append(record) {
    if (this.closed) throw new Error('dsh-pet-bridge: 台账已关闭')
    if (this.readOnlyReason !== null) {
      throw new Error(`dsh-pet-bridge: 台账只读（${this.readOnlyReason}），拒绝新的副作用`)
    }
    this.sequence += 1
    const full = { format: 'dsh-pet-bridge-journal/1', n: this.sequence, t: Date.now(), ...record }
    const line = `${JSON.stringify(full)}\n`
    writeSync(this.fd, line, null, 'utf8')
    if (this.fsyncEnabled) fsyncSync(this.fd)
    this.#applyRecord(full)
    if (this.#logSize() > this.compactBytes) this.#compact()
  }

  /** @returns {number} current append-log size in bytes. */
  #logSize() {
    try {
      return statSync(this.logPath).size
    } catch {
      return 0
    }
  }

  /** Atomically replace the snapshot, then drop the replayed log. */
  #compact() {
    const payload = {
      format: 'dsh-pet-bridge-journal/1',
      lastSeq: this.sequence,
      writtenAt: new Date().toISOString(),
      entries: [...this.entries.values()],
    }
    const temp = `${this.snapshotPath}.tmp`
    const handle = openSync(temp, 'w')
    try {
      writeSync(handle, JSON.stringify(payload))
      if (this.fsyncEnabled) fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
    renameSync(temp, this.snapshotPath)
    try {
      closeSync(this.fd)
    } catch {
      /* already closed */
    }
    this.fd = openSync(this.logPath, 'w')
    if (this.fsyncEnabled) fsyncSync(this.fd)
    this.fd = openSync(this.logPath, 'a')
  }

  /**
   * Record the intent for a new operation. Must be called before the message is
   * handed to DSH.
   * @param {object} input intent.
   * @returns {object} the created entry (live reference; do not mutate).
   */
  begin(input) {
    const key = keyOf(input.clientId, input.requestId)
    if (this.entries.has(key)) throw new Error('dsh-pet-bridge: 内部错误：requestId 已存在')
    this.#append({
      kind: 'received',
      clientId: input.clientId,
      requestId: input.requestId,
      payloadHash: input.payloadHash,
      op: input.op,
      sessionId: input.sessionId,
      messageId: input.messageId,
    })
    return this.entries.get(key)
  }

  /**
   * @param {object} entry ledger entry.
   * @param {{activityId?: string|null, turn?: number|null, instanceId: string}} facts acceptance facts.
   */
  markAccepted(entry, { activityId = null, turn = null, instanceId }) {
    this.#append({
      kind: 'accepted',
      clientId: entry.clientId,
      requestId: entry.requestId,
      activityId,
      turn,
      instanceId,
    })
  }

  /**
   * @param {object} entry ledger entry.
   * @param {{activityId?: string|null, turn?: number|null}} facts observed activity.
   */
  markRunning(entry, { activityId = null, turn = null } = {}) {
    if (entry.status === 'running' || entry.status === 'ended' || entry.status === 'rejected') return
    this.#append({ kind: 'running', clientId: entry.clientId, requestId: entry.requestId, activityId, turn })
  }

  /**
   * @param {object} entry ledger entry.
   * @param {string} outcome completed|failed|cancelled|interrupted.
   * @param {{activityId?: string|null}} [facts] observed activity.
   */
  markEnded(entry, outcome, { activityId = null } = {}) {
    if (entry.status === 'ended') return
    this.#append({ kind: 'ended', clientId: entry.clientId, requestId: entry.requestId, activityId, outcome })
  }

  /**
   * @param {object} entry ledger entry.
   * @param {string} errorCode protocol error code.
   * @param {string} [errorMessage] short operator-safe message.
   */
  markRejected(entry, errorCode, errorMessage) {
    if (entry.status === 'ended' || entry.status === 'rejected') return
    this.#append({ kind: 'rejected', clientId: entry.clientId, requestId: entry.requestId, errorCode, errorMessage })
  }

  /**
   * Mark an executed-but-unprovable operation: the honest crash-recovery answer.
   * @param {object} entry ledger entry.
   * @param {string} errorCode RESULT_UNKNOWN by default.
   * @param {string} [errorMessage] why the outcome cannot be proven.
   */
  markUnknown(entry, errorCode = 'RESULT_UNKNOWN', errorMessage) {
    if (TERMINAL.has(entry.status)) return
    this.#append({ kind: 'unknown', clientId: entry.clientId, requestId: entry.requestId, errorCode, errorMessage })
  }

  /**
   * @param {string} clientId client identity.
   * @param {string} requestId request identity.
   * @returns {object|undefined} the entry, if any.
   */
  lookup(clientId, requestId) {
    return this.entries.get(keyOf(clientId, requestId))
  }

  /**
   * Every entry whose outcome is still open — the crash-recovery work list.
   * A record already resolved to `unknown` is deliberately excluded: that answer
   * was the verdict, and re-deriving it every start would be a second opinion.
   * @returns {object[]} non-terminal, non-unknown entries.
   */
  pendingRecovery() {
    const result = []
    for (const entry of this.entries.values()) {
      if (TERMINAL.has(entry.status) || entry.status === 'unknown') continue
      result.push(entry)
    }
    return result
  }

  /** Drop terminal entries older than the retention window. */
  sweep() {
    const removed = this.#sweepExpiredInMemory()
    if (removed > 0) this.#compact()
    return removed
  }

  /** @returns {number} how many terminal entries were dropped. */
  #sweepExpiredInMemory() {
    const cutoff = Date.now() - this.retentionMs
    let removed = 0
    for (const [key, entry] of this.entries) {
      if (!TERMINAL.has(entry.status)) continue
      if ((entry.endedAt ?? entry.updatedAt) > cutoff) continue
      this.entries.delete(key)
      removed += 1
    }
    return removed
  }

  /**
   * Flush and close. Terminal states are already durable; this only releases the
   * file handle.
   */
  close() {
    if (this.closed) return
    this.closed = true
    if (this.fd !== -1) {
      try {
        if (this.fsyncEnabled) fsyncSync(this.fd)
      } catch {
        /* the handle may already be invalid */
      }
      try {
        closeSync(this.fd)
      } catch {
        /* ignore */
      }
      this.fd = -1
    }
  }

  /**
   * Write the current table as a snapshot without touching the log. Used on a
   * clean shutdown so the next start replays far less.
   */
  checkpoint() {
    if (this.closed) return
    try {
      this.#compact()
    } catch (error) {
      this.log?.warn?.(`dsh-pet-bridge: 台账 checkpoint 失败：${error.message}`)
    }
  }
}

/**
 * Build the directory a bridge instance owns under the Harness home.
 * @param {string} dataDir configured data directory.
 * @param {string} instanceId this run's id (only used in log messages).
 * @returns {string} the journal directory.
 */
export function journalDir(dataDir) {
  return join(dataDir, 'journal')
}

/**
 * @param {string} file absolute path.
 * @returns {string} its directory.
 */
export function parentDir(file) {
  return dirname(file)
}
