/**
 * HVAC design (project store zones) → BimModel. Drawing units are converted to millimetres
 * (imperial: units / scale × 304.8, metric: units / scale × 1000); everything is placed on one storey.
 */
import type { Diffuser, DuctSegment, Zone } from '../../store/projectStore'
import type { BimElement, BimModel, BimProfile, BimSystem, HvacBimOptions } from './bimTypes'

const IN = 25.4
const FT = 304.8

const SUPPLY: BimSystem = {
  id: 'SYS-HVAC-SUP',
  name: 'Supply air',
  kind: 'hvac-supply',
  ifcPredefinedType: 'AIRCONDITIONING',
  color: [0.2, 0.45, 0.95]
}
const RETURN: BimSystem = {
  id: 'SYS-HVAC-RET',
  name: 'Return air',
  kind: 'hvac-return',
  ifcPredefinedType: 'AIRCONDITIONING',
  color: [0.95, 0.5, 0.15]
}
const EQUIP: BimSystem = {
  id: 'SYS-HVAC-EQP',
  name: 'HVAC equipment',
  kind: 'hvac-equipment',
  ifcPredefinedType: 'AIRCONDITIONING',
  color: [0.3, 0.7, 0.35]
}

/** '12x12', '24 x 12', '12"x12"', '10' (round neck → square) → [w, h] inches. */
function parseSizeIn(label: string): [number, number] {
  const m = /(\d+(?:\.\d+)?)\s*(?:"|in)?\s*[x×X]\s*(\d+(?:\.\d+)?)/.exec(label)
  if (m) return [parseFloat(m[1]), parseFloat(m[2])]
  const r = /(\d+(?:\.\d+)?)/.exec(label)
  if (r) return [parseFloat(r[1]), parseFloat(r[1])]
  return [12, 12]
}

export function hvacBimModel(
  zones: Zone[],
  opts: HvacBimOptions & { projectName?: string; projectNumber?: string }
): BimModel {
  const warnings: string[] = []
  let scale = opts.scale
  if (!(scale > 0)) {
    warnings.push(
      `Drawing scale ${opts.scale} is not positive - 1 drawing unit per ${opts.units === 'imperial' ? 'foot' : 'metre'} assumed.`
    )
    scale = 1
  }
  const unitMm = opts.units === 'imperial' ? FT : 1000
  const toMm = (v: number): number => (v / scale) * unitMm
  const elev = opts.elevationMm
  const elements: BimElement[] = []
  const used = new Set<string>()
  const add = (el: Omit<BimElement, 'storeyId'>): void => {
    let key = el.key
    let n = 1
    while (used.has(key)) key = `${el.key}~${n++}`
    used.add(key)
    elements.push({ ...el, key, storeyId: opts.storeyId })
  }

  for (const zone of zones) {
    // ceiling height is stored in feet (imperial) or metres (metric)
    const ceilMm = opts.units === 'imperial' ? zone.ceilingHeight * FT : zone.ceilingHeight * 1000
    const zoneProps = { Zone: zone.name }

    // ── ducts: one segment per polyline leg
    for (const d of zone.ducts ?? []) {
      const round =
        d.shape === 'round' || (d.shape === 'flex' && !!d.diameterIn && d.diameterIn > 0)
      let profile: BimProfile
      if (round) {
        const dia =
          (d.diameterIn && d.diameterIn > 0 ? d.diameterIn : Math.max(d.widthIn, d.heightIn) || 8) *
          IN
        profile = { shape: 'circle', diameterMm: dia }
      } else {
        profile = {
          shape: 'rect',
          widthMm: (d.widthIn > 0 ? d.widthIn : 8) * IN,
          heightMm: (d.heightIn > 0 ? d.heightIn : 8) * IN
        }
      }
      const h = profile.shape === 'circle' ? profile.diameterMm : profile.heightMm
      const z = elev + ceilMm + 50 + h / 2
      const pts = d.points
      const sys = d.type === 'return' ? RETURN : SUPPLY
      let leg = 0
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const sx = toMm(pts[i])
        const sy = toMm(pts[i + 1])
        const ex = toMm(pts[i + 2])
        const ey = toMm(pts[i + 3])
        if (Math.hypot(ex - sx, ey - sy) < 1) continue
        leg++
        add({
          key: `duct|${zone.id}|${d.id}|${leg}`,
          tag: leg === 1 ? d.id : `${d.id}.${leg}`,
          name: `${round ? 'Round' : 'Rectangular'} duct ${ductSize(d, round)}`,
          ifcClass: 'IfcDuctSegment',
          predefinedType: 'RIGIDSEGMENT',
          systemId: sys.id,
          geometry: { kind: 'segment', start: [sx, sy, z], end: [ex, ey, z], profile },
          properties: {
            ...zoneProps,
            DuctType: d.type,
            Size: d.sizeLabel || ductSize(d, round),
            CFM: d.cfm,
            ...(d.velocityFpm !== undefined ? { VelocityFPM: d.velocityFpm } : {}),
            LengthMm: Math.round(Math.hypot(ex - sx, ey - sy))
          }
        })
      }
    }

    // ── terminals
    for (const df of zone.diffusers ?? []) addTerminal(df, zone, ceilMm, add, toMm, elev)

    // ── indoor / outdoor units
    const indoor =
      zone.unitPositions && zone.unitPositions.length > 0
        ? zone.unitPositions
        : zone.unitPos
          ? [zone.unitPos]
          : []
    indoor.forEach((p, i) => {
      const u = indoorUnit(zone.systemType)
      add({
        key: `ahu|${zone.id}|${i}`,
        tag: `IU-${zone.id}-${i + 1}`,
        name: `${u.label} ${zone.name}`,
        ifcClass: 'IfcUnitaryEquipment',
        predefinedType: u.type,
        systemId: EQUIP.id,
        geometry: {
          kind: 'box',
          origin: [toMm(p.x), toMm(p.y), elev + u.base(ceilMm)],
          sizeMm: u.size,
          rotationDeg: 0
        },
        properties: {
          ...zoneProps,
          SystemType: zone.systemType ?? 'concealed',
          ...(zone.catalogModel ? { Model: zone.catalogModel } : {})
        }
      })
    })
    const outdoor =
      zone.outdoorUnitPositions && zone.outdoorUnitPositions.length > 0
        ? zone.outdoorUnitPositions
        : zone.outdoorUnitPos
          ? [zone.outdoorUnitPos]
          : []
    outdoor.forEach((p, i) => {
      add({
        key: `odu|${zone.id}|${i}`,
        tag: `OU-${zone.id}-${i + 1}`,
        name: `Outdoor unit ${zone.name}`,
        ifcClass: 'IfcUnitaryEquipment',
        predefinedType: 'SPLITSYSTEM',
        systemId: EQUIP.id,
        geometry: {
          kind: 'box',
          origin: [toMm(p.x), toMm(p.y), elev],
          sizeMm: [1000, 400, 800],
          rotationDeg: 0
        },
        properties: { ...zoneProps, ...(zone.catalogModel ? { Model: zone.catalogModel } : {}) }
      })
    })
  }

  const usedSystems = [SUPPLY, RETURN, EQUIP].filter((s) =>
    elements.some((e) => e.systemId === s.id)
  )
  return {
    projectName: opts.projectName ?? 'HVAC project',
    projectNumber: opts.projectNumber ?? '',
    discipline: 'HVAC',
    storeys: [{ id: opts.storeyId, name: opts.storeyName, elevationMm: elev }],
    systems: usedSystems.map((s) => ({ ...s })),
    elements,
    warnings
  }
}

