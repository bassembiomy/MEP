import { defineConfig } from '@playwright/test'

// Real-Electron smoke suite. Run via `npm run test:electron`, which builds the
// production bundle first. There is deliberately no webServer: the app under
// test is launched by the fixtures through _electron.launch().
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report-electron' }]],
  outputDir: '../test-results-electron',
  use: { trace: 'retain-on-failure' }
})
