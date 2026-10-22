// Failure containment: a broken bridge must never take DSH down with it.
//
// The Cordis loader treats one failed entry as a failed plugin tree, so a bad
// config value or an unusable authorization file would otherwise stop the whole
// DSH app from starting. These tests pin the alternative: the bridge stays shut
// (no listener, no runtime.json, nothing half-open) while the host keeps running.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createFakeHarness } from './helpers/fake-harness.js'
import * as plugin from '../src/index.js'

/**
 * @returns {string} a throwaway data directory.
 */
function tempDataDir() {
  return mkdtempSync(join(tmpdir(), 'pet-bridge-resilience-'))
}

test('配置无效时不抛错、不监听、不写 runtime.json', async () => {
  const harness = createFakeHarness()
  harness.createSession('session-a')
  const dataDir = tempDataDir()
  try {
    // port 超出 0-65535：parseConfig 会拒绝
    await assert.doesNotReject(plugin.apply(harness.ctx, { dataDir, port: 70000 }))
    assert.equal(existsSync(join(dataDir, 'runtime.json')), false, '失败的启动不得留下 runtime.json')
    assert.equal(existsSync(join(dataDir, 'journal')), false, '配置阶段失败时连数据目录都不该建')
    await harness.dispose()
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('未知配置键也只记录错误，不阻断宿主', async () => {
  const harness = createFakeHarness()
  harness.createSession('session-a')
  try {
    await assert.doesNotReject(plugin.apply(harness.ctx, { enableSteer: true, 拼写错误的键: 1 }))
    await harness.dispose()
  } finally {
    /* nothing persistent was created */
  }
})

test('授权表损坏时以「无授权客户端」继续运行，修好后自动恢复', async () => {
  const harness = createFakeHarness()
  const sessionId = 'session-resilience'
  harness.createSession(sessionId, { cwd: 'C:\\projects\\demo' })
  harness.createAgent(sessionId)
  const dataDir = tempDataDir()
  const clientsFile = join(dataDir, 'clients.json')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(clientsFile, '{ this is not json }')
  try {
    await assert.doesNotReject(plugin.apply(harness.ctx, { dataDir, clientsFile, port: 0 }))
    const runtime = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(join(dataDir, 'runtime.json'), 'utf8')))
    assert.equal(typeof runtime.url, 'string', '桥必须照常监听，只是没有任何授权客户端')

    const unauth = await fetch(new URL('info', runtime.url))
    assert.equal(unauth.status, 401)

    // Fix the file; the 2 s watcher must pick it up without a restart.
    const token = 'f'.repeat(64)
    const { createHash } = await import('node:crypto')
    writeFileSync(clientsFile, JSON.stringify({
      format: 'dsh-pet-bridge-clients/1',
      clients: [{
        clientId: 'pet-resilience',
        tokenSha256: createHash('sha256').update(token, 'utf8').digest('hex'),
        sessions: [sessionId],
        capabilities: ['sessions.list', 'session.snapshot'],
        enabled: true,
      }],
    }))
    const deadline = Date.now() + 6000
    let status = 401
    while (Date.now() < deadline) {
      const res = await fetch(new URL('info', runtime.url), { headers: { authorization: `Bearer ${token}` } })
      status = res.status
      if (status === 200) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    assert.equal(status, 200, '修好授权表后应自动恢复，无需重启 DSH')
    await harness.dispose()
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
