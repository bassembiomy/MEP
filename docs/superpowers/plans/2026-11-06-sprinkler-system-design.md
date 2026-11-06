# Automatic Sprinkler System Design from Floor Plans (NFPA 13-2019) — Plan

> Contract: `engine/fireProtection/sprinkler/sprinklerTypes.ts` (+ `FireDesignInput.sprinklerDesign`,
> `FireDesignResult.sprinklers` in fpTypes.ts). Do NOT change the contract or the tests. Paths relative to
> `src/renderer/src/`. Tests: `npx tsx <file>`; `npm run typecheck`. 1 m = 3.28084 ft; 1 m² = 10.7639 ft².
> Scope: occupancy hazards (light, OH1/OH2, EH1/EH2; residential → light + quick response) with wet, dry,
> preaction (single / double interlock) and deluge systems, standard-spray pendent / upright / dry-pendent heads.
> Out of scope (reported in `outOfScope`): high-piled storage > 12 ft (NFPA 13 Ch. 20–25, ESFR/CMSA), water-spray
> systems (NFPA 15), residential NFPA 13R/13D design methods.

## Task K1 — Standards data, floor-plan import, room detection, questionnaire (Sonnet)
Files `engine/fireProtection/sprinkler/{nfpa13Sprinkler,floorPlanImport,roomDetection}.ts`.
Test `engine/__tests__/sprinklerImportAndRooms.test.ts`.

### nfpa13Sprinkler.ts
- `SPRINKLER_OCCUPANCIES: Record<string, { label; hazard: HazardClass; keywords: string[] }>` (NFPA 13 Annex A.4.3):
  | key | label | hazard | keywords |
  |---|---|---|---|
  |office|Office|light|office, meeting, conference, admin, reception|
  |corridor|Corridor / lobby|light|corridor, lobby, hall, foyer, passage, entrance|
  |toilet|Toilet / washroom|light|toilet, wc, bath, washroom, restroom, shower|
  |residential|Dwelling unit / hotel room|light|bedroom, living, apartment, flat, suite, guest|
  |healthcare|Patient / clinical|light|patient, ward, clinic, exam, nurse|
  |education|Classroom|light|class, lecture, lab, school|
  |assembly|Assembly / dining|light|dining, restaurant, cafe, hall, auditorium, church, theater, theatre|
  |data|Computer / data room|ordinary-1|server, data, it room, comms, telecom|
  |kitchen|Commercial kitchen|ordinary-1|kitchen, pantry, cook|
  |parking|Parking garage|ordinary-1|parking, garage, car park|
  |mechanical|Mechanical / electrical|ordinary-1|mech, plant, electrical, elec, boiler, pump, generator, hvac|
  |laundry|Laundry|ordinary-1|laundry|
  |mercantile|Retail / mercantile|ordinary-2|retail, shop, store front, showroom, mall|
  |storage|Storage (≤ 12 ft)|ordinary-2|storage, store, stock, archive, warehouse, depot|
  |library-stack|Library stack|ordinary-2|stack, library|
  |workshop|Workshop / light industrial|ordinary-2|workshop, repair, printing, factory, production|
  |extra-1|Extra hazard group 1|extra-1|hangar, sawmill, foam, die casting|
  |extra-2|Extra hazard group 2|extra-2|spray booth, flammable, solvent, varnish, plastics|
  `occupancyFromName(name, buildingType)`: first key (table order) whose keyword occurs (case-insensitive, word-ish
  substring) in the name; else building default: office→office, residential/hotel→residential, healthcare→healthcare,
  education→education, mercantile→mercantile, assembly/restaurant→assembly, parking→parking, storage-low-piled→storage,
  industrial→workshop, data-center→data, mixed→office.
- `SPACING_RULES` (Table 10.2.4.2.1(a)–(d), standard pendent/upright, hydraulically calculated, unobstructed):
  light {maxAreaFt2 225, maxSpacingFt 15}, ordinary {130, 15}, extra {100, 12}. `spacingClass(h)`: light→light,
  ordinary-1/2→ordinary, extra-1/2→extra. `MIN_SPRINKLER_SPACING_MM = 1829` (6 ft, §10.2.5.3), `MIN_WALL_DISTANCE_MM = 102`
  (4 in, §10.2.5.2.3), `DEFLECTOR_RANGE_MM = [25, 305]` (§10.2.6.1.1).
