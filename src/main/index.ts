import { app, shell, BrowserWindow, ipcMain, dialog, screen } from 'electron'
import {
  computeWindowPlan,
  parseSavedWindowState,
  WINDOW_MIN_WIDTH,
  WINDOW_MIN_HEIGHT,
  type SavedWindowState
} from '../renderer/src/canvas/windowBounds'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import * as fs from 'fs'
import * as XLSX from 'xlsx'

interface DecorativeUnit {
  spaceName: string
  hapLoad: number
  hapCfm: number
  unitType: string
  capacity: number
  cfm: number
  model: string
  rowNumber: number
  source: string
}

interface DuctedUnit {
  spaceName: string
  hapTotal: number
  hapSensible: number
  hapCfm: number
  enteringDbWb: string
  capacity: number
  sensibleCapacity: number
  cfm: number
  model: string
  esp: string
  qty: number
  rowNumber: number
  source: string
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function parseDecorativeFile(filePath: string): { highWall: DecorativeUnit[]; cassette: DecorativeUnit[] } {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })
  
  const highWall: DecorativeUnit[] = []
  const cassette: DecorativeUnit[] = []

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0 || !row[0]) continue
    if (row[0] === 'Space Name' || row[1] === 'Btu/hr') continue

    const spaceName = String(row[0]).trim()
    const hapLoad = Number(row[1]) || 0
    const hapCfm = Number(row[2]) || 0
    const unitType = row[3] ? String(row[3]).trim() : ''
    const unitCap = Number(row[4]) || 0
    const unitCfm = Number(row[5]) || 0

    if (!unitType || !unitCap) continue

    const unitTypeLower = unitType.toLowerCase()
    let model = ''
    if (unitTypeLower.includes('wall') || unitTypeLower.includes('hw')) {
      if (unitCap === 12050) model = '12K'
      else if (unitCap === 18000) model = '18K'
      else if (unitCap === 22800) model = '24K'
      else if (unitCap === 29300) model = '30K'
      else model = `HW-${unitCap}`

      highWall.push({
        spaceName,
        hapLoad,
        hapCfm,
        unitType,
        capacity: unitCap,
        cfm: unitCfm,
        model,
        rowNumber: i + 1,
        source: 'Decorative unit Selection.xlsx'
      })
    } else if (unitTypeLower.includes('cass')) {
      if (unitCap === 24000) model = '24K'
      else if (unitCap === 34000) model = '36K'
      else if (unitCap === 42500) model = '48K'
      else model = `CAS-${unitCap}`

      cassette.push({
        spaceName,
        hapLoad,
        hapCfm,
        unitType,
        capacity: unitCap,
        cfm: unitCfm,
        model,
        rowNumber: i + 1,
        source: 'Decorative unit Selection.xlsx'
      })
    }
  }

  return { highWall, cassette }
}

function parseDuctedFile(filePath: string): DuctedUnit[] {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })
  
  const catalog: DuctedUnit[] = []

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0 || !row[0]) continue
    if (row[0] === 'Space Name' || row[1] === 'Total Cap(Btu/hr)') continue
    
    const firstCell = String(row[0]).trim()
    if (firstCell.includes('Total') || (!row[1] && !row[5])) {
      break
    }

    const spaceName = firstCell
    const hapTotal = Number(row[1]) || 0
    const hapSensible = Number(row[2]) || 0
    const hapCfm = Number(row[3]) || 0
    const enteringDbWb = row[4] ? String(row[4]).trim() : ''
    const unitTotal = Number(row[5]) || 0
    const unitSensible = Number(row[6]) || 0
    const unitCfm = Number(row[7]) || 0
    const model = row[8] ? String(row[8]).trim() : ''
    const esp = row[9] ? String(row[9]).trim() : '0.16 In'
    const qty = Number(row[10]) || 1

    if (!model || !unitTotal) continue

    catalog.push({
      spaceName,
      hapTotal,
      hapSensible,
      hapCfm,
      enteringDbWb,
      capacity: unitTotal,
      sensibleCapacity: unitSensible,
      cfm: unitCfm,
      model,
      esp,
      qty,
      rowNumber: i + 1,
      source: 'Ducted unit Selection.xlsx'
    })
  }

  return catalog
}

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): SavedWindowState | null {
  try {
    return parseSavedWindowState(fs.readFileSync(windowStatePath(), 'utf8'))
  } catch {
    return null
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    if (win.isDestroyed()) return
    const b = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds()
    const state: SavedWindowState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() }
    fs.writeFileSync(windowStatePath(), JSON.stringify(state))
  } catch {
    // persisting window bounds is best-effort
  }
}

function createWindow(): void {
  // Professional CAD default: 90% of the work area (min 1280x800), first run maximized, later runs restore the last bounds.
  const plan = computeWindowPlan(
    screen.getPrimaryDisplay().workArea,
    loadWindowState(),
    screen.getAllDisplays().map((d) => d.workArea)
  )
  const mainWindow = new BrowserWindow({
    x: plan.x,
    y: plan.y,
    width: plan.width,
    height: plan.height,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  if (plan.maximize) mainWindow.maximize()

  let saveTimer: NodeJS.Timeout | null = null
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveWindowState(mainWindow), 400)
  }
  mainWindow.on('resize', scheduleSave)
  mainWindow.on('move', scheduleSave)
  mainWindow.on('maximize', scheduleSave)
  mainWindow.on('unmaximize', scheduleSave)
  mainWindow.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveWindowState(mainWindow)
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register HVAC catalog loading handlers
  ipcMain.handle('hvac:load-catalogs-default', async () => {
    const decPath = 'G:\\MEP\\hva\\Lecture 05\\Decorative unit Selection.xlsx'
    const ductPath = 'G:\\MEP\\hva\\Lecture 06\\Office building cairo\\Ducted unit Selection.xlsx'

    const result = {
      decorative: null as { highWall: DecorativeUnit[]; cassette: DecorativeUnit[] } | null,
      ducted: null as DuctedUnit[] | null,
      errors: [] as string[]
    }

    if (fs.existsSync(decPath)) {
      try {
        result.decorative = parseDecorativeFile(decPath)
      } catch (err: unknown) {
        result.errors.push(`Error parsing decorative catalog: ${errMessage(err)}`)
      }
    } else {
      result.errors.push('Default Decorative catalog not found at ' + decPath)
    }

    if (fs.existsSync(ductPath)) {
      try {
        result.ducted = parseDuctedFile(ductPath)
      } catch (err: unknown) {
        result.errors.push(`Error parsing ducted catalog: ${errMessage(err)}`)
      }
    } else {
      result.errors.push('Default Ducted catalog not found at ' + ductPath)
    }

    return result
  })

  ipcMain.handle('hvac:load-catalogs-custom', async (_, type: 'decorative' | 'ducted') => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const dialogResult = await dialog.showOpenDialog(win, {
      title: `Select ${type === 'decorative' ? 'Decorative' : 'Ducted'} Catalog Excel File`,
      filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    })

    if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
      return null
    }

    const filePath = dialogResult.filePaths[0]
    try {
      if (type === 'decorative') {
        const parsed = parseDecorativeFile(filePath)
        return { data: parsed, filePath, name: join(filePath).split(/[\\/]/).pop() }
      } else {
        const parsed = parseDuctedFile(filePath)
        return { data: parsed, filePath, name: join(filePath).split(/[\\/]/).pop() }
      }
    } catch (err: unknown) {
      return { error: errMessage(err) }
    }
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
