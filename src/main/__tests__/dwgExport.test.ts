/**
 * Tests for the DWG export bridge (src/main/dwgExport.ts) using stand-in converter executables that
 * validate the command line each real converter expects and write a DWG-like output file.
 * Run: npx tsx src/main/__tests__/dwgExport.test.ts
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  converterCommand,
  converterKindOf,
  exportDwg,
  findDwgConverter,
  ODA_OUTPUT_VERSION
} from '../dwgExport'

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`Assertion Failed: ${m}`)
}

const DWG_MAGIC = 'AC1032' // AutoCAD 2018 DWG header signature
const bin = mkdtempSync(join(tmpdir(), 'fake-conv-'))
const outDir = mkdtempSync(join(tmpdir(), 'dwg-out-'))

// Fake ODA File Converter: <inDir> <outDir> <ver> DWG 0 1 *.DXF → <outDir>/<name>.dwg
writeFileSync(
  join(bin, 'ODAFileConverter'),
  `#!/usr/bin/env node
const fs=require('fs'),path=require('path');const [inDir,out,ver,type,rec,audit,filter]=process.argv.slice(2);
if(type!=='DWG'||ver!=='${ODA_OUTPUT_VERSION}'||rec!=='0'||audit!=='1'||filter!=='*.DXF'){console.error('bad args '+process.argv.slice(2));process.exit(2)}
for(const f of fs.readdirSync(inDir)) if(/\\.dxf$/i.test(f)){const d=fs.readFileSync(path.join(inDir,f),'latin1');if(!d.includes('AC1009'))process.exit(3);fs.writeFileSync(path.join(out,f.replace(/\\.dxf$/i,'.dwg')),'${DWG_MAGIC}'+'\\0'.repeat(200))}
`
)
// Fake AutoCAD core console: /i in.dxf /s script.scr /l en-US — script must SAVEAS 2018 "<path>"
writeFileSync(
  join(bin, 'accoreconsole'),
  `#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);const i=a[a.indexOf('/i')+1],s=a[a.indexOf('/s')+1];
if(!fs.existsSync(i)||!fs.existsSync(s))process.exit(2);const scr=fs.readFileSync(s,'latin1');
const m=/_\\.SAVEAS 2018 "([^"]+)"/.exec(scr);if(!m||!/FILEDIA\\r\\n0/.test(scr)||!/_\\.QUIT/.test(scr))process.exit(3);
fs.writeFileSync(m[1],'${DWG_MAGIC}'+'\\0'.repeat(200));
`
)
// Fake LibreDWG dxf2dwg: -y --as r2000 in.dxf -o out.dwg
writeFileSync(
  join(bin, 'dxf2dwg'),
  `#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);if(a[0]!=='-y'||a[1]!=='--as'||a[2]!=='r2000'||a[4]!=='-o')process.exit(2);
fs.writeFileSync(a[5],'AC1015'+'\\0'.repeat(200));
`
)
// A converter that runs but produces nothing
writeFileSync(join(bin, 'broken-ODAFileConverter'), '#!/bin/sh\nexit 0\n')
for (const f of ['ODAFileConverter', 'accoreconsole', 'dxf2dwg', 'broken-ODAFileConverter'])
  chmodSync(join(bin, f), 0o755)

const DXF =
  '  0\r\nSECTION\r\n  2\r\nHEADER\r\n  9\r\n$ACADVER\r\n  1\r\nAC1009\r\n  0\r\nENDSEC\r\n  0\r\nEOF\r\n'

;(async () => {
  console.log('=== DWG export bridge ===')
  // classification & detection order
  assert(
    converterKindOf('C:\\ODA\\ODAFileConverter 25.12.0\\ODAFileConverter.exe') === 'oda',
    'ODA kind'
  )
  assert(
    converterKindOf('C:\\Program Files\\Autodesk\\AutoCAD 2025\\accoreconsole.exe') === 'autocad',
    'AutoCAD kind'
  )
  assert(
    converterKindOf('/usr/bin/dxf2dwg') === 'libredwg' && converterKindOf('/usr/bin/ls') === null,
    'LibreDWG / other'
  )
  const env = { PATH: bin } as NodeJS.ProcessEnv
  const found = findDwgConverter('linux', env)
  assert(
    found?.kind === 'libredwg' || found?.kind === 'oda',
    `a converter found on PATH: ${JSON.stringify(found)}`
  )
  const onlyOda = findDwgConverter(
    'linux',
    env,
    (p) => p.endsWith('ODAFileConverter') && p.startsWith(bin)
  )
  assert(onlyOda?.kind === 'oda', 'ODA found on PATH')
  assert(findDwgConverter('linux', { PATH: '/nonexistent' }, () => false) === null, 'none found')
  const forced = findDwgConverter('linux', {
    MEP_DWG_CONVERTER: join(bin, 'accoreconsole'),
    PATH: bin
  })
  assert(forced?.kind === 'autocad', 'MEP_DWG_CONVERTER takes precedence')
  const winCands = findDwgConverter('win32', { ProgramFiles: 'C:\\PF', PATH: '' }, () => false)
  assert(winCands === null, 'no Windows converters when nothing exists')
  // command lines
  const c = converterCommand({ kind: 'autocad', path: 'accoreconsole.exe' }, 'W', 'O')
  assert(
    c.args[0] === '/i' && c.args[2] === '/s' && (c.scriptText ?? '').includes('_.SAVEAS 2018'),
    'AutoCAD command + script'
  )
  console.log('✓ detection & command lines')

  // end-to-end with each stand-in converter
  for (const kind of ['oda', 'autocad', 'libredwg'] as const) {
    const exe = join(
      bin,
      kind === 'oda' ? 'ODAFileConverter' : kind === 'autocad' ? 'accoreconsole' : 'dxf2dwg'
    )
    const out = join(outDir, `${kind}.dwg`)
    const r = await exportDwg(DXF, out, { kind, path: exe })
    assert(r.ok && r.converter === kind && r.outputPath === out, `${kind}: ok (${r.error ?? ''})`)
    assert(
      existsSync(out) && readFileSync(out, 'latin1').startsWith('AC10'),
      `${kind}: DWG written`
    )
  }
  console.log('✓ ODA / AutoCAD / LibreDWG conversions')

  // failures
  const none = await exportDwg(DXF, join(outDir, 'x.dwg'), null)
  assert(
    !none.ok && /ODA File Converter/.test(none.error ?? ''),
    'helpful message without a converter'
  )
  const broken = await exportDwg(DXF, join(outDir, 'y.dwg'), {
    kind: 'oda',
    path: join(bin, 'broken-ODAFileConverter')
  })
  assert(
    !broken.ok &&
      /did not produce a DWG/.test(broken.error ?? '') &&
      !existsSync(join(outDir, 'y.dwg')),
    'converter without output reported'
  )
  const missing = await exportDwg(DXF, join(outDir, 'z.dwg'), {
    kind: 'oda',
    path: join(bin, 'does-not-exist')
  })
  assert(!missing.ok, 'missing executable reported')
  console.log('✓ failure handling')

  rmSync(bin, { recursive: true, force: true })
  rmSync(outDir, { recursive: true, force: true })
  console.log('\nAll DWG export tests passed.')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
