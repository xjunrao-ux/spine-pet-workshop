#!/usr/bin/env node
// Build the installable tarball for the bridge bundle.
//
//   node scripts/pack.mjs [--out <dir>] [--force]
//
// The tarball is produced from an explicit allowlist, never from a directory
// glob, so a stray `.env`, token file, journal, or `node_modules` junction can
// never end up in a package that is copied between machines. The script then
// verifies the result: every allowlisted file present, no forbidden name, and
// the protocol/schema digests still match the handoff manifest.

import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const outIndex = argv.indexOf('--out')
const outDir = outIndex === -1 ? join(root, '.build') : resolve(argv[outIndex + 1])

/** Files that make up the installable package. */
const INCLUDE = [
  'package.json',
  'cordis.patch.yml',
  'README.md',
  'COMPATIBILITY.md',
  'TEST_REPORT.md',
  'CHANGELOG.md',
  'docs/PET_INTEGRATION.md',
  'protocol/DSH_BRIDGE_PROTOCOL.md',
  'protocol/LOCAL_SERVICE_API.md',
  'protocol/SHA256SUMS.txt',
  'protocol/expected-sha256.json',
  'protocol/schemas/dsh-bridge-v1.schema.json',
  'scripts/bridge-smoke.mjs',
  'scripts/pet-bridge-admin.mjs',
]

/** Anything matching these is a packaging bug, not a missing feature. */
const FORBIDDEN = [
  /(^|[/\\])node_modules([/\\]|$)/,
  /(^|[/\\])\.env$/,
  /(^|[/\\])clients\.json$/,
  /(^|[/\\])runtime\.json$/,
  /(^|[/\\])wire-ids\.json$/,
  /(^|[/\\])session-cache\.json$/,
  /(^|[/\\])requests\.jsonl$/,
  /token/i,
  /(^|[/\\])\.probe([/\\]|$)/,
  /(^|[/\\])legacy-stage0([/\\]|$)/,
  /(^|[/\\])test([/\\]|$)/,
]

/**
 * @param {string} file absolute path.
 * @returns {string} hex SHA-256.
 */
function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** Collect `src/**` recursively as package-relative paths. */
function srcFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(relative(root, full).split('\\').join('/'))
    }
  }
  walk(join(root, 'src'))
  return out.sort()
}

const files = [...INCLUDE, ...srcFiles()]
const problems = []

for (const file of files) {
  const full = join(root, file)
  try {
    if (statSync(full).size === 0) problems.push(`空文件：${file}`)
  } catch {
    problems.push(`缺少文件：${file}`)
  }
  for (const pattern of FORBIDDEN) {
    if (pattern.test(file)) problems.push(`禁止打包：${file}`)
  }
}

// The protocol copies must still be the handed-off bytes.
let expected
try {
  expected = JSON.parse(readFileSync(join(root, 'protocol', 'expected-sha256.json'), 'utf8')).files
} catch {
  expected = undefined
}
for (const file of ['protocol/DSH_BRIDGE_PROTOCOL.md', 'protocol/LOCAL_SERVICE_API.md', 'protocol/schemas/dsh-bridge-v1.schema.json']) {
  if (expected === undefined) break
  const actual = sha256(join(root, file))
  const want = expected[file]
  if (want !== undefined && want !== actual) problems.push(`摘要不匹配：${file}（期望 ${want.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）`)
}

if (problems.length > 0) {
  console.error('打包检查失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tarballName = `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`

// The archive is assembled from the allowlist above, never from a directory
// glob, and `tar` is invoked directly: no dependency on npm being installed, and
// no shell quoting of a path that may contain spaces or non-ASCII characters.
const stagingDir = join(root, '.build', 'stage')
rmSync(stagingDir, { recursive: true, force: true })
const packageRoot = join(stagingDir, 'package')
for (const file of files) {
  const destination = join(packageRoot, file)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(join(root, file), destination)
}

const tarball = join(outDir, tarballName)
rmSync(tarball, { force: true })
execFileSync('tar', ['-czf', tarball, '-C', stagingDir, 'package'], { stdio: 'inherit' })
rmSync(stagingDir, { recursive: true, force: true })

// Re-read the archive so the report describes what was actually written.
const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.endsWith('/'))
const packed = new Set(listing)
for (const file of files) {
  if (!packed.has(`package/${file}`)) problems.push(`打包后缺少：${file}`)
}
if (problems.length > 0) {
  console.error('打包检查失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log('')
console.log(`打包完成：${tarball}`)
console.log(`包含 ${listing.length} 个文件，摘要：${sha256(tarball).slice(0, 16)}…`)
console.log('')
console.log('包内容清单：')
for (const file of files) console.log(`  ${file}`)
