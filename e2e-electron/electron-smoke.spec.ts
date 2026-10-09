import type { ElectronApplication, Page } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { test, expect, captureNonBlank, corpusPath, mockOpenDialog, captureDownloads } from './fixtures'
import { manifest, twinTruth } from './manifest'
import { writeDefaultCatalogs, writeXlsx, DECORATIVE_ROWS, DUCTED_ROWS } from './catalogs'

test('0. userData is isolated under the temp XDG_CONFIG_HOME', async ({ electronApp, configHome }) => {
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  expect(userData.startsWith(configHome), `${userData} should be under ${configHome} (tmp root ${tmpdir()})`).toBe(true)
})

test('E1. boots: one window, non-blank, hardened renderer, preload bridge, default-size layout', async ({ electronApp, page }, info) => {
  expect(electronApp.windows()).toHaveLength(1)
  await expect(page.getByText('MEP Draw Tools')).toBeVisible()
  const shot = await captureNonBlank(electronApp)
  expect(shot.distinctColors).toBeGreaterThan(1)
  expect(shot.nonBackground).toBeGreaterThan(10_000)

  const globals = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    mep: typeof (window as unknown as { __mep?: unknown }).__mep,
    electronVersion: window.electron.process.versions.electron,
    hasApi: typeof window.api.loadDefaultCatalogs
  }))
  expect(globals.require).toBe('undefined')
  expect(globals.process).toBe('undefined')
  expect(globals.mep).toBe('undefined')
  expect(globals.hasApi).toBe('function')
  expect(globals.electronVersion).toBe(await electronApp.evaluate(() => process.versions.electron))

  // Real default window size: 1400x900 clamped to the primary display's work area (src/main/index.ts), so the expected value
  // is computed from the app's own workAreaSize (Xvfb is 1920x1080 under test:electron, 1280x1024 by default).
  // Report horizontal overflow / clipping as a finding.
  const { size, workArea } = await electronApp.evaluate(({ BrowserWindow, screen }) => ({
    size: BrowserWindow.getAllWindows()[0].getSize(),
    workArea: screen.getPrimaryDisplay().workAreaSize
  }))
  expect(size).toEqual([Math.min(1400, workArea.width), Math.min(900, workArea.height)])
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight
  }))
  await info.attach('window-default', { body: await page.screenshot(), contentType: 'image/png' })
  await info.attach('layout-metrics', { body: JSON.stringify(overflow), contentType: 'application/json' })
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW)
  expect(overflow.scrollH).toBeLessThanOrEqual(overflow.clientH)
})

// Regression guard for a usability finding: at the old 900x670 default window the fixed 260 px left and 330 px right docks
// left the drawing canvas ~300 px wide and clipped its toolbars. The default window is now 1400x900 (minimum 1100x700).
test('E1b. at the default window size the drawing canvas is usable (>= 450 px wide)', async ({ page }) => {
  const box = await page.locator('canvas').first().boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(450)
})

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------
const METRIC = 'arch-metric-mm-r2018.dxf'
const PROJECT_INPUT = 'input[type=file][accept=".json,.mep.json"]'
const CAD_INPUT = 'input[type=file][accept=".dxf,.dwg"]'

function roomareaForMeeting(): { name: string; areaSqFt: number } {
  const m = manifest.files[METRIC].rooms.find((r) => r.name === 'MEETING ROOM')
  if (!m) throw new Error('MEETING ROOM missing from corpus manifest')
  return m
}

async function bigWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000))
}

async function importCad(page: Page, name: string): Promise<void> {
  await page.setInputFiles(CAD_INPUT, corpusPath(name))
  await expect(page.getByText('CAD Elements:')).toBeVisible()
  await expect(page.getByText(/CAD Elements:\s*[1-9]/)).toBeVisible()
}

