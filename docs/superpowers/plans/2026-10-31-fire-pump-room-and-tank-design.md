# Fire Pump Room & Fire Water Tank Design — Implementation Plan

> Spec: `docs/superpowers/specs/2026-10-31-fire-pump-room-and-tank-design.md`
> Contracts (DO NOT change signatures without updating tests): `engine/fireProtection/fpTypes.ts`,
> `engine/fireProtection/drawing/drawingTypes.ts`.
> All paths below are relative to `src/renderer/src/`.

**Goal:** Fire-fighting discipline: NFPA-based hydraulics → pump set → tank & sump → pump-room
layout → 5-sheet R12 DXF + SVG preview, with a UI branch in the app.

**Tech:** TypeScript (strict), React 19, zustand, Tailwind, lucide-react. Tests are plain
`tsx` assertion scripts (no framework): `npx tsx src/renderer/src/engine/__tests__/<file>.test.ts`
must print results and exit 0; a failed `assert` throws. Typecheck: `npm run typecheck`.

**Rules for every task**
- Pure functions in the engine; no React / DOM imports under `engine/`.
- No `any` unless unavoidable; no unused identifiers (tsc `noUnusedLocals` is on).
- Each exported function has a short doc comment citing the standard clause it implements.
- Commit after the task's tests pass: `git add -A && git commit -m "feat(fire): <task>"`.

---

## Task 1 — Standards data + pipe data + hydraulics

Files: `engine/fireProtection/standards/{nfpa13,nfpa14,nfpa20,pipeData,codeReferences}.ts`,
`engine/fireProtection/hydraulics.ts`, `engine/fireProtection/defaults.ts` (DEFAULT_FIRE_INPUT, see §3.4).
Tests: `engine/__tests__/fireStandardsAndHydraulics.test.ts` (provided — make it pass).

### 1.1 `standards/pipeData.ts`
```ts
export const NOMINAL_SIZES_IN = [0.75,1,1.25,1.5,2,2.5,3,3.5,4,5,6,8,10,12,14,16] as const;
export const PIPE_DATA: Record<number,{ dn:number; odIn:number; idSch40:number; idSch10:number }>
```
| in | DN | OD in | ID Sch40 | ID Sch10 |
|---|---|---|---|---|
|0.75|20|1.050|0.824|0.884|
|1|25|1.315|1.049|1.097|
|1.25|32|1.660|1.380|1.442|
|1.5|40|1.900|1.610|1.682|
|2|50|2.375|2.067|2.157|
|2.5|65|2.875|2.469|2.635|
|3|80|3.500|3.068|3.260|
|3.5|90|4.000|3.548|3.760|
|4|100|4.500|4.026|4.260|
|5|125|5.563|5.047|5.295|
|6|150|6.625|6.065|6.357|
|8|200|8.625|7.981|8.329|
|10|250|10.750|10.020|10.420|
|12|300|12.750|11.938|12.390|
|14|350|14.000|13.124|13.500|
|16|400|16.000|15.000|15.670|

Export helpers: `internalDiameterIn(nominal, schedule)`, `outsideDiameterMm(nominal)` (= odIn×25.4),
`dnOf(nominal)`, `nextLargerSize(nominal)` (next entry in NOMINAL_SIZES_IN, throws past 16),
`formatPipeSize(nominal)` → `'DN150 (6")'` style, fractional inch rendering for 0.75/1.25/1.5/2.5/3.5 as
`¾ 1¼ 1½ 2½ 3½`, e.g. `'DN65 (2½")'`.
Valve face-to-face (mm), class 125/150 flanged, used by the layout:
`gateValveLengthMm(n) = round(180 + 15*n*?)` → use table: 2:178, 2.5:190, 3:203, 4:229, 5:254, 6:267, 8:292, 10:330, 12:356, 14:381, 16:406;
`checkValveLengthMm`: 2:203, 2.5:216, 3:241, 4:292, 5:330, 6:356, 8:495, 10:622, 12:698, 14:787, 16:864;
`butterflyValveLengthMm`: 2:43, 2.5:46, 3:46, 4:52, 5:56, 6:56, 8:60, 10:68, 12:78, 14:92, 16:102.
For sizes < 2" use the 2" value.

### 1.2 `standards/nfpa13.ts`
```ts
export interface HazardDesignData { label:string; densityGpmFt2:number; areaFt2:number; maxCoverageFt2:number;
  maxSpacingFt:number; hoseInsideGpm:number; hoseTotalGpm:number; durationMin:[number,number]; reference:string }
export const HAZARD_DESIGN: Record<HazardClass, HazardDesignData>
```
| hazard | label | density | area | max cov | max S | hose inside | hose total | duration |
|---|---|---|---|---|---|---|---|---|
|light|Light Hazard|0.10|1500|225|15|100|100|[30,30]|
|ordinary-1|Ordinary Hazard Group 1|0.15|1500|130|15|100|250|[60,90]|
|ordinary-2|Ordinary Hazard Group 2|0.20|1500|130|15|100|250|[60,90]|
|extra-1|Extra Hazard Group 1|0.30|2500|100|12|100|500|[90,120]|
|extra-2|Extra Hazard Group 2|0.40|2500|100|12|100|500|[90,120]|

reference: `'NFPA 13-2019 Fig. 19.3.3.1.1 & Table 19.3.3.1.2'`.
`MIN_END_HEAD_PRESSURE_PSI = 7` (NFPA 13 §27.2.4.8? — cite "NFPA 13-2019 §28.2.4.8.1 minimum operating pressure 7 psi").
`C_FACTOR = { blackSteelWet:120, blackSteelDry:100, galvanizedDry:100, cpvc:150, copper:150, stainless:150, cementLinedDuctile:140 }`.

Equivalent length (ft), Sch 40 steel, C=120 (NFPA 13-2019 Table 28.2.3.1.1):

