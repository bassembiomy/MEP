/**
 * Sprinkler system accessories per system type, spare sprinkler cabinet and bill of materials (NFPA 13-2019).
 */
import type {
  SprinklerAccessory,
  SprinklerAnswers,
  SprinklerBomLine,
  SprinklerFloorDesign,
  SprinklerHeadType,
  SprinklerSystemType
} from './sprinklerTypes'
import { spareHeadCount } from './nfpa13Sprinkler'
import { formatPipeSize } from '../standards/pipeData'

type AccDef = Omit<SprinklerAccessory, 'tag'>

const MATERIAL_LABEL: Record<SprinklerAnswers['pipeMaterial'], string> = {
  'black-steel-sch40': 'Black steel pipe',
  'black-steel-sch10': 'Black steel pipe',
  'galvanized-steel-sch40': 'Galvanized steel pipe',
  cpvc: 'CPVC pipe',
  'copper-type-l': 'Copper tube type L'
}

/** Accessories for the whole building, tagged SA-01… in order. */
export function buildAccessories(
  floors: SprinklerFloorDesign[],
  headTypes: SprinklerHeadType[]
): SprinklerAccessory[] {
  const defs: AccDef[] = []
  const add = (
    item: string,
    qty: number,
    sizeIn: number | null,
    location: string,
    systemType: SprinklerSystemType | 'all',
    reference: string
  ): void => {
    if (qty > 0) defs.push({ item, qty, sizeIn, location, systemType, reference })
  }
  if (floors.length === 0) return []
  const typeById = new Map(headTypes.map((t) => [t.id, t]))
  // every zone: zone (floor) control assembly; every floor: inspector's test, auxiliary drains
  const bySize = new Map<number, string[]>()
  for (const f of floors) {
    for (const z of f.zones) {
      const s = f.pipes.find((p) => p.kind === 'riser-nipple' && p.zoneId === z.zoneId)?.sizeIn ?? 2
      bySize.set(s, [
        ...(bySize.get(s) ?? []),
        f.zones.length > 1 ? `${f.floorName} / ${z.zoneId}` : f.floorName
      ])
    }
  }
  for (const [size, where] of [...bySize.entries()].sort((a, b) => a[0] - b[0])) {
    add(
      `Floor control assembly (supervised butterfly / OS&Y valve with tamper switch, waterflow switch, test & drain with sight glass, pressure gauge) ${formatPipeSize(size)}`,
      where.length,
      size,
      where.join(', '),
      'all',
      'NFPA 13-2019 §16.9.1, §16.9.3, §16.10.4, §16.13'
    )
  }
  const byK = new Map<number, SprinklerFloorDesign[]>()
  for (const f of floors) {
    if (f.systemType === 'deluge' || f.heads.length === 0) continue
    const k = Math.min(...f.heads.map((h) => typeById.get(h.headTypeId)?.kFactor ?? 5.6))
    byK.set(k, [...(byK.get(k) ?? []), f])
  }
  for (const [k, fs] of [...byK.entries()].sort((a, b) => a[0] - b[0])) {
    add(
      `Inspector's test connection 1" with K${k} orifice at the most remote point`,
      fs.length,
      1,
      fs.map((f) => f.floorName).join(', '),
      'all',
      'NFPA 13-2019 §16.14.2'
    )
  }
  add(
    'Auxiliary drain valve with cap / plug at trapped sections',
    floors.length,
    0.75,
    'Each floor, low points of the piping',
    'all',
    'NFPA 13-2019 §16.10.5'
  )

  const wet = floors.filter((f) => f.systemType === 'wet')
  if (wet.length > 0) {
    add(
      'Alarm check valve with retard chamber',
      1,
      6,
      'Building riser, sprinkler valve room',
      'wet',
      'NFPA 13-2019 §8.2.1, §16.9.2'
    )
    add(
      'Water-motor gong / electric bell (local waterflow alarm)',
      1,
      0.75,
      'Outside, near the alarm check valve',
      'wet',
      'NFPA 13-2019 §8.17.1, §8.17.2'
    )
    add(
      'Pressure switch (waterflow alarm)',
      1,
      0.5,
      'Alarm check valve trim',
      'wet',
      'NFPA 13-2019 §8.17.1.1; NFPA 72'
    )
    add(
      'Main drain 2" with sight glass / discharge to drain',
      1,
      2,
      'Building riser',
      'wet',
      'NFPA 13-2019 §16.10.4'
    )
    add(
      'Pressure gauges (above and below the alarm check valve)',
      2,
      0.5,
      'Alarm check valve trim',
      'wet',
      'NFPA 13-2019 §16.13'
    )
    add(
      'Automatic air vent',
      1,
      0.5,
      'Highest point of the wet piping',
      'wet',
      'NFPA 13-2019 §16.7'
    )
  }
  const countOf = (t: SprinklerSystemType): SprinklerFloorDesign[] =>
    floors.filter((f) => f.systemType === t)
  const dry = countOf('dry')
  if (dry.length > 0) {
    add(
      'Dry-pipe valve with trim',
      dry.length,
      4,
      dry.map((f) => f.floorName).join(', '),
      'dry',
      'NFPA 13-2019 §8.2.3, §16.9.4'
    )
    add(
      'Air compressor / air-maintenance device',
      dry.length,
      0.5,
      'Valve room',
      'dry',
      'NFPA 13-2019 §8.2.5, §7.2.2'
    )
    add(
      'Low-air supervisory pressure switch',
      dry.length,
      0.5,
      'Dry-pipe valve trim',
      'dry',
      'NFPA 13-2019 §8.2.5.4; NFPA 72'
    )
    const accel = dry.filter((f) => f.volumeGal > 500)
    add(
      'Accelerator (quick-opening device)',
      accel.length,
      0.5,
      accel.map((f) => f.floorName).join(', '),
      'dry',
      'NFPA 13-2019 §8.2.3.3'
    )
    add(
      'Heated valve enclosure maintained at 4 °C or above',
      dry.length,
      null,
      'Dry-pipe valve room',
      'dry',
      'NFPA 13-2019 §8.2.5.2'
    )
    add(
      'Auxiliary drum drip at low points',
      dry.reduce(
        (s, f) =>
          s + Math.max(1, Math.ceil(f.pipes.filter((p) => p.kind === 'cross-main').length / 4)),
        0
      ),
      1,
      'Low points of the dry piping',
      'dry',
      'NFPA 13-2019 §16.10.3'
    )
  }
  for (const t of ['preaction-single', 'preaction-double'] as const) {
    const fs = countOf(t)
    if (fs.length === 0) continue
    const names = fs.map((f) => f.floorName).join(', ')
    const dbl = t === 'preaction-double'
    add(
      `Preaction valve with trim (${dbl ? 'double' : 'single'} interlock)`,
      fs.length,
      4,
      names,
      t,
      'NFPA 13-2019 §8.3.2, §16.9.5'
    )
    add('Solenoid release valve', fs.length, 0.5, names, t, 'NFPA 13-2019 §8.3.2; NFPA 72')
    add('Releasing control panel (NFPA 72)', fs.length, null, names, t, 'NFPA 72-2019 §21.2')
    add(
      'Smoke / heat detection system',
      fs.length,
      null,
      'Protected areas',
      t,
      'NFPA 13-2019 §8.3.2.3; NFPA 72'
    )
    add(
      'Supervisory air (air-maintenance device)',
      fs.length,
      0.5,
      names,
      t,
      'NFPA 13-2019 §8.3.2.5'
    )
    if (dbl)
      add(
        'Low-air supervisory switch and detection interlock',
        fs.length,
        0.5,
        names,
        t,
        'NFPA 13-2019 §8.3.2.1.2'
      )
  }
  const del = countOf('deluge')
  if (del.length > 0) {
    const names = del.map((f) => f.floorName).join(', ')
    add('Deluge valve with trim', del.length, 4, names, 'deluge', 'NFPA 13-2019 §8.3.3, §16.9.6')
    add('Solenoid release valve', del.length, 0.5, names, 'deluge', 'NFPA 13-2019 §8.3.3; NFPA 72')
    add(
      'Releasing control panel (NFPA 72)',
      del.length,
      null,
      names,
      'deluge',
      'NFPA 72-2019 §21.2'
    )
    add(
      'Heat / flame detection system',
      del.length,
      null,
      'Protected areas',
      'deluge',
      'NFPA 13-2019 §8.3.3.2'
    )
    add(
      'Manual release station (pull station)',
      del.length,
      null,
      'Exit of the protected area',
      'deluge',
      'NFPA 13-2019 §8.3.3.4'
    )
    add(
      'Strainer upstream of the deluge valve',
      del.length,
      4,
      names,
      'deluge',
      'NFPA 13-2019 §7.2.3, §16.9.6'
    )
  }

  add(
    'Fire department connection 2-way 2½" with check valve and ball drip',
    1,
    2.5,
    'Building exterior, accessible to fire apparatus',
    'all',
    'NFPA 13-2019 §16.12, NFPA 13 §8.17'
  )

  // spare cabinet
  const totalHeads = floors.reduce((s, f) => s + f.heads.length, 0)
  const spares = spareSprinklers(floors)
  const sparesText = spares.map((s) => `${s.qty} × ${s.headTypeId}`).join(', ')
  add(
    `Spare sprinkler cabinet with ${spareHeadCount(totalHeads)} spare sprinklers (${sparesText}) and sprinkler wrench`,
    1,
    null,
    'Sprinkler valve room',
    'all',
    'NFPA 13-2019 §16.2.7'
  )

  return defs.map((d, i) => ({ tag: `SA-${String(i + 1).padStart(2, '0')}`, ...d }))
}

