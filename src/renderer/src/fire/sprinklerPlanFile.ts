/** Reads an architectural floor plan file (DXF, or DWG converted to DXF with LibreDWG) into DXF text. */
import { getLibreDwgInstance } from '../engine/dwgParser'

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}

export async function readPlanFileAsDxf(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  if (/\.dwg$/i.test(file.name)) {
    const libredwg = await getLibreDwgInstance()
    const dxf: Uint8Array | null = libredwg.dwg_write_dxf(buf)
    if (!dxf || dxf.length === 0) throw new Error('The DWG file could not be converted to DXF.')
    return decode(dxf)
  }
  return decode(new Uint8Array(buf))
}
