import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: '../test-results',
  use: {
    baseURL: 'http://127.0.0.1:4319',
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'npx vite preview --config e2e/vite.e2e.config.ts --port 4319 --strictPort',
    url: 'http://127.0.0.1:4319',
    reuseExistingServer: false,
    cwd: '..',
    timeout: 60_000
  }
})