async function approveMeetingRoom(page: Page): Promise<void> {
  const room = roomareaForMeeting()
  await page.selectOption('select[aria-label="Role of A-AREA"]', 'wall')
  await page.getByRole('button', { name: 'Find room candidates' }).click()
  await expect(page.getByText(`${manifest.files[METRIC].rooms.length} candidates`)).toBeVisible()
  await page.locator('button', { hasText: `${room.areaSqFt.toFixed(1)} ft²` }).first().click()
  await expect(page.locator('svg[aria-label^="Boundary preview"]')).toBeVisible()
  await page.getByRole('button', { name: 'Approve boundary and room inputs' }).click()
  await expect(page.getByText('Zones: 1')).toBeVisible()
}

const openComparisonTab = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: /System Catalog Comparison/ }).click()
}

// ---------------------------------------------------------------------------------------------
// E2: default catalogs through the real preload + IPC + xlsx parser
// ---------------------------------------------------------------------------------------------
test('E2a. default catalogs resolve from MEP_CATALOG_DIR and parse through the real IPC', async ({ page, electronApp, catalogDir }) => {
  writeDefaultCatalogs(catalogDir)
  await bigWindow(electronApp)
  await importCad(page, METRIC)
  await approveMeetingRoom(page)
  const r = await page.evaluate(() => window.api.loadDefaultCatalogs())
  expect(r.errors, 'default catalog errors').toEqual([])
  expect(r.decorative?.highWall.map((u) => u.model)).toEqual(['12K', '18K'])
  expect(r.decorative?.cassette.map((u) => u.model)).toEqual(['24K', '36K'])
  expect(r.ducted?.map((u) => u.model)).toEqual(['FDM-TEST-36', 'FDM-TEST-48'])
  expect(r.ducted?.[0]).toMatchObject({ qty: 2, esp: '0.20 In', capacity: 30500 })
  // The comparison tab picks them up and says so.
  await openComparisonTab(page)
  await expect(page.getByText('Cairo HVAC Catalogs Active')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'not fully loaded' })).toHaveCount(0)
})

test('E2b. missing default catalogs show a non-blocking notice, not a silent nothing', async ({ page, electronApp, dialogLog }) => {
  await bigWindow(electronApp)
  await importCad(page, METRIC)
  await approveMeetingRoom(page)
  await openComparisonTab(page)
  await expect(page.getByText('Demo Catalog Active')).toBeVisible()
  const notice = page.getByRole('status').filter({ hasText: 'Default Decorative catalog not found' })
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Default Ducted catalog not found')
  expect(dialogLog, 'notice must be non-blocking (no alert/confirm)').toEqual([])
})

// Known gap, not fixed here: the Excel catalogs are loaded, parsed, displayed and persisted but
// generateSystemCandidates() takes them as the unused parameter `_loadedCatalogs`; selection uses only
// STANDARD_EQUIPMENT_CATALOG. So a catalog model can never appear in the recommendations.
test('E2c. a model from the loaded Excel catalog appears in the system comparison', async ({ page, electronApp, catalogDir }) => {
  test.fail(true, 'systemDesigner.generateSystemCandidates ignores loadedCatalogs (_loadedCatalogs is unused); selection uses only STANDARD_EQUIPMENT_CATALOG')
  writeDefaultCatalogs(catalogDir)
  await bigWindow(electronApp)
  await importCad(page, METRIC)
  await approveMeetingRoom(page)
  await openComparisonTab(page)
  await expect(page.getByText('Cairo HVAC Catalogs Active')).toBeVisible()
  await expect(page.getByText(/FDM-TEST-(36|48)/).first()).toBeVisible({ timeout: 3000 })
})

