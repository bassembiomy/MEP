/**
 * DWG export — converts the application's verified AutoCAD R12 DXF to a native DWG using a DWG engine
 * installed on the user's computer. DWG is Autodesk's closed binary format; rather than hand-writing it,
 * the conversion is delegated to (in order of preference):
 *
 *   1. ODA File Converter (free, Open Design Alliance) — `ODAFileConverter <inDir> <outDir> <ver> DWG 0 1 <filter>`
 *   2. AutoCAD Core Console (ships with AutoCAD)     — `accoreconsole.exe /i in.dxf /s script.scr`
 *   3. LibreDWG `dxf2dwg`                            — `dxf2dwg -y --as r2000 in.dxf -o out.dwg`
 *
 * A converter can also be forced with the environment variable MEP_DWG_CONVERTER (full path to one of
 * the executables above). Pure helpers are exported for unit testing.
 */
import { execFile } from 'child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export type DwgConverterKind = 'oda' | 'autocad' | 'libredwg'

export interface DwgConverter {
  kind: DwgConverterKind
  path: string
}

export interface DwgExportResult {
  ok: boolean
  converter?: DwgConverterKind
  converterPath?: string
  outputPath?: string
  error?: string
}

/** DWG release written by each converter (AutoCAD 2018 format opens in AutoCAD 2018 → current). */
export const ODA_OUTPUT_VERSION = 'ACAD2018'
export const AUTOCAD_SAVEAS_VERSION = '2018'

/** Classify an executable path by its file name. */
export function converterKindOf(path: string): DwgConverterKind | null {
  // Split on both separators so Windows paths classify correctly on any platform.
  const n = (path.split(/[\\/]/).pop() ?? path).toLowerCase()
  if (n.startsWith('odafileconverter')) return 'oda'
  if (n.startsWith('accoreconsole')) return 'autocad'
  if (n.startsWith('dxf2dwg')) return 'libredwg'
  return null
}

/** Newest-first list of sub-directories of `dir` whose name starts with `prefix` (e.g. "AutoCAD 2025"). */
function versionedDirs(dir: string, prefix: string): string[] {
  try {
    return readdirSync(dir)
      .filter((d) => d.toLowerCase().startsWith(prefix.toLowerCase()))
      .sort()
      .reverse()
      .map((d) => join(dir, d))
  } catch {
    return []
  }
}

/** Candidate executable locations for the current platform, in preference order. */
export function candidateConverterPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const out: string[] = []
  if (env.MEP_DWG_CONVERTER) out.push(env.MEP_DWG_CONVERTER)
  if (platform === 'win32') {
    for (const root of [
      env['ProgramFiles'] ?? 'C:\\Program Files',
      env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    ]) {
      for (const d of versionedDirs(join(root, 'ODA'), 'ODAFileConverter'))
        out.push(join(d, 'ODAFileConverter.exe'))
    }
    for (const root of [env['ProgramFiles'] ?? 'C:\\Program Files']) {
      for (const d of versionedDirs(join(root, 'Autodesk'), 'AutoCAD'))
        out.push(join(d, 'accoreconsole.exe'))
    }
  } else if (platform === 'darwin') {
    out.push('/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter')
  } else {
    out.push(
      '/usr/bin/ODAFileConverter',
      '/usr/local/bin/ODAFileConverter',
      '/opt/ODAFileConverter/ODAFileConverter'
    )
  }
  // LibreDWG on PATH (any platform)
  const sep = platform === 'win32' ? ';' : ':'
  for (const dir of (env.PATH ?? env.Path ?? '').split(sep).filter(Boolean)) {
    out.push(join(dir, platform === 'win32' ? 'dxf2dwg.exe' : 'dxf2dwg'))
    if (platform !== 'win32') out.push(join(dir, 'ODAFileConverter'))
  }
  return out
}

/** First installed converter, or null. */
export function findDwgConverter(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync
): DwgConverter | null {
  for (const p of candidateConverterPaths(platform, env)) {
    const kind = converterKindOf(p)
    if (kind && exists(p)) return { kind, path: p }
  }
  return null
}

/** Command line for a converter. `workDir` holds `in.dxf`; the DWG is written to `outDir`. */
export function converterCommand(
  conv: DwgConverter,
  workDir: string,
  outDir: string
): { file: string; args: string[]; scriptText?: string; outputFile: string } {
  const inFile = join(workDir, 'drawing.dxf')
  const outFile = join(outDir, 'drawing.dwg')
  switch (conv.kind) {
    case 'oda':
      // <input folder> <output folder> <output version> <output type> <recurse> <audit> [<input filter>]
      return {
        file: conv.path,
        args: [workDir, outDir, ODA_OUTPUT_VERSION, 'DWG', '0', '1', '*.DXF'],
        outputFile: outFile
      }
    case 'autocad': {
      // Script: no file dialogs, SAVEAS to the 2018 DWG format, then quit.
      const scriptText = [
        'FILEDIA',
        '0',
        `_.SAVEAS ${AUTOCAD_SAVEAS_VERSION} "${outFile.replace(/\\/g, '/')}"`,
        '_.QUIT',
        ''
      ].join('\r\n')
      return {
        file: conv.path,
        args: ['/i', inFile, '/s', join(workDir, 'export.scr'), '/l', 'en-US'],
        scriptText,
        outputFile: outFile
      }
    }
    case 'libredwg':
      return {
        file: conv.path,
        args: ['-y', '--as', 'r2000', inFile, '-o', outFile],
        outputFile: outFile
      }
  }
}

function run(
  file: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, _stdout, stderr) => {
      // execFile reports a numeric exit status in err.code, or a string such as 'ENOENT' when it cannot start.
      const raw: unknown = err ? (err as unknown as { code?: unknown }).code : 0
      const code = typeof raw === 'number' ? raw : err ? 1 : 0
      resolve({ code, stderr: String(stderr || (err ? err.message : '')) })
    })
  })
}

/** Convert DXF text to a DWG file at `outputPath`. */
export async function exportDwg(
  dxfText: string,
  outputPath: string,
  converter: DwgConverter | null = findDwgConverter(),
  timeoutMs = 120000
): Promise<DwgExportResult> {
  if (!converter) {
    return {
      ok: false,
      error:
        'No DWG converter was found. Install the free "ODA File Converter" (opendesign.com → Guest Files → ODA File Converter) ' +
        'or use a computer with AutoCAD installed, then export again. The DXF export works without any converter and opens in AutoCAD.'
    }
  }
  const workDir = mkdtempSync(join(tmpdir(), 'mep-dwg-in-'))
  const outDir = mkdtempSync(join(tmpdir(), 'mep-dwg-out-'))
  try {
    writeFileSync(join(workDir, 'drawing.dxf'), dxfText, 'latin1')
    const cmd = converterCommand(converter, workDir, outDir)
    if (cmd.scriptText) writeFileSync(join(workDir, 'export.scr'), cmd.scriptText, 'latin1')
    const r = await run(cmd.file, cmd.args, timeoutMs)
    if (!existsSync(cmd.outputFile) || statSync(cmd.outputFile).size < 64) {
      return {
        ok: false,
        converter: converter.kind,
        converterPath: converter.path,
        error:
          `The ${converter.kind} converter did not produce a DWG (exit ${r.code}). ${r.stderr.slice(0, 400)}`.trim()
      }
    }
    copyFileSync(cmd.outputFile, outputPath)
    return { ok: true, converter: converter.kind, converterPath: converter.path, outputPath }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
    rmSync(outDir, { recursive: true, force: true })
  }
}
