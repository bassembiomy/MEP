/**
 * Fire-protection design result (sprinklers, standpipes, pump room + tank, CO2, extinguishers) → BimModel.
 *
 * Plan coordinates of sprinklers, sprinkler / CO2 pipes and CO2 devices are taken from the design as is (mm, floor
 * plan coordinates). Items that have no plan coordinates in the design (pump room, standpipe risers, extinguisher
 * zones) are placed from `placement`, or on a schematic default position that is reported in `warnings`.
 */
import type { FireDesignResult, PlacedEquipment, PlacedValve, PipeSegment2D } from '../fireProtection/fpTypes';
import { butterflyValveLengthMm, checkValveLengthMm, gateValveLengthMm, outsideDiameterMm } from '../fireProtection/standards/pipeData';
import type { BimElement, BimIfcClass, BimModel, BimStorey, BimSystem, BimSystemKind, FireBimPlacement, Vec3 } from './bimTypes';

type NewElement = Omit<BimElement, 'storeyId' | 'systemId' | 'key'> & { key?: string };

const COLORS: Record<string, [number, number, number]> = {
  sprinkler: [0.85, 0.1, 0.1],
  standpipe: [0.65, 0.05, 0.05],
  pump: [0.8, 0.3, 0.1],
  co2: [0.1, 0.6, 0.75],
  extinguisher: [0.9, 0.15, 0.45],
  alarm: [0.9, 0.7, 0.1]
};

/** Outside diameter of a nominal pipe size, mm (falls back for sizes outside the steel table). */
function od(sizeIn: number): number {
  try {
    return outsideDiameterMm(sizeIn);
  } catch {
    return sizeIn * 25.4 * 1.1;
  }
}

function valveLengthMm(kind: PlacedValve['kind'], sizeIn: number): number {
  try {
    if (kind === 'os&y-gate') return gateValveLengthMm(sizeIn);
    if (kind === 'check' || kind === 'sensing-check') return checkValveLengthMm(sizeIn);
    if (kind === 'butterfly') return butterflyValveLengthMm(sizeIn);
  } catch {
    /* fall through */
  }
  return Math.max(2 * od(sizeIn), 80);
}

const mm = (m: number): number => Math.round(m * 1e6) / 1e3;

