/**
 * Renderer side of the DWG export: hands the application's DXF to the Electron main process, which
 * converts it with the DWG engine installed on the computer (ODA File Converter, AutoCAD's accoreconsole
 * or LibreDWG). Returns a user-facing status message.
 */
const CONVERTER_NAME: Record<string, string> = {
  oda: 'ODA File Converter',
  autocad: 'AutoCAD (accoreconsole)',
  libredwg: 'LibreDWG dxf2dwg'
}

export interface DwgExportStatus {
  ok: boolean
  message: string
}

export async function exportDwgFromApp(
  dxf: string,
  suggestedName: string
): Promise<DwgExportStatus> {
  const api = (window as unknown as { api?: Window['api'] }).api
  if (!api || typeof api.exportDwg !== 'function') {
    return {
      ok: false,
      message:
        'DWG export runs in the desktop application. Use "Export DXF" here — the DXF opens directly in AutoCAD.'
    }
  }
  try {
    const r = await api.exportDwg(dxf, suggestedName)
    if (r.ok) {
      const by = r.converter ? (CONVERTER_NAME[r.converter] ?? r.converter) : 'converter'
      return {
        ok: true,
        message: `DWG saved to ${r.outputPath} (converted with ${by}, AutoCAD 2018 format).`
      }
    }
    if (r.error === 'cancelled') return { ok: false, message: 'DWG export cancelled.' }
    return { ok: false, message: r.error ?? 'DWG export failed.' }
  } catch (e) {
    return {
      ok: false,
      message: `DWG export failed: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}
