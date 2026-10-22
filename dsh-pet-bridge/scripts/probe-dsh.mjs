// Boot the real harness tree with the bridge mounted and report exactly what
// happened. Produces the D0/D6 evidence quoted in COMPATIBILITY.md and
// TEST_REPORT.md, and is the diagnostic tool when a real boot fails.
//
// The tree runs against a throwaway DSH_HOME and a scripted model adapter: no
// user session, setting or credential is read, and no paid model call is made.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const realHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE, '.dsh')
const installAnchor = require.resolve('@deepseek-ai/dsh/package.json')
const dshDir = dirname(installAnchor)

const appBoot = await import('@deepseek-ai/dsh-app-boot')
const llm = await import('@deepseek-ai/dsh-llm')

const profileName = process.env.DSH_PROFILE ?? 'desktop'
const profile = appBoot.loadProfile('dsh', profileName, installAnchor, realHome, { userLayer: false })
console.log('profile:', profileName)
console.log('profile bundles:', profile.layers.map((layer) => layer.packageName).join(', '))
const baseLayer = profile.layers.find((layer) => layer.packageName === '@deepseek-ai/dsh-base')
console.log('dsh-base patch groups:', baseLayer.patches.length)

const work = mkdtempSync(join(tmpdir(), 'pet-probe-'))
const tempHome = join(work, 'home')
const projectDir = join(work, 'project')
mkdirSync(tempHome, { recursive: true })
mkdirSync(projectDir, { recursive: true })

const sessionId = `session-${randomUUID()}`
const token = 'p'.repeat(64)
const dataDir = join(work, 'bridge')
mkdirSync(dataDir, { recursive: true })
const clientsFile = join(dataDir, 'clients.json')
writeFileSync(clientsFile, JSON.stringify({
  format: 'dsh-pet-bridge-clients/1',
  clients: [{
    clientId: 'probe',
    tokenSha256: createHash('sha256').update(token, 'utf8').digest('hex'),
    sessions: [sessionId],
    capabilities: ['sessions.list', 'session.snapshot', 'message.send', 'events.follow', 'requests.lookup', 'session.cancel'],
    enabled: true,
  }],
}))

const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = tempHome
const configPath = join(work, 'cordis.yml')
writeFileSync(configPath, '[]\n')

const patches = [
  ...baseLayer.patches,
  { id: 'agent-presets', config: { roots: [{ path: join(dshDir, 'config', 'agent-presets'), trust: 'system' }] } },
  {
    insert: [{
      id: 'dsh-pet-bridge',
      // `DSH_BRIDGE_PLUGIN_PATH` lets the probe boot a copy that is not this
      // checkout — used to prove a built tarball is complete and runnable.
      name: pathToFileURL(process.env.DSH_BRIDGE_PLUGIN_PATH ?? join(import.meta.dirname, '..', 'src', 'index.js')).href,
      config: { dataDir, clientsFile, port: 0, enableSteer: false },
    }],
  },
]

// Bare package names in the bundle patches resolve from the shared fallback
// directory the launcher uses, expressed as a file URL (the loader's baseUrl).
const bareModuleBaseUrl = pathToFileURL(`${join(realHome, 'profiles')}/`).href

/**
 * Print a nested loader failure with every entry that failed.
 * @param {any} error failure.
 * @param {number} depth nesting depth.
 */
function report(error, depth = 0) {
  const pad = '  '.repeat(depth)
  console.error(`${pad}${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`)
  const nested = error?.errors ?? error?.cause?.errors
  if (Array.isArray(nested)) {
    for (const inner of nested) report(inner, depth + 1)
  } else if (error?.cause !== undefined) {
    report(error.cause, depth + 1)
  }
}

let ctx
try {
  ctx = await appBoot.boot('dsh', configPath, patches, undefined, bareModuleBaseUrl)
  console.log('BOOT OK')
  const services = ['agents', 'sessions', 'llm', 'sessionTitle', 'approval', 'tools', 'timer']
  console.log('services:', services.map((service) => `${service}=${ctx.get(service) !== undefined}`).join(' '))
  const runtime = JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8'))
  console.log('bridge url:', runtime.url)
  console.log('bridge instance:', runtime.instanceId, 'dsh:', runtime.dshVersion)

  const adapter = new (class extends llm.LlmAdapter {
    providerInfo(provider) {
      return { id: provider, name: 'scripted' }
    }

    async *stream(options) {
      const text = 'probe reply from the scripted adapter'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      for (const char of [...text]) {
        if (options.signal?.aborted === true) {
          const aborted = new Error('aborted')
          aborted.name = 'AbortError'
          throw aborted
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
        yield { type: 'text-delta', index: 0, text: char }
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  })()
  const registration = ctx.llm.registerAdapter(['scripted'], adapter)
  const handle = await ctx.agents.create({
    sessionId,
    meta: { cwd: projectDir },
    agentOptions: { provider: 'scripted', model: 'scripted-model' },
  })
  console.log('agent created:', handle.agent.id, 'status:', handle.agent.status)

  const auth = { headers: { authorization: `Bearer ${token}` } }
  const info = await (await fetch(new URL('info', runtime.url), auth)).json()
  console.log('info:', JSON.stringify(info))
  const sessions = await (await fetch(new URL('sessions', runtime.url), auth)).json()
  console.log('sessions:', JSON.stringify(sessions))

  handle.agent.followup({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: 'direct followup probe' }],
    source: { kind: 'user' },
  })
  await handle.agent.whenIdle()
  const snapshot = await (await fetch(new URL(`snapshot?sessionId=${sessionId}`, runtime.url), auth)).json()
  console.log('snapshot messages:', JSON.stringify(snapshot.messages))
  console.log('snapshot activity:', JSON.stringify(snapshot.activity))

  registration()
  await handle.dispose()
  console.log('PROBE OK')
} catch (error) {
  report(error)
  process.exitCode = 1
} finally {
  try {
    await ctx?.fiber.dispose()
  } catch (error) {
    console.error('dispose failed:', error?.message)
  }
  process.env.DSH_HOME = previousHome
  rmSync(work, { recursive: true, force: true })
}
