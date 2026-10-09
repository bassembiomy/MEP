import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
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

function parseDecorativeFile(filePath: string) {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })
  
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
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })
  
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

const DECORATIVE_CATALOG_FILE = 'Decorative unit Selection.xlsx'
const DUCTED_CATALOG_FILE = 'Ducted unit Selection.xlsx'
const LEGACY_DECORATIVE_PATH = 'G:\\MEP\\hva\\Lecture 05\\' + DECORATIVE_CATALOG_FILE
const LEGACY_DUCTED_PATH = 'G:\\MEP\\hva\\Lecture 06\\Office building cairo\\' + DUCTED_CATALOG_FILE

/** Where to look for a default catalog: $MEP_CATALOG_DIR, then <userData>/catalogs, then the original author's drive. */
function defaultCatalogCandidates(fileName: string, legacyPath: string): string[] {
  const dirs: string[] = []
  if (process.env['MEP_CATALOG_DIR']) dirs.push(process.env['MEP_CATALOG_DIR'])
  dirs.push(join(app.getPath('userData'), 'catalogs'))
  return [...dirs.map((d) => join(d, fileName)), legacyPath]
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    // The fixed 260 px left and 330 px right docks leave the drawing canvas ~300 px wide at 900x670, which clips its toolbars:
    // 1400x900 gives ~810 px, and the minimum keeps at least ~510 px (e2e-electron E1b asserts >= 450 px).
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
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
    const result = {
      decorative: null as any,
      ducted: null as any,
      errors: [] as string[]
    }

    const decSearch = defaultCatalogCandidates(DECORATIVE_CATALOG_FILE, LEGACY_DECORATIVE_PATH)
    const decPath = decSearch.find((p) => fs.existsSync(p))
    if (decPath) {
      try {
        result.decorative = parseDecorativeFile(decPath)
      } catch (err: any) {
        result.errors.push(`Error parsing decorative catalog: ${err.message}`)
      }
    } else {
      result.errors.push('Default Decorative catalog not found. Looked in: ' + decSearch.join('; '))
    }

    const ductSearch = defaultCatalogCandidates(DUCTED_CATALOG_FILE, LEGACY_DUCTED_PATH)
    const ductPath = ductSearch.find((p) => fs.existsSync(p))
    if (ductPath) {
      try {
        result.ducted = parseDuctedFile(ductPath)
      } catch (err: any) {
        result.errors.push(`Error parsing ducted catalog: ${err.message}`)
      }
    } else {
      result.errors.push('Default Ducted catalog not found. Looked in: ' + ductSearch.join('; '))
    }

    return result
  })

  ipcMain.handle('hvac:load-catalogs-custom', async (event, type: 'decorative' | 'ducted') => {
    // Parent the dialog on the window that asked; getFocusedWindow() is null when no window has focus
    // (e.g. no window manager), which used to make this handler silently do nothing.
    const win = BrowserWindow.fromWebContents(event.sender)
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
    } catch (err: any) {
      return { error: err.message }
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