function ductSize(d: DuctSegment, round: boolean): string {
  return round ? `${d.diameterIn ?? d.widthIn}"` : `${d.widthIn}x${d.heightIn}`
}

function indoorUnit(type: Zone['systemType']): {
  type: string
  label: string
  size: [number, number, number]
  base: (ceilMm: number) => number
} {
  switch (type) {
    case 'cassette':
      return {
        type: 'AIRCONDITIONINGUNIT',
        label: 'Ceiling cassette',
        size: [840, 840, 300],
        base: (c) => c
      }
    case 'high-wall':
      return {
        type: 'AIRCONDITIONINGUNIT',
        label: 'High-wall unit',
        size: [1000, 250, 300],
        base: () => 2400
      }
    case 'packaged':
      return {
        type: 'ROOFTOPUNIT',
        label: 'Packaged unit',
        size: [2000, 1000, 1000],
        base: () => 0
      }
    case 'ahu':
      return {
        type: 'ROOFTOPUNIT',
        label: 'Air handling unit',
        size: [2400, 1200, 1200],
        base: () => 0
      }
    case 'fcu':
    case 'vrf':
    case 'concealed':
    default:
      return {
        type: 'AIRHANDLER',
        label: type === 'fcu' ? 'Fan coil unit' : 'Concealed unit',
        size: [1200, 600, 300],
        base: (c) => c + 50
      }
  }
}

function addTerminal(
  df: Diffuser,
  zone: Zone,
  ceilMm: number,
  add: (el: Omit<BimElement, 'storeyId'>) => void,
  toMm: (v: number) => number,
  elev: number
): void {
  const isReturn = df.type === 'return' || df.type === 'exhaust'
  const [w, h] = parseSizeIn(df.size ?? '')
  add({
    key: `term|${zone.id}|${df.id}`,
    tag: df.id,
    name: `${isReturn ? 'Return grille' : 'Supply diffuser'} ${df.size ?? ''}`.trim(),
    ifcClass: 'IfcAirTerminal',
    predefinedType: isReturn ? 'GRILLE' : 'DIFFUSER',
    systemId: isReturn ? RETURN.id : SUPPLY.id,
    geometry: {
      kind: 'box',
      origin: [toMm(df.x), toMm(df.y), elev + ceilMm - 250],
      sizeMm: [w * IN, h * IN, 250],
      rotationDeg: 0
    },
    properties: {
      Zone: zone.name,
      TerminalType: df.type ?? 'supply',
      Size: df.size ?? '',
      CFM: df.cfm,
      ...(df.actualNc !== undefined ? { NC: df.actualNc } : {}),
      ...(df.throwT50Ft !== undefined ? { ThrowT50Ft: df.throwT50Ft } : {})
    }
  })
}
