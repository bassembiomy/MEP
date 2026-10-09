import { test as base, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type Konva from 'konva'
import type { useProjectStore } from '../src/renderer/src/store/projectStore'

type Api = Window['api']
type ProcessVersions = Window['electron']['process']['versions']

export const CORPUS = resolve(__dirname, '../src/renderer/src/engine/__tests__/fixtures/corpus')

interface CorpusRoom { name: string; areaSqFt: number; polygon: number[] }
interface CorpusFile { drawingUnit: string; expected: { cadUnit: string; unitsConfidence: string }; rooms: CorpusRoom[]; unitsPerFoot: number }
export const manifest: { files: Record<string, CorpusFile> } = JSON.parse(readFileSync(resolve(CORPUS, 'manifest.json'), 'utf8'))
export const corpusPath = (name: string): string => resolve(CORPUS, name)

declare global {
  interface Window {
    __mep: { store: typeof useProjectStore; Konva: typeof Konva }
  }
}

/** Console messages that are known, harmless and allowed. Keep this tiny and explicit. */
const ALLOWED_CONSOLE_ERRORS: RegExp[] = []

// Stub of the preload bridge, type-checked against the real Window['api'] / Window['electron'] shapes.
const stubApi: Api = {
  loadDefaultCatalogs: async () => ({ decorative: null, ducted: null, errors: [] }),
  selectCustomCatalog: async () => null
}
const stubVersions: Partial<ProcessVersions> = { electron: '0.0.0-e2e', chrome: '0', node: '0' }

export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error' && !ALLOWED_CONSOLE_ERRORS.some((r) => r.test(m.text()))) errors.push(`console.error: ${m.text()}`)
      })
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      page.on('dialog', (d) => void d.accept())
      await page.addInitScript(
        ({ apiSrc, versions }) => {
          const w = window as unknown as Record<string, unknown>
          w.api = new Function(`return (${apiSrc})`)()
          w.electron = { process: { versions } }
        },
        {
          apiSrc: `{ loadDefaultCatalogs: ${stubApi.loadDefaultCatalogs.toString()}, selectCustomCatalog: ${stubApi.selectCustomCatalog.toString()} }`,
          versions: stubVersions
        }
      )
      await use(errors)
    },
    { auto: true }
  ]
})

test.afterEach(async ({ errors }) => {
  expect(errors, 'no console errors or page errors').toEqual([])
})

export { expect }

export type Store = ReturnType<typeof useProjectStore.getState>

/** Evaluate `fn` against the live zustand state in the page (fn must be self-contained; pass data via `arg`). */
export function store<T, A = undefined>(page: Page, fn: (s: Store, arg: A) => T, arg?: A): Promise<T> {
  return page.evaluate(
    ([src, a]) => new Function(`return (${src})`)()(window.__mep.store.getState(), a),
    [fn.toString(), arg] as [string, A | undefined]
  ) as Promise<T>
}

/** Map a drawing-space (Konva stage local) point to page client coordinates. */
export async function toScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').first().boundingBox()
  if (!box) throw new Error('canvas not visible')
  const p = await page.evaluate(
    ({ x, y }) => {
      const stage = window.__mep.Konva.stages[0]
      return stage.getAbsoluteTransform().point({ x, y })
    },
    { x, y }
  )
  return { x: box.x + p.x, y: box.y + p.y }
}

/** Wait until stage scale/position and entity count stop changing for several frames. */
export async function waitStageSettled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let last = ''
        let same = 0
        const tick = (): void => {
          const st = window.__mep.Konva.stages[0]
          const key = st ? `${st.x()}|${st.y()}|${st.scaleX()}|${window.__mep.store.getState().dxfEntities.length}` : ''
          same = key && key === last ? same + 1 : 0
          last = key
          if (same >= 8) done()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
  )
}

/** Count non-transparent pixels over all canvases (page-side getImageData). */
export function nonBlankPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0
    for (const c of Array.from(document.querySelectorAll('canvas'))) {
      const ctx = c.getContext('2d')
      if (!ctx || !c.width || !c.height) continue
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) n++
    }
    return n
  })
}
