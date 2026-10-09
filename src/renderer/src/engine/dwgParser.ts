import { LibreDwg, Dwg_File_Type, Dwg_Object_Type, createModule } from '@mlightcad/libredwg-web'
import type { ParsedDxf } from './dxfParser'
import { parseDwgDatabase } from './cad/dwgGeometry'
import wasmUrl from '../../../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm?url'

let libredwgInstance: LibreDwg | null = null

async function getLibreDwgInstance(): Promise<LibreDwg> {
  if (!libredwgInstance) {
    const wasmInstance = await createModule({ locateFile: () => wasmUrl })
    libredwgInstance = LibreDwg.createByWasmInstance(wasmInstance)
  }
  return libredwgInstance
}

/**
 * libredwg-web's convert() omits the elevation (group 38) of TEXT and ATTRIB, which the DWG object does carry. Read it from
 * the typed entity and attach it, by handle, to the converted records (top level, block definitions and INSERT.attribs) so
 * the adapter treats it like every other elevated entity.
 */
function attachTextElevations(libredwg: LibreDwg, dwgData: Parameters<LibreDwg['convert']>[0], db: unknown): void {
  const elevations = new Map<string, number>()
  for (const type of [Dwg_Object_Type.DWG_TYPE_TEXT, Dwg_Object_Type.DWG_TYPE_ATTRIB]) {
    for (const tio of libredwg.dwg_getall_entity_by_type(dwgData, type)) {
      const elevation = libredwg.dwg_dynapi_entity_data<number>(tio, 'elevation')
      if (typeof elevation !== 'number' || elevation === 0) continue
      const parent = libredwg.dwg_dynapi_entity_data<number>(tio, 'parent')
      elevations.set(libredwg.dwg_object_entity_get_handle_object(parent).value.toString(16).toUpperCase(), elevation)
    }
  }
  if (elevations.size === 0) return
  const visit = (records: unknown): void => {
    if (!Array.isArray(records)) return
    for (const record of records as { type?: string; handle?: string; elevation?: number; attribs?: unknown }[]) {
      if (!record || typeof record !== 'object') continue
      if ((record.type === 'TEXT' || record.type === 'ATTRIB') && record.elevation === undefined && typeof record.handle === 'string') {
        const elevation = elevations.get(record.handle)
        if (elevation !== undefined) record.elevation = elevation
      }
      visit(record.attribs)
    }
  }
  const database = db as { entities?: unknown; tables?: { BLOCK_RECORD?: { entries?: { entities?: unknown }[] } } }
  visit(database.entities)
  for (const block of database.tables?.BLOCK_RECORD?.entries ?? []) visit(block.entities)
}

/**
 * Decode DWG bytes with an already created LibreDwg instance. Environment independent: the browser entry point
 * below supplies the instance created from the bundled ?url wasm, tests supply one created in Node from the wasm file.
 */
export async function parseDwgWith(libredwg: LibreDwg, uint8Array: Uint8Array): Promise<ParsedDxf> {
  // Copy exactly this view's bytes (including subarray offsets) to the
  // ArrayBuffer expected by LibreDWG's public API.
  const dwgData = libredwg.dwg_read_data(new Uint8Array(uint8Array).buffer, Dwg_File_Type.DWG)
  if (!dwgData) throw new Error('Failed to parse DWG binary data.')
  try {
    const db = libredwg.convert(dwgData)
    attachTextElevations(libredwg, dwgData, db)
    return parseDwgDatabase(db)
  } finally {
    libredwg.dwg_free(dwgData)
  }
}

export async function parseDwgBuffer(uint8Array: Uint8Array): Promise<ParsedDxf> {
  return parseDwgWith(await getLibreDwgInstance(), uint8Array)
}
