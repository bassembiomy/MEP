/**
 * R1 — BIM export for Revit: discipline-neutral model, IFC4 writer, fire-protection & HVAC adapters, model-space DXF
 * per storey (true coordinates), clash detection. External validation: python3 scripts/validate_ifc.py <file>.
 */
import { writeIfc } from '../bim/ifcWriter';
import { fireBimModel } from '../bim/fireBim';
import { hvacBimModel } from '../bim/hvacBim';
import { writeModelDxf } from '../bim/modelDxf';
import { detectClashes, mergeBimModels } from '../bim/bimModel';
import { BimModel } from '../bim/bimTypes';
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT } from '../fireProtection/defaults';
import { defaultSprinklerAnswers } from '../fireProtection/sprinkler/nfpa13Sprinkler';
import { defaultCo2Answers, co2EnclosureFromRoom } from '../fireProtection/co2/nfpa12';
import { OFFICE_POLYGON } from './sprinklerSamplePlan';
import { Zone } from '../../store/projectStore';
import { mkdirSync, writeFileSync } from 'fs';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`Assertion Failed: ${m}`);
}
const near = (a: number, e: number, tol: number, m: string): void => assert(Math.abs(a - e) <= tol, `${m}: expected ${e}±${tol}, got ${a}`);
const count = (ifc: string, cls: string): number => (ifc.match(new RegExp(`=${cls}\\(`, 'g')) ?? []).length;