| in | elbow-45 | elbow-90 | long-turn-90 | tee-branch | butterfly | gate | swing-check |
|---|---|---|---|---|---|---|---|
|0.75|1|2|1|4|—|—|4|
|1|1|2|2|5|—|—|5|
|1.25|1|3|2|6|—|—|7|
|1.5|2|4|2|8|—|—|9|
|2|2|5|3|10|6|1|11|
|2.5|3|6|4|12|7|1|14|
|3|3|7|5|15|10|1|16|
|3.5|3|8|5|17|—|1|19|
|4|4|10|6|20|12|2|22|
|5|5|12|8|25|9|2|27|
|6|7|14|9|30|10|3|32|
|8|9|18|13|35|12|4|45|
|10|11|22|16|50|19|5|55|
|12|13|27|18|60|21|6|65|
|14|17|35|23|71|23|7|76|
|16|19|40|26|81|26|8|87|

"—" → use the value of the nearest larger size that has one. `alarm-check` uses the swing-check value.
C multiplier (Table 28.2.3.1.1 note): `{100:0.713, 120:1.0, 130:1.16, 140:1.33, 150:1.51}`; other C → linear interpolate.
Sch 10 (or any ID ≠ Sch 40): multiply by `(idActual / idSch40)^4.87`.
Export `equivalentLengthFt(type: FittingType, nominalIn, c, schedule): number`.

### 1.3 `standards/nfpa14.ts`
`standpipeFlowGpm(cls, count, sprinklered)`: none→0; II→100; I/III → `min(500 + 250*(count-1), sprinklered?1000:1250)` (count ≥ 1).
`standpipeResidualPsi(cls)`: I/III 100, II 65, none 0. `STANDPIPE_DURATION_MIN = 30`. Reference strings.

### 1.4 `standards/nfpa20.ts`
```ts
export const RATED_CAPACITIES_GPM = [25,50,100,150,200,250,300,400,450,500,750,1000,1250,1500,2000,2500,3000,3500,4000,4500,5000];
export const PUMP_DATA_TABLE: PumpSizeTableRow[]  // "Summary of Centrifugal Fire Pump Data"
```
|gpm|suction|discharge|relief|relief disch|meter|hose valves|header supply|
|---|---|---|---|---|---|---|---|
|25|1|1|0.75|1|1.25|1|1|
|50|1.5|1.25|1.25|1.5|2|1|1.5|
|100|2|2|1.5|2|2.5|1|2.5|
|150|2.5|2.5|2|2.5|3|1|2.5|
|200|3|3|2|2.5|3|1|2.5|
|250|3.5|3|2|2.5|3.5|1|3|
|300|4|4|2.5|3.5|3.5|1|3|
|400|4|4|3|5|4|2|4|
|450|5|5|3|5|4|2|4|
|500|5|5|3|5|5|2|4|
|750|6|6|4|6|5|3|6|
|1000|8|6|4|8|6|4|6|
|1250|8|8|6|8|6|6|8|
|1500|8|8|6|8|8|6|8|
|2000|10|10|6|10|8|6|8|
|2500|10|10|6|10|8|8|10|
|3000|12|12|8|12|8|12|10|
|3500|12|12|8|12|10|12|12|
|4000|14|12|8|14|10|16|12|
|4500|16|14|8|14|10|16|12|
|5000|16|14|8|14|10|20|12|

Other exports:
- `NEMA_MOTOR_HP = [0.5,0.75,1,1.5,2,3,5,7.5,10,15,20,25,30,40,50,60,75,100,125,150,200,250,300,350,400,450,500,600,700,800]`
- `DIESEL_ENGINE_HP = [30,40,50,63,75,89,100,115,125,140,165,180,200,230,260,300,340,375,420,460,525,600,700,800]`
- `JOCKEY_FLOWS_GPM = [1,2,3,5,7,10,15,20,25,30,40,50]`
- `MAX_SUCTION_VELOCITY_FPS = 15`, `MIN_SUCTION_PRESSURE_TANK_PSI = -3`, `SHUTOFF_MAX_RATIO = 1.40`, `MIN_RATIO_AT_150 = 0.65`
- `ratedEfficiency(gpm)`: ≤250 → 0.60, ≤500 → 0.70, ≤1500 → 0.78, else 0.82
- `pumpSpeedRpm(gpm, hz)`: gpm ≤ 500 → (hz===50?2950:3550); else (hz===50?1480:1770)
- `circulationReliefSizeIn(gpm)`: ≤2500 → 0.75 else 1
- `pumpDataFor(ratedGpm)` → row (exact match, throws otherwise)
- `selectRatedCapacity(demandGpm)` → smallest ≥ demand; throws if > 5000.

### 1.5 `standards/codeReferences.ts`
`STANDARDS_REFERENCES: {code, edition, scope}[]` — the 10 rows of spec §2. `CODE_NOTE` string
("Verify clause numbering against the edition adopted by the Authority Having Jurisdiction.").
`PLUMBING_REQUIREMENTS: {code:string; clause:string; requirement:string}[]` — IPC §608 air gap on
tank fill (air gap ≥ 2 × effective opening diameter above overflow rim), IPC §802 indirect waste
for relief/drip/trench via air gap, UPC §603 air gap, UPC §801 indirect waste, IBC §913.2.1 room
rating, IBC §913.4 valve supervision, NFPA 70 Art. 695 / 110.26.

