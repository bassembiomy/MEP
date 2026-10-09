import type { Page, TestInfo } from '@playwright/test'
import { test, expect, corpusPath, manifest, store, toScreen, waitStageSettled, nonBlankPixels } from './fixtures'

const METRIC = 'arch-metric-mm-r2018.dxf'
const UNITLESS = 'unitless-insunits0.dxf'
const NOISE = 'noise-dim-hatch-spline-paper.dxf'

async function importCad(page: Page, name: string): Promise<void> {
  await page.goto('/')
  await page.setInputFiles('input[type=file][accept=".dxf,.dwg"]', corpusPath(name))
  await page.waitForFunction(() => window.__mep.store.getState().dxfEntities.length > 0)
  await waitStageSettled(page)
}

const shoelaceSqFt = (pts: number[], unitsPerFoot: number): number => {
  let a = 0
  for (let i = 0; i < pts.length; i += 2) {
    const j = (i + 2) % pts.length
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1]
  }
  return Math.abs(a) / 2 / (unitsPerFoot * unitsPerFoot)
}

const attachShot = async (page: Page, info: TestInfo, name: string): Promise<void> => {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
}

/** Click a drawing-space point from a small pixel offset, to prove the tool snaps rather than the mouse being exact. */
async function clickNear(page: Page, x: number, y: number, dx: number, dy: number, settleMs = 450): Promise<void> {
  const p = await toScreen(page, x, y)
  await page.mouse.move(p.x + dx, p.y + dy)
  await page.mouse.click(p.x + dx, p.y + dy)
  if (settleMs) await page.waitForTimeout(settleMs) // default stays outside Konva's 400 ms dblclick window (see test 4b)
}

// Office 1 in store coordinates (Y is negated on import). Offsets point away from the nearest neighbouring snap
// targets (walls are 100 mm = ~6 px apart at the fitted zoom; screen +y is store +y) so the nearest endpoint is unambiguous.
const OFFICE_1_CORNERS: Array<{ x: number; y: number; dx: number; dy: number }> = [
  { x: 0, y: 0, dx: 4, dy: 3 },
  { x: 4000, y: 0, dx: -4, dy: 3 },
  { x: 4000, y: -5000, dx: -4, dy: 3 },
  { x: 0, y: -5000, dx: 4, dy: 3 }
]

test('1. DXF import renders a non-blank canvas', async ({ page }, info) => {
  await importCad(page, METRIC)
  const m = manifest.files[METRIC]
  const n = await store(page, (s) => s.dxfEntities.length)
  expect(n).toBeGreaterThan(0)
  await page.waitForTimeout(300)
  expect(await store(page, (s) => s.dxfEntities.length)).toBe(n) // stable
  expect(n).toBeGreaterThanOrEqual(m.rooms.length)
  await expect(page.getByText('CAD Elements:')).toContainText(String(n))
  expect(await nonBlankPixels(page)).toBeGreaterThan(2000)
  await attachShot(page, info, 'imported-metric')
})

test('2. units prompt: declared vs unitless', async ({ page }) => {
  await importCad(page, METRIC)
  expect(manifest.files[METRIC].expected.unitsConfidence).toBe('declared')
  await expect(page.getByText('Drawing units read from CAD header.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm selected units and scale' })).toHaveCount(0)

  await importCad(page, UNITLESS)
  expect(manifest.files[UNITLESS].expected.unitsConfidence).toBe('unknown')
  await expect(page.getByText(/Drawing units are not confirmed/)).toBeVisible()
  const confirm = page.getByRole('button', { name: 'Confirm selected units and scale' }).first()
  await expect(confirm).toBeVisible()
  const find = page.getByRole('button', { name: 'Find room candidates' })
  await expect(find).toBeDisabled()
  await confirm.click()
  await expect(find).toBeEnabled()
  expect(await store(page, (s) => s.project.cadUnitsConfirmed)).toBe(true)
})

