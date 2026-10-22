// Pure wire-contract units: identifiers, canonical hashing, budgets, envelopes.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BridgeError,
  LIMITS,
  PROTOCOL,
  canonicalJson,
  charLength,
  clampText,
  errorEnvelope,
  formatCursor,
  isIdentifier,
  okEnvelope,
  parseCommandEnvelope,
  parseCursor,
  parseMessageSend,
  parseSessionCancel,
  payloadHashOf,
  serializeBounded,
  sha256Hex,
  textOfContent,
  utf8Length,
} from '../src/wire.js'

test('标识符文法与 schema 一致', () => {
  for (const good of ['a', 'session-1', 'act.3f2a1c09.12', 'A_b-c.1', 'x'.repeat(100)]) {
    assert.equal(isIdentifier(good), true, good)
  }
  for (const bad of ['', 'x'.repeat(101), 'a b', 'a/b', '中文', 'a\nb', null, 1, undefined]) {
    assert.equal(isIdentifier(bad), false, String(bad))
  }
})

test('cursor 与实例绑定并拒绝跨实例游标', () => {
  assert.equal(formatCursor('instance-a', 7), 'instance-a.7')
  assert.equal(parseCursor('instance-a.7', 'instance-a'), 7)
  assert.equal(parseCursor('instance-b.7', 'instance-a'), undefined)
  assert.equal(parseCursor('instance-a.x', 'instance-a'), undefined)
  assert.equal(parseCursor('instance-a.', 'instance-a'), undefined)
  assert.equal(parseCursor(undefined, 'instance-a'), undefined)
  assert.equal(parseCursor('instance-a.99999999999999999999', 'instance-a'), undefined)
})

test('canonicalJson 归一化键序，哈希跨重启稳定', () => {
  const a = { op: 'message.send', sessionId: 's', data: { text: '你好', mode: 'followup' } }
  const b = { data: { mode: 'followup', text: '你好' }, sessionId: 's', op: 'message.send' }
  assert.equal(canonicalJson(a), canonicalJson(b))
  assert.equal(payloadHashOf(a), payloadHashOf(b))
  assert.notEqual(payloadHashOf(a), payloadHashOf({ ...a, data: { ...a.data, text: '你好！' } }))
  // Key order must not survive as a difference, but values must.
  assert.equal(sha256Hex('abc').length, 64)
})

test('字符与字节预算分别计算', () => {
  assert.equal(charLength('abc'), 3)
  assert.equal(charLength('桌宠'), 2)
  assert.equal(charLength('👩‍💻'), 3, 'ZWJ 序列按码点数计')
  assert.equal(utf8Length('桌宠'), 6)
  assert.equal(utf8Length('a'), 1)
})

test('clampText 只在裁剪时追加省略号', () => {
  assert.equal(clampText('abc', 5), 'abc')
  const cut = clampText('abcdefgh', 4)
  assert.equal(charLength(cut), 4)
  assert.ok(cut.endsWith('…'))
})

test('textOfContent 只取 text 块，丢弃推理与工具块', () => {
  const content = [
    { type: 'text', text: '可见' },
    { type: 'reasoning', text: '私密推理' },
    { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"cmd":"dir"}' },
    { type: 'text', text: '内容' },
  ]
  assert.equal(textOfContent(content), '可见内容')
  assert.equal(textOfContent(undefined), '')
})

test('命令信封逐字段校验', () => {
  const instanceId = 'instance-a'
  const good = {
    protocol: PROTOCOL,
    instanceId,
    requestId: 'req-1',
    op: 'message.send',
    sessionId: 'session-a',
    data: { mode: 'followup', text: 'x' },
  }
  assert.deepEqual(parseCommandEnvelope(good, instanceId), {
    requestId: 'req-1',
    op: 'message.send',
    sessionId: 'session-a',
    data: { mode: 'followup', text: 'x' },
  })

  const cases = [
    [{ ...good, protocol: 'pet-dsh/2' }, 'VERSION_MISMATCH'],
    [{ ...good, instanceId: 'instance-b' }, 'INSTANCE_CHANGED'],
    [{ ...good, requestId: 'bad id' }, 'INVALID_REQUEST'],
    [{ ...good, sessionId: '' }, 'INVALID_REQUEST'],
    [{ ...good, extra: 1 }, 'INVALID_REQUEST'],
    [{ ...good, data: [] }, 'INVALID_REQUEST'],
    [null, 'INVALID_REQUEST'],
    ['text', 'INVALID_REQUEST'],
  ]
  for (const [body, code] of cases) {
    assert.throws(() => parseCommandEnvelope(body, instanceId), (error) => {
      assert.ok(error instanceof BridgeError)
      assert.equal(error.code, code)
      return true
    })
  }
})

