#!/usr/bin/env node
// Opt-in download of third-party DWG example files into .cache/dwg-external/ (gitignored; never vendored: the
// LibreDWG test data is GPL-licensed). Each file is pinned to a LibreDWG commit and verified by sha256.
//   npm run corpus:fetch-dwg
// dwgExternal.test.ts skips itself when the files are absent, so `npm test` never needs the network.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const manifest = JSON.parse(readFileSync(new URL('./external-dwg.json', import.meta.url), 'utf8'))
const BASE = `https://raw.githubusercontent.com/LibreDWG/libredwg/${manifest.commit}/${manifest.directory}`
const FILES = manifest.files
const root = fileURLToPath(new URL('../../', import.meta.url))
const dest = join(root, '.cache', 'dwg-external')
mkdirSync(dest, { recursive: true })
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
let failed = false
for (const { name, sha256 } of FILES) {
  const path = join(dest, name)
  if (existsSync(path) && sha(readFileSync(path)) === sha256) {
    console.log(`ok       ${name} (cached)`)
    continue
  }
  try {
    const response = await fetch(BASE + name)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (sha(bytes) !== sha256) throw new Error(`sha256 mismatch: expected ${sha256}, got ${sha(bytes)}`)
    writeFileSync(path, bytes)
    console.log(`ok       ${name} (${bytes.length} bytes)`)
  } catch (error) {
    failed = true
    console.error(`FAILED   ${name}: ${error.message}`)
  }
}
process.exitCode = failed ? 1 : 0
