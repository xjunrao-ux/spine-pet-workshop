#!/usr/bin/env node
// Operator console for the pet-dsh/1 bridge.
//
// It owns the only place a connection token exists in plaintext: this process's
// stdout, printed once, for the operator to paste into the pet's trusted
// connection window. Nothing else writes it — not the config file, not the
// journal, not runtime.json, not this script's own state.
//
//   node scripts/pet-bridge-admin.mjs token create --client pet-livingroom --session session-xxxx
//   node scripts/pet-bridge-admin.mjs token create --client pet-livingroom --session session-xxxx --export
//   node scripts/pet-bridge-admin.mjs list
//   node scripts/pet-bridge-admin.mjs grant  --client pet-livingroom --session session-yyyy
//   node scripts/pet-bridge-admin.mjs revoke --client pet-livingroom
//   node scripts/pet-bridge-admin.mjs token rotate --client pet-livingroom
//   node scripts/pet-bridge-admin.mjs status

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const FORMAT = 'dsh-pet-bridge-clients/1'
const BASE_CAPABILITIES = ['sessions.list', 'session.snapshot', 'message.send', 'events.follow', 'requests.lookup']

const argv = process.argv.slice(2)
const command = argv[0]
const sub = argv[1]

/**
 * Read `--name value` flags.
 * @param {string[]} args argument list.
 * @returns {Record<string, string|true>} flag map.
 */
function parseFlags(args) {
  const flags = {}
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = args[index + 1]
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true
    } else {
      flags[key] = next
      index += 1
    }
  }
  return flags
}

/**
 * @param {NodeJS.ProcessEnv} env process environment.
 * @returns {string} the bridge data directory.
 */
function dataDir(env = process.env) {
  const configured = env.DSH_PET_BRIDGE_DATA_DIR
  if (configured !== undefined && configured !== '') return resolve(configured)
  const home = env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(resolve(home), 'pet-bridge')
}

const dir = dataDir()
const clientsFile = join(dir, 'clients.json')
const runtimeFile = join(dir, 'runtime.json')
const exportFile = join(dir, 'connection-export.json')

/**
 * Load the registry, tolerating a missing file.
 * @returns {{format: string, clients: object[]}} registry document.
 */
function loadRegistry() {
  if (!existsSync(clientsFile)) return { format: FORMAT, clients: [] }
  const doc = JSON.parse(readFileSync(clientsFile, 'utf8'))
  if (doc?.format !== FORMAT || !Array.isArray(doc.clients)) {
    fail(`clients.json 格式不受支持；请先备份 ${clientsFile} 再处理`)
  }
  return doc
}

/**
 * Write the registry atomically and restrict it to the current user.
 * @param {object} doc registry document.
 */