export function fireBimModel(r: FireDesignResult, placement: FireBimPlacement = {}): BimModel {
  const warnings: string[] = [];
  const storeys = new Map<string, BimStorey>();
  const systems = new Map<string, BimSystem>();
  const elements: BimElement[] = [];
  const keys = new Set<string>();

  const addStorey = (id: string, name: string, elevationMm: number): void => {
    const have = storeys.get(id);
    if (!have) storeys.set(id, { id, name, elevationMm });
    else if (Math.abs(have.elevationMm - elevationMm) > 0.5) {
      warnings.push(`Level ${id}: elevation ${elevationMm} mm of the design differs from the building level (${have.elevationMm} mm); the building level is used.`);
    }
  };
  /** Storey for a floor id; unknown ids get a level at ±0 and a warning. */
  const storeyOf = (id: string): BimStorey => {
    let st = storeys.get(id);
    if (!st) {
      st = { id, name: id, elevationMm: 0 };
      storeys.set(id, st);
      warnings.push(`Level "${id}" is not part of the building definition - created at elevation 0 mm.`);
    }
    return st;
  };
  const nearestStorey = (zMm: number): BimStorey => {
    let best: BimStorey | null = null;
    for (const s of storeys.values()) if (!best || Math.abs(s.elevationMm - zMm) < Math.abs(best.elevationMm - zMm)) best = s;
    if (!best) throw new Error('fireBimModel: no building levels');
    return best;
  };
  const sys = (id: string, name: string, kind: BimSystemKind, color: keyof typeof COLORS): string => {
    if (!systems.has(id)) systems.set(id, { id, name, kind, ifcPredefinedType: 'FIREPROTECTION', color: COLORS[color] });
    return id;
  };
  const add = (storeyId: string, systemId: string, el: NewElement): void => {
    let key = el.key ?? `${systemId}|${el.tag}`;
    let n = 1;
    const base = key;
    while (keys.has(key)) key = `${base}~${n++}`;
    keys.add(key);
    elements.push({ ...el, key, storeyId, systemId });
  };
  /** One IfcPipeSegment per polyline leg; the first leg keeps the tag. */
  const addPolyline = (storeyId: string, systemId: string, tagBase: string, name: string, pts: [number, number][], z: number, diameterMm: number, props: BimElement['properties']): void => {
    let leg = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 1) continue;
      leg++;
      add(storeyId, systemId, {
        key: `${systemId}|${tagBase}|${leg}`,
        tag: leg === 1 ? tagBase : `${tagBase}.${leg}`,
        name,
        ifcClass: 'IfcPipeSegment',
        predefinedType: 'RIGIDSEGMENT',
        geometry: { kind: 'segment', start: [a[0], a[1], z], end: [b[0], b[1], z], profile: { shape: 'circle', diameterMm } },
        properties: { ...props, LegLengthMm: Math.round(l) }
      });
    }
  };

  // ── levels: building ∪ sprinkler ∪ CO2 floors
  const input = r.input;
  for (const f of input.building?.floors ?? []) addStorey(f.id, f.name, mm(f.elevationM));
  for (const f of input.sprinklerDesign?.floors ?? []) addStorey(f.id, f.name, mm(f.elevationM));
  for (const f of input.co2Design?.floors ?? []) addStorey(f.id, f.name, mm(f.elevationM));
  if (storeys.size === 0) addStorey('GF', 'Ground Floor', 0);
  const lowest = (): BimStorey => [...storeys.values()].sort((a, b) => a.elevationMm - b.elevationMm)[0];

  // ───────────────────────── sprinklers ─────────────────────────
  const sd = input.sprinklerDesign;
  if (r.sprinklers && sd) {
    const deflector = sd.answers.deflectorBelowCeilingMm ?? 100;
    for (const fd of r.sprinklers.floors) {
      const fin = sd.floors.find((x) => x.id === fd.floorId);
      const st = storeyOf(fd.floorId);
      const ffl = st.elevationMm;
      const ceilByRoom = new Map((fin?.rooms ?? []).map((rm) => [rm.id, rm.ceilingHeightM * 1000] as const));
      const defaultCeil = sd.answers.defaultCeilingHeightM * 1000;
      const ceilings = (fin?.rooms ?? []).filter((rm) => !rm.omit).map((rm) => rm.ceilingHeightM * 1000);
      const pipeZ = ffl + (ceilings.length > 0 ? Math.min(...ceilings) : defaultCeil) - 300;
      const zoneName = new Map(fd.zones.map((z) => [z.zoneId, z.name] as const));
      const sysOf = (zoneId: string): string =>
        sys(`SYS-SPK-${fd.floorId}-${zoneId}`, `Sprinklers ${fd.floorName} ${zoneName.get(zoneId) ?? zoneId}`, 'fire-sprinkler', 'sprinkler');
      const flow = new Map<string, number>();
      for (const ra of fd.remoteAreas) {
        for (const row of ra.rows) {
          const k = `${row.fromNode}>${row.toNode}`;
          flow.set(k, Math.max(flow.get(k) ?? 0, row.totalFlowGpm));
        }
      }

      for (const h of fd.heads) {
        const ht = r.sprinklers.headTypes.find((t) => t.id === h.headTypeId);
        const ceil = ceilByRoom.get(h.roomId) ?? defaultCeil;
        const ob = h.belowObstruction ? fd.obstructions.find((o) => o.id === h.belowObstruction) : undefined;
        const top = ffl + ceil - (ob?.bottomBelowCeilingMm ?? 0) - deflector;
        const zid = h.zoneId || 'Z1';
        add(fd.floorId, sysOf(zid), {
          key: `spk|${fd.floorId}|${h.tag}`,
          tag: h.tag,
          name: `Sprinkler ${ht?.description ?? h.headTypeId}`,
          ifcClass: 'IfcFireSuppressionTerminal',
          predefinedType: 'SPRINKLER',
          geometry: { kind: 'cylinder', base: [h.x, h.y, top - 60], diameterMm: 50, heightMm: 60 },
          properties: {
            HeadType: h.headTypeId,
            ...(ht ? { KFactor: ht.kFactor, Orientation: ht.orientation, TempRatingF: ht.tempRatingF, Response: ht.response } : {}),
            Room: h.roomId,
            Zone: zid,
            CoverageFt2: h.areaFt2,
            SpacingSmm: h.spacingSmm,
            SpacingLmm: h.spacingLmm,
            DeflectorBelowCeilingMm: deflector,
            ...(ob ? { BelowObstruction: ob.id } : {})
          }
        });
        if (ob && pipeZ - top > 1) {
          add(fd.floorId, sysOf(zid), {
            key: `spk-drop|${fd.floorId}|${h.tag}`,
            tag: `${h.tag}-DROP`,
            name: 'Sprinkler drop nipple 1"',
            ifcClass: 'IfcPipeSegment',
            predefinedType: 'RIGIDSEGMENT',
            geometry: { kind: 'segment', start: [h.x, h.y, pipeZ], end: [h.x, h.y, top - 60], profile: { shape: 'circle', diameterMm: od(1) } },
            properties: { Size: '1"', NominalSizeIn: 1, Obstruction: ob.id }
          });
        }
      }

      for (const p of fd.pipes) {
        const fl = flow.get(`${p.fromNode}>${p.toNode}`);
        const planLen = p.points.reduce((acc, q, i) => (i === 0 ? 0 : acc + Math.hypot(q[0] - p.points[i - 1][0], q[1] - p.points[i - 1][1])), 0);
        if (planLen < 1 && p.points.length > 0 && pipeZ - 150 - ffl > 1) {
          // zero plan length = vertical riser nipple from the floor control assembly up to the piping level
          add(fd.floorId, sysOf(p.zoneId || 'Z1'), {
            key: `spk-nipple|${fd.floorId}|${p.id}`,
            tag: p.id,
            name: `Sprinkler riser nipple ${p.sizeIn}"`,
            ifcClass: 'IfcPipeSegment',
            predefinedType: 'RIGIDSEGMENT',
            geometry: { kind: 'segment', start: [p.points[0][0], p.points[0][1], ffl], end: [p.points[0][0], p.points[0][1], pipeZ - 150], profile: { shape: 'circle', diameterMm: od(p.sizeIn) } },
            properties: { Size: `${p.sizeIn}"`, NominalSizeIn: p.sizeIn, Schedule: p.schedule, Kind: p.kind, ...(fl !== undefined ? { FlowGpm: fl } : {}) }
          });
          continue;
        }
        addPolyline(fd.floorId, sysOf(p.zoneId || 'Z1'), p.id, `Sprinkler pipe ${p.sizeIn}" ${p.kind}`, p.points, pipeZ, od(p.sizeIn), {
          Size: `${p.sizeIn}"`,
          NominalSizeIn: p.sizeIn,
          Schedule: p.schedule,
          LengthM: p.lengthM,
          Kind: p.kind,
          FromNode: p.fromNode,
          ToNode: p.toNode,
          ...(fl !== undefined ? { FlowGpm: fl } : {})
        });
      }

      for (const z of fd.zones) {
        add(fd.floorId, sysOf(z.zoneId), {
          key: `zcv|${fd.floorId}|${z.controlValveTag}`,
          tag: z.controlValveTag,
          name: `Zone control valve ${z.controlValveTag}`,
          ifcClass: 'IfcValve',
          predefinedType: 'ISOLATING',
          geometry: { kind: 'box', origin: [z.riser.x, z.riser.y, pipeZ - 150], sizeMm: [350, 350, 300], rotationDeg: 0 },
          properties: { Zone: z.zoneId, Heads: z.headCount, AreaM2: z.areaM2 }
        });
      }
    }
  }

  // ───────────────────────── pump room position (needed by the standpipe express risers) ─────────────────────────
  let roomPl = placement.pumpRoom;
  let roomStorey: BimStorey;
  if (roomPl && storeys.has(roomPl.floorId)) {
    roomStorey = storeys.get(roomPl.floorId)!;
  } else {
    if (roomPl) warnings.push(`Pump room floor "${roomPl.floorId}" is not a building level - the lowest level is used.`);
    const pre = input.building?.pumpRoomFloorElevationM;
    roomStorey = (pre !== undefined ? [...storeys.values()].find((s) => Math.abs(s.elevationMm - pre * 1000) < 1) : undefined) ?? lowest();
    if (!roomPl) {
      warnings.push(`Pump room: no placement given - schematic position at the origin (0, 0) on level ${roomStorey.id}, rotation 0. Set the pump room origin and rotation to place it in the building.`);
      roomPl = { x: 0, y: 0, floorId: roomStorey.id, rotationDeg: 0 };
    } else roomPl = { ...roomPl, floorId: roomStorey.id };
  }
  const rot = (roomPl.rotationDeg * Math.PI) / 180;
  const rc = Math.cos(rot);
  const rs = Math.sin(rot);
  const toBuilding = (x: number, y: number): [number, number] => [roomPl!.x + x * rc - y * rs, roomPl!.y + x * rs + y * rc];
  const roomFfl = roomStorey.elevationMm;

  // ───────────────────────── standpipes ─────────────────────────
  const sp = r.standpipe;
  if (sp && sp.applicable !== false) {
    const risers = new Map<string, { x: number; y: number }>();
    const schematic: string[] = [];
    sp.risers.forEach((rs0, i) => {
      const given = placement.standpipes?.[rs0.tag];
      const pos = given ?? { x: 2000 + 6000 * i, y: -3000 };
      if (!given) schematic.push(`${rs0.tag} (${pos.x}, ${pos.y})`);
      risers.set(rs0.tag, pos);
    });
    if (schematic.length > 0) warnings.push(`Standpipe risers placed on schematic positions: ${schematic.join(', ')}. Set the riser plan positions to match the stairs / cores.`);

    for (const rd of sp.risers) {
      const pos = risers.get(rd.tag)!;
      const sid = sys(`SYS-STP-${rd.tag}`, `Standpipe ${rd.tag}`, 'fire-standpipe', 'standpipe');
      const bottom = mm(rd.bottomElevationM);
      const top = mm(Math.max(rd.topElevationM, ...rd.outlets.map((o) => o.elevationM))) + 300;
      if (top - bottom > 1) {
        add(nearestStorey(bottom).id, sid, {
          key: `riser|${rd.tag}`,
          tag: rd.tag,
          name: `Standpipe riser ${rd.tag} ${rd.sizeIn}"`,
          ifcClass: 'IfcPipeSegment',
          predefinedType: 'RIGIDSEGMENT',
          geometry: { kind: 'segment', start: [pos.x, pos.y, bottom], end: [pos.x, pos.y, top], profile: { shape: 'circle', diameterMm: od(rd.sizeIn) } },
          properties: { Size: `${rd.sizeIn}"`, NominalSizeIn: rd.sizeIn, Location: rd.location, DemandFlowGpm: sp.demandFlowGpm, RoofOutlet: rd.hasRoofOutlet }
        });
      }
      const side = od(rd.sizeIn) / 2 + 120;
      for (const o of rd.outlets) {
        add(storeyOf(o.floorId).id, sid, {
          key: `hose|${rd.tag}|${o.floorId}|${o.elevationM}`,
          tag: `${rd.tag}-HV-${o.floorId}`,
          name: `Hose valve ${rd.tag} ${o.floorName}`,
          ifcClass: 'IfcValve',
          predefinedType: 'FAUCET',
          geometry: { kind: 'box', origin: [pos.x + side, pos.y, mm(o.elevationM) - 90], sizeMm: [160, 160, 180], rotationDeg: 0 },
          properties: {
            SizeIn: o.sizeIn,
            RoofOutlet: o.isRoofOutlet,
            Flowing: o.flowing,
            FlowGpm: o.flowGpm,
            StaticPsi: o.staticPsi,
            ResidualPsi: o.residualPsi,
            PrvRequired: o.prvRequired,
            Zone: o.zoneId
          }
        });
      }
    }
    // express risers of the selected zoning solution (no outlets up to their zone)
    const sol = sp.zoning.selected === 'with-prv' ? sp.zoning.withPrv : sp.zoning.withoutPrv;
    for (const z of sol.zones) {
      if (z.station.kind !== 'express' || !z.expressRiserLengthM || z.expressRiserLengthM <= 0) continue;
      const base = risers.get(z.governingRiserTag) ?? [...risers.values()][0];
      if (!base) continue;
      const start = roomFfl;
      const sid = sys(`SYS-STP-${z.governingRiserTag}`, `Standpipe ${z.governingRiserTag}`, 'fire-standpipe', 'standpipe');
      add(roomStorey.id, sid, {
        key: `express|${z.id}`,
        tag: `${z.governingRiserTag}-EXP-${z.id}`,
        name: `Express riser zone ${z.id}`,
        ifcClass: 'IfcPipeSegment',
        predefinedType: 'RIGIDSEGMENT',
        geometry: { kind: 'segment', start: [base.x + 450, base.y, start], end: [base.x + 450, base.y, start + z.expressRiserLengthM * 1000], profile: { shape: 'circle', diameterMm: od(sp.riserSizeIn) } },
        properties: { Size: `${sp.riserSizeIn}"`, NominalSizeIn: sp.riserSizeIn, Zone: z.id, LengthM: z.expressRiserLengthM }
      });
    }
  }

  // ───────────────────────── pump room + tank ─────────────────────────
  {
    const room = r.room;
    const el = room.elevations;
    const sid = sys('SYS-PUMP', 'Fire pump room', 'fire-pump', 'pump');
    const stId = roomStorey.id;
    const zAt = (m: number): number => roomFfl + m * 1000;
    const pipeZ: Record<PipeSegment2D['service'], number> = {
      suction: zAt(el.pumpCLM),
      discharge: zAt(el.pumpCLM),
      jockey: zAt(el.pumpCLM),
      relief: zAt(el.pumpCLM),
      sensing: zAt(el.pumpCLM),
      test: zAt(el.highLevelPipeM),
      exhaust: zAt(el.highLevelPipeM),
      drain: zAt(el.padTopM) + 200,
      fuel: zAt(el.padTopM) + 300
    };
    const controllers = [...r.pumps.mainPumps.map((p) => p.controller), ...r.pumps.jockeys.map((j) => j.controller)];
    const box = (rect: PlacedEquipment['rect'], baseZ: number, h: number, rotExtra = 0): { kind: 'box'; origin: Vec3; sizeMm: [number, number, number]; rotationDeg: number } => {
      const [cx, cy] = toBuilding(rect.x + rect.w / 2, rect.y + rect.h / 2);
      return { kind: 'box', origin: [cx, cy, baseZ], sizeMm: [rect.w, rect.h, h], rotationDeg: roomPl!.rotationDeg + rotExtra };
    };
    for (const e of room.equipment) {
      const props: BimElement['properties'] = { Label: e.label, Kind: e.kind };
      if (e.kind === 'fire-pump' || e.kind === 'jockey-pump') {
        const main = r.pumps.mainPumps.find((p) => p.tag === e.tag);
        const jp = r.pumps.jockeys.find((p) => p.tag === e.tag);
        if (main) Object.assign(props, { Driver: main.driver, Role: main.role, RatedFlowGpm: main.ratedFlowGpm, RatedNetPressurePsi: main.ratedNetPressurePsi, DriverHp: main.driverHp, SpeedRpm: main.speedRpm });
        if (jp) Object.assign(props, { RatedFlowGpm: jp.ratedFlowGpm, RatedNetPressurePsi: jp.ratedNetPressurePsi, DriverHp: jp.motorHp });
        const type = main
          ? ({ 'horizontal-split-case': 'SPLITCASE', 'end-suction': 'ENDSUCTION', 'vertical-inline': 'VERTICALINLINE', 'vertical-turbine': 'VERTICALTURBINE' } as const)[main.pumpType]
          : 'ENDSUCTION';
        add(stId, sid, { tag: e.tag, name: `${e.kind === 'fire-pump' ? 'Fire pump' : 'Jockey pump'} ${e.tag}`, ifcClass: 'IfcPump', predefinedType: type, geometry: box(e.rect, zAt(el.padTopM), 1.2 * el.pumpCLM * 1000), properties: props });
      } else if (e.kind === 'fuel-tank') {
        add(stId, sid, { tag: e.tag, name: `Diesel fuel tank ${e.tag}`, ifcClass: 'IfcTank', predefinedType: 'STORAGE', geometry: box(e.rect, zAt(el.padTopM), 1000), properties: props });
      } else if (e.kind === 'drain-pit') {
        const depth = room.drainageSump.pitDepthMm > 0 ? room.drainageSump.pitDepthMm : 600;
        add(stId, sid, { tag: e.tag, name: `Drainage sump pit ${e.tag}`, ifcClass: 'IfcBuildingElementProxy', predefinedType: 'USERDEFINED', objectType: 'DRAINPIT', geometry: box(e.rect, roomFfl - depth, depth), properties: props });
      } else {
        const spec = controllers.find((c) => c.tag === e.tag);
        const h = spec?.heightMm ?? 1800;
        add(stId, sid, {
          tag: e.tag,
          name: `${e.kind === 'transfer-switch' ? 'Transfer switch' : 'Controller'} ${e.tag}`,
          ifcClass: 'IfcBuildingElementProxy',
          predefinedType: 'USERDEFINED',
          objectType: 'CONTROLPANEL',
          geometry: box(e.rect, roomFfl + (spec?.mounting === 'wall' ? 800 : 0), h),
          properties: { ...props, ...(spec ? { Listing: spec.listing } : {}) }
        });
      }
    }
    for (const p of room.pipes) {
      if (p.points.length < 2) continue;
      addPolyline(stId, sid, p.id, `Pump room pipe ${p.sizeIn}" ${p.service}`, p.points.map(([x, y]) => toBuilding(x, y)), pipeZ[p.service], od(p.sizeIn), {
        Size: `${p.sizeIn}"`,
        NominalSizeIn: p.sizeIn,
        Service: p.service
      });
    }
    for (const v of room.valves) {
      const o = od(v.sizeIn);
      const body = Math.max(o * 1.2, 40);
      let cls: BimIfcClass = 'IfcValve';
      let type = 'USERDEFINED';
      let objectType: string | undefined = v.kind.toUpperCase().replace(/[^A-Z0-9]/g, '');
      let len = valveLengthMm(v.kind, v.sizeIn);
      switch (v.kind) {
        case 'os&y-gate':
        case 'butterfly':
        case 'ball-valve':
          type = 'ISOLATING';
          break;
        case 'check':
        case 'sensing-check':
          type = 'CHECK';
          break;
        case 'relief':
        case 'circulation-relief':
          type = 'PRESSURERELIEF';
          break;
        case 'hose-valve':
          type = 'FAUCET';
          break;
        case 'flow-meter':
          cls = 'IfcFlowMeter';
          type = 'WATERMETER';
          break;
        case 'pressure-gauge':
          cls = 'IfcSensor';
          type = 'PRESSURESENSOR';
          len = 80;
          break;
        case 'tamper-switch':
          cls = 'IfcSensor';
          type = 'CONTACTSENSOR';
          len = 80;
          break;
        case 'eccentric-reducer':
        case 'concentric-increaser':
          cls = 'IfcPipeFitting';
          type = 'TRANSITION';
          break;
        case 'flexible-coupling':
          cls = 'IfcPipeFitting';
          type = 'CONNECTOR';
          break;
      }
      if (type !== 'USERDEFINED') objectType = undefined;
      const [cx, cy] = toBuilding(v.x, v.y);
      add(stId, sid, {
        tag: v.tag,
        name: `${v.kind} ${v.sizeIn}" ${v.tag}`,
        ifcClass: cls,
        predefinedType: type,
        ...(objectType ? { objectType } : {}),
        geometry: { kind: 'box', origin: [cx, cy, pipeZ[v.service] - body / 2], sizeMm: [len, body, body], rotationDeg: v.angleDeg + roomPl.rotationDeg },
        properties: { Kind: v.kind, Size: `${v.sizeIn}"`, NominalSizeIn: v.sizeIn, Service: v.service }
      });
    }
    // fire water tank on the far side of the common (west) wall, south edge flush with the room origin
    const t = r.tank;
    const wall = room.wallThicknessMm;
    const tLen = t.internalLengthM * 1000; // along the wall (y)
    const tDepth = t.internalWidthM * 1000; // away from the wall (-x)
    const [tcx, tcy] = toBuilding(-wall - tDepth / 2, tLen / 2);
    add(stId, sid, {
      key: 'tank',
      tag: 'TK-1',
      name: 'Fire water tank',
      ifcClass: 'IfcTank',
      predefinedType: 'STORAGE',
      geometry: { kind: 'box', origin: [tcx, tcy, zAt(el.tankFloorM)], sizeMm: [tDepth, tLen, t.totalInternalHeightM * 1000], rotationDeg: roomPl.rotationDeg },
      properties: {
        EffectiveVolumeM3: t.providedEffectiveM3,
        RequiredVolumeM3: t.requiredEffectiveM3,
        EffectiveDepthM: t.effectiveDepthM,
        Compartments: t.compartments,
        Material: t.material,
        Placement: t.placement
      }
    });
  }

  // ───────────────────────── CO2 ─────────────────────────
  const co2 = r.co2;
  const cin = input.co2Design;
  if (co2 && cin) {
    const hasStorage = co2.floors.length > 0;
    for (const fd of co2.floors) {
      const fin = cin.floors.find((x) => x.id === fd.floorId);
      const st = storeyOf(fd.floorId);
      const ffl = st.elevationMm;
      const heights = new Map((fin?.enclosures ?? []).map((e) => [e.id, e.heightM * 1000] as const));
      const minH = heights.size > 0 ? Math.min(...heights.values()) : 3000;
      const hOf = (id: string | null): number => (id ? heights.get(id) : undefined) ?? minH;
      const csys = sys(`SYS-CO2-${fd.floorId}`, `CO2 ${fd.floorName}`, 'fire-co2', 'co2');
      const asys = sys(`SYS-FA-${fd.floorId}`, `CO2 detection and alarm ${fd.floorName}`, 'fire-alarm', 'alarm');
      for (const enc of fd.enclosures) {
        for (const n of enc.nozzles) {
          const top = ffl + hOf(enc.enclosureId) - 100;
          add(fd.floorId, csys, {
            key: `co2n|${fd.floorId}|${n.tag}`,
            tag: n.tag,
            name: `CO2 nozzle ${n.tag}`,
            ifcClass: 'IfcFireSuppressionTerminal',
            predefinedType: 'USERDEFINED',
            objectType: 'CO2NOZZLE',
            geometry: { kind: 'cylinder', base: [n.x, n.y, top - 120], diameterMm: 60, heightMm: 120 },
            properties: { Enclosure: enc.enclosureId, FlowLbMin: n.flowLbMin, PressurePsi: n.pressurePsi, OrificeCode: n.orificeCode, OrificeAreaIn2: n.orificeAreaIn2 }
          });
        }
      }
      for (const p of fd.pipes) {
        addPolyline(fd.floorId, csys, p.id, `CO2 pipe ${p.sizeIn}" ${p.kind}`, p.points, ffl + hOf(p.enclosureId) - 250, od(p.sizeIn), {
          Size: `${p.sizeIn}"`,
          NominalSizeIn: p.sizeIn,
          Schedule: p.schedule,
          LengthM: p.lengthM,
          Kind: p.kind,
          FlowLbMin: p.flowLbMin,
          FromNode: p.fromNode,
          ToNode: p.toNode
        });
      }
      for (const d of fd.devices) {
        const ceil = ffl + hOf(d.enclosureId);
        const props: BimElement['properties'] = { Device: d.kind, ...(d.enclosureId ? { Enclosure: d.enclosureId } : {}), ...(d.zone ? { DetectionZone: d.zone } : {}) };
        const tag = d.tag;
        const cyl = (diameter: number, h: number, baseZ: number): BimElement['geometry'] => ({ kind: 'cylinder', base: [d.x, d.y, baseZ], diameterMm: diameter, heightMm: h });
        const bx = (w: number, dd: number, h: number, baseZ: number): BimElement['geometry'] => ({ kind: 'box', origin: [d.x, d.y, baseZ], sizeMm: [w, dd, h], rotationDeg: 0 });
        switch (d.kind) {
          case 'smoke-detector':
            add(fd.floorId, asys, { tag, name: `Smoke detector ${tag}`, ifcClass: 'IfcSensor', predefinedType: 'SMOKESENSOR', geometry: cyl(100, 50, ceil - 50), properties: props });
            break;
          case 'heat-detector':
            add(fd.floorId, asys, { tag, name: `Heat detector ${tag}`, ifcClass: 'IfcSensor', predefinedType: 'HEATSENSOR', geometry: cyl(100, 50, ceil - 50), properties: props });
            break;
          case 'horn-strobe':
            add(fd.floorId, asys, { tag, name: `Horn/strobe ${tag}`, ifcClass: 'IfcAlarm', predefinedType: 'SIREN', geometry: bx(150, 100, 150, ffl + 2300), properties: props });
            break;
          case 'strobe-outside':
            add(fd.floorId, asys, { tag, name: `Strobe ${tag}`, ifcClass: 'IfcAlarm', predefinedType: 'LIGHT', geometry: bx(120, 80, 120, ffl + 2300), properties: props });
            break;
          case 'manual-release':
            add(fd.floorId, asys, { tag, name: `Manual release ${tag}`, ifcClass: 'IfcAlarm', predefinedType: 'MANUALPULLBOX', geometry: bx(130, 80, 130, ffl + 1200), properties: props });
            break;
          case 'control-panel':
            add(fd.floorId, asys, { tag, name: `CO2 control panel ${tag}`, ifcClass: 'IfcBuildingElementProxy', predefinedType: 'USERDEFINED', objectType: 'CONTROLPANEL', geometry: bx(600, 200, 800, ffl + 1200), properties: props });
            break;
          case 'lockout-valve':
          case 'selector-valve':
            add(fd.floorId, csys, { tag, name: `${d.kind === 'lockout-valve' ? 'Lockout valve' : 'Selector valve'} ${tag}`, ifcClass: 'IfcValve', predefinedType: 'USERDEFINED', objectType: d.kind === 'lockout-valve' ? 'LOCKOUTVALVE' : 'SELECTORVALVE', geometry: bx(250, 150, 150, ceil - 400), properties: props });
            break;
          case 'pressure-switch':
            add(fd.floorId, csys, { tag, name: `Pressure switch ${tag}`, ifcClass: 'IfcSensor', predefinedType: 'PRESSURESENSOR', geometry: cyl(80, 80, ceil - 450), properties: props });
            break;
          case 'pressure-relief-vent':
            add(fd.floorId, asys, { tag, name: `Pressure relief vent ${tag}`, ifcClass: 'IfcBuildingElementProxy', predefinedType: 'USERDEFINED', objectType: 'PRESSUREVENT', geometry: bx(400, 100, 400, ffl + 2200), properties: props });
            break;
          case 'warning-sign':
            add(fd.floorId, asys, { tag, name: `Warning sign ${tag}`, ifcClass: 'IfcBuildingElementProxy', predefinedType: 'USERDEFINED', objectType: 'WARNINGSIGN', geometry: bx(300, 20, 200, ffl + 2000), properties: props });
            break;
        }
      }
    }
    if (hasStorage) {
      const first = co2.floors[0];
      const st = co2.storage;
      const ffl = storeyOf(first.floorId).elevationMm;
      const csys = sys(`SYS-CO2-${first.floorId}`, `CO2 ${first.floorName}`, 'fire-co2', 'co2');
      if (co2.floors.some((f) => Math.abs(f.storage.x - first.storage.x) > 1 || Math.abs(f.storage.y - first.storage.y) > 1)) {
        warnings.push(`CO2 storage: the design has one supply but several storage points - the cylinders are modelled at the storage point of level ${first.floorId}.`);
      }
      const total = st.mainCylinders + st.reserveCylinders;
      for (let i = 0; i < total; i++) {
        const main = i < st.mainCylinders;
        const idx = main ? i + 1 : i - st.mainCylinders + 1;
        const col = i % 6;
        const row = Math.floor(i / 6);
        add(first.floorId, csys, {
          key: `co2cyl|${i}`,
          tag: `CYL-${main ? 'M' : 'R'}${idx}`,
          name: `CO2 cylinder ${main ? 'M' : 'R'}${idx}`,
          ifcClass: 'IfcTank',
          predefinedType: 'PRESSUREVESSEL',
          geometry: { kind: 'cylinder', base: [first.storage.x + col * 350, first.storage.y + row * 400, ffl], diameterMm: 267, heightMm: 1500 },
          properties: { Role: main ? 'main' : 'reserve', NetCo2Lb: st.cylinderLb }
        });
      }
      if (st.tankTons) {
        add(first.floorId, csys, {
          key: 'co2tank',
          tag: 'CO2-TK-1',
          name: 'CO2 low-pressure storage tank',
          ifcClass: 'IfcTank',
          predefinedType: 'STORAGE',
          geometry: { kind: 'cylinder', base: [first.storage.x, first.storage.y, ffl], diameterMm: 1600, heightMm: 3500 },
          properties: { CapacityTons: st.tankTons }
        });
      }
    }
  }

  // ───────────────────────── extinguishers ─────────────────────────
  const ex = r.extinguishers;
  if (ex && ex.zones.length > 0) {
    const fsys = sys('SYS-FE', 'Portable fire extinguishers', 'fire-extinguisher', 'extinguisher');
    const inputZones = new Map((input.extinguishers?.zones ?? []).map((z) => [z.id, z] as const));
    const nextX = new Map<string, number>();
    const schematic: string[] = [];
    for (const zd of ex.zones) {
      let origin = placement.extinguisherZones?.[zd.zoneId];
      if (!origin) {
        const zin = inputZones.get(zd.zoneId);
        const wM = (zin?.lengthM ?? zd.lengthFt * 0.3048) * 1000;
        const dM = (zin?.widthM ?? zd.widthFt * 0.3048) * 1000;
        const x = nextX.get(zd.floorId) ?? 0;
        nextX.set(zd.floorId, x + wM + 2000);
        origin = { x, y: -20000 - dM };
        schematic.push(zd.zoneId);
      }
      const st = storeyOf(zd.floorId);
      for (const e of zd.extinguishers) {
        const unit = ex.catalog.find((u) => u.id === e.unitId);
        const h = unit?.heightMm ?? 500;
        const topAbs = st.elevationMm + e.mountingTopMm;
        add(zd.floorId, fsys, {
          key: `fe|${e.tag}`,
          tag: e.tag,
          name: `Fire extinguisher ${unit?.label ?? e.unitId}`,
          ifcClass: 'IfcFireSuppressionTerminal',
          predefinedType: 'USERDEFINED',
          objectType: 'FIREEXTINGUISHER',
          geometry: { kind: 'cylinder', base: [origin.x + e.xM * 1000, origin.y + e.yM * 1000, Math.max(st.elevationMm, topAbs - h)], diameterMm: 180, heightMm: h },
          properties: { Zone: zd.zoneId, Unit: e.unitId, Rating: unit?.ratingText ?? '', Purpose: e.purpose, Mounting: e.mounting, CoverageRadiusFt: e.coverageRadiusFt }
        });
      }
    }
    if (schematic.length > 0) {
      warnings.push(`Extinguisher zones placed on a schematic grid south of the building: ${schematic.join(', ')}. Set the zone origins to the room positions.`);
    }
  }

  return {
    projectName: input.projectName,
    projectNumber: input.projectNumber,
    discipline: 'Fire Protection',
    storeys: [...storeys.values()].sort((a, b) => a.elevationMm - b.elevationMm),
    systems: [...systems.values()],
    elements,
    warnings
  };
}