### 1.6 `hydraulics.ts` (all pure)
```ts
hazenWilliamsPsiPerFt(qGpm, idIn, c) = 4.52 * q^1.85 / (c^1.85 * d^4.87)   // NFPA 13 §28.2.2.1
sprinklerFlow(k, p) = k*sqrt(p);  sprinklerPressure(k, q) = (q/k)^2
elevationPsi(ft) = 0.433*ft;     velocityFps(q, idIn) = 0.4085*q/idIn^2
psiToBar(p) = p*0.0689476; gpmToLpm(q) = q*3.785411784; ftToM(f) = f*0.3048; galToM3(g) = g*0.003785411784
fittingsEquivalentFt(fittings, pipe) → { eqFt, desc }   // desc like "2E 1T 1GV" (E elbow-90, 45 elbow-45, LE long-turn, T tee, BV butterfly, GV gate, CV swing-check, AC alarm-check)
calculatePipeSegment(args:{ fromNode, toNode, description, flowAddedGpm, kFactor?, totalFlowGpm, startPressurePsi, run: PipeRun }): HydraulicNodeRow
   pf = pfPerFt * (lengthFt + eqFt); pe = 0.433 * elevationRiseFt; ptEnd = ptStart + pf + pe
calculateBranchLine(args:{ k, headCount, spacingFt, pipe: PipeSpec, startPressurePsi, prefix: string }): BranchLineResult
calculateSprinklerDemand(input: FireDesignInput): SprinklerDemandResult
calculateStandpipeDemand(input: FireDesignInput): StandpipeDemandResult
calculateSystemDemand(input: FireDesignInput): SystemDemand
```
**Branch line** (heads numbered from the remote end, node names `${prefix}1…${prefix}n`, inlet node `${prefix}0`):
head 1 pressure = startPressurePsi; for i = 1..n: qᵢ = K√Pᵢ, Qcum += qᵢ; segment i→i+1 (i<n) has
length S, no fittings, flow Qcum; Pᵢ₊₁ = Pᵢ + Pf. The final segment n → inlet has length S/2 with one
`tee-branch` fitting and flow Qcum. `inletPressurePsi` = pressure at the inlet. `equivalentK = Q/√Pinlet`.
Every segment produces a row (flowAddedGpm = qᵢ, kFactor = K).

**Remote area** (`calculateSprinklerDemand`):
density/area from overrides else `HAZARD_DESIGN`; coverage = override else maxCoverage;
S = min(√coverage, maxSpacing); n_area = ⌈A / coverage⌉; headsPerBranch = ⌈1.2√A / S⌉;
branchLines = ⌈n_area / headsPerBranch⌉; minHeadFlow = density × coverage;
remoteHeadPressure = max(7, (minHeadFlow/K)²).
Branch line 1 is calculated with prefix `'BL1-'`. Cross-main nodes `CM1..CMm` (m = branchLines):
CM1 pressure = inlet pressure of BL1, flow Q₁. For j = 2..m: segment CM(j-1) → CMj, length S,
cross-main pipe, flow ΣQ so far; Qⱼ = K_eq √P(CMj) (row flowAddedGpm = Qⱼ, description `Branch line j`).
Then segment CMm → `RT` (riser top): length S, one `tee-branch`, cross-main pipe, flow ΣQ.
Then `RT` → `RB` using `input.riser` (rise is positive), then `RB` → `PD` using `input.feedMain`.
`sprinklerFlowGpm` = ΣQ; `pressureAtPumpDischargePsi` = Pt at PD. `rows` = BL1 rows + cross-main rows + riser + feed.

**Standpipe:** flow from nfpa14; residual; pressure = residual + 0.433 × topOutletHeightFt + standpipeFrictionPsi.