test('3. room candidates carry manifest areas; approving creates a zone', async ({ page }, info) => {
  await importCad(page, METRIC)
  const rooms = manifest.files[METRIC].rooms
  await page.selectOption('select[aria-label="Role of A-AREA"]', 'wall')
  await page.getByRole('button', { name: 'Find room candidates' }).click()
  await expect(page.getByText(`${rooms.length} candidates`)).toBeVisible()
  for (const r of rooms) {
    await expect(page.locator('button', { hasText: `${r.areaSqFt.toFixed(1)} ft²` }).first()).toBeVisible()
  }
  const meeting = rooms.find((r) => r.name === 'MEETING ROOM')!
  await page.locator('button', { hasText: `${meeting.areaSqFt.toFixed(1)} ft²` }).first().click()
  await expect(page.locator('svg[aria-label^="Boundary preview"]')).toBeVisible()
  await page.getByRole('button', { name: 'Approve boundary and room inputs' }).click()
  await expect.poll(() => store(page, (s) => s.zones.length)).toBe(1)
  const zone = await store(page, (s) => ({ points: s.zones[0].points, upf: s.zones[0].cadProvenance?.drawingUnitsPerFoot ?? 0 }))
  const area = shoelaceSqFt(zone.points, zone.upf)
  expect(Math.abs(area - meeting.areaSqFt) / meeting.areaSqFt).toBeLessThan(0.005)
  await attachShot(page, info, 'approved-room')
})

test('3b. candidate buttons are named after the manifest room names', async ({ page }) => {
  await importCad(page, METRIC)
  await page.getByRole('button', { name: 'Find room candidates' }).click()
  for (const r of manifest.files[METRIC].rooms) {
    await expect(page.locator('button', { hasText: r.name }).first()).toBeVisible({ timeout: 2000 })
  }
})

test('4. polyline tool snaps to wall corners and closes a room', async ({ page }, info) => {
  await importCad(page, METRIC)
  await page.getByRole('button', { name: 'Draw Zone Polygon' }).click()
  for (let i = 0; i < OFFICE_1_CORNERS.length; i++) {
    const c = OFFICE_1_CORNERS[i]
    await clickNear(page, c.x, c.y, c.dx, c.dy)
    const pts = await store(page, (s) => s.tempPoints)
    expect(pts.length).toBe((i + 1) * 2)
    expect(pts[pts.length - 2]).toBeCloseTo(c.x, 6)
    expect(pts[pts.length - 1]).toBeCloseTo(c.y, 6)
  }
  await attachShot(page, info, 'polyline-in-progress')
  await clickNear(page, 0, 0, 4, 3) // close on the first point
  await expect.poll(() => store(page, (s) => s.zones.length)).toBe(1)
  const z = await store(page, (s) => ({ points: s.zones[0].points, upf: s.project.scale }))
  const office1 = manifest.files[METRIC].rooms.find((r) => r.name === 'OFFICE 1')!
  expect(Math.abs(shoelaceSqFt(z.points, z.upf) - office1.areaSqFt) / office1.areaSqFt).toBeLessThan(0.005)
})

test('4b. two quick vertex clicks at different places do not close the polygon', async ({ page }) => {
  test.fail(true, 'App defect: Konva onDblClick has no distance check, so clicking a 4th vertex <400 ms after the 3rd is treated as a double-click and commits the polygon early.')
  await importCad(page, METRIC)
  await page.getByRole('button', { name: 'Draw Zone Polygon' }).click()
  const [a, b, c, d] = OFFICE_1_CORNERS
  await clickNear(page, a.x, a.y, a.dx, a.dy)
  await clickNear(page, b.x, b.y, b.dx, b.dy)
  await clickNear(page, c.x, c.y, c.dx, c.dy, 0)
  await clickNear(page, d.x, d.y, d.dx, d.dy, 0)
  expect(await store(page, (s) => s.zones.length)).toBe(0)
  expect(await store(page, (s) => s.tempPoints.length)).toBe(8)
})

async function openMeasure(page: Page): Promise<void> {
  const measure = page.locator('[title="Measure / Calibrate Scale"]')
  if (!(await measure.isVisible())) {
    // The measure tool is only on the collapsed tool rail.
    await page.locator('[title^="Collapse Tools"]').click()
    await waitStageSettled(page)
  }
  await measure.click()
  await waitStageSettled(page)
}

