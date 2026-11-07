/**
 * IFC4 (ISO 16739-1:2018, schema 'IFC4') STEP writer for the discipline-neutral BimModel.
 *
 * Output is a reference-view style MEP model that Revit links with Insert > Link IFC:
 *   IfcProject (mm) > IfcSite > IfcBuilding > IfcBuildingStorey (elevation, placement z = elevation)
 *   each element: IfcLocalPlacement relative to its storey, 'Body' / 'SweptSolid' (IfcExtrudedAreaSolid), IfcStyledItem
 *   (system colour), property set 'MEP_Design', containment in the storey, assignment to its IfcDistributionSystem.
 * Deterministic: GlobalIds are hashed from `${discipline}|${key}`; the only variable input is the timestamp option.
 */
import type { BimElement, BimGeometry, BimModel, Vec3 } from './bimTypes';

export interface IfcWriteOptions {
  /** ISO-8601 local date-time written to FILE_NAME (default: fixed epoch so output is reproducible). */
  timestamp?: string;
}

// ───────────────────────────── STEP encoding helpers ─────────────────────────────

/** REAL with a decimal point, no exponent notation (ISO 10303-21 §6.4.4). */
function real(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`IFC writer: non-finite number ${v}`);
  const r = Math.abs(v) < 1e-9 ? 0 : v;
  let s = r.toFixed(6);
  s = s.replace(/0+$/, '');
  return s === '-0.' ? '0.' : s;
}

