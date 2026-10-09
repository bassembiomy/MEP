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
 * libredwg-web's convert() omits the elevation (group 38) of TEXT and ATTRIB, which the DWG object does carry, and the
 * `dataflags` that say whether the alignment point is stored (bit 0x02 set: it is not, and equals the insertion point).
 * Read both from the typed entity and attach them, by handle, to the converted records (top level, block definitions and
 * INSERT.attribs): `elevation` so the adapter treats the text like every other elevated entity, `textDataFlags` for the
 * justification anchor.
 */
function attachTextElevations(libredwg: LibreDwg, dwgData: Parameters<LibreDwg['convert']>[0], db: unknown): void {
  const elevations = new Map<string, number>()
  const dataFlags = new Map<string, number>()
  for (const type of [Dwg_Object_Type.DWG_TYPE_TEXT, Dwg_Object_Type.DWG_TYPE_ATTRIB]) {
    for (const tio of libredwg.dwg_getall_entity_by_type(dwgData, type)) {
      const elevation = libredwg.dwg_dynapi_entity_data<number>(tio, 'elevation')
      const flags = libredwg.dwg_dynapi_entity_data<number>(tio, 'dataflags')
      const hasElevation = typeof elevation === 'number' && elevation !== 0
      if (!hasElevation && typeof flags !== 'number') continue
      const parent = libredwg.dwg_dynapi_entity_data<number>(tio, 'parent')
      const handle = libredwg.dwg_object_entity_get_handle_object(parent).value.toString(16).toUpperCase()
      if (hasElevation) elevations.set(handle, elevation)
      if (typeof flags === 'number') dataFlags.set(handle, flags)
    }
  }
  if (elevations.size === 0 && dataFlags.size === 0) return
  const visit = (records: unknown): void => {
    if (!Array.isArray(records)) return
    for (const record of records as { type?: string; handle?: string; elevation?: number; textDataFlags?: number; attribs?: unknown }[]) {
      if (!record || typeof record !== 'object') continue
      if ((record.type === 'TEXT' || record.type === 'ATTRIB') && typeof record.handle === 'string') {
        const elevation = elevations.get(record.handle)
        if (elevation !== undefined && record.elevation === undefined) record.elevation = elevation
        const flags = dataFlags.get(record.handle)
        if (flags !== undefined) record.textDataFlags = flags
      }
      visit(record.attribs)
    }
  }
  const database = db as { entities?: unknown; tables?: { BLOCK_RECORD?: { entries?: { entities?: unknown }[] } } }
  visit(database.entities)
  for (const block of database.tables?.BLOCK_RECORD?.entries ?? []) visit(block.entities)
}

/**
 * libredwg-web's converted BLOCK_RECORD exposes `flag` (always 64 in files LibreDWG reads) but neither `blkisxref` nor the xref path.
 * Read both from the typed BLOCK_HEADER and mark the converted block record (matched by name) so an INSERT of an external reference
 * can be reported instead of silently expanding an empty block. NOT verified against a real xref DWG: dxf2dwg 0.13.3 drops the xref
 * flag and path, so no such file can be produced here (documented in the corpus README).
 */
function attachXrefs(libredwg: LibreDwg, dwgData: Parameters<LibreDwg['convert']>[0], db: unknown): void {
  const xrefs = new Map<string, string>()
  for (const tio of libredwg.dwg_getall_object_by_type(dwgData, Dwg_Object_Type.DWG_TYPE_BLOCK_HEADER)) {
    if (!libredwg.dwg_dynapi_entity_data<number>(tio, 'blkisxref')) continue
    const name = libredwg.dwg_dynapi_entity_data<string>(tio, 'name')
    const path = libredwg.dwg_dynapi_entity_data<string>(tio, 'xref_pname')
    if (typeof name === 'string') xrefs.set(name, typeof path === 'string' ? path : '')
  }
  if (!xrefs.size) return
  for (const block of (db as { tables?: { BLOCK_RECORD?: { entries?: { name?: string; isXref?: boolean; xrefPath?: string }[] } } }).tables?.BLOCK_RECORD?.entries ?? [])
    if (typeof block.name === 'string' && xrefs.has(block.name)) { block.isXref = true; block.xrefPath = xrefs.get(block.name) }
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
    attachXrefs(libredwg, dwgData, db)
    return parseDwgDatabase(db)
  } finally {
    libredwg.dwg_free(dwgData)
  }
}

export async function parseDwgBuffer(uint8Array: Uint8Array): Promise<ParsedDxf> {
  return parseDwgWith(await getLibreDwgInstance(), uint8Array)
}