- `PIPE_SCHEDULE_LIMITS` (steel, number of sprinklers per pipe size; §28.5 Tables 28.5.2.2.1 / 28.5.3.4 / 28.5.4.? — used
  for initial sizing, verified hydraulically):
  light: 1→2, 1.25→3, 1.5→5, 2→10, 2.5→30, 3→60, 3.5→100, 4→∞;
  ordinary: 1→2, 1.25→3, 1.5→5, 2→10, 2.5→20, 3→40, 3.5→65, 4→100, 5→160, 6→275, 8→∞;
  extra: 1→1, 1.25→2, 1.5→5, 2→8, 2.5→15, 3→27, 3.5→40, 4→55, 5→90, 6→150, 8→∞.
  `pipeScheduleSize(count, spacingClass)` = smallest size whose limit ≥ count.
- `DRY_DELIVERY_TIME_S` (Table 8.2.3.6.1): light 60, ordinary 50, extra 45. `DRY_CAPACITY_NO_QOD_GAL = 500`,
  `DRY_CAPACITY_WITH_QOD_GAL = 750` (§8.2.3.2–8.2.3.3). `PREACTION_MAX_CLOSED_SPRINKLERS = 1000` (§8.3.2.6).
- `DRY_AREA_INCREASE = 1.3` (§19.3.3.2.5: dry pipe & double-interlock preaction).
- `DRY_SLOPE_BRANCH_MM_PER_M = 4` (½ in per 10 ft), `DRY_SLOPE_MAIN_MM_PER_M = 2` (¼ in per 10 ft) (§16.10.3.2).
- `HANGER_SPACING_M`: steel 1" → 3.66 (12 ft), ≥ 1¼" → 4.57 (15 ft); CPVC 1" → 1.68, 1¼" → 1.83, 1½" → 2.13, 2" → 2.44
  (Table 17.4.2.1(a); CPVC per listing). `hangerSpacingM(sizeIn, material)`.
- `spareHeadCount(total)`: ≤ 300 → 6, ≤ 1000 → 12, else 24 (§16.2.7.3).
- `hazenC(material, systemType)`: black steel wet & deluge 120, black steel dry/preaction 100, galvanized 100 (dry/preaction) / 120 (wet & deluge),
  CPVC 150, copper 150 (Table 28.2.4.8.1).
- `QUESTIONNAIRE`: array of `{ id: keyof SprinklerAnswers; question; help; options?: {value, label}[] }` — one entry per answers
  field, help text citing NFPA 13 (freezing → §8.2 dry / dry pendents; water-sensitive → §8.3 preaction; deluge → §8.3 / open
  sprinklers + detection; high-piled → Ch. 20–25 out of scope; ceiling → pendent vs upright; pipe material → CPVC wet light-hazard
  only per listing; seismic → Ch. 18 bracing; supply → fire pump (this design) or municipal flow test).
- `defaultSprinklerAnswers()`: office, all false, finished-flat, 3.0, black-steel-sch40, seismic false, supply fire-pump.
- `recommendedSystemType(answers, room)`: deluge if answers.delugeHazard && room.hazard starts 'extra'; preaction-double if
  room.freezing && answers.waterSensitiveAreas; dry if room.freezing; preaction-single if answers.waterSensitiveAreas &&
  room.occupancy === 'data'; else wet.

### floorPlanImport.ts — `importFloorPlanDxf(dxfText, unitsOverride?): FloorPlan`
Robust group-code pairing: split on `\r?\n`, read code/value pairs strictly in order (never drop empty values), trim the code
line only. $INSUNITS (HEADER, group 70): 1 in, 2 ft, 4 mm, 5 cm, 6 m, else 'unknown'. units = override ?? declared; if unknown,
infer from the bbox of the raw coordinates: max extent < 1000 → 'm' else 'mm', and add a warning. scaleToMm: mm 1, cm 10,
m 1000, in 25.4, ft 304.8. Only the ENTITIES section is read. LINE (10/20, 11/21), LWPOLYLINE (70 bit 1 = closed, vertices
10/20 pairs), POLYLINE + VERTEX… + SEQEND (70 bit 1), CIRCLE (10/20/40), ARC (10/20/40/50/51), TEXT (10/20, 40, 1), MTEXT
(10/20, 40, 1 + 3 chunks; strip `\P`→space, `{\…;` / `}` formatting, `\~`→space). Layer from 8 (default '0'). A polyline whose
first and last vertices are within 1 mm is closed (duplicate last vertex removed). INSERT entities are counted and reported as a
warning (`n block references (INSERT) not exploded`). layers summary sorted by name; bbox over all points in mm.