/** String per ISO 10303-21: quote doubling, backslash doubling, \X2\ / \X4\ for non-ASCII, no control characters. */
export function stepString(text: string, maxLen = 255): string {
  // '#<digit>' would look like an instance reference to naive scanners — keep names free of it
  const t = text.replace(/#(?=\d)/g, 'No.').replace(/[\r\n\t]+/g, ' ');
  const cps = Array.from(t).slice(0, maxLen);
  let out = '';
  let hex: string[] = [];
  let wide = false;
  const flush = (): void => {
    if (hex.length === 0) return;
    out += `${wide ? '\\X4\\' : '\\X2\\'}${hex.join('')}\\X0\\`;
    hex = [];
    wide = false;
  };
  for (const ch of cps) {
    const cp = ch.codePointAt(0) ?? 0x20;
    if (cp >= 0x20 && cp <= 0x7e) {
      flush();
      out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch;
    } else if (cp < 0x20 || cp === 0x7f) {
      flush();
      out += ' ';
    } else {
      // all pending characters of a run are written with the wider form when any needs it
      if (cp > 0xffff) {
        if (!wide && hex.length > 0) hex = hex.map((h) => h.padStart(8, '0'));
        wide = true;
      }
      hex.push(wide ? cp.toString(16).toUpperCase().padStart(8, '0') : cp.toString(16).toUpperCase().padStart(4, '0'));
    }
  }
  flush();
  return `'${out}'`;
}

const S = stepString;
const list = (ids: number[]): string => `(${ids.map((i) => `#${i}`).join(',')})`;
const ref = (i: number | null): string => (i === null ? '$' : `#${i}`);

// ───────────────────────────── GlobalId ─────────────────────────────

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** cyrb128-style 4 × 32-bit hash of a string. */
function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** IFC GlobalId: 128 bit → 22 characters (first char 2 bits, then 6 bits each), compressed base-64 alphabet. */
function globalId(seed: string): string {
  const [a, b, c, d] = hash128(seed);
  let v = (BigInt(a) << 96n) | (BigInt(b) << 64n) | (BigInt(c) << 32n) | BigInt(d);
  const chars: string[] = [];
  for (let i = 0; i < 21; i++) {
    chars.push(B64[Number(v & 63n)]);
    v >>= 6n;
  }
  chars.push(B64[Number(v & 3n)]);
  return chars.reverse().join('');
}

// ───────────────────────────── geometry helpers ─────────────────────────────

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

class StepFile {
  private readonly lines: string[] = [];
  private next = 1;
  private readonly cache = new Map<string, number>();

  add(entity: string): number {
    const id = this.next++;
    this.lines.push(`#${id}=${entity};`);
    return id;
  }

  /** De-duplicated entity (points / directions / placements). */
  shared(entity: string): number {
    const hit = this.cache.get(entity);
    if (hit !== undefined) return hit;
    const id = this.add(entity);
    this.cache.set(entity, id);
    return id;
  }

  body(): string {
    return this.lines.join('\n');
  }
}

// ───────────────────────────── writer ─────────────────────────────

export function writeIfc(model: BimModel, options: IfcWriteOptions = {}): string {
  const timestamp = options.timestamp ?? '2026-01-01T00:00:00';
  const f = new StepFile();
  const used = new Set<string>();
  const gid = (seed: string): string => {
    let key = `${model.discipline}|${seed}`;
    let g = globalId(key);
    let n = 0;
    while (used.has(g)) g = globalId(`${key}#${++n}`);
    used.add(g);
    return g;
  };
  const root = (seed: string, name: string | null = null, desc: string | null = null): string =>
    `'${gid(seed)}',$,${name === null ? '$' : S(name)},${desc === null ? '$' : S(desc)}`;

  const pnt = (x: number, y: number, z: number): number => f.shared(`IFCCARTESIANPOINT((${real(x)},${real(y)},${real(z)}))`);
  const dir = (x: number, y: number, z: number): number => f.shared(`IFCDIRECTION((${real(x)},${real(y)},${real(z)}))`);
  const axis = (loc: Vec3, z?: Vec3, x?: Vec3): number =>
    f.shared(`IFCAXIS2PLACEMENT3D(#${pnt(loc[0], loc[1], loc[2])},${z ? `#${dir(z[0], z[1], z[2])}` : '$'},${x ? `#${dir(x[0], x[1], x[2])}` : '$'})`);
  const placement = (parent: number | null, a: number): number => f.add(`IFCLOCALPLACEMENT(${ref(parent)},#${a})`);

  // ── project, units, contexts
  const origin = axis([0, 0, 0]);
  const ctx = f.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${origin},$)`);
  const body = f.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${ctx},$,.MODEL_VIEW.,$)`);
  const uLen = f.add('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
  const uArea = f.add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const uVol = f.add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const uAng = f.add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const units = f.add(`IFCUNITASSIGNMENT(${list([uLen, uArea, uVol, uAng])})`);
  const project = f.add(`IFCPROJECT(${root('project', model.projectName || 'MEP Project', model.projectNumber ? `Project ${model.projectNumber} - ${model.discipline}` : null)},$,$,$,(#${ctx}),#${units})`);

  const sitePl = placement(null, origin);
  const site = f.add(`IFCSITE(${root('site', 'Site')},$,#${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = placement(sitePl, origin);
  const building = f.add(`IFCBUILDING(${root('building', model.projectName || 'Building')},$,#${bldPl},$,$,.ELEMENT.,$,$,$)`);
  f.add(`IFCRELAGGREGATES(${root('agg-project')},#${project},(#${site}))`);
  f.add(`IFCRELAGGREGATES(${root('agg-site')},#${site},(#${building}))`);

  const storeyInfo = new Map<string, { id: number; pl: number; elev: number }>();
  for (const st of model.storeys) {
    const pl = placement(bldPl, axis([0, 0, st.elevationMm]));
    const id = f.add(`IFCBUILDINGSTOREY(${root(`storey|${st.id}`, st.name)},$,#${pl},$,$,.ELEMENT.,${real(st.elevationMm)})`);
    storeyInfo.set(st.id, { id, pl, elev: st.elevationMm });
  }
  if (storeyInfo.size > 0) f.add(`IFCRELAGGREGATES(${root('agg-building')},#${building},${list([...storeyInfo.values()].map((s) => s.id))})`);

  // ── systems (colour styles are shared per system)
  const systemIds = new Map<string, number>();
  const styleIds = new Map<string, number>();
  for (const sys of model.systems) {
    systemIds.set(sys.id, f.add(`IFCDISTRIBUTIONSYSTEM(${root(`system|${sys.id}`, sys.name)},$,$,.${sys.ifcPredefinedType}.)`));
    const [r, g, b] = sys.color;
    const rgb = f.shared(`IFCCOLOURRGB($,${real(r)},${real(g)},${real(b)})`);
    const rend = f.shared(`IFCSURFACESTYLERENDERING(#${rgb},$,$,$,$,$,$,$,.NOTDEFINED.)`);
    styleIds.set(sys.id, f.add(`IFCSURFACESTYLE(${S(sys.name)},.BOTH.,(#${rend}))`));
  }

  // ── geometry
  const circleProfile = (d: number): number => f.shared(`IFCCIRCLEPROFILEDEF(.AREA.,$,$,${real(d / 2)})`);
  const rectProfile = (w: number, h: number): number => f.shared(`IFCRECTANGLEPROFILEDEF(.AREA.,$,$,${real(w)},${real(h)})`);
  const zDir = dir(0, 0, 1);

  /** Element placement (location rel. to storey) + the swept solid in element coordinates. */
  function geometryOf(el: BimElement, storeyElev: number): { loc: Vec3; refX?: Vec3; solid: number } {
    const g: BimGeometry = el.geometry;
    const check = (v: number[], what: string): void => {
      if (v.some((x) => !Number.isFinite(x))) throw new Error(`IFC writer: ${el.tag} has non-finite ${what}`);
    };
    if (g.kind === 'segment') {
      check([...g.start, ...g.end], 'segment coordinates');
      const d = sub(g.end, g.start);
      const length = len3(d);
      if (length < 1e-6) throw new Error(`IFC writer: ${el.tag} has zero length`);
      const u: Vec3 = [d[0] / length, d[1] / length, d[2] / length];
      // profile local x must be horizontal & perpendicular to the run so a rectangle's width is horizontal
      const horiz = Math.hypot(u[0], u[1]);
      const rx: Vec3 = horiz < 1e-9 ? [1, 0, 0] : [-u[1] / horiz, u[0] / horiz, 0];
      const profile =
        g.profile.shape === 'circle' ? circleProfile(positive(g.profile.diameterMm, el.tag)) : rectProfile(positive(g.profile.widthMm, el.tag), positive(g.profile.heightMm, el.tag));
      const pos = axis([0, 0, 0], u, rx);
      return { loc: [g.start[0], g.start[1], g.start[2] - storeyElev], solid: f.add(`IFCEXTRUDEDAREASOLID(#${profile},#${pos},#${zDir},${real(length)})`) };
    }
    if (g.kind === 'box') {
      check([...g.origin, ...g.sizeMm, g.rotationDeg], 'box');
      const [w, dpt, h] = g.sizeMm;
      const a = (g.rotationDeg * Math.PI) / 180;
      const profile = rectProfile(positive(w, el.tag), positive(dpt, el.tag));
      return { loc: [g.origin[0], g.origin[1], g.origin[2] - storeyElev], refX: [Math.cos(a), Math.sin(a), 0], solid: f.add(`IFCEXTRUDEDAREASOLID(#${profile},#${origin},#${zDir},${real(positive(h, el.tag))})`) };
    }
    check([...g.base, g.diameterMm, g.heightMm], 'cylinder');
    const profile = circleProfile(positive(g.diameterMm, el.tag));
    return { loc: [g.base[0], g.base[1], g.base[2] - storeyElev], solid: f.add(`IFCEXTRUDEDAREASOLID(#${profile},#${origin},#${zDir},${real(positive(g.heightMm, el.tag))})`) };
  }
  function positive(v: number, tag: string): number {
    if (!(v > 0) || !Number.isFinite(v)) throw new Error(`IFC writer: ${tag} has a non-positive size`);
    return v;
  }

  const byStorey = new Map<string, number[]>();
  const bySystem = new Map<string, number[]>();

  for (const el of model.elements) {
    const st = storeyInfo.get(el.storeyId);
    if (!st) throw new Error(`IFC writer: ${el.tag} references unknown storey ${el.storeyId}`);
    if (!systemIds.has(el.systemId)) throw new Error(`IFC writer: ${el.tag} references unknown system ${el.systemId}`);
    const { loc, refX, solid } = geometryOf(el, st.elev);
    f.add(`IFCSTYLEDITEM(#${solid},(#${styleIds.get(el.systemId)}),$)`);
    const shapeRep = f.add(`IFCSHAPEREPRESENTATION(#${body},'Body','SweptSolid',(#${solid}))`);
    const shape = f.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRep}))`);
    const pl = placement(st.pl, axis(loc, undefined, refX));
    const cls = el.ifcClass.toUpperCase();
    const id = f.add(
      `${cls}(${root(`el|${el.key}`, el.name)},${el.objectType ? S(el.objectType) : '$'},#${pl},#${shape},${S(el.tag)},.${el.predefinedType}.)`
    );
    (byStorey.get(el.storeyId) ?? byStorey.set(el.storeyId, []).get(el.storeyId)!).push(id);
    (bySystem.get(el.systemId) ?? bySystem.set(el.systemId, []).get(el.systemId)!).push(id);

    const props: number[] = [];
    for (const [k, v] of Object.entries(el.properties)) {
      let value: string;
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) continue;
        value = `IFCREAL(${real(v)})`;
      } else if (typeof v === 'boolean') value = `IFCBOOLEAN(${v ? '.T.' : '.F.'})`;
      else value = `IFCLABEL(${S(String(v))})`;
      props.push(f.add(`IFCPROPERTYSINGLEVALUE(${S(k, 255)},$,${value},$)`));
    }
    if (props.length > 0) {
      const pset = f.add(`IFCPROPERTYSET('${gid(`pset|${el.key}`)}',$,'MEP_Design',$,${list(props)})`);
      f.add(`IFCRELDEFINESBYPROPERTIES('${gid(`psetrel|${el.key}`)}',$,$,$,(#${id}),#${pset})`);
    }
  }

  for (const [sid, ids] of byStorey) {
    f.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${root(`contain|${sid}`)},${list(ids)},#${storeyInfo.get(sid)!.id})`);
  }
  for (const [sysId, ids] of bySystem) {
    const sys = systemIds.get(sysId)!;
    f.add(`IFCRELASSIGNSTOGROUP(${root(`assign|${sysId}`)},${list(ids)},$,#${sys})`);
    f.add(`IFCRELSERVICESBUILDINGS(${root(`services|${sysId}`)},#${sys},(#${building}))`);
  }

  const header = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${S(`${(model.projectNumber || 'model').replace(/[^\w.-]+/g, '_')}-${model.discipline.replace(/\s+/g, '')}.ifc`)},${S(timestamp)},('MEP Design Suite'),('MEP'),'MEP Design Suite IFC writer','MEP Design Suite','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;'
  ].join('\n');
  return `${header}\n${f.body()}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