// ---------------------------------------------------------------------------------------------
// E3: custom catalog through the (mocked) native open dialog
// ---------------------------------------------------------------------------------------------
test('E3a. selectCustomCatalog opens the dialog for the requesting window and parses the chosen file', async ({ page, electronApp, tmp }) => {
  const file = join(tmp, 'My Decorative.xlsx')
  writeXlsx(file, DECORATIVE_ROWS)
  await mockOpenDialog(electronApp, file)
  // The user may have focused another app by the time the IPC arrives: no window has focus.
  const focused = await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].blur()
    return BrowserWindow.getFocusedWindow() !== null
  })
  expect(focused, 'precondition: no focused BrowserWindow').toBe(false)
  const r = await page.evaluate(() => window.api.selectCustomCatalog('decorative'))
  expect(r, 'null means the handler bailed out (e.g. no focused window)').not.toBeNull()
  expect(r.error).toBeUndefined()
  expect(r.name).toBe('My Decorative.xlsx')
  expect(r.data.highWall).toHaveLength(2)
  expect(r.data.cassette).toHaveLength(2)
})

test('E3b. loading a custom ducted catalog through the UI switches the catalog status', async ({ page, electronApp, tmp, dialogLog }) => {
  const file = join(tmp, 'My Ducted.xlsx')
  writeXlsx(file, DUCTED_ROWS)
  await bigWindow(electronApp)
  await importCad(page, METRIC)
  await approveMeetingRoom(page)
  await openComparisonTab(page)
  await expect(page.getByText('Demo Catalog Active')).toBeVisible()
  await mockOpenDialog(electronApp, file)
  await page.getByRole('button', { name: 'Load Ducted XLSX' }).click()
  await expect(page.getByText('Custom Catalogs Active')).toBeVisible()
  expect(dialogLog).toEqual([])
})