### roomDetection.ts — `detectRooms(plan, layers, defaults): SprinklerRoomInput[]`
defaults `{ buildingType, ceilingHeightM, ceilingType, minAreaM2 = 2 }`. Candidates: closed polylines with ≥ 3 vertices on the
given layers (all layers if `layers` is empty) with area ≥ minAreaM2. Drop duplicates (area within 1 % and centroids within
100 mm — keep the first). Drop any candidate that contains the centroid of another candidate whose area is < 2/3 of its own
(outer outlines, keep innermost). Name: the non-empty (trimmed) TEXT with the largest height whose insertion point lies inside the polygon (and not
inside a smaller candidate), else `Room n`. Order by centroid y descending, then x ascending; ids R1…Rn. occupancy =
occupancyFromName; hazard = occupancy hazard; ceiling from defaults; freezing = occupancy 'parking' && false (false);
heatSource = occupancy in {kitchen, mechanical}; omit false, omitReason ''. Also export `polygonArea(p)` (absolute, mm²),
`pointInPolygon(x, y, p)`, `polygonCentroid(p)`, `distanceToPolygonEdges(x, y, p)`.

## Task K2 — Head layout, head selection, piping layout & sizing (Sonnet)
Files `sprinkler/headLayout.ts`, `sprinkler/pipingLayout.ts`. Test `engine/__tests__/sprinklerLayoutAndPiping.test.ts`.

### Head selection — `selectHeadType(room, systemType, answers): SprinklerHeadType`
K: light/ordinary 5.6, extra-1 8.0, extra-2 11.2. Orientation: deluge → open (id code `OPEN`, orientation 'upright' for exposed
structure else 'pendent', open true); finished-flat ceiling: system wet → (room.freezing ? 'dry-pendent' : 'pendent'), dry /
preaction → 'dry-pendent'; exposed-structure → 'upright'. Response: quick for light and ordinary (all system types except
deluge), standard for extra and deluge. Temperature: heatSource → 200 °F intermediate (green); else 155 °F ordinary (red)
(§9.4.2, Table 7.2.4.1). id = `${QR|SR}-${PEN|UPR|DPEN|OPEN}-K${k}-${temp}` e.g. `QR-PEN-K5.6-155`; description
`Quick-response pendent spray sprinkler K5.6, 155°F (68°C) ordinary`.

### Head layout — `layoutRoomHeads(room, direction, rules): { points: [x, y][]; S: number; L: number }`
Bounding box W (x extent) × H (y extent). S is the spacing along branch lines (direction axis), L between branch lines.
For direction 'x': choose integers (nx, ny) minimising nx·ny subject to W/nx ≤ Smax, H/ny ≤ Smax, (W/nx)(H/ny) ≤ Amax
(Smax = maxSpacingFt × 304.8 mm, Amax = maxAreaFt2 / 10.7639 m² converted to mm²); ties → smaller |W/nx − H/ny|, then smaller nx.
S = W/nx, L = H/ny; grid points (minX + (i+0.5)S, minY + (j+0.5)L). Direction 'y' is the same with axes swapped (S along y).
Non-rectangular rooms: a grid point is kept if inside the polygon and ≥ 102 mm from every edge. For every other grid cell
that intersects the polygon (sample the cell on a 10 × 10 point grid; ≥ 5 % of samples inside), place a head at the average of
the inside samples, then if that point is < 102 mm from an edge or outside, move it to the inside sample nearest to that average
that is ≥ 102 mm from every edge. Coverage validation: every point of a 250 mm grid inside the polygon must have a head with
|dx| ≤ S/2 + 1 and |dy| ≤ L/2 + 1 (direction 'x'; swapped for 'y'); if not, increase the count along the axis with the larger
cell dimension by 1 and redo (≤ 10 rounds). Rectangular rooms therefore get exactly nx·ny heads.
Room checks (ids `${base}:${roomId}`): `spr-spacing` (S, L ≤ Smax), `spr-area` (S·L ≤ Amax), `spr-wall-distance` (max wall
distance ≤ S/2 along-branch and L/2 across, min ≥ 102 mm), `spr-min-spacing` (no two heads < 1829 mm apart), `spr-coverage`.

