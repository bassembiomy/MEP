import { describe, expect, it } from 'vitest'
import { validateCriticalPathPressure } from '../validation/pressureValidator'
import { executeMasterHvacValidation } from '../validation/hvacValidator'
import type { EquipmentServiceZone } from '../zoning/zonePartitioner'
import type { SteppedDuctSection } from '../ducts/steppedDuctRouter'
import type { CoordinatedAirTerminal } from '../terminals/terminalPlacer'

export const zoneFixture = (id = 'z1', overrides: Partial<EquipmentServiceZone> = {}): EquipmentServiceZone => ({
  id, unitTag: `AC-${id}`, designControlMode: 'ai', equipmentModel: 'verified fixture',
  coolingSource: 'dx', equipmentType: 'concealed-split', nominalTonnage: 2,
  actualCapacityBtu: 24000, supplyCfm: 600, returnCfm: 600, outdoorAirCfm: 60,
  outdoorAirConnectionApproved: true, espInWg: 0.5,
  equipmentPosition: { x: 0, y: 0, rotation: 0, wallSide: 'ceiling' },
  serviceAreaPolygon: [0,0,20,0,20,20,0,20], sensibleLoadBtu: 16000,
  latentLoadBtu: 4000, totalLoadBtu: 20000, targetNc: 30,
  pressureBudgetInWg: { supplyDuct: 0.1, returnDuct: 0.05, terminals: 0.04, fittings: 0.05, totalAvailable: 0.5 },
  isUserOverridden: false, ...overrides
})

export const ductFixture = (id: string, overrides: Partial<SteppedDuctSection> = {}): SteppedDuctSection => ({
  id, unitId: 'z1', designControlMode: 'ai', systemType: 'supply', role: 'main-trunk',
  startPoint: { x: 0, y: 0 }, endPoint: { x: 100, y: 0 }, airflowCfm: 600,
  shape: 'rectangular', widthIn: 12, heightIn: 12, velocityFpm: 600, allowableVelocityFpm: 1200,
  frictionLossPer100Ft: 0.1, fittingLossInWg: 0.01, totalSectionLossInWg: 0.11,
  ncRating: 25, connectedDiffuserCount: 1, connectedDiffusers: ['t1'], childDuctIds: [], ...overrides
})

const terminalFixture = (unitId: string, cfm: number): CoordinatedAirTerminal => ({
  id: `t-${unitId}`, unitId, designControlMode: 'ai', type: 'supply', subtype: '4-way-ceiling',
  position: { x: 10, y: 10 }, cfm, catalogModel: 'fixture', neckDimension: '12x12',
  faceDimension: '24x24', throwT50Ft: 15, throwRatio: 1, adjacentOverlapRatio: 0,
  occupiedZoneVelocityFpm: 40, ncRating: 25, deltaPInWg: 0.04, status: 'pass'
})

describe('per-fan pressure integrity', () => {
  it('uses the longest connected path rather than summing parallel branches', () => {
    const ducts = [
      ductFixture('trunk', { childDuctIds: ['a', 'b'], connectedDiffusers: [] }),
      ductFixture('a', { parentDuctId: 'trunk', startPoint: { x:100,y:0 }, endPoint: { x:200,y:0 }, frictionLossPer100Ft: 0.2, fittingLossInWg: 0.02 }),
      ductFixture('b', { parentDuctId: 'trunk', startPoint: { x:100,y:0 }, endPoint: { x:100,y:100 }, frictionLossPer100Ft: 0.1, fittingLossInWg: 0.01 })
    ]
    // (0.11 trunk + max(0.22,0.11) branch + 0.04 terminal + 0.05 return) * 1.15 = 0.483
    ducts.push(ductFixture('return', { systemType:'return', startPoint:{x:10,y:0},endPoint:{x:0,y:0},frictionLossPer100Ft:0.5,fittingLossInWg:0 }));
    const report = validateCriticalPathPressure([zoneFixture()], ducts)
    expect(report.status).toBe('PASS')
    expect(report.metric).toContain('0.483')
  })

  it('does not borrow the first fan ESP for another unit', () => {
    const zones = [zoneFixture('z1', { espInWg: 2 }), zoneFixture('z2', { espInWg: 0.1 })]
    const report = validateCriticalPathPressure(zones, [ductFixture('a'), ductFixture('b', { unitId: 'z2' })])
    expect(report.status).toBe('FAIL')
    expect(report.message).toContain('z2')
  })

  it('fails missing parents instead of treating disconnected sections as valid', () => {
    expect(validateCriticalPathPressure([zoneFixture()], [ductFixture('a', { parentDuctId: 'missing' })]).status).toBe('FAIL')
  })

  it('fails a cyclic network', () => {
    const ducts = [ductFixture('a', { parentDuctId: 'b', childDuctIds: ['b'] }), ductFixture('b', { parentDuctId: 'a', childDuctIds: ['a'] })]
    expect(validateCriticalPathPressure([zoneFixture()], ducts).status).toBe('FAIL')
  })

  it('fails missing pressure evidence for a ducted unit', () => {
    expect(validateCriticalPathPressure([zoneFixture()], []).status).toBe('FAIL')
  })
})