console.log('=== R1: BIM / Revit export ===');
// ── 1. IFC writer on a hand-made model
{
  const m: BimModel = {
    projectName: 'Test', projectNumber: 'P-1', discipline: 'Fire Protection',
    storeys: [{ id: 'GF', name: 'Ground Floor', elevationMm: 0 }, { id: 'L1', name: 'Level 1', elevationMm: 4500 }],
    systems: [{ id: 'SYS-1', name: 'Sprinklers L1', kind: 'fire-sprinkler', ifcPredefinedType: 'FIREPROTECTION', color: [1, 0, 0] }],
    elements: [
      { key: 'P1', tag: 'P1', name: 'Pipe 2"', ifcClass: 'IfcPipeSegment', predefinedType: 'RIGIDSEGMENT', storeyId: 'L1', systemId: 'SYS-1', geometry: { kind: 'segment', start: [0, 0, 7200], end: [4000, 0, 7200], profile: { shape: 'circle', diameterMm: 60.3 } }, properties: { Size: '2"', LengthM: 4 } },
      { key: 'S1', tag: 'S-L1-001', name: 'Sprinkler', ifcClass: 'IfcFireSuppressionTerminal', predefinedType: 'SPRINKLER', storeyId: 'L1', systemId: 'SYS-1', geometry: { kind: 'cylinder', base: [4000, 0, 7340], diameterMm: 50, heightMm: 60 }, properties: { KFactor: 5.6 } },
      { key: 'V1', tag: 'V1', name: 'Valve', ifcClass: 'IfcValve', predefinedType: 'ISOLATING', storeyId: 'GF', systemId: 'SYS-1', geometry: { kind: 'box', origin: [0, 0, 1000], sizeMm: [300, 200, 250], rotationDeg: 30 }, properties: {} }
    ],
    warnings: []
  };
  const ifc = writeIfc(m, { timestamp: '2026-11-07T00:00:00' });
  assert(ifc.startsWith('ISO-10303-21;') && ifc.includes("FILE_SCHEMA(('IFC4'))") && ifc.trimEnd().endsWith('END-ISO-10303-21;'), 'STEP header / schema / trailer');
  assert(count(ifc, 'IFCPROJECT') === 1 && count(ifc, 'IFCSITE') === 1 && count(ifc, 'IFCBUILDING') === 1 && count(ifc, 'IFCBUILDINGSTOREY') === 2, 'spatial structure');
  assert(/IFCSIUNIT\(\*,\.LENGTHUNIT\.,\.MILLI\.,\.METRE\.\)/.test(ifc), 'millimetres');
  assert(count(ifc, 'IFCPIPESEGMENT') === 1 && count(ifc, 'IFCFIRESUPPRESSIONTERMINAL') === 1 && count(ifc, 'IFCVALVE') === 1 && count(ifc, 'IFCDISTRIBUTIONSYSTEM') === 1, 'elements & system');
  assert(/IFCBUILDINGSTOREY\([^;]*'Level 1'[^;]*4500\./.test(ifc), 'storey elevation 4500');
  assert(ifc.includes('.SPRINKLER.') && ifc.includes('.RIGIDSEGMENT.') && ifc.includes("'MEP_Design'") && ifc.includes('IFCRELASSIGNSTOGROUP') && ifc.includes('IFCRELCONTAINEDINSPATIALSTRUCTURE'), 'types, pset, system & containment relations');
  // every referenced #id is defined
  const defined = new Set([...ifc.matchAll(/^#(\d+)=/gm)].map((x) => x[1]));
  for (const r of ifc.matchAll(/#(\d+)/g)) assert(defined.has(r[1]), `reference #${r[1]} defined`);
  const gids = [...ifc.matchAll(/\('([0-9A-Za-z_$]{22})'/g)].map((x) => x[1]);
  assert(gids.length >= 10 && new Set(gids).size === gids.length, 'unique 22-char GlobalIds');
  assert(writeIfc(m, { timestamp: '2026-11-07T00:00:00' }) === ifc, 'deterministic output');
  const out = process.env.BIM_OUT;
  if (out) { mkdirSync(out, { recursive: true }); writeFileSync(`${out}/unit.ifc`, ifc); }
  console.log('✓ IFC4 writer');
}
// ── 2. Fire protection adapter (pump room, tank, standpipes, sprinklers, CO2, extinguishers)
{
  const r = designFireProtectionSystem({
    ...DEFAULT_FIRE_INPUT,
    sprinklerDesign: {
      answers: defaultSprinklerAnswers(), buildingRiserIn: 6, buildingRiserSchedule: 'sch40',
      floors: [{ id: 'L1', name: 'Level 1', elevationM: 4.5, roomLayers: [], systemType: 'wet', riser: { x: -500, y: 6000 }, branchDirection: 'x',
        rooms: [{ id: 'R1', name: 'Office', polygon: OFFICE_POLYGON, occupancy: 'office', hazard: 'light', ceilingHeightM: 3, ceilingType: 'finished-flat', freezing: false, heatSource: false, omit: false, omitReason: '' }] }]
    },
    co2Design: { answers: defaultCo2Answers(), floors: [{ id: 'B1', name: 'Basement 1', elevationM: -4, storage: { x: 21000, y: -2000 },
      enclosures: [co2EnclosureFromRoom({ id: 'R9', name: 'Switch Room', polygon: [[22000, 0], [30000, 0], [30000, 6000], [22000, 6000]], occupancy: 'electrical', hazard: 'ordinary-1', ceilingHeightM: 3, ceilingType: 'finished-flat', freezing: false, heatSource: false, omit: false, omitReason: '' }, 'Z1')] }] }
  });
  const m = fireBimModel(r);
  assert(m.discipline === 'Fire Protection' && m.storeys.some((s) => s.id === 'L1' && s.elevationMm === 4500) && m.storeys.some((s) => s.id === 'B1' && s.elevationMm === -4000), 'storeys from the building');
  const spk = m.elements.filter((e) => e.ifcClass === 'IfcFireSuppressionTerminal' && e.predefinedType === 'SPRINKLER');
  const f = r.sprinklers!.floors[0];
  assert(spk.length === f.heads.length, `one IFC sprinkler per head (${spk.length}/${f.heads.length})`);
  const h0 = spk.find((e) => e.tag === f.heads[0].tag)!;
  assert(h0.geometry.kind === 'cylinder', 'sprinkler body');
  if (h0.geometry.kind === 'cylinder') {
    near(h0.geometry.base[0], f.heads[0].x, 0.01, 'sprinkler x = plan x');
    near(h0.geometry.base[2] + h0.geometry.heightMm, 4500 + 3000 - 100, 0.5, 'deflector 100 mm below the 3 m ceiling of L1');
  }
  const spkPipes = m.elements.filter((e) => e.ifcClass === 'IfcPipeSegment' && m.systems.find((s) => s.id === e.systemId)!.kind === 'fire-sprinkler');
  assert(spkPipes.length >= f.pipes.length, 'every sprinkler pipe exported');
  const p0 = spkPipes.find((e) => e.tag === f.pipes[0].id)!;
  assert(!!p0 && p0.geometry.kind === 'segment' && Math.abs(p0.geometry.start[2] - (4500 + 3000 - 300)) < 0.5, 'branch piping 300 mm below the ceiling');
  assert(m.elements.filter((e) => e.ifcClass === 'IfcPump').length === r.pumps.mainPumps.length + r.pumps.jockeys.length, 'pumps');
  assert(m.elements.some((e) => e.ifcClass === 'IfcTank' && /tank/i.test(e.name)), 'fire water tank');
  const risers = m.elements.filter((e) => m.systems.find((s) => s.id === e.systemId)!.kind === 'fire-standpipe' && e.ifcClass === 'IfcPipeSegment' && e.geometry.kind === 'segment' && e.geometry.start[0] === e.geometry.end[0] && e.geometry.start[1] === e.geometry.end[1]);
  assert(risers.length >= r.standpipe!.risers.length, 'vertical standpipe risers');
  assert(m.elements.filter((e) => e.ifcClass === 'IfcValve' && e.predefinedType === 'FAUCET' || (e.ifcClass === 'IfcValve' && /hose/i.test(e.name))).length >= r.standpipe!.risers.reduce((s, x) => s + x.outlets.length, 0), 'hose valves at every outlet');
  const co2 = r.co2!.floors[0];
  assert(m.elements.filter((e) => e.objectType === 'CO2NOZZLE').length === co2.enclosures.reduce((s, e) => s + e.nozzles.length, 0), 'CO2 nozzles');
  assert(m.elements.filter((e) => e.ifcClass === 'IfcTank' && /CO2/i.test(e.name)).length === r.co2!.storage.mainCylinders + r.co2!.storage.reserveCylinders, 'CO2 cylinders');
  assert(m.elements.filter((e) => e.objectType === 'FIREEXTINGUISHER').length === r.extinguishers!.zones.reduce((s, z) => s + z.extinguishers.length, 0), 'extinguishers');
  assert(m.warnings.some((w) => /pump room/i.test(w)) && m.warnings.some((w) => /standpipe/i.test(w)), 'schematic placements reported');
  const placed = fireBimModel(r, { pumpRoom: { x: 50000, y: 20000, floorId: 'B1', rotationDeg: 90 }, standpipes: { 'ST-1': { x: 1000, y: 2000 }, 'ST-2': { x: 25000, y: 2000 } } });
  assert(!placed.warnings.some((w) => /pump room/i.test(w)), 'placed pump room → no warning');
  const st1 = placed.elements.find((e) => e.tag.startsWith('ST-1') && e.geometry.kind === 'segment')!;
  assert(st1.geometry.kind === 'segment' && st1.geometry.start[0] === 1000 && st1.geometry.start[1] === 2000, 'riser at its placement');
  for (const e of m.elements) assert(m.storeys.some((s) => s.id === e.storeyId) && m.systems.some((s) => s.id === e.systemId), `${e.tag} has storey & system`);
  const ifc = writeIfc(placed, { timestamp: '2026-11-07T00:00:00' });
  assert(count(ifc, 'IFCFIRESUPPRESSIONTERMINAL') === spk.length + m.elements.filter((e) => e.objectType === 'CO2NOZZLE' || e.objectType === 'FIREEXTINGUISHER').length, 'IFC terminals');
  const out = process.env.BIM_OUT;
  if (out) writeFileSync(`${out}/fire.ifc`, ifc);
  // model-space DXF per storey: true coordinates, no sheet frame
  const dxf = writeModelDxf(placed, 'L1');
  assert(dxf.includes('AC1009') && /\$INSUNITS\s*\r?\n\s*70\s*\r?\n\s*4/.test(dxf), 'R12, millimetres');
  assert(dxf.includes('FP-SPRK-HEAD') && dxf.includes('FP-SPRK-PIPE'), 'NCS layers');
  assert(dxf.includes(`\n${f.heads[0].x.toFixed(1)}`) || dxf.includes(`\n${f.heads[0].x.toFixed(4)}`) || dxf.includes(`\n${String(f.heads[0].x)}`), 'sprinkler at its plan coordinate');
  assert(!/TITLE|FRAME|SHEET/i.test(dxf.split('ENTITIES')[1] ?? ''), 'no sheet frame / title block in the link DXF');
  if (out) writeFileSync(`${out}/fire-L1-link.dxf`, dxf);
  console.log('✓ fire protection → BIM');
}
// ── 3. HVAC adapter
{
  const zone: Zone = {
    id: 'z1', name: 'Office', points: [0, 0, 300, 0, 300, 200, 0, 200], spaceTypeId: 'office', ceilingHeight: 10, occupants: 10,
    diffusers: [{ id: 'd1', x: 100, y: 100, cfm: 200, size: '12x12', type: 'supply' }, { id: 'd2', x: 200, y: 100, cfm: 200, size: '12x12', type: 'supply' }, { id: 'r1', x: 150, y: 50, cfm: 400, size: '24x12', type: 'return' }],
    ducts: [{ id: 't1', type: 'trunk', points: [20, 100, 100, 100, 200, 100], widthIn: 14, heightIn: 10, cfm: 400, sizeLabel: '14x10' }, { id: 'rt', type: 'return', points: [20, 50, 150, 50], widthIn: 16, heightIn: 10, cfm: 400, sizeLabel: '16x10' }],
    unitPositions: [{ x: 20, y: 100 }], outdoorUnitPositions: [{ x: -50, y: 0 }]
  };
  const m = hvacBimModel([zone], { storeyId: 'L1', storeyName: 'Level 1', elevationMm: 4500, scale: 10, units: 'imperial' });
  assert(m.discipline === 'HVAC' && m.storeys.length === 1 && m.storeys[0].elevationMm === 4500, 'HVAC storey');
  const ducts = m.elements.filter((e) => e.ifcClass === 'IfcDuctSegment');
  assert(ducts.length === 3, `one duct segment per polyline leg (${ducts.length})`);
  const d0 = ducts[0];
  assert(d0.geometry.kind === 'segment' && d0.geometry.profile.shape === 'rect', 'rectangular duct');
  if (d0.geometry.kind === 'segment' && d0.geometry.profile.shape === 'rect') {
    near(d0.geometry.start[0], 20 / 10 * 304.8, 0.01, 'x: drawing units / (units per ft) × 304.8');
    near(d0.geometry.profile.widthMm, 14 * 25.4, 0.01, 'duct width mm');
    assert(d0.geometry.start[2] > 4500 + 10 * 304.8, 'duct above the ceiling');
  }
  assert(m.elements.filter((e) => e.ifcClass === 'IfcAirTerminal').length === 3 && m.elements.some((e) => e.ifcClass === 'IfcAirTerminal' && e.predefinedType === 'GRILLE'), 'diffusers & return grille');
  assert(m.elements.filter((e) => e.ifcClass === 'IfcUnitaryEquipment').length === 2, 'indoor & outdoor units');
  assert(m.systems.some((s) => s.kind === 'hvac-supply') && m.systems.some((s) => s.kind === 'hvac-return'), 'supply & return systems');
  const ifc = writeIfc(m, { timestamp: '2026-11-07T00:00:00' });
  assert(count(ifc, 'IFCDUCTSEGMENT') === 3 && count(ifc, 'IFCAIRTERMINAL') === 3, 'HVAC IFC');
  const dxf = writeModelDxf(m, 'L1');
  assert(dxf.includes('M-DUCT-SUPP') && dxf.includes('M-DUCT-RETN') && dxf.includes('M-HVAC-DIFF'), 'HVAC layers');
  if (process.env.BIM_OUT) { writeFileSync(`${process.env.BIM_OUT}/hvac.ifc`, ifc); writeFileSync(`${process.env.BIM_OUT}/hvac-L1-link.dxf`, dxf); }
  // ── 4. merge + clash detection (a duct crossing a sprinkler pipe at the same level clashes)
  const fire: BimModel = {
    projectName: 'T', projectNumber: '1', discipline: 'Fire Protection', storeys: [{ id: 'L1', name: 'Level 1', elevationMm: 4500 }],
    systems: [{ id: 'S', name: 'S', kind: 'fire-sprinkler', ifcPredefinedType: 'FIREPROTECTION', color: [1, 0, 0] }],
    elements: [{ key: 'x', tag: 'PIPE-X', name: 'pipe', ifcClass: 'IfcPipeSegment', predefinedType: 'RIGIDSEGMENT', storeyId: 'L1', systemId: 'S', geometry: { kind: 'segment', start: [1500, -1000, d0.geometry.kind === 'segment' ? d0.geometry.start[2] : 0], end: [1500, 9000, d0.geometry.kind === 'segment' ? d0.geometry.start[2] : 0], profile: { shape: 'circle', diameterMm: 60 } }, properties: {} }],
    warnings: []
  };
  const merged = mergeBimModels([fire, m], 'MEP');
  assert(merged.discipline === 'MEP' && merged.storeys.length === 1 && merged.elements.length === m.elements.length + 1, 'merged model');
  const clashes = detectClashes(merged, { toleranceMm: 25 });
  assert(clashes.some((c) => (c.a === 'PIPE-X' || c.b === 'PIPE-X') && c.clearanceMm < 0), `pipe/duct clash found (${clashes.length})`);
  assert(detectClashes(m, { toleranceMm: 25 }).every((c) => c.a !== c.b), 'no self clashes');
  console.log('✓ HVAC → BIM, merge, clash detection');
}
console.log('\nAll BIM export tests passed.');
