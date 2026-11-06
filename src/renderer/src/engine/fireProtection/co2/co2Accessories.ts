/** Accessories and bill of materials for the NFPA 12 CO2 system (preliminary — final list by the manufacturer). */
import type { Co2Accessory, Co2BomLine, Co2DesignInput, Co2DeviceKind, Co2SystemDesign } from './co2Types'
import { CO2_REFERENCE_DESIGN } from './nfpa12'

export function buildCo2Accessories(input: Co2DesignInput, d: Co2SystemDesign): Co2Accessory[] {
  const a = input.answers
  const out: Co2Accessory[] = []
  const add = (item: string, qty: number, location: string, sizeIn: number | null = null): void => {
    if (qty <= 0) return
    out.push({ tag: `CA-${String(out.length + 1).padStart(2, '0')}`, item, qty, sizeIn, location, reference: CO2_REFERENCE_DESIGN })
  }
  const st = d.storage
  const hp = st.storage === 'high-pressure'
  const cyl = st.mainCylinders + st.reserveCylinders
  const devs = d.floors.flatMap((f) => f.devices)
  const count = (k: Co2DeviceKind): number => devs.filter((x) => x.kind === k).length
  const nEnc = d.floors.reduce((s, f) => s + f.enclosures.length, 0)
  if (hp) {
    add(`CO2 cylinder, ${st.cylinderLb} lb net, with valve (main ${st.mainCylinders} + reserve ${st.reserveCylinders})`, cyl, 'CO2 storage room')
    add('Cylinder valve and discharge head (pressure-operated)', cyl, 'On each cylinder')
    add('Pilot cylinder / electric actuator', Math.max(1, d.floors.length), 'Cylinder bank')
    add('Flexible discharge hose', cyl, 'Cylinder to manifold')
    add('Check valve', cyl, 'Cylinder to manifold')
    add('Discharge manifold', st.reserveCylinders > 0 ? 2 : 1, 'CO2 storage room')
  } else {
    add(`Low-pressure CO2 storage tank, ${st.tankTons ?? 0} ton, refrigerated, with vapor-pressure gauge and supervision`, 1, 'CO2 storage area')
    add('Flexible discharge hose', 1, 'Tank to manifold')
    add('Check valve', st.reserveLb > 0 ? 2 : 1, 'Tank discharge')
    add('Discharge manifold', 1, 'CO2 storage area')
  }
  add('Manifold safety relief (pressure relief device)', 1, 'Discharge manifold')
  add('Selector (directional) valve', d.floors.reduce((s, f) => s + (f.enclosures.length > 1 ? f.enclosures.length : 0), 0), 'Branch to each enclosure')
  add('Lockout valve (supervised)', Math.max(1, count('lockout-valve')), 'Main discharge pipe')
  add('Pressure-operated time delay', Math.max(1, nEnc), 'Before each enclosure')
  add('Pressure switch', Math.max(1, count('pressure-switch')), 'Main discharge pipe')
  if (a.odorizer) add('Odorizer', 1, 'Main discharge pipe')
  if (a.reserve) add('Main / reserve transfer switch', 1, 'Manifold')
  const noz = new Map<number, number>()
  for (const f of d.floors) for (const e of f.enclosures) for (const n of e.nozzles) noz.set(n.orificeCode, (noz.get(n.orificeCode) ?? 0) + 1)
  for (const [code, q] of [...noz].sort((x, y) => x[0] - y[0])) add(`Discharge nozzle, orifice code ${code}`, q, 'Protected enclosures')
  add('CO2 releasing control panel (NFPA 72)', Math.max(1, count('control-panel')), 'Fire alarm panel room')
  add('Smoke detector', count('smoke-detector'), 'Protected enclosures')
  add('Heat detector', count('heat-detector'), 'Protected enclosures')
  add('Horn / strobe', count('horn-strobe'), 'Inside enclosures')
  add('Strobe (outside, discharge in progress)', count('strobe-outside'), 'Outside entrances')
  add('Manual release station', count('manual-release'), 'Outside entrances')
  add('Mechanical manual release', Math.max(1, d.floors.length), 'CO2 storage')
  add('Warning sign (NFPA 12)', count('warning-sign'), 'Inside, entrances and storage')
  add('Pressure relief vent', count('pressure-relief-vent'), 'Protected enclosures')
  if (hp) add('Cylinder weighing device', cyl, 'Cylinder bank')
  return out
}

export function buildCo2Bom(input: Co2DesignInput, d: Co2SystemDesign): Co2BomLine[] {
  const out: Co2BomLine[] = []
  const pipe = new Map<string, number>()
  for (const f of d.floors) for (const p of f.pipes) {
    const key = `${p.sizeIn}" ${p.schedule === 'sch80' ? 'Sch 80' : 'Sch 40'}`
    pipe.set(key, (pipe.get(key) ?? 0) + p.lengthM)
  }
  for (const [size, m] of pipe) out.push({ item: 'CO2 discharge pipe, seamless steel', size, qty: Math.round(m * 100) / 100, unit: 'm' })
  const noz = new Map<number, number>()
  for (const f of d.floors) for (const e of f.enclosures) for (const n of e.nozzles) noz.set(n.orificeCode, (noz.get(n.orificeCode) ?? 0) + 1)
  for (const [code, q] of [...noz].sort((x, y) => x[0] - y[0])) out.push({ item: 'CO2 discharge nozzle', size: `orifice code ${code}`, qty: q, unit: 'ea' })
  const st = d.storage
  if (st.storage === 'high-pressure') out.push({ item: 'CO2 cylinder with valve', size: `${st.cylinderLb} lb`, qty: st.mainCylinders + st.reserveCylinders, unit: 'ea' })
  else out.push({ item: 'Low-pressure CO2 storage tank', size: `${st.tankTons ?? 0} ton`, qty: 1, unit: 'ea' })
  const devs = d.floors.flatMap((f) => f.devices)
  const kinds: [Co2DeviceKind, string][] = [
    ['smoke-detector', 'Smoke detector'], ['heat-detector', 'Heat detector'], ['horn-strobe', 'Horn / strobe'],
    ['strobe-outside', 'Strobe (outside)'], ['manual-release', 'Manual release station'], ['warning-sign', 'Warning sign'],
    ['lockout-valve', 'Lockout valve'], ['selector-valve', 'Selector valve'], ['pressure-switch', 'Pressure switch'],
    ['pressure-relief-vent', 'Pressure relief vent'], ['control-panel', 'CO2 releasing control panel']
  ]
  for (const [k, label] of kinds) {
    const n = devs.filter((x) => x.kind === k).length
    if (n) out.push({ item: label, size: '-', qty: n, unit: 'ea' })
  }
  void input
  return out
}
