import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = join(root, 'src/renderer/src/engine/__tests__')
const requested = process.argv.slice(2)
const files = readdirSync(directory).filter(name => name.endsWith('.test.ts'))
const legacy = files.filter(name => !/from\s+['"]vitest['"]/.test(readFileSync(join(directory, name), 'utf8')))
const matches = name => requested.length === 0 || requested.some(filter => name.includes(filter))
const run = (args) => spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' }).status ?? 1
let failed = false
if (files.some(name => !legacy.includes(name) && matches(name))) {
  failed = run(['node_modules/vitest/vitest.mjs', 'run', ...requested]) !== 0
}
const legacyFiles = legacy.filter(matches).map(name => join(directory, name))
if (legacyFiles.length) {
  console.log('\nRunning legacy assertion and node:test files through Node...')
  failed = run(['--import', 'tsx', '--test', '--test-concurrency=2', ...legacyFiles]) !== 0 || failed
}
if (!files.some(matches)) {
  console.error('No engine tests matched the supplied filter.')
  failed = true
}
process.exitCode = failed ? 1 : 0
