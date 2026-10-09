import { readFileSync } from 'node:fs'
import { CORPUS } from './fixtures'
import { resolve } from 'node:path'

interface CorpusRoom { name: string; areaSqFt: number; polygon: number[] }
interface CorpusFile { drawingUnit: string; expected: { cadUnit: string; unitsConfidence: string }; rooms: CorpusRoom[]; unitsPerFoot: number }
/** Read-only view of the corpus manifest; tests assert against it and never rewrite it. */
export const manifest: { files: Record<string, CorpusFile> } = JSON.parse(readFileSync(resolve(CORPUS, 'manifest.json'), 'utf8'))
