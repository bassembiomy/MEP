import { readdirSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const directory = 'src/renderer/src/engine/__tests__'
const vitestFiles = readdirSync(directory)
  .filter(name => name.endsWith('.test.ts') && /from\s+['"]vitest['"]/.test(readFileSync(`${directory}/${name}`, 'utf8')))
  .map(name => `${directory}/${name}`)

export default defineConfig({
  test: {
    environment: 'node',
    include: vitestFiles,
    testTimeout: 30000,
    maxWorkers: 2
  }
})
