// After `npx electron-vite build`, the shipped renderer bundles must not contain the
// GUI-test hook. Equivalent to: grep -L __mep out/renderer/assets/*.js  (must list every bundle)
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'out/renderer/assets'
const bundles = readdirSync(dir).filter(f => f.endsWith('.js'))
if (!bundles.length) { console.error(`No bundles in ${dir}; run npx electron-vite build first.`); process.exit(1) }
const bad = bundles.filter(f => readFileSync(join(dir, f), 'utf8').includes('__mep'))
if (bad.length) { console.error('Test hook leaked into production bundles:', bad.join(', ')); process.exit(1) }
console.log(`OK: __mep absent from ${bundles.length} production bundle(s).`)