describe('master engineering integrity', () => {
  const input = () => ({ roomName: 'room', roomPolygon: [0,0,20,0,20,20,0,20], requiredRoomCfm: 600,
    designLoadBtu: 20000, zones: [zoneFixture()], terminals: [terminalFixture('z1',600)], ducts: [ductFixture('a', { endPoint: { x:10,y:10 } })] })

  it('blocks missing equipment instead of passing an empty design', () => {
    const report = executeMasterHvacValidation({ ...input(), zones: [], terminals: [], ducts: [] })
    expect(report.overallStatus).toBe('FAIL')
  })

  it('fails capacity deficient in one zone even if aggregate capacity covers both', () => {
    const report = executeMasterHvacValidation({ ...input(), requiredRoomCfm: 1200, designLoadBtu: 40000,
      zones: [zoneFixture('z1',{actualCapacityBtu:50000}), zoneFixture('z2',{actualCapacityBtu:10000})],
      terminals: [terminalFixture('z1',600), terminalFixture('z2',600)],
      ducts: [ductFixture('a'), ductFixture('b',{unitId:'z2'})] })
    expect(report.overallStatus).toBe('FAIL')
    expect(report.points.some(p => p.pointIndex === 8 && p.status === 'FAIL')).toBe(true)
  })

  it('fails a room with deficient delivery even when aggregate airflow balances', () => {
    const report = executeMasterHvacValidation({ ...input(), requiredRoomCfm:1200, designLoadBtu:40000,
      zones:[zoneFixture('z1'),zoneFixture('z2')], terminals:[terminalFixture('z1',900),terminalFixture('z2',300)],
      ducts:[ductFixture('a'),ductFixture('b',{unitId:'z2'})] })
    expect(report.overallStatus).toBe('FAIL')
  })

  it('does not claim issue readiness from preliminary checks', () => {
    const report = executeMasterHvacValidation(input())
    expect(report).toHaveProperty('issueReady', false)
    expect(report).toHaveProperty('verificationScope', 'preliminary')
    expect((report as { limitations?: string[] }).limitations?.length).toBeGreaterThan(0)
  })
})

import { validateSystemAirMassBalance } from '../validation/massBalanceValidator'
import { validateSpatialCoordination } from '../validation/spatialValidator'

describe('air balance and spatial evidence', () => {
  it('rejects outdoor airflow greater than fan delivery', () => {
    expect(validateSystemAirMassBalance([zoneFixture('z1', { outdoorAirCfm:800 })]).status).toBe('FAIL')
  })
  it('rejects return exceeding supplied room air', () => {
    expect(validateSystemAirMassBalance([zoneFixture('z1', { returnCfm:800 })]).status).toBe('FAIL')
  })
  it('does not report a duct outside its room as coordinated', () => {
    expect(validateSpatialCoordination([zoneFixture()], [ductFixture('outside')], [0,0,20,0,20,20,0,20]).status).toBe('FAIL')
  })
  it('rejects aspect ratio above the declared maximum of three', () => {
    expect(validateSpatialCoordination([zoneFixture()], [ductFixture('wide', { widthIn:28, heightIn:8, endPoint:{x:10,y:10} })], [0,0,20,0,20,20,0,20]).status).toBe('FAIL')
  })
})

import { routeSteppedSupplyDucts } from '../ducts/steppedDuctRouter'

describe('stepped network engineering evidence', () => {
  const placed = () => [
    { ...terminalFixture('z1',300), id:'t1',position:{x:5,y:10} },
    { ...terminalFixture('z1',300), id:'t2',position:{x:15,y:10} }
  ]
  it('links successive trunk sections instead of making a disconnected second fan root', () => {
    const ducts=routeSteppedSupplyDucts(zoneFixture(),placed())
    const trunk=ducts.find(d=>d.startPoint.x===5 && d.endPoint.x===15)!
    expect(trunk.parentDuctId).toBeDefined()
    expect(ducts.find(d=>d.id===trunk.parentDuctId)?.childDuctIds).toContain(trunk.id)
  })
  it('reports velocity calculated from actual flow and section area', () => {
    const ducts=routeSteppedSupplyDucts(zoneFixture(),placed())
    const first=ducts[0]
    expect(first.widthIn).toBe(18)
    expect(first.heightIn).toBe(10)
    // 600 CFM / (18*10/144 ft²) = 480 FPM.
    expect(first.velocityFpm).toBe(480)
  })
})