### Floor piping — `layoutFloorPiping(floorId, heads, riser, direction, ctx)`
`ctx = { hazardOf(tag): HazardClass; schedule; minMainIn: 2 }`; returns `{ pipes: SprinklerPipe[]; armIds; nodes }`.
Direction 'x' (swap axes for 'y'): rows = heads grouped by y rounded to 10 mm, rows within 150 mm merged (row y = mean).
Each row → junction `J{r}` at (riser.x, rowY) on the cross main; heads east of riser.x form the east arm, west of it the west arm
(arm ids `A{r}E` / `A{r}W`), ordered outward from the junction. Branch segments: J → nearest head, head → next head. Cross main
along x = riser.x through all junctions and the floor-control node `FC` at (riser.x, riser.y); segments between consecutive
nodes sorted by y. Riser nipple `FC` → `R` (the building riser connection, same point) length 1.0 m. If a junction coincides with the riser point
(within 1 mm) that junction node *is* `FC` (no separate J node, no zero-length segment).
Node ids: heads use their tag, junctions `J{r}`, `FC`, `R`. Rows are numbered by ascending y. Pipe ids `B-{arm}-{n}`, `CM-{n}`,
`RN`. sprinklersDownstream = number of heads supplied through the segment. Sizing: branch/arm segments
`pipeScheduleSize(count, spacingClass of the highest hazard among those heads)`; cross-main segments and the riser nipple the
same but not less than 2". Schedule from answers.pipeMaterial (sch10 → 'sch10', others 'sch40').

## Task K3 — Hydraulics, system types, accessories, BOM, engine & integration (Sonnet)
Files `sprinkler/sprinklerHydraulics.ts`, `sprinkler/sprinklerAccessories.ts`, `sprinkler/sprinklerEngine.ts`,
modify `fireProtectionEngine.ts`, `report.ts`. Test `engine/__tests__/sprinklerHydraulics.test.ts`.

### Elevation & source
Floor pipe elevation z = floor.elevationM + min(ceilingHeightM of non-omitted rooms) − 0.30 m (heads at the pipe elevation; drops
neglected). Without context (`designSprinklerSystem(input)`), the source is node `R` (flowAtSource = flowAtFloor, pressureAtSource
= pressure at R, hose allowance still reported). With context `{ pumpCLAbsM, feedMain: PipeRun, insideHoseGpm }` (from the fire
engine): add `R` → `BR` building riser (pipe buildingRiserIn/schedule, C as the system, length = rise = (z − pumpCLAbsM) × 3.28084 ft,
fittings {tee-branch:1, gate-valve:1, alarm-check:1 for wet / swing-check:1 otherwise}) and `BR` → `SRC` with the feed main run.

