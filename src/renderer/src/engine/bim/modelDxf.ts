/**
 * Model-space link DXF (AutoCAD R12) of one storey of a BimModel: plan projection at true project coordinates
 * (millimetres, $INSUNITS 4), no sheet frame / title block, NCS-style layers. Linked into Revit with
 * Insert > Link CAD, positioning "Auto - Origin to Origin".
 */
import { DrawingBuilder } from '../fireProtection/drawing/drawingBuilder'
import { writeDxf } from '../fireProtection/drawing/dxfWriter'
import type { LayerDef, Linetype } from '../fireProtection/drawing/drawingTypes'
import type { BimElement, BimModel, BimSystemKind } from './bimTypes'

const L = (
  name: string,
  color: number,
  description: string,
  linetype: Linetype = 'CONTINUOUS',
  lineweightMm = 0.25
): LayerDef => ({
  name,
  color,
  linetype,
  lineweightMm,
  description
})

export const MODEL_LAYERS: LayerDef[] = [
  L('FP-SPRK-PIPE', 1, 'Sprinkler piping', 'CONTINUOUS', 0.35),
  L('FP-SPRK-HEAD', 1, 'Sprinkler heads'),
  L('FP-SPRK-VALV', 2, 'Sprinkler valves'),
  L('FP-STND-PIPE', 1, 'Standpipe risers and mains', 'CONTINUOUS', 0.5),
  L('FP-STND-VALV', 2, 'Hose valves and standpipe valves'),
  L('FP-PUMP-EQPM', 3, 'Fire pump room equipment, tank'),
  L('FP-PUMP-PIPE', 1, 'Fire pump room piping', 'CONTINUOUS', 0.5),
  L('FP-CO2-PIPE', 4, 'CO2 piping', 'CONTINUOUS', 0.35),
  L('FP-CO2-NOZZ', 4, 'CO2 nozzles'),
  L('FP-CO2-EQPM', 4, 'CO2 cylinders and valves'),
  L('FP-EXTG', 6, 'Portable fire extinguishers'),
  L('FA-DEVC', 6, 'Detection and alarm devices'),
  L('FP-ANNO', 7, 'Fire protection text and tags'),
  L('M-DUCT-SUPP', 5, 'Supply ductwork', 'CONTINUOUS', 0.35),
  L('M-DUCT-RETN', 30, 'Return ductwork', 'CONTINUOUS', 0.35),
  L('M-HVAC-DIFF', 3, 'Diffusers and grilles'),
  L('M-HVAC-EQPM', 3, 'HVAC equipment', 'CONTINUOUS', 0.35),
  L('M-ANNO', 7, 'HVAC text and tags')
]

function layerOf(el: BimElement, kind: BimSystemKind | undefined): string {
  const pipe = el.ifcClass === 'IfcPipeSegment' || el.ifcClass === 'IfcPipeFitting'
  const duct = el.ifcClass === 'IfcDuctSegment' || el.ifcClass === 'IfcDuctFitting'
  const valve = el.ifcClass === 'IfcValve'
  switch (kind) {
    case 'fire-sprinkler':
      return pipe ? 'FP-SPRK-PIPE' : valve ? 'FP-SPRK-VALV' : 'FP-SPRK-HEAD'
    case 'fire-standpipe':
      return pipe ? 'FP-STND-PIPE' : 'FP-STND-VALV'
    case 'fire-pump':
      return pipe ? 'FP-PUMP-PIPE' : 'FP-PUMP-EQPM'
    case 'fire-co2':
      return pipe ? 'FP-CO2-PIPE' : el.objectType === 'CO2NOZZLE' ? 'FP-CO2-NOZZ' : 'FP-CO2-EQPM'
    case 'fire-extinguisher':
      return 'FP-EXTG'
    case 'fire-alarm':
      return 'FA-DEVC'
    case 'hvac-supply':
    case 'hvac-outdoor-air':
      return el.ifcClass === 'IfcAirTerminal' ? 'M-HVAC-DIFF' : duct ? 'M-DUCT-SUPP' : 'M-HVAC-EQPM'
    case 'hvac-return':
      return el.ifcClass === 'IfcAirTerminal' ? 'M-HVAC-DIFF' : duct ? 'M-DUCT-RETN' : 'M-HVAC-EQPM'
    case 'hvac-equipment':
    default:
      return 'M-HVAC-EQPM'
  }
}

const annoLayer = (layer: string): string => (layer.startsWith('M-') ? 'M-ANNO' : 'FP-ANNO')

/** Text kept readable: rotation folded into (-90, 90]. */
function readableAngle(dx: number, dy: number): number {
  let a = (Math.atan2(dy, dx) * 180) / Math.PI
  if (a > 90) a -= 180
  if (a <= -90) a += 180
  return a
}

