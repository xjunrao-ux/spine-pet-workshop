// A harness-compatible in-process fake used by the default test suite.
//
// It mirrors the *verified* DSH 0.1.1-rc.2 semantics this plugin depends on
// (COMPATIBILITY.md): a committed, append-only session log; `session/event`
// fired after the commit; `agent/inbox/claimed` at the claim boundary;
// `agent/status` transitions; `agent.followup`/`steer`/`cancel`; and
// `turn/start` … `assistant/chunk` … `assistant/message` … `turn/end`.
//
// It is NOT the real harness. Tests built on it prove the bridge's own
// behaviour; test/real-dsh.test.js proves the adapter against the real thing.

import { randomUUID } from 'node:crypto'

/**
 * @param {object} [options] harness options.
 * @param {number} [options.deltaChunks] how many text chunks one reply streams in.
 * @param {string} [options.reply] assistant reply text.
 * @returns {object} the fake context plus test drivers.
 */
export function createFakeHarness(options = {}) {
  const deltaChunks = options.deltaChunks ?? 3
  const replyText = options.reply ?? '项目包含单元测试和界面验证。'

  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map()
  /** @type {Map<string, object>} */
  const sessions = new Map()
  /** @type {Map<string, object>} */
  const agents = new Map()
  const disposers = []

  const loggerFor = () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  })
  const loggerService = Object.assign(
    () => loggerFor(),
    loggerFor(),
  )

  const emit = (name, ...args) => {
    const set = listeners.get(name)
    if (set === undefined) return
    for (const listener of [...set]) {
      try {
        listener(...args)
      } catch (error) {
        // Cordis contains listener failures; mirror that so one bad listener
        // cannot mask the plugin's own behaviour in tests.
        loggerService.error(`listener failed: ${error.message}`)
      }
    }
  }

  /**
   * Create one fake session with a contiguous event log.
   * @param {string} id session id.
   * @param {{cwd?: string}} [meta] creation metadata.
   * @returns {object} the session.
   */
  const createSession = (id, meta = {}) => {
    const session = {
      id,
      header: { version: 0, id, createdAt: Date.now(), cwd: meta.cwd },
      events: [],
      /** @type {{title: string}|null} */
      titleSnapshot: null,
      append(type, data) {
        const event = { type, seq: this.events.length, time: Date.now(), data }
        this.events.push(event)
        emit('session/event', this, event)
        return event
      },
    }
    sessions.set(id, session)
    return session
  }

  /**
   * Create one fake agent bound to a session.
   * @param {string} sessionId session id.
   * @returns {object} the agent.
   */
  const createAgent = (sessionId) => {
    const session = sessions.get(sessionId)
    if (session === undefined) throw new Error(`unknown session ${sessionId}`)
    let turnCounter = 0
    let currentTurn = null
    let cancelRequested = false
    let pendingTimer = null
    let gateAfterTurn = false

    /** @param {object} message inbox message */
    const wake = () => {
      if (agent.status === 'running') return
      agent.status = 'running'
      emit('agent/status', { agent, status: 'running' })
      pendingTimer = setImmediate(() => {
        pendingTimer = null
        runTurn()
      })
      pendingTimer.unref?.()
    }

    const runTurn = async () => {
      const message = agent.inbox.nextTurn.shift()
      if (message === undefined) {
        agent.status = 'idle'
        emit('agent/status', { agent, status: 'idle' })
        return
      }
      turnCounter += 1
      currentTurn = turnCounter
      const turn = turnCounter
      cancelRequested = false
      session.append('turn/start', { turn })
      emit('agent/inbox/claimed', { agent, message, turn })
      session.append('user/message', { ...message })
      session.append('step/start', { turn, step: 1 })
      // Yield so the HTTP receipt for the followup is written before the turn
      // produces output, matching the real loop's async scheduling.
      await delay(5)
      const chunks = splitText(replyText, deltaChunks)
      for (const text of chunks) {
        if (cancelRequested) break
        session.append('assistant/chunk', {
          turn,
          step: 1,
          chunk: { type: 'text-delta', index: 0, text },
        })
        // A real provider streams over time; the gap makes the cancellation
        // window observable and keeps the bridge's delta coalescer honest.
        await delay(15)
      }
      if (cancelRequested) {
        session.append('turn/end', { turn, reason: { kind: 'aborted', reason: { kind: 'user' } } })
      } else {
        session.append('assistant/message', {
          turn,
          step: 1,
          message: {
            id: randomUUID(),
            role: 'assistant',
            content: [{ type: 'text', text: replyText }],
            source: { kind: 'model', provider: 'fake', model: 'fake-model' },
          },
        })
        session.append('step/end', { turn, step: 1 })
        session.append('turn/end', { turn, reason: { kind: 'completed' } })
      }
      currentTurn = null
      // With the gate on, the agent stays "running" so tests can observe the
      // busy state deterministically; `release()` closes the turn out.
      if (gateAfterTurn) return
      agent.status = 'idle'
      emit('agent/status', { agent, status: 'idle' })
      if (agent.inbox.nextTurn.length > 0) wake()
    }

    const agent = {
      id: sessionId,
      session,
      options: { provider: 'fake', model: 'fake-model' },
      status: 'idle',
      inbox: { nextTurn: [], nextStep: [] },
      /** Test hook: keep the agent `running` after its turn finishes. */
      gate(gated = true) {
        gateAfterTurn = gated
      },
      /** Test hook: leave the gated `running` state. */
      release() {
        gateAfterTurn = false
        agent.status = 'idle'
        emit('agent/status', { agent, status: 'idle' })
        if (agent.inbox.nextTurn.length > 0) wake()
      },
      followup(message) {
        agent.inbox.nextTurn.push(message)
        wake()
      },
      steer(message) {
        agent.inbox.nextStep.push(message)
        wake()
      },
      inject() {},
      cancel(cause, cancelOptions = {}) {
        cancelRequested = true
        if (cancelOptions.keepInbox !== true) {
          const discarded = [...agent.inbox.nextTurn, ...agent.inbox.nextStep]
          agent.inbox.nextTurn.length = 0
          agent.inbox.nextStep.length = 0
          for (const message of discarded) emit('agent/inbox/discarded', { agent, message })
        }
        if (currentTurn === null) {
          // Nothing running: cancellation is a no-op and does not arm later work.
          cancelRequested = false
        }
      },
      whenIdle() {
        return new Promise((resolve) => {
          const check = () => {
            if (agent.status === 'idle') resolve()
            else setTimeout(check, 1).unref?.()
          }
          check()
        })
      },
      async runMaintenance(task) {
        return task(new AbortController().signal)
      },
    }
    agents.set(sessionId, agent)
    return agent
  }

  const ctx = {
    logger: loggerService,
    on(eventName, handler) {
      let set = listeners.get(eventName)
      if (set === undefined) {
        set = new Set()
        listeners.set(eventName, set)
      }
      set.add(handler)
    },
    effect(execute) {
      const result = execute()
      const disposer = typeof result === 'function' ? result : () => {}
      disposers.push(disposer)
      return async () => {
        await disposer()
      }
    },
    get(serviceName) {
      if (serviceName === 'sessionTitle') {
        return {
          get: (session) => session.titleSnapshot ?? undefined,
        }
      }
      return undefined
    },
    agents: {
      get: (id) => agents.get(id),
      list: () => [...agents.values()],
      roots: () => [...agents.values()],
    },
    sessions: {
      get: (id) => sessions.get(id),
      list: () => [...sessions.values()],
    },
  }

  return {
    ctx,
    sessions,
    agents,
    createSession,
    createAgent,
    emit,
    /**
     * Run every registered effect disposer (plugin teardown).
     * @returns {Promise<void>} resolves when teardown finished.
     */
    async dispose() {
      for (const disposer of [...disposers].reverse()) await disposer()
      disposers.length = 0
    },
    /**
     * Simulate another front end (the DSH GUI) sending a prompt.
     * @param {object} agent fake agent.
     * @param {string} text prompt text.
     * @param {string} [messageId] message identity.
     */
    guiSend(agent, text, messageId = randomUUID()) {
      agent.followup({
        id: messageId,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      })
    },
  }
}

/**
 * Split text into `count` roughly equal pieces (each 1+ characters).
 * @param {string} text source text.
 * @param {number} count desired pieces.
 * @returns {string[]} pieces.
 */
function splitText(text, count) {
  if (count <= 1) return [text]
  const chars = [...text]
  const size = Math.max(1, Math.ceil(chars.length / count))
  const out = []
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(''))
  return out
}

/**
 * @param {number} ms delay.
 * @returns {Promise<void>} resolves after the delay.
 */
function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}