### Remote area — `calculateFloorDemand(floor, layout, heads, headTypes, systemType, hazard, ctx)`
Density / base area from HAZARD_DESIGN[hazard]; designArea = base × (dry or preaction-double ? 1.3 : 1).
Candidates = heads in non-omitted rooms with this hazard. Remote head = candidate with the largest pipe path length to `FC`;
ties → larger |headY − FC.y| (direction x) then larger x then larger y. N = ceil(designArea / remoteHead.areaFt2);
nb = ceil(1.2 √designArea / (remoteHead.spacingSmm / 304.8)). Arms holding candidates are ordered: the remote head's arm first,
then by |J − J_remote| along the cross main ascending, ties → the arm farther from FC first, then east before west. On each arm take
the min(nb, remaining) candidate heads farthest from its junction. Deluge: every head of the floor flows (all arms).
If fewer candidates than N exist: all flow and check `spr-design-area` = warn.
q_min = density × head.areaFt2 (use the remote head); P_start = max(7, (q_min/K)²).
Arm calculation (`calculateArm(arm, flowingTags, Pstart)`): from the farthest flowing head toward the junction; flowing heads add
q = K√P; non-flowing heads add nothing; the last segment (first head → J) carries fitting `{tee-branch: 1}` at the arm size;
C = hazenC(material, systemType); fitting equivalent lengths use the shared `equivalentLengthFt` (NFPA 13 Table 28.2.3.1.1 with the C multiplier, e.g. × 0.713 at C = 100). Remote arm: Pstart at its farthest flowing head. Other arms: computed with the same Pstart to
obtain K_arm = Q/√P_J.
Cross main: start at the remote arm junction, walk toward FC adding, at each junction reached, the flow of every other flowing arm
there (K_arm √P_J). Flowing arms whose junctions are on the other side of FC (or on cross-main stubs not on that path) join at FC:
for each such arm solve Q by bisection so that (Q/K_arm)² + Pf(cross-main path from its junction to FC at Q) = P_FC, and add Q at FC.
Then `FC` → `R` riser nipple: length 1.0 m, fittings {butterfly-valve: 1, elbow-90: 2} at the nipple size (floor control
assembly: supervised butterfly valve + waterflow switch). Rows (HydraulicNodeRow) in calculation order. Elevation terms are 0 on
the floor; the building riser adds 0.433 × rise.
The floor's governing remote area = the hazard with the highest pressure at the source; the building's = the floor with the highest.
Supply: city → availablePsi = Ps − (Ps − Pr)(Qtotal/Qr)^1.85 at Qtotal = flowAtSource + hoseAllowanceTotal; margin = available −
pressureAtSource; if margin < 0, upsize every segment that carried flow one pipe size (cross main + flowing arms + nipple, max 8")
and recompute, ≤ 6 rounds. Fire pump → filled by the fire engine after pump selection with the FP-1 curve as in the standpipe
analysis (net P at x = (flowAtSource + insideHose)/rated, + suctionPressureMinPsi); standalone fire-pump supply → available 0, margin 0.

### System checks per floor (ids `${base}:${floorId}`)
`spr-pressure-min` (remote head ≥ 7 psi), `spr-supply` (margin ≥ 0), `spr-dry-capacity` (dry: volume ≤ 500 pass; ≤ 750 pass with
"quick-opening device (accelerator) required"; > 750 warn "water delivery time calculation / test to ≤ N s required"),
`spr-preaction-size` (preaction: closed heads ≤ 1000), `spr-slope` (dry / preaction: pitch notes 4 mm/m branches, 2 mm/m mains),
`spr-quick-response` (light hazard heads must be quick response), `spr-freezing` (wet floor with freezing rooms uses dry-pendent
heads → pass, else fail), `spr-cpvc` (CPVC only for wet light hazard → else fail). Building: `spr-out-of-scope` (warn per
outOfScope item), `spr-spares`. volumeGal = Σ over the floor's pipes length(in) × π/4 × ID² / 231.

### Hangers & accessories & BOM
Hangers: for each pipe segment n = ceil(length / hangerSpacing(size)) hangers at (i + 0.5)·length/n along it.
Accessories (sprinklerAccessories.ts), tags SA-01…, with NFPA 13 references:
- every floor: floor control assembly (supervised butterfly / OS&Y + tamper switch, waterflow switch, test & drain with sight
  glass, pressure gauge) sized as the riser nipple; inspector's test connection (1" with orifice equal to the smallest K, at the
  most remote point, §16.14.2) — not for deluge; auxiliary drains (§16.10.5).
- wet (per building riser): alarm check valve with retard chamber, water-motor gong / electric bell, pressure switch, main drain
  2" (§16.10.4), gauges (§16.13), automatic air vent (§16.7), fire department connection 2-way 2½" with check valve + ball drip.
- dry: dry-pipe valve, air compressor / air-maintenance device, low-air supervisory switch, accelerator (quick-opening device)
  when volume > 500 gal, heated valve enclosure ≥ 4 °C (§8.2.5), auxiliary drum drips at low points, dry pendents where pendent.
- preaction-single / -double: preaction valve, solenoid release, releasing control panel (NFPA 72), detection (smoke / heat),
  supervisory air, (double: low-air and detection interlock).
- deluge: deluge valve, solenoid release, releasing panel, heat / flame detection, manual release station, strainer, open
  sprinklers.
Spare cabinet: total = spareHeadCount(totalHeads), distributed per head type proportionally (≥ 2 each), plus wrench (§16.2.7).
BOM: heads per type (ea), pipe length per size & schedule (m, 1 decimal), hangers per size (ea), floor control assemblies,
inspector's tests, and one line per accessory.