async function measureFiveMetreWall(page: Page): Promise<void> {
  await openMeasure(page)
  // Wall LINE (4000,0)-(4000,-5000) is exactly 5 m long in mm drawings.
  await clickNear(page, 4000, 0, -4, 3)
  await clickNear(page, 4000, -5000, -4, 3)
  const input = page.getByPlaceholder(/e\.g\./)
  await expect(input).toBeVisible()
  await expect(page.getByText(/Segment: 5000(\.0*)? drawing units/)).toBeVisible()
  await input.fill('5 m')
  await page.getByRole('button', { name: 'Confirm and apply scale' }).click()
}

test('5a. measure/calibrate on a metric file leaves the scale unchanged', async ({ page }) => {
  await importCad(page, METRIC)
  const before = await store(page, (s) => s.project.scale)
  await measureFiveMetreWall(page)
  await expect(page.getByText(/Scale calibrated/)).toBeVisible()
  const after = await store(page, (s) => s.project.scale)
  expect(Math.abs(after - before) / before).toBeLessThan(0.001)
  expect(await store(page, (s) => s.project.cadUnitsConfirmed)).toBe(true)
})

test('5b. measure/calibrate corrects a wrongly confirmed unit', async ({ page }) => {
  await importCad(page, UNITLESS)
  await page.getByRole('button', { name: 'Confirm selected units and scale' }).first().click()
  await page.selectOption('select:has(option[value="custom"])', 'm') // wrong: the drawing is millimetres
  const wrong = await store(page, (s) => s.project.scale)
  expect(wrong).toBeCloseTo(0.3048, 4)
  await measureFiveMetreWall(page)
  await expect(page.getByText(/Scale calibrated/)).toBeVisible()
  const fixed = await store(page, (s) => s.project.scale)
  expect(Math.abs(fixed - 304.8) / 304.8).toBeLessThan(0.001)
})

test('6. vertex drag is grid-snapped and Undo restores it', async ({ page }) => {
  await importCad(page, METRIC)
  await page.evaluate(() => window.__mep.store.getState().addZone([0, 0, 4000, 0, 4000, -5000, 0, -5000]))
  await expect.poll(() => store(page, (s) => s.zones.length)).toBe(1)
  await expect.poll(() => store(page, (s) => s.selectedZoneId)).not.toBeNull()
  const original = await store(page, (s) => [...s.zones[0].points])
  const grid = await store(page, (s) => s.project.scale * 0.5) // 0.5 ft in drawing units (imperial project)
  await waitStageSettled(page)
  const v = await toScreen(page, 4000, -5000)
  await page.mouse.move(v.x, v.y)
  await page.mouse.down()
  await page.mouse.move(v.x + 12, v.y + 10, { steps: 4 })
  await page.mouse.move(v.x + 30, v.y + 20, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => store(page, (s) => s.zones[0].points.join(','))).not.toBe(original.join(','))
  const moved = await store(page, (s) => [...s.zones[0].points])
  expect(moved.slice(0, 4)).toEqual(original.slice(0, 4)) // other vertices untouched
  for (const c of moved.slice(4, 6)) expect(Math.abs(c / grid - Math.round(c / grid))).toBeLessThan(1e-6)
  expect(moved[4]).toBeGreaterThan(4000)
  await page.getByRole('button', { name: /^Undo \(/ }).click()
  await expect.poll(() => store(page, (s) => s.zones[0].points.join(','))).toBe(original.join(','))
})

test('7. noisy file (dims, hatch, splines, paper space) imports without errors', async ({ page }, info) => {
  await importCad(page, NOISE)
  expect(await store(page, (s) => s.dxfEntities.length)).toBeGreaterThan(0)
  expect(await nonBlankPixels(page)).toBeGreaterThan(2000)
  await attachShot(page, info, 'imported-noise')
  // console/page errors are asserted by the afterEach hook
})