**System demand:** hose inside = input.insideHoseGpm; hose total = override ?? table; duration =
override ?? table upper. Sprinkler case Q = sprinklerFlow + insideHose, P = sprinkler pressure.
If standpipe applicable: pumpDemandFlow = max(Qspr case, Qsp), pumpDemandPressure = max(P's),
governingCase = Qsp > Qspr case ? 'standpipe' : 'sprinkler'. Else sprinkler case.
requiredStorageGal = max((sprinklerFlow + hoseTotal) × duration, standpipe applicable ? Qsp × 30 : 0), rounded up to integer.

---

## Task 2 — Drawing kernel (parallel with Task 1)

Files: `engine/fireProtection/drawing/{drawingBuilder,symbols,dxfWriter,svgRenderer}.ts`.
Tests: `engine/__tests__/fireDrawingKernel.test.ts` (provided).

### 2.1 Layers — `FP_LAYERS: LayerDef[]` exported from `drawingBuilder.ts`
| name | ACI | linetype | lw | description |
|---|---|---|---|---|
|FP-WALL|7|CONTINUOUS|0.50|Walls, slabs (cut)|
|FP-WALL-HTCH|8|CONTINUOUS|0.13|Wall / concrete hatch|
|FP-TANK|4|CONTINUOUS|0.50|Fire water tank structure|
|FP-WATR|5|DASHED|0.18|Water levels|
|FP-EQPM|3|CONTINUOUS|0.35|Pumps, drivers, tanks|
|FP-PADS|8|CONTINUOUS|0.25|Concrete housekeeping pads|
|FP-PIPE-SUCT|1|CONTINUOUS|0.50|Suction piping|
|FP-PIPE-DISC|1|CONTINUOUS|0.50|Discharge piping & header|
|FP-PIPE-TEST|6|CONTINUOUS|0.35|Test / flow-meter / relief return|
|FP-PIPE-JCKY|30|CONTINUOUS|0.35|Jockey pump piping|
|FP-PIPE-DRAN|140|DASHED|0.25|Drains, indirect waste|
|FP-PIPE-SENS|2|HIDDEN|0.18|Pressure sensing lines|
|FP-FUEL|40|PHANTOM|0.25|Diesel fuel & exhaust|
|FP-VALV|2|CONTINUOUS|0.25|Valves & fittings|
|FP-ELEC|210|CONTINUOUS|0.35|Controllers, ATS, power|
|FP-TRCH|94|CONTINUOUS|0.25|Drainage trench & pit|
|FP-HIDN|8|HIDDEN|0.18|Hidden / below-floor|
|FP-CNTR|8|CENTER|0.13|Centre-lines|
|FP-DIMS|7|CONTINUOUS|0.18|Dimensions|
|FP-ANNO|7|CONTINUOUS|0.25|Text, tags, leaders|
|FP-LEVL|5|CONTINUOUS|0.18|Level markers|
|FP-TABL|7|CONTINUOUS|0.18|Schedules & tables|
|FP-TBLK|7|CONTINUOUS|0.50|Sheet frame & title block|
|FP-ARCH|8|CONTINUOUS|0.25|Doors, louvers, openings|

### 2.2 `DrawingBuilder`
```ts
export class DrawingBuilder {
  constructor(title: string, layers?: LayerDef[]);       // default FP_LAYERS
  readonly entities: DrawEntity[];
  /** Current paper scale denominator — annotation sizes passed in PAPER mm are multiplied by it. */
  scale: number;
  line(layer,x1,y1,x2,y2); polyline(layer,pts,closed=false); rect(layer,x,y,w,h); circle(layer,cx,cy,r);
  arc(layer,cx,cy,r,startDeg,endDeg); solid(layer,pts);
  text(layer,x,y,paperHeightMm,text,opts?:{rotationDeg?,align?,vAlign?});  // height = paperHeightMm*scale
  /** Linear dimension between (x1,y1)-(x2,y2), dimension line offset perpendicular by offsetPaperMm*scale
   *  (positive = left of the direction p1→p2). Draws 2 extension lines (gap 1 mm, overshoot 2 mm paper),
   *  dimension line, two 45° architectural ticks (3 mm paper) and the measured value in mm (rounded integer)
   *  or `override` text, 2.5 mm paper height, centred above the dim line, rotated with it. Layer FP-DIMS. */
  dimLinear(x1,y1,x2,y2,offsetPaperMm,override?);
  /** Leader with closed arrowhead (solid, 3 mm × 1 mm paper) at the first point, text at the last point. */
  leader(points:[number,number][], text:string|string[], layer='FP-ANNO');
  /** Level marker: open triangle 3 mm paper pointing down to the level line, text "+1.250" style (sign + 3 decimals, metres) and optional label e.g. "TWL". */
  levelMark(x,y,levelM,label?);
  /** Equipment / valve tag: circle 8 mm paper diameter (or rounded rectangle when text > 4 chars) with centred text 2.5 mm. */
  tag(x,y,text);
  /** Double-line pipe between two points with given outside diameter (mm, true size), plus centre-line on FP-CNTR. Ends open. */
  pipe(layer, pts:[number,number][], odMm, centreLine=true);
  /** Section cut arrow pair with letter ("A") at both ends of a cut line. */
  sectionMark(x1,y1,x2,y2,letter);
  /** Diagonal 45° hatch (spacing paper mm) clipped to an axis-aligned rectangle — computed analytically, layer FP-WALL-HTCH. */
  hatchRect(x,y,w,h,spacingPaperMm=2);
  /** Table: column widths in paper mm, rows of strings, header row bold-looking (drawn twice offset 0.1 mm is NOT needed — just a heavier rule under it). Returns height in model mm. */
  table(x,yTop,colWidthsPaperMm:number[],rows:string[][],opts?:{rowHeightPaperMm?:number,textHeightPaperMm?:number,title?:string}): number;
  bbox(): BBox;                       // over all entities (text approximated by height*0.6*chars)
  build(sheets: SheetInfo[]): Drawing;
}
```
### 2.3 `symbols.ts` — each function draws at (x,y) along `angleDeg`, sized from pipe OD (mm) so they scale with the pipe:
`gateValve` (two triangles tip-to-tip, plus OS&Y stem: small line + handwheel ellipse approx as rectangle), `butterflyValve`
(two triangles + circle + bar), `checkValve` (two triangles, one filled solid, with arrow), `reliefValve` (angle body: triangle
on line + triangle to side + spring zig-zag), `flowMeter` (circle with "FM"), `pressureGauge` (small circle on stem with "PG"),
`eccentricReducer` (trapezoid with flat top), `concentricReducer` (symmetric trapezoid), `hoseValve` (angle valve + cap),
`flexibleCoupling` (two short parallel bars), `ballValve` (two triangles + filled circle).
Equipment in plan: `pumpPlan(b, rect, kind:'hsc'|'end-suction'|'jockey', driver:'electric'|'diesel', tag)` draws pad, base
plate, casing (circle/rounded), coupling guard, motor (rectangle with fins lines) or diesel engine (rectangle with
exhaust/flywheel detail), and the tag; `controlPanelPlan(b, rect, tag, label)` rectangle with diagonal and door swing line;
`doorPlan(b, x, y, width, wall)`, `louverPlan`, `northArrow(b,x,y)`, `titleBlock(b, sheet, fields: {project, projectNumber, drawingTitle, sheetNumber, scaleText, date, drawnBy, checkedBy, standards})` — sets `b.scale = sheet.scale`, the frame in model space is `paper × sheet.scale` at `(originX, originY)` (frame: 20 mm left margin,
10 mm others; title block 180 × 60 mm paper bottom-right with rows: project, drawing title, sheet no., scale "1:50", date,
drawn/checked, standards line, revision table 3 rows).
Each symbol returns nothing; it writes to the builder. Valve symbol signature: `(b, x, y, angleDeg, odMm)`; reducers `(b, x, y, angleDeg, odLargeMm, odSmallMm)` / concentric `(b,x,y,angleDeg,odInMm,odOutMm)`; all valve geometry on layer `FP-VALV`.

### 2.4 `dxfWriter.ts`
`writeDxf(drawing: Drawing): string` — AutoCAD R12 ASCII, CRLF-free (`\n`), each group = code line (right-aligned
to 3 chars) + value line. Sections in order: HEADER (`$ACADVER AC1009`, `$INSBASE`, `$EXTMIN`, `$EXTMAX`,
`$LIMMIN`, `$LIMMAX`, `$LTSCALE` = 50 ), TABLES (LTYPE with CONTINUOUS, DASHED (12.7,-6.35), HIDDEN (6.35,-3.175),
CENTER (31.75,-6.35,6.35,-6.35), PHANTOM (31.75,-6.35,6.35,-6.35,6.35,-6.35) — pattern values ×1 (LTSCALE scales);
LAYER with every layer (code 2 name, 70 0, 62 colour, 6 linetype); STYLE with `STANDARD` (font `txt`)), BLOCKS (empty
section), ENTITIES, then `0 EOF`.
Entity encoding: LINE (8 layer, 10/20/30, 11/21/31); CIRCLE (10/20/30, 40); ARC (+50 start, 51 end);
TEXT (10/20/30 insertion, 40 height, 1 text, 50 rotation, 7 STANDARD, 72 h-justify 0/1/2 for left/center/right,
73 v-justify 0 baseline/1 bottom/2 middle/3 top, and when 72≠0 or 73≠0 also the alignment point 11/21/31 = same xy);
POLYLINE (66 1, 70 1 if closed else 0, 10/20/30 0) + VERTEX (8 layer, 10/20/30) per point + SEQEND (8 layer);
SOLID (10..13 / 20..23 / 30..33 — DXF SOLID vertex order is 1,2,4,3 for a quad: emit p0,p1,p3,p2; for a triangle repeat
p2 as the 4th point). Numbers: up to 4 decimals, no exponent notation, `-0` → `0`. Text: strip `\n`, keep `%%c` etc.;
replace characters > 0x7E with `\U+XXXX` (R12-compatible escape).

### 2.5 `svgRenderer.ts`
`renderSvg(drawing, opts?: { sheetIndex?: number; background?: 'white'|'dark'; widthPx?: number }): string`
viewBox = sheet frame in model units `originX, -(originY+paperH·scale), paperW·scale, paperH·scale` (e.g. `0 -29700 42050 29700` for A1 @ 1:50) (or whole bbox when sheetIndex undefined), y flipped (`svgY = -y`), ACI colour map (white
background → ACI 7 renders #000, ACI 2 renders #b8a000 for contrast; dark background → ACI 7 #fff), stroke width =
lineweightMm × scale (sheet scale; whole-drawing mode uses 50), dash arrays from linetype × scale × 0.5, text as
`<text>` with `font-family="Arial, sans-serif"`, size = height × 1.25 (cap-height compensation), anchor from align,
dominant-baseline from vAlign, rotation `rotate(-deg, x, y)`. `%%c`→`Ø`, `%%d`→`°`, `%%p`→`±`. XML-escape text.
Solids → `<polygon>` filled. Group per layer `<g data-layer="FP-…">`.

---

## Task 3 — Pump selection, tank, pump room, engine orchestrator

Files: `engine/fireProtection/{pumpSelector,tankDesigner,pumpRoomDesigner,fireProtectionEngine,report}.ts`.
Tests: `engine/__tests__/firePumpTankRoom.test.ts` (provided).

### 3.1 `pumpSelector.ts` — `selectPumpSet(input: FireDesignInput, demand: SystemDemand): PumpSetSelection`
1. `rated = selectRatedCapacity(demand.pumpDemandFlowGpm)`; `row = pumpDataFor(rated)`.
2. Suction size: start `row.suctionIn`; while `velocityFps(1.5·rated, ID_sch40) > 15` → `nextLargerSize`. Record v150.
   The selected suction size replaces `sizes.suctionIn` in the returned row copy.
3. Static suction (1 m water = 1.42197 psi): `minStatic = tankFloorToPumpCLm × 1.42197`;
   `maxStatic = (tankFloorToPumpCLm + tankEffectiveDepthM + 0.20) × 1.42197` (TWL = effective top + 0.20 m).
4. Suction friction: Sch 40, C = 120, equivalent length = 20 ft + 1 gate-valve + 1 elbow-90 at suction size.
   `suctionAt100 = minStatic − pf(rated)`, `suctionAt150 = minStatic − pf(1.5·rated)` → `suctionPressureMinPsi`.
5. `ratedNet = ceil((demand.pumpDemandPressurePsi − suctionAt100)/5)·5`; head ft = net × 2.31.
6. Curve x ∈ {0, .25, .5, .75, 1, 1.25, 1.5}: `P = Pr(1.2 + 0.066667x − 0.266667x²)`, `η = ηr·x(2−x)`;
   `bhp = Q·(P·2.31)/(3960·η)` for x>0; `bhp(0) = 0.45 · bhp(1)`. churn = P(0), pressureAt150 = P(1.5). maxBhp = max.
7. Pump type: preference unless `'auto'`: auto → `minStatic ≤ 0` ? `'vertical-turbine'` : rated ≤ 300 ? `'end-suction'` : `'horizontal-split-case'`.
8. Drivers per arrangement: `'electric+diesel'` → [electric duty FP-1, diesel standby FP-2]; `'electric+electric'` →
   [electric duty, electric standby]; `'diesel+diesel'` → [diesel duty, diesel standby]; `'electric-only'` → [electric duty];
   `'diesel-only'` → [diesel duty]. Tags FP-1, FP-2; controllers FPC-1, FPC-2.
9. Electric: `driverHp` = smallest NEMA ≥ maxBhp (service factor kept as reserve); kW = hp × 0.7457.
   Controller: kind `electric-fire-pump-controller`, listing `'UL 218 / FM 1321 — NFPA 20 Ch. 10'`, startingMethod =
   hp ≤ 30 ? `'Full voltage (across-the-line)'` : `'Reduced voltage — closed-transition wye-delta'`, 900 W × 450 D × 2000 H, floor.
   Circulation relief = `circulationReliefSizeIn(rated)`.
10. Diesel: derate % = `3·max(0,(siteElevationFt−300)/1000) + 1·max(0,(ambientTempF−77)/10)`; required = maxBhp/(1−d/100);
    `driverHp` = smallest DIESEL_ENGINE_HP ≥ required; fuel gal = ceil(driverHp × 1.10); liters = round(gal × 3.785);
    controller `diesel-fire-pump-controller`, `'UL 218 / FM 1323 — NFPA 20 Ch. 12'`, startingMethod `'Dual battery banks, 2 chargers, 6 crank cycles (15 s on / 15 s off)'`,
    800 W × 400 D × 1800 H, floor. Circulation relief `null` (heat-exchanger cooling water flow from pump discharge).
11. `maxSystemPressurePsi = churn + maxStatic`. Main relief valve: required when any diesel driver and
    `1.21·churn + maxStatic > systemComponentRatingPsi`; size/discharge from row; set = systemComponentRatingPsi − 5
    reason text cites NFPA 20 121 % rule. Otherwise required=false (size still filled from row).
    Check `components-rating`: electric only and `churn + maxStatic > rating` → fail.
12. Jockey: flow = smallest JOCKEY_FLOWS ≥ max(1, 0.01·rated). Setpoints (round to integer psi):
    stop = churn + max(0,minStatic); start = stop − 10; dutyStart = start − 5; standbyStart = dutyStart − 10;
    timers 10 / 30. Jockey net = ceil((stop − max(0,minStatic) + 10)/5)·5 (10 psi above churn to reach stop);
    motor hp = smallest NEMA ≥ Q·net·2.31/(3960·0.40); pipe = flow ≤ 10 ? 1 : flow ≤ 25 ? 1.5 : 2.
    Controller JPC-1 `jockey-pump-controller`, `'UL 508A'`, 500 W × 250 D × 700 H, wall.
13. Test header size = row.hoseHeaderSupplyIn, valves = row.hoseValves; flow meter = row.meterDeviceIn.
14. Checks (ids exactly): `suction-velocity` (≤15 fps @150 %, NFPA 20 §4.14.3.1), `suction-pressure` (≥ −3 psi @150 %),
    `flooded-suction` (horizontal pumps need minStatic > 0 else fail; VT pass), `shutoff-ratio` (churn ≤ 1.40 Pr),
    `ratio-150` (P150 ≥ 0.65 Pr), `rated-vs-demand` (rated ≥ demand flow and net + suction ≥ demand pressure),
    `jockey-vs-sprinkler` (jockey flow < K√7 of one sprinkler, else warn), `components-rating`, `relief-valve`.

### 3.2 `tankDesigner.ts` — `designTank(input, demand, pumps): TankDesign`
- requiredGal = demand.requiredStorageGal; m³ = gal × 0.003785411784. n = twoCompartments ? 2 : 1. H = tankEffectiveDepthM.
- Plan area per compartment a = m³/(n·H).
- Module: RC → 0.1 m, GRP → 1.0 m, steel-bolted → 1.22 m. Compartment width W = ceilTo(√a, module),
  compartment length Lc = ceilTo(a/W, module). (Use ceilTo(v,m)=ceil(v/m − 1e-9)·m, round to 3 decimals.)
- Levels (m above internal floor): low 0, effectiveTop H, overflow H+0.10, topWater H+0.20,
  roofSoffit: RC = ceilTo(H+0.20+0.30, 0.05); GRP = ceilTo(H+0.50, 0.5); steel = ceilTo(H+0.50, 1.22).
  freeboard = roofSoffit − topWater; totalInternalHeight = roofSoffit.
- Thickness mm: RC wall = totalH ≤3 → 250, ≤4.5 → 300, ≤6 → 350, else 400; floor = wall + 50; roof 250.
  GRP 25/25/25; steel 6/6/5. Divider wall thickness (RC) = wall thickness; GRP/steel divider 25/6.
- internalLengthM = n·Lc + (n−1)·divider/1000; internalWidthM = W; provided = n·Lc·W·H.
- Sump (one per main pump, all identical): D = pumps.mainPumps[0].sizes.suctionIn; OD mm;
  plate = ceilTo(max(2·OD, OD + 300), 50); inletAbove = max(OD/2, 100) rounded to mm; clearance c = max(OD, 200);
  plateCentreFromWall = c + plate/2; pitLength = ceilTo(2c + plate, 50); pitWidth = ceilTo(2c + plate, 50);
  elbowDrop = round(OD); suctionCLBelowTankFloor = round(tankFloorToPumpCLm·1000);
  pitDepth = max(300, ceilTo(suctionCLBelowTankFloor + elbowDrop + inletAbove, 50)).
- Connections: suction (D, ×nPumps), fill = smallest size (excluding 3½") with Sch 40 velocity(refillFlow) ≤ 10 fps (min 2"), overflow =
  nextLargerSize(fill) (skip 3½" → 4"), vent = max(4, overflow), drain 4, test return = pumps.flowMeterIn, relief return =
  pumps.mainReliefValve.required ? dischargeIn : (omit), level indicator 1, manhole note "Ø 800 mm (≥ 600) each compartment".
- refillHours = requiredGal / refillFlowGpm / 60.
- materialSpec by material:
  RC: `Reinforced concrete C35/45 (f'c ≥ 35 MPa), ACI 350 / BS EN 1992-3, w/c ≤ 0.45, crack width ≤ 0.2 mm`,
  `Internal crystalline waterproofing + PVC waterstops at all joints`, `Cover ≥ 50 mm water face`, `Galvanised / GRP access ladders, Ø800 manholes with lockable covers`.
  GRP: `GRP sectional panels 1 m × 1 m, BS EN 13280, WRAS listed`, `Internal SS 316 tie rods & stays`, `Hot-dip galvanised steel skid base on RC plinth 300 mm`, `Insulated panels where freezing possible`.
  Steel: `Pressed-steel sectional panels 1.22 m modules, BS 1564 / FM 4020 (bolted)`, `Hot-dip galvanised + internal epoxy (AWWA D102)`, `EPDM gaskets, SS bolts`, `RC plinth / steel beams`.
- Checks: `tank-capacity` (provided ≥ required), `tank-refill` (≤ 8 h, NFPA 22), `vortex-plate` (plate ≥ 2·OD),
  `tank-air-gap` (pass, IPC §608 / UPC §603 note), `overflow-size` (overflow ≥ fill).

### 3.3 `pumpRoomDesigner.ts` — `designPumpRoom(input, pumps, tank): PumpRoomLayout`
Origin (0,0) = inner corner tank-wall (west) / south wall; x east, y north; west wall is the common wall with the tank
(thickness = tank.wallThicknessMm or 250 min for GRP/steel → use 250 RC wall between), other walls 250 mm masonry.
- Skid size (along shaft = y, across = x), mm, by driver HP:
  electric HSC: hp ≤25 → 1500×600; ≤60 → 1900×700; ≤125 → 2300×800; ≤250 → 2800×900; else 3300×1000.
  diesel: hp ≤100 → 2900×1000; ≤200 → 3400×1100; ≤350 → 3900×1200; else 4400×1300. end-suction / vertical-inline: electric values × 0.9 (rounded to 10).
  Pad = skid + 150 mm each side. Casing centre (nozzle y) = skid.y + 0.25·length.
- Jockey: 500×500, pad 150 each side.
- Elevations: roomFloor 0; padTop 0.15; pumpCL = 0.15 + (rated ≤1500 ? 0.45 : 0.60); tankFloor = pumpCL + tankFloorToPumpCLm;
  highLevelPipe = 2.40; roofSoffit = max(3.5, highLevelPipe + 0.9) → clearHeightMm.
- X chain for each main pump: suction from wall x=0: 300 (wall flange & flex coupling) + gate valve F-F + straight run
  max(10·OD_suction, 600) + eccentric reducer (length = OD_suction) → pump pad west edge at `xPadW` (same for all pumps
  = max over pumps). Skid x = xPadW + 150. Discharge nozzle x = skid.x + skid.w.
  Discharge chain: concentric increaser (OD_disc) + 200 + check F-F + 150 + butterfly F-F + 300 → `headerX`.
  Panels against east wall: room length L = headerX + OD_header/2 + 1000 (NEC 110.26 working space) + max panel depth;
  round up to 100 mm.
- Y chain (south → north): 1200 corridor (test line at y = 600) → FP-1 pad → 1200 gap → FP-2 pad → 1200 gap →
  jockey pad (x = xPadW) → [diesel present: 1000 gap → fuel-tank bund row] → 1000 → north wall. With one main pump omit FP-2.
  Fuel tank (diesel present): rect 800 mm deep (y) × length (x) = max(1000, ceil(liters / 1000 / (1.0 × 0.8) × 10) × 100) mm,
  1.0 m high; bund (equipment.pad) = tank + 150 mm each side, bund.x = xPadW. W = sum of the chain, rounded up to 100.
- Controllers on east wall, centred on their pump's nozzle y (FPC-n), JPC-1 on east wall at jockey y; no overlaps (shift north).
- Pipes: suction for each pump [(−wall, y),(nozzle x, y)] service suction; discharge [(nozzle,y),(headerX,y)];
  header [(headerX, 600),(headerX, yJockey)] + system outlet [(headerX, yJockey),(headerX, W + wall)] (exits north wall);
  test return [(headerX, 600), (−wall, 600)] (high level, back to tank); test header branch from (headerX − 1500, 600)
  south to (headerX − 1500, −wall) (exterior hose valve header); jockey suction tap from the last main pump suction at
  x = 600 north to jockey y then east to jockey; jockey discharge to header; relief discharge (if required) from header at
  y=600+800 west joins test return; sensing lines from header to each controller (service 'sensing'); diesel: fuel line
  from tank to engine, exhaust from engine north through wall.
- Valves (tags V-01…): per pump: os&y-gate on suction (+ tamper-switch), flexible-coupling, eccentric-reducer, pressure-gauge
  (suction compound), concentric-increaser, pressure-gauge (discharge), circulation-relief (electric), check, butterfly;
  header: relief (if required), system outlet butterfly; test line: butterfly isolation, flow-meter, butterfly throttle;
  test header: butterfly (normally closed, supervised) + `hoseValves` × hose-valve on exterior wall; jockey: ball-valve
  suction, check, ball-valve discharge.
- Trench: width 300, path from (xPadW − 450, W − 1000) to (xPadW − 450, 1500) then to pit; slope 1 %; depthStart 150,
  depthEnd = 150 + 1 % × length; capacity Manning (n = 0.013, depth = 0.75·depthStart, b=0.3 m) in gpm;
  designInflow = Σ(2 % rated per electric pump) + 5 gpm per pump (packing drips) + jockey flow; grating `Galvanised steel
  heavy-duty grating 300 mm, 25×5 mm bars @ 30 mm`; outlet pit 600 mm at path end with 4" drain to IPC §802 indirect waste.
- Doors: double 1800 mm on the south wall at x = L − 1400 (exterior access, IBC §913 / NFPA 20 §4.12); louvers (diesel):
  intake on south wall near diesel x, exhaust/relief on north wall, both 1200 wide.
- fireRatingHours: 2 when input riser rise > 75 ft (high-rise per IBC §403) else 1.
- Checks: `room-working-space` (≥ 1000 mm clear in front of each controller), `suction-straight-run` (≥ 10·D),
  `no-butterfly-on-suction` (pass — OS&Y gate used, NFPA 20 §4.14.5), `room-rating`, `room-heating`
  (≥ 4.4 °C, diesel ≥ 21 °C note), `room-drainage` (capacity ≥ inflow), `equipment-clearance` (≥ 900 mm between pads).

### 3.4 `defaults.ts` (created in Task 1) & `fireProtectionEngine.ts`
`defaults.ts` exports `DEFAULT_FIRE_INPUT: FireDesignInput` (engine re-exports it) — OH2, K 5.6, branch 2" Sch40 C120, cross-main 4" Sch40 C120, riser
{6" sch40 c120, length 40 ft, rise 40 ft, fittings {tee-branch:1, 'alarm-check':1, 'gate-valve':1}}, feed main
{6" sch40 c120, 150 ft, rise 0, {'elbow-90':4, 'tee-branch':1, 'gate-valve':1}}, insideHose 100, Class I standpipe ×2,
sprinklered true, top outlet 45 ft, friction 10 psi, arrangement electric+diesel, auto type, 175 psi, elevation 300 ft,
75 °F, 400 V 3 ph 50 Hz, RC underground, effective depth 3.0 m, two compartments, tankFloorToPumpCLm 0.5,
refill 250 gpm, project "Fire Pump Room & Tank", number "FP-2026-001", designer "MEP Designer".
`designFireProtectionSystem(input): FireDesignResult` = demand → pumps → tank → room → checks concat + references.

### 3.5 `report.ts`
`buildFireCalcReport(result): string` — sections: project header; standards; design basis; hydraulic node table
(columns: From To | K | q | Q | Size | ID | C | L | Ftg | Fteq | Ltot | Pf/ft | Pf | Pe | Pt), standpipe; system
demand; pump schedule; jockey & setpoints; tank; sump; pump room; checks (PASS/WARN/FAIL); code note.

---

## Task 4 — Drawing sheets
File: `engine/fireProtection/drawing/sheets.ts` → `generateFireDrawings(result): Drawing`.
Tests: `engine/__tests__/fireDrawingSheets.test.ts` (provided) and Python audit `scripts/audit_fire_dxf.py` (Opus).

Sheet set (A1 841×594 paper, frame per §2.3; sheets placed left→right with 5000 mm model gap):
1. **FP-101 Fire Pump Room — Plan.** Scale = smallest of {20,25,50,75,100} where room+tank-wall strip+annotation fits in
   (paper − 40 mm margins − title block height). Content: walls (double line, hatched), partial tank (2 m strip) with
   sumps dashed (FP-HIDN), pads, pumps (symbols), all pipes double-line (true OD), valves, controllers + 1000 mm
   working-space dashed rectangles, trench (dashed outline + grating hatch lines) with slope arrow + "1%", drain pit,
   fuel tank + bund, door swing, louvers, north arrow, section mark A-A through FP-1 suction CL, tags at every pump /
   controller / valve, dimension strings: overall L and W (outside), pump CL spacing, header offset, suction straight run;
   room notes (fire rating, heating, drainage). Equipment legend table.
2. **FP-102 Section A-A.** Through FP-1 suction CL: tank (wall, floor slab hatched, roof slab, sump pit, elbow down,
   anti-vortex plate, water levels LWL/NWL/OFL/TWL with level marks), common wall with sleeve/puddle flange, suction pipe,
   OS&Y gate, eccentric reducer (flat top), pump on pad, discharge, check, butterfly, header (cut circle), high-level test
   line, room slab, trench (cut), controller elevation. Level marks for FFL, pad, pump CL, tank floor, sump floor, levels,
   roof. Vertical dimension chain.
3. **FP-103 Fire Water Tank — Plan, Section B-B & Sump Detail.** Tank plan: outer/inner walls, divider, compartments
   with volume text, sumps, suction pipes, manholes (2 per compartment, Ø800 circles), ladders, vent, overflow, fill with
   float valve, drain, level indicator, internal/external dimensions; Section B-B across width; Sump detail at 1:10 inside a
   framed box (dims: plate, inletAbove, pit L/W/D, D); material specification notes.
4. **FP-104 Fire Pump Schematic (NTS).** Single-line flow diagram left→right: tank compartments → suction valves →
   pumps (FP-1 electric, FP-2 diesel, JP-1) → discharge valves → header → system riser; test line + flow meter back to tank;
   test header to exterior; relief valve; sensing lines with two check valves each ("2 × ³⁄₃₂ in orifice"); controller
   boxes with sensing connections; power source notes (Art. 695). Symbol legend.
5. **FP-105 Schedules & Hydraulic Calculations.** Tables: hydraulic node table, pump schedule, jockey & pressure
   setpoints, valve schedule, tank schedule, compliance checks, standards references, general notes (≥ 10 notes).
Every sheet: title block filled (project name/number, sheet title, number, scale "1:N" or "NTS", date 2026-10-31,
designer), all entities inside its frame.

---

## Task 5 — UI branch
Files: `store/fireProtectionStore.ts`, `fire/FireWorkspace.tsx`, `fire/FireInputPanel.tsx`,
`fire/FireResultsPanels.tsx`, `fire/DrawingPreview.tsx`, `fire/PumpCurveChart.tsx`, modify `App.tsx`.
- Store: `{ input, result, drawing, activeView, activeSheet, setInput(partial), reset() }`; result & drawing recomputed
  synchronously on setInput (wrap in try/catch → `error` string).
- App: discipline switch in the header (`HVAC` | `Fire Fighting`, Flame icon); when fire → render `<FireWorkspace/>`
  instead of the HVAC main grid.
- Workspace: left column inputs (sections: Project, Sprinkler (hazard select, K select, density/area overrides), Piping
  (riser/feed length & rise), Standpipe, Pump set (arrangement, type, component rating, elevation, ambient), Tank (material,
  placement, depth, compartments, tank-floor-to-pump CL, refill)); main area tabs: Drawings (sheet selector, zoom/pan SVG
  preview on white paper, Export DXF button → `FP_<project>.dxf`), Hydraulic Calc (Elite-style table), Pumps (schedule +
  `PumpCurveChart` SVG: curve, demand point, 100 %/150 % markers, 65 % and 140 % limit lines), Tank & Sump, Pump Room,
  Checks (pass/warn/fail chips with references), Report export (.txt).
- Match existing dark Tailwind style (neutral-900 cards, red/orange accent for fire).
