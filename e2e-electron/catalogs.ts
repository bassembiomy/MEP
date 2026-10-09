import * as XLSX from 'xlsx'
import { join } from 'node:path'

export const DECORATIVE_FILE = 'Decorative unit Selection.xlsx'
export const DUCTED_FILE = 'Ducted unit Selection.xlsx'

/** Two header rows, then data rows, in the layout parseDecorativeFile expects. */
export const DECORATIVE_ROWS: unknown[][] = [
  ['Decorative selection'],
  ['Space Name', 'Btu/hr', 'CFM', 'Unit Type', 'Capacity', 'CFM'],
  ['Office A', 11000, 400, 'High Wall', 12050, 420],
  ['Office B', 17000, 500, 'High Wall', 18000, 520],
  ['Lobby', 23000, 800, 'Cassette', 24000, 850],
  ['Hall', 33000, 1000, 'Cassette', 34000, 1100]
]

/** Two header rows, then data rows, in the layout parseDuctedFile expects. */
export const DUCTED_ROWS: unknown[][] = [
  ['Ducted selection'],
  ['Space Name', 'Total Cap(Btu/hr)', 'Sens', 'CFM', 'DB/WB', 'Unit Total', 'Unit Sens', 'Unit CFM', 'Model', 'ESP', 'Qty'],
  ['Room 1', 30000, 22000, 900, '80/67', 30500, 22500, 950, 'FDM-TEST-36', '0.20 In', 2],
  ['Room 2', 48000, 35000, 1400, '80/67', 48500, 35500, 1450, 'FDM-TEST-48', '0.30 In', 1],
  ['Total']
]

export function writeXlsx(path: string, rows: unknown[][]): void {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  XLSX.writeFile(wb, path)
}

export function writeDefaultCatalogs(dir: string): void {
  writeXlsx(join(dir, DECORATIVE_FILE), DECORATIVE_ROWS)
  writeXlsx(join(dir, DUCTED_FILE), DUCTED_ROWS)
}
