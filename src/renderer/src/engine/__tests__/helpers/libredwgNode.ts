import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LibreDwg, createModule } from '@mlightcad/libredwg-web'

const wasmPath = fileURLToPath(
  new URL('../../../../../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm', import.meta.url)
)

let instance: Promise<LibreDwg> | null = null

/** One LibreDwg (WASM) instance per test worker, created in Node from the wasm file's bytes. */
export function getNodeLibreDwg(): Promise<LibreDwg> {
  instance ??= createModule({ wasmBinary: readFileSync(wasmPath) }).then((module) => LibreDwg.createByWasmInstance(module))
  return instance
}
