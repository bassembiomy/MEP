// Builds the production Electron bundle, verifies the GUI test hook is absent, then runs the
// real-Electron Playwright suite (e2e-electron/). On Linux without a display it is wrapped in xvfb-run.
import { spawnSync } from 'node:child_process'

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const extra = process.argv.slice(2)

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false })
  if (r.error) {
    console.error(`Failed to run ${cmd}: ${r.error.message}`)
    process.exit(1)
  }
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run(npx, ['electron-vite', 'build'])
run(process.execPath, ['scripts/check-no-test-hook.mjs'])

const pw = [npx, 'playwright', 'test', '-c', 'e2e-electron/playwright.config.ts', ...extra]
if (process.platform === 'linux' && !process.env.DISPLAY) {
  run('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', ...pw])
} else {
  run(pw[0], pw.slice(1))
}
