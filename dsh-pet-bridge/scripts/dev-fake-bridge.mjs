#!/usr/bin/env node
// A stand-in DSH for trying the bridge (and bridge-smoke) without booting the
// harness: it mounts the plugin over a harness-compatible in-process fake and
// answers every prompt with a fixed reply.
//
//   node scripts/dev-fake-bridge.mjs [--port 0] [--data-dir <path>]
//
// This is a development tool. It is NOT the real DSH and proves nothing about
// the real adapter — see COMPATIBILITY.md and TEST_REPORT.md for that split.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFakeHarness } from '../test/helpers/fake-harness.js'
import { startBridge, writeClients } from '../test/helpers/bridge-host.js'

const argv = process.argv.slice(2)

/**
 * @param {string} name flag name.
 * @param {string} fallback default value.
 * @returns {string} flag value.
 */
function flag(name, fallback) {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  return argv[index + 1] ?? fallback
}

const port = Number(flag('port', '0'))
const dataDir = flag('data-dir', mkdtempSync(join(tmpdir(), 'pet-bridge-dev-')))
// A short, fixed, obviously-fake token: it still satisfies the wire grammar
// (16–512 chars of [A-Za-z0-9._~+/-]) but is easy to retype in cmd.exe, where
// there is no `'x' * 64` expression to build a long one.
const token = 'devdevdevdevdev0'

const bridge = await startBridge({
  token,
  dataDir,
  config: { port },
  harnessOptions: { reply: '（模拟 DSH 回复）收到你的消息，这里是 dev-fake-bridge。', deltaChunks: 5 },
})

writeClients(bridge.clientsFile, [bridge.client])

const smokeScript = join(import.meta.dirname, 'bridge-smoke.mjs')

console.log('dev-fake-bridge 已启动（模拟 DSH，非真实 Harness）')
console.log(`  根地址: ${bridge.url}`)
console.log(`  令牌  : ${token}`)
console.log(`  会话  : ${bridge.session.id}`)
console.log(`  数据  : ${dataDir}`)
console.log('')
console.log('保持这个窗口开着，另开一个窗口试（cmd.exe 里没有单引号语法）：')
console.log('')
console.log('  cmd.exe:')
console.log(`    set DSH_PET_TOKEN=${token}`)
console.log(`    node "${smokeScript}" --url ${bridge.url} --allow-model`)
console.log('')
console.log('  PowerShell:')
console.log(`    $env:DSH_PET_TOKEN = '${token}'`)
console.log(`    node "${smokeScript}" --url ${bridge.url} --allow-model`)
console.log('')
console.log('去掉 --allow-model 就只做只读检查（不发消息）。Ctrl+C 停止。')

process.on('SIGINT', async () => {
  await bridge.stop()
  process.exit(0)
})
// Keep the process alive while the plugin serves requests.
setInterval(() => {}, 1 << 30)
