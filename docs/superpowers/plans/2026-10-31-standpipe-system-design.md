# Standpipe System (NFPA 14) — Floor Data, Hydraulics, Riser Elevation & Details

> Extends `2026-10-31-fire-pump-room-and-tank-design.md`. Contract additions are already in
> `engine/fireProtection/fpTypes.ts` (FloorLevel, StandpipeLocation, BuildingInput, StandpipeDesignInput,
> StandpipeOutlet, StandpipeRiserDesign, StandpipeSystemDesign, `FireDesignInput.building/standpipeDesign`,
> `FireDesignResult.standpipe`, FittingType `'angle-hose-valve'`). Paths relative to `src/renderer/src/`.
> Tests: plain `npx tsx <file>`; typecheck `npm run typecheck`. Do not change the contract or tests.

## Goal
1. **Data first** — the user enters the building floor by floor (name, FFL elevation, floor-to-floor, usage, area,
   sprinklered, hose connection, roof) and the standpipe design data (system type, combined, stair locations with
   horizontal run to the pump room, roof access, riser size override, pipe, hose valve height, FDC/hydrant distance).
2. **Engineering** — NFPA 14 node-to-node hydraulic calculation of every standpipe, governing riser selection,
   static/residual pressure at every outlet on every floor, pressure-regulating devices, FDC, drains, checks.
   The detailed standpipe result drives the pump selection.
3. **Drawings** — FP-106 *Standpipe Riser Diagram (elevation, every floor)* and FP-107 *Standpipe Floor Connection
   Side View, Details & Floor Schedule*.

