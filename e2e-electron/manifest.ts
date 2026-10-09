import { readFileSync } from 'node:fs'
import { CORPUS } from './fixtures'
import { resolve } from 'node:path'

interface CorpusRoom { name: string; areaSqFt: number; polygon: number[] }
interface CorpusFile { drawingUnit: string; expected: { cadUnit: string; unitsConfidence: string }; rooms: CorpusRoom[]; unitsPerFoot: number }
/** Read-only view of the corpus manifest; tests assert against it and never rewrite it. */
export const manifest: { files: Record<string, CorpusFile> } = JSON.parse(readFileSync(resolve(CORPUS, 'manifest.json'), 'utf8'))

interface TwinTruth { expectedEntityCount: number; sourceUnsupported: Record<string, number> }
/** Ground truth (ezdxf construction) of the DXF twin of a committed binary DWG fixture, e.g. `dwg/arch-metric-mm-r2000.dwg`. */
export function twinTruth(dwgPath: string): TwinTruth {
  const dir = resolve(CORPUS, 'dwg')
  const files = JSON.parse(readFileSync(resolve(dir, 'dwg-manifest.json'), 'utf8')).files as Record<string, { twin: string }>
  const twins = JSON.parse(readFileSync(resolve(dir, 'twins-manifest.json'), 'utf8')).files as Record<string, TwinTruth>
  const name = dwgPath.replace(/^dwg\//, '')
  if (!files[name]) throw new Error(`${name} missing from dwg-manifest.json`)
  return twins[files[name].twin]
}