test('message.send 校验文本与模式，拒绝陌生字段', () => {
  assert.deepEqual(parseMessageSend({ mode: 'followup', text: '  hi  ' }, { steer: false }), {
    mode: 'followup',
    text: '  hi  ',
  })
  assert.throws(() => parseMessageSend({ mode: 'followup', text: '   ' }, { steer: false }), /text 不能为空/)
  assert.throws(() => parseMessageSend({ mode: 'followup', text: 'x'.repeat(4001) }, { steer: false }), /4000/)
  assert.throws(() => parseMessageSend({ mode: 'steer', text: 'x' }, { steer: false }), (error) => error.code === 'UNSUPPORTED_CAPABILITY')
  assert.throws(() => parseMessageSend({ mode: 'append', text: 'x' }, { steer: true }), /mode/)
  // A URL or shell field is not part of the operation: refuse rather than ignore.
  assert.throws(() => parseMessageSend({ mode: 'followup', text: 'x', url: 'http://evil' }, { steer: true }), /不支持字段/)
  assert.throws(() => parseMessageSend({ mode: 'followup', text: 'x', shell: 'calc' }, { steer: true }), /不支持字段/)
  assert.throws(() => parseMessageSend({ mode: 'followup', text: 42 }, { steer: true }), /字符串/)
})

test('session.cancel 只接受 activityId', () => {
  assert.deepEqual(parseSessionCancel({ activityId: 'act.abcd1234.3' }), { activityId: 'act.abcd1234.3' })
  assert.throws(() => parseSessionCancel({ activityId: 'act 1' }), /activityId/)
  assert.throws(() => parseSessionCancel({ activityId: 'act.1.2', force: true }), /不支持字段/)
})

test('成功/失败信封形状符合 schema', () => {
  assert.deepEqual(okEnvelope('instance-a', 'req-1', { status: 'accepted' }), {
    protocol: PROTOCOL,
    instanceId: 'instance-a',
    ok: true,
    data: { status: 'accepted' },
    requestId: 'req-1',
  })
  const failure = errorEnvelope(new BridgeError('SESSION_BUSY', '忙'), { instanceId: 'instance-a', requestId: 'req-1' })
  assert.equal(failure.ok, false)
  assert.equal(failure.data, undefined, '失败响应不得同时带 data')
  assert.deepEqual(Object.keys(failure).sort(), ['error', 'instanceId', 'ok', 'protocol', 'requestId'])
  assert.deepEqual(failure.error, { code: 'SESSION_BUSY', message: '忙', retryable: false })
  // Authentication failures may omit the ids entirely.
  const bare = errorEnvelope(new BridgeError('UNAUTHORIZED', 'no'))
  assert.deepEqual(Object.keys(bare).sort(), ['error', 'ok', 'protocol'])
  assert.equal(bare.error.retryable, false)
})

test('错误码映射到协议规定的 HTTP 状态', () => {
  const expectations = {
    INVALID_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    SESSION_NOT_FOUND: 404,
    SESSION_BUSY: 409,
    REQUEST_CONFLICT: 409,
    REQUEST_UNKNOWN: 404,
    UNSUPPORTED_CAPABILITY: 501,
    BODY_TOO_LARGE: 413,
    OVERLOADED: 429,
    INTERNAL_ERROR: 500,
  }
  for (const [code, status] of Object.entries(expectations)) {
    assert.equal(new BridgeError(code, 'x').status, status, code)
  }
})

test('serializeBounded 拒绝超出预算的响应', () => {
  assert.equal(serializeBounded({ a: 1 }, 100, '响应'), '{"a":1}')
  assert.throws(() => serializeBounded({ a: 'x'.repeat(200) }, 100, '响应'), /超出 100 字节预算/)
})

test('协议常量与限额', () => {
  assert.equal(PROTOCOL, 'pet-dsh/1')
  assert.equal(LIMITS.requestBytes, 65536)
  assert.equal(LIMITS.responseBytes, 262144)
  assert.equal(LIMITS.eventBytes, 65536)
  assert.equal(LIMITS.messageChars, 4000)
  assert.equal(LIMITS.eventsPerSecond, 30)
  assert.equal(LIMITS.heartbeatMs, 15000)
  assert.equal(LIMITS.journalRetentionHours, 24)
  // 15 s request budget must stay well under the pet host's 45 s idle close.
  assert.ok(LIMITS.requestTimeoutMs < LIMITS.petStreamIdleMs)
  // The heartbeat must be short enough to refresh that idle timer.
  assert.ok(LIMITS.heartbeatMs * 2 < LIMITS.petStreamIdleMs)
})
