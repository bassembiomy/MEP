import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(__filename)

export const CORPUS = resolve(__dirname, '../src/renderer/src/engine/__tests__/fixtures/corpus')
export const corpusPath = (name: string): string => resolve(CORPUS, name)
const MAIN_ENTRY = resolve(__dirname, '../out/main/index.js')

/**
 * Child-process stderr lines that are known Chromium/Linux-container noise, not application errors.
 * Keep this tiny. Every entry must say why it is safe to ignore.
 */
const STDERR_ALLOWLIST: Array<{ re: RegExp; why: string }> = [
  // Under xvfb in a container there is no session D-Bus; Chromium logs its failed connection attempt.
  { re: /bus\.cc/, why: 'Chromium cannot reach the (absent) D-Bus session bus' },
  // Software-rendered GPU process start-up chatter (we pass --disable-gpu; no GPU exists in the container).
  { re: /viz\/.*gpu_init|gpu_init\.cc|viz_main_impl\.cc/, why: 'GPU process initialisation messages with no GPU present' },
  // Fontconfig has no config/cache dirs in a clean container / temp XDG_CONFIG_HOME.
  { re: /Fontconfig/i, why: 'Fontconfig warns about missing config/cache directories in the container' }
]

export interface Diagnostics {
  /** Everything that should make the test fail. */
  errors: string[]
  /** Pull main-process uncaughtException / unhandledRejection records into `errors`. */
  collectMain: () => Promise<void>
}

export interface Launched {
  app: ElectronApplication
  page: Page
  diag: Diagnostics
}

export interface LaunchOptions {
  /** Becomes XDG_CONFIG_HOME (and therefore app.getPath('userData')'s parent). */
  configHome: string
  catalogDir?: string
}

export async function launchApp(opts: LaunchOptions): Promise<Launched> {
  const app = await _electron.launch({
    executablePath: require('electron') as unknown as string,
    args: [MAIN_ENTRY, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SANDBOX: '1',
      XDG_CONFIG_HOME: opts.configHome,
      ...(opts.catalogDir ? { MEP_CATALOG_DIR: opts.catalogDir } : {})
    } as Record<string, string>
  })
  const errors: string[] = []
  app.process().stderr?.on('data', (buf: Buffer) => {
    for (const line of buf.toString().split('\n')) {
      const t = line.trim()
      if (t && !STDERR_ALLOWLIST.some((a) => a.re.test(t))) errors.push(`stderr: ${t}`)
    }
  })
  await app.evaluate(() => {
    const g = globalThis as unknown as { __mainDiag?: string[] }
    g.__mainDiag = []
    process.on('uncaughtException', (e) => g.__mainDiag!.push(`uncaughtException: ${e?.stack ?? e}`))
    process.on('unhandledRejection', (e) => g.__mainDiag!.push(`unhandledRejection: ${(e as Error)?.stack ?? e}`))
  })
  const page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  const diag: Diagnostics = {
    errors,
    collectMain: async () => {
      const got = await app
        .evaluate(() => {
          const g = globalThis as unknown as { __mainDiag?: string[] }
          return g.__mainDiag?.splice(0) ?? []
        })
        .catch(() => [] as string[])
      errors.push(...got)
    }
  }
  await page.waitForLoadState('domcontentloaded')
  return { app, page, diag }
}

interface Fixtures {
  /** Per-test temp dir (config home, downloads, catalogs live below it). */
  tmp: string
  configHome: string
  catalogDir: string
  /** Launch an additional app instance sharing this test's config home (e.g. relaunch). All are zero-error checked. */
  launch: () => Promise<Launched>
  electronApp: ElectronApplication
  page: Page
}

export const test = base.extend<Fixtures>({
  tmp: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'mep-e2e-'))
    await use(dir)
    rmSync(dir, { recursive: true, force: true })
  },
  configHome: async ({ tmp }, use) => {
    const d = join(tmp, 'config')
    mkdirSync(d)
    await use(d)
  },
  catalogDir: async ({ tmp }, use) => {
    const d = join(tmp, 'catalogs')
    mkdirSync(d)
    await use(d)
  },
  launch: async ({ configHome, catalogDir }, use) => {
    const launched: Launched[] = []
    await use(async () => {
      const l = await launchApp({ configHome, catalogDir })
      l.page.on('dialog', (d) => void d.accept())
      launched.push(l)
      return l
    })
    // E8: every instance must have produced zero errors. Collected before closing.
    const all: string[] = []
    for (const l of launched) {
      await l.diag.collectMain()
      all.push(...l.diag.errors)
      await l.app.close().catch(() => undefined)
    }
    expect(all, 'no console/page/main-process/stderr errors').toEqual([])
  },
  electronApp: async ({ launch }, use) => {
    const l = await launch()
    await use(l.app)
  },
  page: async ({ electronApp }, use) => {
    await use(await electronApp.firstWindow())
  }
})

export { expect }

/** Capture the main window and return the count of non-background pixels (non-blank check). */
export async function captureNonBlank(app: ElectronApplication): Promise<{ width: number; height: number; distinctColors: number; nonBackground: number }> {
  const raw = await app.evaluate(async ({ BrowserWindow }) => {
    const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
    const size = img.getSize()
    return { b64: img.toBitmap().toString('base64'), ...size }
  })
  const bmp = Buffer.from(raw.b64, 'base64')
  const seen = new Set<number>()
  const bg = bmp.readUInt32LE(0)
  let nonBackground = 0
  for (let i = 0; i + 3 < bmp.length; i += 4) {
    const px = bmp.readUInt32LE(i)
    if (seen.size < 64) seen.add(px)
    if (px !== bg) nonBackground++
  }
  return { width: raw.width, height: raw.height, distinctColors: seen.size, nonBackground }
}

/** Make the next dialog.showOpenDialog resolve with `path` (or cancelled when path is null). */
export async function mockOpenDialog(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => (p === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
  }, path)
}

/**
 * Route every download straight into `dir` (no native save dialog, which would hang under xvfb).
 * Returns a function listing the saved files' absolute paths.
 */
export async function captureDownloads(app: ElectronApplication, dir: string): Promise<() => string[]> {
  mkdirSync(dir, { recursive: true })
  await app.evaluate(({ session }, d) => {
    session.defaultSession.on('will-download', (_e, item) => {
      item.setSavePath(`${d}/${item.getFilename()}`)
    })
  }, dir)
  return () => readdirSync(dir).map((f) => join(dir, f))
}
