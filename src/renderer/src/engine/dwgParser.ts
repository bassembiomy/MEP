import { LibreDwg, Dwg_File_Type, createModule } from '@mlightcad/libredwg-web'
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

export async function parseDwgBuffer(uint8Array: Uint8Array): Promise<ParsedDxf> {
  const libredwg = await getLibreDwgInstance()
  // Copy exactly this view's bytes (including subarray offsets) to the
  // ArrayBuffer expected by LibreDWG's public API.
  const dwgData = libredwg.dwg_read_data(new Uint8Array(uint8Array).buffer, Dwg_File_Type.DWG)
  if (!dwgData) throw new Error('Failed to parse DWG binary data.')
  try {
    return parseDwgDatabase(libredwg.convert(dwgData))
  } finally {
    libredwg.dwg_free(dwgData)
  }
}
