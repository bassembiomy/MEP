import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, CORPUS, store, toScreen, waitStageSettled } from './fixtures'

/**
 * Precision at a far origin. Drawings written by scripts/cad-corpus/generate_adversarial.py: one plan 20 ft (or 20 m) wide, at the
 * origin and offset by 2,000,000 ft (6e8 mm). The importer rebases a far drawing to a local frame centred on its bbox; because the
 * offset is a multiple of the origin step the far file's local coordinates equal the at-origin file's, so the fitted view and the
 * canvas pixels must be identical, and a snapped corner must land exactly on the wall corner in that local frame.
 */
const ADVERSARIAL = resolve(CORPUS, 'adversarial')
const adv = JSON.parse(readFileSync(resolve(CORPUS, 'adversarial-manifest.json'), 'utf8')).files as Record<string, {
  unit: string; half: number; centre: [number, number]; centreB: [number, number]; twin: string; second: string
  outerCorners: [number, number][]; twinCorners: [number, number][]
}>

async function importAdv(page: Page, name: string): Promise<void> {
  await page.goto('/')
  await page.setInputFiles('input[type=file][accept=".dxf,.dwg"]', resolve(ADVERSARIAL, name))
  await page.waitForFunction(() => window.__mep.store.getState().dxfEntities.length > 0)
  await waitStageSettled(page)
}
/** Import another file into the current session (no reload): zones and the stage are kept. Resolves once the drawing origin moved. */
async function importMore(page: Page, name: string): Promise<void> {
  const before = await store(page, (s) => s.drawingOrigin.x)
  await page.setInputFiles('input[type=file][accept=".dxf,.dwg"]', resolve(ADVERSARIAL, name))
  await expect.poll(() => store(page, (s) => s.drawingOrigin.x)).not.toBe(before)
  await waitStageSettled(page)
}

/** RGBA bytes of every canvas, concatenated (page-side getImageData), as base64. */
async function canvasBytes(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const parts: Uint8ClampedArray[] = []
    for (const c of Array.from(document.querySelectorAll('canvas'))) {
      const ctx = c.getContext('2d')
      if (ctx && c.width && c.height) parts.push(ctx.getImageData(0, 0, c.width, c.height).data)
    }
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) { all.set(p, at); at += p.length }
    let s = ''
    for (let i = 0; i < all.length; i += 0x8000) s += String.fromCharCode(...all.subarray(i, i + 0x8000))
    return btoa(s)
  })
  return Buffer.from(b64, 'base64')
}
function pixelDiff(a: Buffer, b: Buffer): { differing: number; maxDelta: number; nonBlank: number } {
  expect(a.length).toBe(b.length)
  let differing = 0, maxDelta = 0, nonBlank = 0
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] !== 0) nonBlank++
    let d = 0
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(a[i + k] - b[i + k]))
    if (d) { differing++; maxDelta = Math.max(maxDelta, d) }
  }
  return { differing, maxDelta, nonBlank }
}
const stageView = (page: Page) => page.evaluate(() => { const st = window.__mep.Konva.stages[0]; return { x: st.x(), y: st.y(), scale: st.scaleX() } })