## Standards rules used (NFPA 14-2019 unless noted)
| Rule | Value |
|---|---|
| Class I hose connections | 2½" at every floor level landing of each required exit stair (§7.3.2.1) |
| Roof hose connection | required where roof slope < 4 in 12 — at the stair with roof access (§7.3.2.2) |
| Hose valve height | 3 ft – 5 ft (900–1500 mm) above floor (§7.3.1.1) |
| Minimum riser size | Class I/III 4"; combined with sprinklers 6"; Class II 2" (§7.6) |
| Flow | 500 gpm first standpipe (250 gpm at each of the two topmost outlets), +250 gpm each additional, max 1000 gpm sprinklered / 1250 unsprinklered (§7.10.1.1); Class II 100 gpm |
| Residual pressure | 100 psi at the topmost 2½" outlet of the hydraulically most remote standpipe; 65 psi at 1½" (§7.8.1) |
| Additional standpipe flow | added at the point of connection, not balanced (§7.10.1.1.4) |
| Pressure limit | max 350 psi anywhere (§7.2.1) |
| Pressure-regulating devices | 2½" outlet where static > 175 psi → limit to 175 psi; 1½" where residual > 100 psi or static > 175 → 100 psi (§7.2.3) |
| Drain riser | 3" drain riser adjacent to each standpipe with PRVs, 2" main drain at base (§7.11) |
| FDC | one 2½" inlet per 250 gpm (min 2), pipe ≥ 4", 18–48 in above grade, check valve + automatic drip, within 100 ft of a hydrant (§6.4, §7.12; IFC §912) |
| Zone height | ≤ 275 ft per zone else warn (§7.9) |
| High-rise | highest occupied floor > 75 ft above FD access (IBC §202 / §403) → 2-h pump room (IBC §913.2.1) |
| Combined system | sprinkler demand not added to standpipe demand in fully sprinklered buildings (§7.10.1.3); floor control valve assembly at each sprinklered floor (NFPA 13 §16.9.4 — supervised valve, waterflow switch, test & drain) |
| Angle hose valve loss | equivalent length = 150 × ID(2½" Sch40)/12 = 30.86 ft (Crane TP-410 L/D = 150) |

## Task S1 — Engine (Sonnet)
Files: `engine/fireProtection/standpipeDesigner.ts` (new); modify `defaults.ts`, `hydraulics.ts`, `standards/nfpa13.ts`,
`standards/nfpa14.ts`, `pumpRoomDesigner.ts`, `fireProtectionEngine.ts`, `report.ts`.
Tests: `engine/__tests__/fireStandpipeSystem.test.ts` (new, provided) + existing fire tests must still pass.

### S1.1 Defaults
- Rename the current `DEFAULT_FIRE_INPUT` object to `SIMPLE_FIRE_INPUT` (unchanged values, no building) and export it.
- `DEFAULT_FIRE_INPUT = { ...SIMPLE_FIRE_INPUT, systemComponentRatingPsi: 300, building, standpipeDesign }`:
  - floors (bottom→top): `B1` "Basement 1" el −4.0 ftf 4.0 usage "Parking / Plant"; `GF` "Ground Floor" 0.0 ftf 4.5 "Lobby / Retail";
    `L1`…`L8` "Level n" el 4.5 + 3.6·(n−1) ftf 3.6 "Office"; `RF` "Roof" el 33.3 ftf 0 "Roof" isRoof.
    areaM2 1200 (roof 1200); sprinklered = !isRoof; hoseConnection = !isRoof.
  - `pumpRoomFloorElevationM −4.5`, `roofSlopeLessThan4in12 true`, `fireDeptAccessElevationM 0`.
  - standpipeDesign: `automatic-wet`, combined true, locations `[{tag:'ST-1', location:'Stair 1', horizontalRunToPumpM:25, servesRoof:true},
    {tag:'ST-2', location:'Stair 2', horizontalRunToPumpM:40, servesRoof:false}]`, riserSizeIn undefined, pipe `{schedule:'sch40', c:120}`,
    hoseValveHeightMm 1200, fdcDistanceToHydrantM 20, fdcInlets undefined.
- `fireProtectionEngine.ts` re-exports both.

### S1.2 Small additions
- `nfpa13.equivalentLengthFt('angle-hose-valve', n, c, sch)` = `150 × internalDiameterIn(n,'sch40')/12` × C multiplier × schedule factor (same adjustments as table fittings). `fittingsEquivalentFt` abbreviation `HV`.
- `nfpa14.ts`: `standpipeMinRiserSizeIn(cls, combined)` (II → 2, combined → 6, else 4); `standpipeOutletSizeIn(cls)` (II → 1.5 else 2.5);
  `STANDPIPE_MAX_PRESSURE_PSI = 350`, `HOSE_OUTLET_STATIC_LIMIT_PSI = 175`, `HOSE_1_5_LIMIT_PSI = 100`, `MAX_ZONE_HEIGHT_FT = 275`,
  `HIGH_RISE_FT = 75`, `HOSE_VALVE_HEIGHT_RANGE_MM = [900, 1500]`.
- `pumpRoomDesigner.ts`: export `pumpCenterlineHeightM(ratedGpm) = 0.15 + (rated ≤ 1500 ? 0.45 : 0.60)` and use it for
  `elevations.pumpCLM`. `fireRatingHours`: when `input.building` → 2 if highest non-roof floor elevation −
  fireDeptAccessElevationM > 75 ft (22.86 m) else 1; otherwise the existing rule.
- `hydraulics.calculateSystemDemand(input, overrides?: { standpipe?: StandpipeDemandResult })` — when `overrides.standpipe`
  is given use it instead of `calculateStandpipeDemand(input)`. Nothing else changes.

### S1.3 `standpipeDesigner.ts`
```ts
export function standpipeApplicable(input): boolean   // building && standpipeDesign && standpipeClass !== 'none' && locations.length > 0
export function pumpCenterlineAbsM(input, ratedGpm): number // building.pumpRoomFloorElevationM + pumpCenterlineHeightM(rated)
export function derivedSprinklerRiser(input, pumpCLAbsM): PipeRun
export function designStandpipeHydraulics(input, pumpCLAbsM): StandpipeSystemDesign   // outlets' pressure fields = 0 / prv false for now
export function analyzeStandpipeOutlets(design, input, pumps: PumpSetSelection): StandpipeSystemDesign // fills pressures, PRVs, FDC, drains, checks
```
**Derived sprinkler riser:** top = highest floor with `sprinklered && !isRoof`; ceiling = top.elevationM + top.floorToFloorM − 0.30;
rise = length = (ceiling − pumpCLAbs) × 3.28084 ft; pipe & fittings from `input.riser`.

**Outlets of a riser T** (top→down): every non-roof floor with `hoseConnection` → elevation = floor.elevationM + hoseValveHeightMm/1000,
size = `standpipeOutletSizeIn(class)`; plus a roof outlet (elevation = roof.elevationM + hvh) when `roofSlopeLessThan4in12` and
(T.servesRoof, or no location serves the roof and T is the first location).

**Flows:** Class I/III → q₁ = 250, q₂ = 250 (only one outlet → q₁ = 500). Class II → q₁ = 100. Top residual: I/III 100 psi, II 65 psi.
Total standpipe demand Q = `standpipeFlowGpm(class, locations.length, building fully sprinklered)` (Class II → 100).

**Rows for riser T** (k outlets, riser size R, supply main size M = Q > 500 ? max(R, 6) : R; all pipes use `standpipeDesign.pipe` schedule & C):
1. `${T}-H1` → `${T}-S1` "Hose valve <floor name> to riser": outlet-size pipe, length 1 ft, rise 0, fittings `{tee-branch:1, angle-hose-valve:1}`
   (at outlet size), flowAdded = total = q₁, start = top residual.
2. for i = 1…k−1: `${T}-S{i}` → `${T}-S{i+1}` "Riser <floor i> to <floor i+1>": riser pipe, length = rise = Δz (ft) between the outlet elevations,
   no fittings, flow = Σq₁…qᵢ, flowAdded = (i ≥ 2 ? qᵢ : 0).
3. `${T}-S{k}` → `${T}-SB` "Riser base": riser pipe, length = rise = (z_k − floors[0].elevationM) ft, fittings `{elbow-90:1}`, flow = Σq,
   flowAdded = (k ≥ 2 ? q_k : 0).
4. `${T}-SB` → `PD` "Supply main to pump discharge": main pipe, length = horizontalRunToPumpM × 3.28084, rise = (floors[0].elevationM − pumpCLAbs) × 3.28084,
   fittings `{elbow-90:2, tee-branch:1, gate-valve:1}`, flowAdded = Q − Σq (other standpipes, added at the connection), flow = Q.
`requiredPressureAtPumpPsi` = Pt at PD. Governing riser = largest required pressure (ties → first location). `rows`/`pressureAtPumpDischargePsi`
from the governing riser. Riser size = override ?? min. `bottomElevationM` = floors[0].elevationM, `topElevationM` = top outlet elevation.
`floorControlValveFloors` (combined only): on the first location only, every floor with `sprinklered && !isRoof`.

**Outlet analysis** (after pump selection; FP-1 curve): x = demandFlow / ratedFlow;
`Pnet(x) = ratedNet·(1.2 + 0.066667x − 0.266667x²)`; discharge = Pnet(x) + suctionPressureMinPsi.
For every outlet: z = (elevation − pumpCLAbs) × 3.28084 ft; `staticPsi = maxSystemPressurePsi − 0.433·z`;
friction = governing riser → Σ pfPsi of governing rows from that outlet's S node down to PD (top outlet includes the H1 row);
other risers → pfPsi of the governing SB→PD row; `residualPsi = discharge − 0.433·z − friction`.
Flowing = the governing riser's outlets 1 and 2 (flowGpm q₁, q₂), others 0.
PRV: 2½" → required when staticPsi > 175, set 175; 1½" → required when residual > 100 or static > 175, set 100. Else null.
FDC: inlets = fdcInlets ?? max(2, ⌈Q/250⌉), inletSize 2.5, pipeSize = max(4, riserSizeIn), height 900 mm, distance from input.
drainRiserIn = any PRV ? 3 : null; mainDrainIn 2. buildingHeightFt = (highest non-roof FFL − fireDeptAccessElevationM) × 3.28084; highRise > 75.
**Checks (ids):** `sp-riser-size`, `sp-hose-connections`, `sp-roof-outlet`, `sp-top-residual`, `sp-max-pressure`, `sp-components`
(max static ≤ systemComponentRatingPsi else fail), `sp-prv` (pass; detail lists floors), `sp-drain-riser`, `sp-zone-height`,
`sp-fdc` (pass when inlets ≥ ⌈Q/250⌉, pipe ≥ 4, hydrant ≤ 30.5 m; else warn), `sp-hose-valve-height` (fail outside 900–1500), `sp-high-rise` (pass, info).

### S1.4 Engine order (`designFireProtectionSystem`)
1. If standpipe applicable: rated₀ = selectRatedCapacity(max(sprinklerFlow + insideHose, Q)); pumpCLAbs = pumpCenterlineAbsM(input, rated₀);
   input′ = { …input, riser: derivedSprinklerRiser(input, pumpCLAbs), standpipeCount: locations.length }.
   (Sprinkler flow comes from `calculateSprinklerDemand(input)`; flow is independent of the riser.)
2. sp = designStandpipeHydraulics(input′, pumpCLAbs); demand = calculateSystemDemand(input′, { standpipe: { applicable: true,
   flowGpm: sp.demandFlowGpm, residualPressurePsi: sp.topOutletResidualPsi, pressureAtPumpDischargePsi: sp.pressureAtPumpDischargePsi, durationMin: 30 } }).
3. pumps, tank, room exactly as before (with input′). 4. standpipe = analyzeStandpipeOutlets(sp, input′, pumps). 5. checks concat.
Without building/standpipeDesign the engine behaves exactly as before and `standpipe = null`.
`result.input` = input′.

### S1.5 Report
Add a "STANDPIPE SYSTEM (NFPA 14)" section: design basis, riser table, governing node table, floor-by-floor outlet table
(standpipe, floor, elevation, size, flow, static, residual, PRV), FDC & drains, checks.

## Task S2 — Drawings (Sonnet) — `drawing/sheetStandpipe.ts`, register in `sheets.ts`
When `result.standpipe` is non-null append two A1 sheets after FP-105 (scales chosen from {50,75,100,150,200,250,500}):
- **FP-106 STANDPIPE RISER DIAGRAM — ELEVATION.** Vertical axis true scale (floor FFLs), horizontal schematic.
  Every floor: full-width floor line (FP-WALL, slab thickness 200 mm hatched), floor name + level mark (`+4.500`) at the left,
  floor-to-floor dimension chain (FP-DIMS) at the right. Each standpipe a double-line riser (true OD) labelled `ST-n DN150 (6")`,
  location text, at every outlet: tee + 2½" angle hose valve symbol with cap, `HV` tag, PRV symbol + "PRV SET 175 PSI" when required,
  outlet static/residual psi text; floor control valve assembly branch on combined floors ("FLOOR CONTROL VALVE ASSEMBLY" — supervised
  butterfly, flow switch "FS", test & drain to drain riser) with stub "TO FLOOR SPRINKLERS"; drain riser (FP-PIPE-DRAN, dashed) beside each
  riser with PRVs; air release valve + "AUTOMATIC AIR RELEASE" at the top; roof outlet / roof manifold on the roof; cross connection
  at the base between risers with OS&Y isolation valves; supply main to "FIRE PUMP ROOM (SEE FP-101)"; FDC on the ground floor exterior wall
  with check valve, ball drip, "FIRE DEPARTMENT CONNECTION n × 2½\"" ; flowing outlets marked "250 GPM @ … PSI (FLOWING)";
  legend; notes; title block.
- **FP-107 STANDPIPE FLOOR CONNECTION — SIDE VIEW, DETAILS & FLOOR SCHEDULE.** (a) "TYPICAL FLOOR CONNECTION — SIDE VIEW" at 1:20:
  stair landing slab, riser through slab with sleeve, tee, angle hose valve at the design height (dimensioned from FFL), cap & chain,
  PRV, floor control valve assembly (supervised valve, waterflow switch, pressure gauge, test & drain with sight glass) and drain riser;
  (b) "FIRE DEPARTMENT CONNECTION — ELEVATION" (inlets, height above grade dimension 900, check valve, ball drip, sign "STANDPIPE");
  (c) "FLOOR SCHEDULE" table: every standpipe × floor row (floor, FFL, outlet el., size, flow, static psi, residual psi, PRV / set);
  (d) "STANDPIPE HYDRAULIC CALCULATION" node table of the governing riser; (e) "STANDPIPE NOTES" (≥ 8 notes citing NFPA 14 clauses above,
  NFPA 13 floor control, IBC §905, IFC §912).

## Task S3 — UI (Sonnet)
- Input panel: new sections **BUILDING & FLOORS** (pump-room FFL, roof slope, FD access level, generator: basements n / height,
  ground height, upper floors n / typical height → regenerates floors; editable floor table with add/remove/reorder rows: name, FFL,
  floor-to-floor, usage, area, sprinklered ✓, hose connection ✓; roof row fixed last) and **STANDPIPE DESIGN** (system type, combined ✓,
  locations table add/remove: tag, location, run m, serves roof ✓; riser override select (auto/4/6/8), schedule, C, hose valve height mm,
  FDC hydrant distance, FDC inlets override). Toggle "Detailed floor-by-floor standpipe design" (on = building present).
- New results tab **Standpipe**: summary (governing riser, Q @ P at pump, riser/main size, high-rise, FDC), floor-by-floor outlet
  table (PRV rows highlighted), governing node table, checks.
- Drawings tab shows FP-106/FP-107 automatically (selector is data-driven).