describe('reviewed evidence gaps', () => {
  it('rejects a duct without a service-zone owner before filtering networks', () => {
    const report=executeMasterHvacValidation({roomName:'room',roomPolygon:[0,0,20,0,20,20,0,20],requiredRoomCfm:600,designLoadBtu:20000,zones:[zoneFixture()],terminals:[terminalFixture('z1',600)],ducts:[ductFixture('orphan',{unitId:'missing'})]})
    expect(report.points.some(p=>p.status==='FAIL' && /orphan.*owner/i.test(p.message))).toBe(true)
  })
  it('rejects a missing return pressure network rather than using a budget', () => {
    expect(validateCriticalPathPressure([zoneFixture()], [ductFixture('a')]).status).toBe('FAIL')
  })
  it('includes actual connected return grille pressure', () => {
    const ducts=[ductFixture('a',{connectedDiffusers:['t-z1']}),ductFixture('r',{systemType:'return',startPoint:{x:10,y:0},endPoint:{x:0,y:0},connectedDiffusers:['r1'],frictionLossPer100Ft:0,fittingLossInWg:0})]
    const grille={...terminalFixture('z1',600),id:'r1',type:'return' as const,deltaPInWg:0.5}
    expect(validateCriticalPathPressure([zoneFixture()],ducts,undefined,[terminalFixture('z1',600),grille]).status).toBe('FAIL')
  })
})


it('does not mark missing sensible and latent capacity evidence as a verified pass',()=>{
  const report=executeMasterHvacValidation({roomName:'room',roomPolygon:[0,0,20,0,20,20,0,20],requiredRoomCfm:600,designLoadBtu:20000,zones:[zoneFixture()],terminals:[terminalFixture('z1',600)],ducts:[]});
  expect(report.points.find(p=>p.pointIndex===8)?.status).not.toBe('PASS');
});

import { routeReturnDucts } from '../ducts/returnDuctRouter';
it('routes return pressure evidence from each actual grille to its equipment',()=>{
  const grille={...terminalFixture('z1',600),id:'r1',type:'return' as const,position:{x:10,y:10}};
  const routed=routeReturnDucts(zoneFixture(),[grille]);
  expect(routed.find(d=>d.connectedDiffusers.includes('r1'))?.startPoint).toEqual(grille.position);
  expect(routed.find(d=>d.connectedDiffusers.includes('r1'))?.endPoint).toEqual({x:0,y:0});
});


import { adaptPlaceTerminals } from '../adapters/terminalAdapter';
it('does not relabel generated return grilles as supply diffusers',()=>{
  const terminals=adaptPlaceTerminals([0,0,20,0,20,15,0,15],237.4);
  expect(terminals.some(t=>/ret-grille/i.test(t.id))).toBe(false);
  expect(terminals.reduce((sum,t)=>sum+t.cfm,0)).toBeCloseTo(237.4,8);
});


it('rejects a terminal ID connection whose actual endpoint is elsewhere',()=>{
  const supply=ductFixture('s',{connectedDiffusers:['t-z1'],endPoint:{x:10,y:0}});
  const ret=ductFixture('r',{systemType:'return',startPoint:{x:10,y:10},endPoint:{x:0,y:0},connectedDiffusers:['r1']});
  const report=validateCriticalPathPressure([zoneFixture()], [supply,ret],undefined,[terminalFixture('z1',600),{...terminalFixture('z1',600),id:'r1',type:'return' as const}]);
  expect(report.message).toMatch(/terminal.*position|terminal.*disconnected/i);
});
it('compares actual return grille delivery to required return airflow',()=>{
  const report=executeMasterHvacValidation({roomName:'room',roomPolygon:[0,0,20,0,20,20,0,20],requiredRoomCfm:600,designLoadBtu:20000,zones:[zoneFixture()],terminals:[terminalFixture('z1',600),{...terminalFixture('z1',300),id:'r1',type:'return' as const}],ducts:[]});
  expect(report.points.some(p=>p.status==='FAIL' && /return.*airflow/i.test(p.message))).toBe(true);
});


it('routes the real terminal endpoint even for a half-foot takeoff',()=>{
  const terminal={...terminalFixture('z1',600),position:{x:10,y:0.5}};
  const ducts=routeSteppedSupplyDucts(zoneFixture(),[terminal]);
  expect(ducts.some(d=>d.connectedDiffusers.includes(terminal.id) && d.endPoint.y===0.5)).toBe(true);
});