for (const unit of ['ft', 'mm']) {
  const t = adv[`far-origin-${unit}.dxf`]
  test(`far-origin ${unit}: rebased to a local frame, canvas pixels equal the at-origin twin, corner snap is exact`, async ({ page }) => {
    await importAdv(page, `far-origin-${unit}.dxf`)
    const origin = await store(page, (s) => s.drawingOrigin)
    expect(origin.x).toBe(t.centre[0])
    expect(origin.y).toBe(-t.centre[1]) // internal Y is the negated DXF Y
    const viewFar = await stageView(page)
    const far = await canvasBytes(page)

    // Zoom out so the corners clear the canvas toolbars that float over its edges, then check they are on the canvas.
    const box = (await page.locator('canvas').first().boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 300)
    await waitStageSettled(page)

    // corner snap, local frame: store coordinates are raw - origin, so the corner is (+-half, -(+-half)) exactly
    await page.getByRole('button', { name: 'Draw Zone Polygon' }).click()
    const corners = t.outerCorners.map(([x, y]) => ({ x: x - origin.x, y: -y - origin.y }))
    for (const c of corners) expect(Math.abs(c.x)).toBe(t.half)
    const order = [corners[0], corners[1], corners[2]]
    for (let i = 0; i < order.length; i++) {
      const c = order[i]
      // approach from inside the room so a neighbouring (circle / label) target never wins; offsets are a few px
      const p = await toScreen(page, c.x, c.y)
      expect(p.x, `corner ${i} on canvas`).toBeGreaterThan(box.x + 80)
      expect(p.x).toBeLessThan(box.x + box.width - 80)
      expect(p.y).toBeGreaterThan(box.y + 120)
      expect(p.y).toBeLessThan(box.y + box.height - 120)
      const dx = c.x < 0 ? 4 : -4, dy = c.y < 0 ? 3 : -3
      await page.mouse.move(p.x + dx, p.y + dy)
      await page.mouse.click(p.x + dx, p.y + dy)
      const pts = await store(page, (s) => s.tempPoints)
      expect(pts.length).toBe((i + 1) * 2)
      expect(pts[pts.length - 2], `corner ${i} x`).toBe(c.x)
      expect(pts[pts.length - 1], `corner ${i} y`).toBe(c.y)
      expect(pts[pts.length - 2] + origin.x, `corner ${i} raw x`).toBe(t.outerCorners[i][0])
    }

    await importAdv(page, t.twin)
    const originTwin = await store(page, (s) => s.drawingOrigin)
    expect(originTwin).toEqual({ x: 0, y: 0 })
    const viewTwin = await stageView(page)
    expect(viewTwin.scale).toBeCloseTo(viewFar.scale, 9)
    expect(viewTwin.x).toBeCloseTo(viewFar.x, 6)
    expect(viewTwin.y).toBeCloseTo(viewFar.y, 6)
    const twin = await canvasBytes(page)
    const diff = pixelDiff(far, twin)
    test.info().annotations.push({ type: 'pixel-diff', description: JSON.stringify(diff) })
    expect(diff.nonBlank, 'the canvas is not blank').toBeGreaterThan(2000)
    // Identical local coordinates and an identical fitted view give identical pixels: 0 differing pixels were observed (ft 249,938 and mm 6,226
    // painted pixels). Documented allowance for other GPUs / rasterisers: one level of antialiasing noise on at most 0.01 % of the painted pixels.
    expect(diff.maxDelta).toBeLessThanOrEqual(1)
    expect(diff.differing).toBeLessThanOrEqual(Math.ceil(diff.nonBlank * 0.0001))
  })

  test(`far-origin ${unit}: importing a second far drawing with a zone present keeps the zone where it is on screen and in raw coordinates`, async ({ page }) => {
    await importAdv(page, `far-origin-${unit}.dxf`)
    const o1 = await store(page, (s) => s.drawingOrigin)
    const h = t.half
    // a zone inside the inner room, drawn in the local frame
    await page.evaluate(([a, b]) => window.__mep.store.getState().addZone([-a, -b, a, -b, a, b, -a, b]), [h / 4, h / 8])
    await expect.poll(() => store(page, (s) => s.zones.length)).toBe(1)
    await waitStageSettled(page)
    const rawBefore = await store(page, (s) => s.zones[0].points.slice())
    const before = await toScreen(page, rawBefore[0], rawBefore[1])

    await importMore(page, t.second)
    await expect.poll(() => store(page, (s) => s.drawingOrigin.x)).not.toBe(o1.x)
    const o2 = await store(page, (s) => s.drawingOrigin)
    expect(o2.x).toBe(t.centreB[0])
    const zone = await store(page, (s) => s.zones[0].points.slice())
    // I1: raw = local + origin is unchanged for the retained zone (exact: these are integers well below 2^53)
    for (let i = 0; i < zone.length; i++) expect(zone[i] + (i % 2 ? o2.y : o2.x)).toBe(rawBefore[i] + (i % 2 ? o1.y : o1.x))
    // the canvas origin-change effect pans the stage by -(old - new) * scale, so the zone stays on the same screen pixel
    await waitStageSettled(page)
    const after = await toScreen(page, zone[0], zone[1])
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.5)
    expect(Math.abs(after.y - before.y)).toBeLessThan(0.5)
  })
}