test('E3c. cancelling the dialog changes nothing and raises no error', async ({ page, electronApp, dialogLog }) => {
  await bigWindow(electronApp)
  await importCad(page, METRIC)
  await approveMeetingRoom(page)
  await openComparisonTab(page)
  await expect(page.getByText('Demo Catalog Active')).toBeVisible()
  await mockOpenDialog(electronApp, null)
  expect(await page.evaluate(() => window.api.selectCustomCatalog('ducted'))).toBeNull()
  await page.getByRole('button', { name: 'Load Decorative XLSX' }).click()
  await page.waitForTimeout(500)
  await expect(page.getByText('Demo Catalog Active')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(dialogLog).toEqual([])
})

// ---------------------------------------------------------------------------------------------
// E4: DXF through the real file input
// ---------------------------------------------------------------------------------------------
test('E4. DXF import through the real file input renders the corpus drawing', async ({ page, electronApp }, info) => {
  await bigWindow(electronApp)
  await importCad(page, METRIC)
  const text = await page.getByText(/CAD Elements:/).first().innerText()
  const n = Number(/CAD Elements:\s*(\d+)/.exec(text)?.[1])
  expect(n).toBeGreaterThanOrEqual(manifest.files[METRIC].rooms.length) // same lower bound test:gui asserts
  await page.waitForTimeout(300)
  expect(Number(/CAD Elements:\s*(\d+)/.exec(await page.getByText(/CAD Elements:/).first().innerText())?.[1])).toBe(n) // stable
  await expect(page.getByText('Drawing units read from CAD header.')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.waitForTimeout(500)
  const shot = await captureNonBlank(electronApp)
  expect(shot.nonBackground).toBeGreaterThan(10_000)
  await info.attach('imported-metric', { body: await page.screenshot(), contentType: 'image/png' })
})

// ---------------------------------------------------------------------------------------------
// E5: DWG through the real file input. Production loads libredwg-web-*.wasm over file://, which
// nothing else tests. The fixture is committed; a missing file must FAIL (no skip).
// ---------------------------------------------------------------------------------------------
const DWG_NAME = 'dwg/arch-metric-mm-r2000.dwg'
test('E5. DWG import through the real file input (wasm loaded over file://)', async ({ page, electronApp }, info) => {
  const fixture = corpusPath(DWG_NAME)
  expect(existsSync(fixture), `${fixture} must be committed (npm run corpus:generate-dwg)`).toBe(true)
  await bigWindow(electronApp)
  await page.setInputFiles(CAD_INPUT, fixture)
  await expect(page.getByText(/CAD Elements:\s*[1-9]/)).toBeVisible({ timeout: 60_000 })
  // Exactly what the twin manifest (ezdxf ground truth) says the plan holds, plus one TEXT per visible INSERT attribute.
  const truth = twinTruth(DWG_NAME)
  const expected = truth.expectedEntityCount + (truth.sourceUnsupported.ATTRIB ?? 0)
  await expect(page.getByText(new RegExp(`CAD Elements:\\s*${expected}\\b`))).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.waitForTimeout(500)
  expect((await captureNonBlank(electronApp)).nonBackground).toBeGreaterThan(10_000)
  await info.attach('imported-dwg', { body: await page.screenshot(), contentType: 'image/png' })
})

// ---------------------------------------------------------------------------------------------
// E6: room flow, DOM only (no test hook in the production build)
// ---------------------------------------------------------------------------------------------
test('E6. role A-AREA=wall, find candidates, approve one, zone appears', async ({ page, electronApp }) => {
  await bigWindow(electronApp)
  await importCad(page, METRIC)
  await expect(page.getByText('Zones: 0')).toBeVisible()
  await approveMeetingRoom(page)
  for (const r of manifest.files[METRIC].rooms) {
    await expect(page.locator('button', { hasText: r.name }).first()).toBeVisible()
  }
  await expect(page.getByText('Room approved.')).toBeVisible()
})

// ---------------------------------------------------------------------------------------------
// E7: save / load across a real relaunch, and Export DXF round trip
// ---------------------------------------------------------------------------------------------
test('E7. Save project, relaunch with the same user data, open it; exported DXF re-imports cleanly', async ({ electronApp, page, launch, tmp }) => {
  const downloads = join(tmp, 'downloads')
  const saved = await captureDownloads(electronApp, downloads)
  await bigWindow(electronApp)
  await importCad(page, METRIC)
  await approveMeetingRoom(page)

  await page.getByRole('button', { name: 'Export DXF' }).click()
  await expect.poll(() => saved().filter((f) => f.endsWith('.preliminary.dxf')).length).toBe(1)
  await page.getByRole('button', { name: 'Save project' }).click()
  await expect.poll(() => saved().filter((f) => f.endsWith('.mep.json')).length).toBe(1)
  const projectFile = saved().find((f) => f.endsWith('.mep.json'))!
  const dxfFile = saved().find((f) => f.endsWith('.preliminary.dxf'))!
  const doc = JSON.parse(readFileSync(projectFile, 'utf8'))
  expect(doc.format).toBe('mep-hvac-project')
  expect(doc.version).toBe(2)
  expect(doc.zones).toHaveLength(1)
  expect(doc.cadImport.sourceName).toBe(METRIC)
  expect(statSync(dxfFile).size).toBeGreaterThan(1000)
  await electronApp.close()

  // Relaunch against the same XDG_CONFIG_HOME.
  const second = await launch()
  await bigWindow(second.app)
  await expect(second.page.getByText('Zones: 0')).toBeVisible()
  await second.page.setInputFiles(PROJECT_INPUT, projectFile)
  await expect(second.page.getByText('Zones: 1')).toBeVisible()
  await expect(second.page.getByText(METRIC).first()).toBeVisible()
  await expect(second.page.getByRole('alert')).toHaveCount(0)
  await expect(second.page.getByText(/Open this project/)).toHaveCount(0)

  // The exported DXF must be importable again.
  const third = await launch()
  await bigWindow(third.app)
  await third.page.setInputFiles(CAD_INPUT, dxfFile)
  await expect(third.page.getByText(/CAD Elements:\s*[1-9]/)).toBeVisible()
  await expect(third.page.getByRole('alert')).toHaveCount(0)
})