/** Spare sprinklers per head type: total spareHeadCount, distributed proportionally with at least 2 of each type. */
export function spareSprinklers(
  floors: SprinklerFloorDesign[]
): { headTypeId: string; qty: number }[] {
  const counts = new Map<string, number>()
  let total = 0
  for (const f of floors) {
    for (const h of f.heads) {
      counts.set(h.headTypeId, (counts.get(h.headTypeId) ?? 0) + 1)
      total++
    }
  }
  if (total === 0) return []
  const target = spareHeadCount(total)
  const ids = [...counts.keys()]
  const out = ids.map((id) => {
    const share = (target * counts.get(id)!) / total
    return { headTypeId: id, qty: Math.max(2, Math.floor(share)), rem: share - Math.floor(share) }
  })
  let sum = out.reduce((s, o) => s + o.qty, 0)
  while (sum < target) {
    const o = [...out].sort((a, b) => b.rem - a.rem)[0]
    o.qty++
    o.rem = -1
    sum++
  }
  while (sum > target) {
    const o = [...out].filter((x) => x.qty > 2).sort((a, b) => b.qty - a.qty)[0]
    if (!o) break
    o.qty--
    sum--
  }
  return out.map((o) => ({ headTypeId: o.headTypeId, qty: o.qty }))
}