function sizeText(el: BimElement): string {
  const p = el.properties
  if (typeof p.Size === 'string' && p.Size) return p.Size
  if (typeof p.NominalSize === 'string' && p.NominalSize) return p.NominalSize
  const g = el.geometry
  if (g.kind === 'segment') {
    return g.profile.shape === 'circle'
      ? `%%c${Math.round(g.profile.diameterMm * 10) / 10}`
      : `${Math.round(g.profile.widthMm)}x${Math.round(g.profile.heightMm)}`
  }
  return ''
}

export function writeModelDxf(model: BimModel, storeyId: string): string {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) throw new Error(`writeModelDxf: unknown storey ${storeyId}`)
  const b = new DrawingBuilder(
    `${model.projectName} - ${storey.name} (${model.discipline})`,
    MODEL_LAYERS
  )
  b.scale = 1 // model space, text heights in mm
  const kindOf = new Map(model.systems.map((s) => [s.id, s.kind] as const))
  const TEXT = 80

  for (const el of model.elements) {
    const g = el.geometry
    const layer = layerOf(el, kindOf.get(el.systemId))
    const anno = annoLayer(layer)
    if (g.kind === 'segment') {
      const dx = g.end[0] - g.start[0]
      const dy = g.end[1] - g.start[1]
      const run = Math.hypot(dx, dy)
      const zLo = Math.min(g.start[2], g.end[2])
      const zHi = Math.max(g.start[2], g.end[2])
      if (run < 1e-6) {
        // vertical element: shown on its own storey and on every storey it passes through
        const here =
          el.storeyId === storeyId ||
          (storey.elevationMm >= zLo - 1 && storey.elevationMm <= zHi + 1)
        if (!here) continue
        const r =
          g.profile.shape === 'circle'
            ? g.profile.diameterMm / 2
            : Math.max(g.profile.widthMm, g.profile.heightMm) / 2
        b.circle(layer, g.start[0], g.start[1], Math.max(r, 40))
        b.text(anno, g.start[0] + Math.max(r, 40) + 40, g.start[1], TEXT, el.tag, {
          vAlign: 'middle'
        })
        continue
      }
      if (el.storeyId !== storeyId) continue
      const ux = dx / run
      const uy = dy / run
      if (g.profile.shape === 'rect' || layer.startsWith('M-')) {
        const half = (g.profile.shape === 'rect' ? g.profile.widthMm : g.profile.diameterMm) / 2
        const nx = -uy * half
        const ny = ux * half
        b.polyline(
          layer,
          [
            [g.start[0] + nx, g.start[1] + ny],
            [g.end[0] + nx, g.end[1] + ny],
            [g.end[0] - nx, g.end[1] - ny],
            [g.start[0] - nx, g.start[1] - ny]
          ],
          true
        )
      } else {
        b.line(layer, g.start[0], g.start[1], g.end[0], g.end[1])
      }
      if (run > 500) {
        const label = sizeText(el)
        if (label) {
          const off =
            (g.profile.shape === 'rect' ? g.profile.widthMm : g.profile.diameterMm) / 2 + 40
          b.text(
            anno,
            (g.start[0] + g.end[0]) / 2 - uy * off,
            (g.start[1] + g.end[1]) / 2 + ux * off,
            TEXT,
            label,
            {
              rotationDeg: readableAngle(dx, dy),
              align: 'center',
              vAlign: 'bottom'
            }
          )
        }
      }
      continue
    }
    if (el.storeyId !== storeyId) continue
    if (g.kind === 'box') {
      const a = (g.rotationDeg * Math.PI) / 180
      const c = Math.cos(a)
      const s = Math.sin(a)
      const hx = g.sizeMm[0] / 2
      const hy = g.sizeMm[1] / 2
      const corner = (lx: number, ly: number): [number, number] => [
        g.origin[0] + lx * c - ly * s,
        g.origin[1] + lx * s + ly * c
      ]
      b.polyline(layer, [corner(-hx, -hy), corner(hx, -hy), corner(hx, hy), corner(-hx, hy)], true)
      b.text(anno, g.origin[0], g.origin[1], TEXT, el.tag, {
        align: 'center',
        vAlign: 'middle',
        rotationDeg: readableAngle(c, s)
      })
    } else {
      const r = Math.max(g.diameterMm / 2, 75)
      b.circle(layer, g.base[0], g.base[1], r)
      b.text(anno, g.base[0] + r + 40, g.base[1], TEXT, el.tag, { vAlign: 'middle' })
    }
  }

  const dxf = writeDxf(b.build([]))
  // R12 has no $INSUNITS; AutoCAD / Revit CAD link read it when present: 4 = millimetres
  const marker = '  9\r\n$EXTMIN'
  const at = dxf.indexOf(marker)
  if (at < 0) throw new Error('writeModelDxf: DXF header layout changed ($EXTMIN not found)')
  return `${dxf.slice(0, at)}  9\r\n$INSUNITS\r\n 70\r\n     4\r\n${dxf.slice(at)}`
}