function saveRegistry(doc) {
  mkdirSync(dirname(clientsFile), { recursive: true })
  const temp = `${clientsFile}.tmp`
  writeFileSync(temp, `${JSON.stringify(doc, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, clientsFile)
  try {
    chmodSync(clientsFile, 0o600)
  } catch {
    // Windows ignores POSIX modes. The directory lives under the user's DSH
    // home, which already inherits the user's profile ACL; this script never
    // claims that a mode bit equals an ACL.
  }
}

/**
 * @param {string} message failure text.
 * @returns {never} exits the process.
 */
function fail(message) {
  console.error(`错误：${message}`)
  process.exit(1)
}

/**
 * @param {string} text prompt text.
 */
function note(text) {
  console.log(text)
}

/**
 * @param {string} token plaintext token.
 * @returns {string} SHA-256 hex digest.
 */
function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * @returns {string} a 32-byte hex token.
 */
function newToken() {
  // Hex stays inside the pet host's accepted character set and is unambiguous
  // when copied from a terminal.
  return randomBytes(32).toString('hex')
}

/**
 * Validate a session id against the wire grammar before registering it.
 * @param {string} sessionId candidate id.
 */
function assertSessionId(sessionId) {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(sessionId)) {
    fail(`会话标识必须匹配 [A-Za-z0-9._-]{1,100}：${sessionId}`)
  }
}

/**
 * Split `--session` (repeatable or comma separated) into a list.
 * @param {string|true|undefined} value flag value.
 * @returns {string[]} session ids.
 */
function sessionList(value) {
  if (value === undefined) return []
  const raw = value === true ? '' : String(value)
  return raw.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
}

/**
 * Print the connection information for one client, once.
 * @param {object} options print options.
 */
function printConnection({ token, clientId, sessions, endpoint }) {
  note('')
  note('================ 连接令牌（只显示这一次） ================')
  note(`根地址: ${endpoint ?? '（插件运行时写入 runtime.json；先启动 DSH）'}`)
  note(`令牌  : ${token}`)
  note(`客户端: ${clientId}`)
  note(`会话  : ${sessions.join(', ')}`)
  note('=========================================================')
  note('把「根地址」和「令牌」填进桌宠的可信连接窗口。令牌不会写入任何文件；')
  note('关闭本终端后只能用 token rotate 重新签发。')
  note('')
}

/**
 * The endpoint of a bridge that is *currently* running, if any.
 *
 * `runtime.json` is removed on a graceful unload but survives a hard kill, so
 * the pid is checked rather than trusting the file.
 * @returns {{url: string, runtime: object}|undefined} live runtime facts.
 */
function runningRuntime() {
  if (!existsSync(runtimeFile)) return undefined
  let runtime
  try {
    runtime = JSON.parse(readFileSync(runtimeFile, 'utf8'))
  } catch {
    return undefined
  }
  if (typeof runtime.url !== 'string') return undefined
  if (Number.isInteger(runtime.pid) && runtime.pid > 0) {
    try {
      process.kill(runtime.pid, 0)
    } catch {
      return undefined
    }
  }
  return { url: runtime.url, runtime }
}

/**
 * @returns {string|undefined} the endpoint of the running bridge, if any.
 */
function runningEndpoint() {
  return runningRuntime()?.url
}

/**
 * Create a client record with a fresh token.
 * @param {object} flags parsed flags.
 */
function tokenCreate(flags) {
  const clientId = typeof flags.client === 'string' ? flags.client : 'pet'
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(clientId)) fail('--client 必须是 1-64 个 [A-Za-z0-9._-] 字符')
  const sessions = sessionList(flags.session)
  if (sessions.length === 0) fail('必须用 --session 指定至少一个已存在的会话；默认不共享任何会话')
  for (const sessionId of sessions) assertSessionId(sessionId)

  const capabilities = [...BASE_CAPABILITIES]
  if (flags['with-cancel'] === true) capabilities.push('session.cancel')
  if (flags['with-steer'] === true) capabilities.push('message.steer')

  const doc = loadRegistry()
  if (doc.clients.some((client) => client.clientId === clientId)) {
    fail(`客户端 ${clientId} 已存在；先用 revoke 删除，或用 token rotate 换令牌`)
  }
  const token = newToken()
  doc.clients.push({
    clientId,
    label: typeof flags.label === 'string' ? flags.label : clientId,
    tokenSha256: hashToken(token),
    sessions,
    capabilities,
    enabled: true,
    createdAt: new Date().toISOString(),
  })
  saveRegistry(doc)
  printConnection({ token, clientId, sessions, endpoint: runningEndpoint() })

  if (flags.export === true) {
    // A deliberately explicit local export: the operator asked for a file.
    const payload = {
      format: 'dsh-pet-bridge-connection/1',
      endpoint: runningEndpoint() ?? null,
      token,
      clientId,
      sessions,
      note: '本文件含明文连接令牌。用完请删除；不要提交到版本库或放在项目工作区。',
      createdAt: new Date().toISOString(),
    }
    writeFileSync(exportFile, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    note(`已写入受保护的本地导出文件：${exportFile}`)
    note('Windows 上仅设置 POSIX 权限不等价于 ACL；该文件位于你的 DSH home 目录下，')
    note('用完请手动删除，并确认它没有被同步或提交。')
  }
}

/** @param {object} flags parsed flags. */
function tokenRotate(flags) {
  const clientId = typeof flags.client === 'string' ? flags.client : ''
  const doc = loadRegistry()
  const client = doc.clients.find((entry) => entry.clientId === clientId)
  if (client === undefined) fail(`没有客户端 ${clientId}`)
  const token = newToken()
  client.tokenSha256 = hashToken(token)
  client.createdAt = new Date().toISOString()
  saveRegistry(doc)
  note(`旧令牌立即失效；插件会在约 2 秒内关闭该客户端的 SSE 流（已提交的 DSH 任务不会取消）。`)
  printConnection({ token, clientId, sessions: client.sessions, endpoint: runningEndpoint() })
}

/** @param {object} flags parsed flags. */
function grant(flags) {
  const clientId = typeof flags.client === 'string' ? flags.client : ''
  const sessions = sessionList(flags.session)
  if (sessions.length === 0) fail('必须用 --session 指定会话')
  const doc = loadRegistry()
  const client = doc.clients.find((entry) => entry.clientId === clientId)
  if (client === undefined) fail(`没有客户端 ${clientId}`)
  for (const sessionId of sessions) {
    assertSessionId(sessionId)
    if (!client.sessions.includes(sessionId)) client.sessions.push(sessionId)
  }
  saveRegistry(doc)
  note(`${clientId} 现在可以访问：${client.sessions.join(', ')}`)
}

/** @param {object} flags parsed flags. */
function revoke(flags) {
  const clientId = typeof flags.client === 'string' ? flags.client : ''
  const doc = loadRegistry()
  const before = doc.clients.length
  doc.clients = doc.clients.filter((entry) => entry.clientId !== clientId)
  if (doc.clients.length === before) fail(`没有客户端 ${clientId}`)
  saveRegistry(doc)
  note(`已撤销 ${clientId}。插件会在约 2 秒内关闭它的 SSE 流并拒绝新请求。`)
  note('已提交的 DSH 任务不会被取消。')
}

function list() {
  const doc = loadRegistry()
  if (doc.clients.length === 0) {
    note('没有已授权客户端（默认状态：所有请求 401）。')
    return
  }
  for (const client of doc.clients) {
    note(`${client.clientId}${client.enabled ? '' : '（已禁用）'}  会话: ${client.sessions.join(', ')}`)
    note(`  能力: ${client.capabilities.join(', ')}`)
    note(`  令牌摘要: ${client.tokenSha256.slice(0, 12)}…（只存哈希）`)
  }
}

function status() {
  const live = runningRuntime()
  const doc = loadRegistry()
  note(`数据目录: ${dir}`)
  note(`客户端文件: ${clientsFile}${existsSync(clientsFile) ? `（${statSync(clientsFile).size} 字节）` : '（不存在）'}`)
  note(`授权客户端: ${doc.clients.filter((client) => client.enabled).length}`)
  note(`授权会话: ${new Set(doc.clients.flatMap((client) => client.sessions)).size}`)
  if (live === undefined) {
    note('运行实例: 未检测到（DSH 未启动，或插件未启用）')
    if (existsSync(runtimeFile)) note('提示: runtime.json 是上次运行留下的，进程已不在')
    return
  }
  note(`运行实例: ${live.runtime.instanceId}  pid=${live.runtime.pid}  DSH ${live.runtime.dshVersion}`)
  note(`根地址: ${live.url}`)
}

switch (command) {
  case 'token':
    if (sub === 'create') tokenCreate(parseFlags(argv.slice(2)))
    else if (sub === 'rotate') tokenRotate(parseFlags(argv.slice(2)))
    else fail('用法：token create|rotate [--client id] [--session id] [--label 名称] [--with-cancel] [--with-steer] [--export]')
    break
  case 'grant':
    grant(parseFlags(argv.slice(1)))
    break
  case 'revoke':
    revoke(parseFlags(argv.slice(1)))
    break
  case 'list':
    list()
    break
  case 'status':
    status()
    break
  case 'export-path':
    note(exportFile)
    break
  default:
    note('用法：')
    note('  pet-bridge-admin.mjs token create --client <id> --session <sessionId> [--with-cancel] [--export]')
    note('  pet-bridge-admin.mjs token rotate --client <id>')
    note('  pet-bridge-admin.mjs grant  --client <id> --session <sessionId>')
    note('  pet-bridge-admin.mjs revoke --client <id>')
    note('  pet-bridge-admin.mjs list | status')
    note(`数据目录：${dir}（可用 DSH_PET_BRIDGE_DATA_DIR 覆盖）`)
    process.exitCode = command === undefined ? 0 : 1
}