/** Bill of materials: heads, pipe by size and schedule (m), hangers by size, one line per accessory. */
export function buildBom(
  floors: SprinklerFloorDesign[],
  headTypes: SprinklerHeadType[],
  accessories: SprinklerAccessory[],
  answers: SprinklerAnswers
): SprinklerBomLine[] {
  const bom: SprinklerBomLine[] = []
  const headCount = new Map<string, number>()
  const pipeM = new Map<string, number>()
  const hangers = new Map<number, number>()
  for (const f of floors) {
    for (const h of f.heads) headCount.set(h.headTypeId, (headCount.get(h.headTypeId) ?? 0) + 1)
    for (const p of f.pipes) {
      const key = `${p.sizeIn}|${p.schedule}`
      pipeM.set(key, (pipeM.get(key) ?? 0) + p.lengthM)
    }
    const sizeOf = new Map(f.pipes.map((p) => [p.id, p.sizeIn]))
    for (const hg of f.hangers) {
      const s = sizeOf.get(hg.pipeId) ?? 1
      hangers.set(s, (hangers.get(s) ?? 0) + 1)
    }
  }
  for (const t of headTypes) {
    const n = headCount.get(t.id)
    if (n)
      bom.push({
        item: `Sprinkler ${t.id} — ${t.description}`,
        size: `K${t.kFactor}`,
        qty: n,
        unit: 'ea'
      })
  }
  const keys = [...pipeM.keys()].sort(
    (a, b) => Number(a.split('|')[0]) - Number(b.split('|')[0]) || a.localeCompare(b)
  )
  for (const k of keys) {
    const [size, sch] = k.split('|')
    bom.push({
      item: `${MATERIAL_LABEL[answers.pipeMaterial]}${answers.pipeMaterial === 'cpvc' || answers.pipeMaterial === 'copper-type-l' ? '' : ` ${sch === 'sch10' ? 'Sch 10' : 'Sch 40'}`}`,
      size: formatPipeSize(Number(size)),
      qty: Math.round(pipeM.get(k)! * 10) / 10,
      unit: 'm'
    })
  }
  for (const [s, n] of [...hangers.entries()].sort((a, b) => a[0] - b[0])) {
    bom.push({ item: 'Pipe hanger', size: formatPipeSize(s), qty: n, unit: 'ea' })
  }
  for (const a of accessories) {
    bom.push({
      item: `${a.tag} ${a.item}`,
      size: a.sizeIn ? formatPipeSize(a.sizeIn) : '—',
      qty: a.qty,
      unit: 'ea'
    })
  }
  return bom
}