### Engine
`designSprinklerSystem(input: SprinklerDesignInput, ctx?): SprinklerSystemDesign` — per floor: head types, layout per room
(direction: 'auto' picks for the floor the direction with fewer total heads, tie 'x'), tags `S-{floorId}-{nnn}` in room order then
along rows (y, then x ascending), piping, sizing, hydraulics per system type, upsizing for city supply, checks; building governing,
accessories, spares, BOM, outOfScope (answers.highPiledStorage → 'High-piled storage above 12 ft requires an NFPA 13 Ch. 20–25
storage design (ESFR / CMSA / CMDA)').
Fire engine: if `input.sprinklerDesign` is present compute it with the context (pumpCLAbsM as for the standpipe, feedMain,
insideHose) and override `demand.sprinkler` (sprinklerFlowGpm = governing.flowAtSource, pressureAtPumpDischargePsi =
governing.pressureAtSource, rows = governing.rows, density / area from it, other fields consistent) before the system demand;
after pump selection fill availablePsi / margin and the `spr-supply` checks; `result.sprinklers`; checks appended. Without
sprinklerDesign: `sprinklers = null` and behaviour unchanged. Report: "AUTOMATIC SPRINKLER SYSTEM (NFPA 13)" section.

## Task K4 — Shop drawings per floor (Sonnet) — `drawing/sprinklerSheets.ts`
`generateSprinklerDrawings(result: FireDesignResult): { floors: { floorId: string; drawing: Drawing }[]; riserAndDetails: Drawing;
hydraulics: Drawing; combined: Drawing }` (null-safe: throws if result.sprinklers is null). Sheets FS-1nn (one per floor, n in floor
order from 01), FS-501 riser diagram & details, FS-601 hydraulic calculations; `combined` contains all sheets left → right.
Floor sheet (A1, scale from {50, 75, 100, 150, 200, 250, 500} that fits): architectural underlay from the floor's planDxf
(re-imported, every entity on a layer prefixed `A-` + original name, ACI 8; when no planDxf, room polygons only); room outlines
& names with hazard / occupancy; every sprinkler head symbol by type (pendent ○ with cross, upright ●, dry-pendent ◐, open ◎)
with tag; branch lines / cross main single-line with pipe size labels at each size change and segment lengths; riser & floor
control assembly symbol with callout; inspector's test; hangers (short ticks); remote design area boundary (dashed, hatched) with
the node numbers of flowing heads and the flow / pressure at FC; slope notes for dry; legend (head types with K / temp / response /
count), head schedule, notes (≥ 10, NFPA 13 clauses), north arrow, title block. Layers: FS-HEAD, FS-PIPE-BRANCH, FS-PIPE-MAIN,
FS-PIPE-RISER, FS-HANG, FS-REMOTE, FS-ROOM, FS-ANNO, FS-DIMS, FS-TBLK, FS-LEGEND + A-* underlay.
FS-501: riser diagram per system type in the design (all floors, floor control assemblies, building riser, valve trim per system
type: alarm check / dry-pipe valve + accelerator / preaction valve + solenoid / deluge valve + solenoid, FDC, main drain,
inspector's test), details (pendent / upright / dry-pendent installation with deflector 25–305 mm, hanger detail, floor control
assembly, inspector's test, dry-pipe valve trim when dry), accessory schedule, spare cabinet.
FS-601: governing hydraulic node table, every floor's remote area summary, demand vs supply graph (supply curve and demand point
incl. hose allowance), BOM table.

## Task K5 — UI & HTML report (Sonnet)
- `sprinkler/sprinklerReport.ts`: `buildSprinklerReportHtml(result: FireDesignResult, drawings): string` — self-contained,
  printable: project block, questionnaire answers, design basis (NFPA 13 tables), per floor (rooms table, heads, system type,
  remote area, node table), building summary, accessories, spares, BOM, checks, out-of-scope, embedded SVG of every floor sheet +
  FS-501 + FS-601.
- UI tab **Sprinklers** (fire workspace) as a wizard: 1 Questions (QUESTIONNAIRE) → 2 Floors (per floor: name, FFL, upload
  DXF / DWG (DWG converted with LibreDWG `dwg_write_dxf`), units select (auto/mm/cm/m/in/ft), room-layer multi-select, detect rooms,
  riser point (click on the plan preview or x/y inputs), system type (recommended shown)) → 3 Rooms (table: include/omit + reason,
  name, occupancy, hazard, ceiling height / type, freezing, heat source) → 4 Design (summary, per-floor preview with heads and pipes,
  remote area, checks) → 5 Exports (per-floor DXF, per-floor DWG via the existing exportDwg, riser/details DXF, hydraulics DXF,
  combined DXF, HTML report). A "Load sample floor" button creates a demo floor (synthetic DXF) so the workflow can be tried.
