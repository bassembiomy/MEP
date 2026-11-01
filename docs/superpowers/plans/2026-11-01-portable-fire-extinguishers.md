# Portable Fire Extinguishers (NFPA 10-2022) — Data, Calculation, Drawings, Report

> Extends the fire-protection branch. Contract already added in `engine/fireProtection/fpTypes.ts`:
> `ExtinguisherHazard, ExtinguisherAgent, ExtinguisherZoneInput, ExtinguisherDesignInput (FireDesignInput.extinguishers),
> ExtinguisherUnitType, PlacedExtinguisher, ExtinguisherCandidate, ExtinguisherZoneDesign, ExtinguisherSystemDesign
> (FireDesignResult.extinguishers)`. Do NOT change the contract or the tests. Paths relative to `src/renderer/src/`.
> Tests: `npx tsx <file>`; typecheck `npm run typecheck`. Unit conversions: 1 m = 3.28084 ft, 1 m² = 10.7639 ft².

## Standards rules (NFPA 10-2022 unless noted)
| Topic | Rule |
|---|---|
| Hazard classification | §5.4: light (low), ordinary (moderate), extra (high) |
| Class A (Table 6.2.1.1) | min single rating light 2-A / ordinary 2-A / extra 4-A; floor area per unit of A: 3000 / 1500 / 1000 ft²; max floor area per extinguisher 11 250 ft²; max travel 75 ft |
| Class B spill (Table 6.3.1.1) | light 5-B @ 30 ft or 10-B @ 50 ft; ordinary 10-B @ 30 ft or 20-B @ 50 ft; extra 40-B @ 30 ft or 80-B @ 50 ft |
| Class B appreciable depth (§6.3.2) | ≥ 20-B per ft² of the largest liquid surface, travel ≤ 50 ft; portable extinguishers may not be the sole protection when the surface exceeds 10 ft² (fixed system required) |
| Class C (§6.4) | C-rated, non-conductive agent; sized on the A/B hazard of the area; dry chemical not used on delicate electronics (§5.5.4 / Annex) → CO2 or clean agent |
| Class D (§6.5) | Class D agent for the specific metal, travel ≤ 75 ft from the hazard, size per manufacturer |
| Class K (§6.6) | travel ≤ 30 ft from cooking; one 1.5 gal (6 L) Class K per up to 4 fryers ≤ 80 lb cooking medium each, one more per additional group of 4; fryer > 80 lb → per manufacturer |
| Mounting (§6.1.3.8) | gross ≤ 40 lb: top ≤ 5 ft (1530 mm); gross > 40 lb: top ≤ 3.5 ft (1070 mm); bottom ≥ 4 in (102 mm) above floor; wheeled units on floor |
| Placement (§6.1.3) | conspicuous, along normal paths of travel incl. exits, not obstructed; signage where not visible (§6.1.3.3); cabinets not locked |
| Each floor | at least one extinguisher on each occupied floor (IFC §906.1 / NFPA 10 §6.1) |
| Inspection & maintenance | monthly inspection (§7.2), annual maintenance (§7.3), 6-yr internal exam stored-pressure dry chemical (§7.3.3), hydrostatic test Table 8.3.1: water / AFFF / wet chemical / CO2 5 yr; dry chemical / clean agent / dry powder 12 yr |
| Travel model | direct distance from any point of the zone to the nearest unit (half cell diagonal of a uniform grid) — the drawings note "verify actual walking travel on the architectural plan" |

## Task X1 — Engine (Sonnet)
Files: new `standards/nfpa10.ts`, new `extinguisherDesigner.ts`; modify `defaults.ts`, `fireProtectionEngine.ts`, `report.ts`
(add a section + `buildExtinguisherReport(result)`), `learningExample.ts` (add zones via the generator).
Test: `engine/__tests__/fireExtinguishers.test.ts` (provided).

### X1.1 `standards/nfpa10.ts`
```ts
export const FE_HAZARD: Record<ExtinguisherHazard, { label; minA: number; areaPerAFt2: number; bShort: number; bLong: number }>
// light {Light (Low) Hazard, 2, 3000, 5, 10}; ordinary {Ordinary (Moderate) Hazard, 2, 1500, 10, 20}; extra {Extra (High) Hazard, 4, 1000, 40, 80}
export const FE_MAX_AREA_PER_UNIT_FT2 = 11250, FE_TRAVEL_A_FT = 75, FE_TRAVEL_B_SHORT_FT = 30, FE_TRAVEL_B_LONG_FT = 50,
  FE_TRAVEL_D_FT = 75, FE_TRAVEL_K_FT = 30, FE_DEEP_B_PER_FT2 = 20, FE_DEEP_MAX_SURFACE_FT2 = 10,
  FE_K_FRYERS_PER_UNIT = 4, FE_K_MAX_FRYER_LB = 80, FE_LIGHT_MOUNT_TOP_MAX_MM = 1530, FE_HEAVY_MOUNT_TOP_MAX_MM = 1070,
  FE_MIN_BOTTOM_CLEARANCE_MM = 102, FE_HEAVY_LB = 40
export const FE_CATALOG: ExtinguisherUnitType[]   // typical listed ratings (UL 711) — verify with the selected manufacturer
```
| id | label | agent | A | B | C | K | D | ratingText | capacity | gross lb | height mm | wheeled | hydro yr | internal yr |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|ABC-2.5|Multipurpose dry chemical ABC|dry-chemical-abc|1|10|✓|||1-A:10-B:C|2.5 lb (1 kg)|5|330||12|6|
|ABC-5|Multipurpose dry chemical ABC|dry-chemical-abc|2|10|✓|||2-A:10-B:C|5 lb (2.3 kg)|9|400||12|6|
|ABC-10|Multipurpose dry chemical ABC|dry-chemical-abc|4|60|✓|||4-A:60-B:C|10 lb (4.5 kg)|17|500||12|6|
|ABC-20|Multipurpose dry chemical ABC|dry-chemical-abc|10|80|✓|||10-A:80-B:C|20 lb (9 kg)|33|600||12|6|
|CO2-5|Carbon dioxide|co2|0|5|✓|||5-B:C|5 lb (2.3 kg)|15|550||5|null|
|CO2-10|Carbon dioxide|co2|0|10|✓|||10-B:C|10 lb (4.5 kg)|33|700||5|null|
|CO2-15|Carbon dioxide|co2|0|10|✓|||10-B:C|15 lb (6.8 kg)|43|750||5|null|
|CO2-20|Carbon dioxide|co2|0|10|✓|||10-B:C|20 lb (9 kg)|56|800||5|null|
|WATER-2.5G|Stored-pressure water|water|2|0||||2-A|2.5 gal (9.5 L)|28|600||5|null|
|AFFF-2.5G|AFFF foam|afff|3|20||||3-A:20-B|2.5 gal (9.5 L)|28|600||5|null|
|CLEAN-5.5|Clean agent (HFC-236fa)|clean-agent|0|2|✓|||2-B:C|5.5 lb (2.5 kg)|10|450||12|null|
|CLEAN-15.5|Clean agent (HFC-236fa)|clean-agent|2|10|✓|||2-A:10-B:C|15.5 lb (7 kg)|26|550||12|null|
|WETCHEM-6L|Wet chemical Class K|wet-chemical|2|0||✓||2-A:K|1.5 gal (6 L)|25|550||5|null|
|CLASSD-30|Dry powder Class D|dry-powder-d|0|0|||✓|D|30 lb (13.6 kg)|45|650||12|null|
|WHEELED-ABC-125|Wheeled dry chemical ABC|dry-chemical-abc|40|240|✓|||40-A:240-B:C|125 lb (57 kg)|200|1100|✓|12|6|

Labels are `${label}, ${capacity}`.

### X1.2 `extinguisherDesigner.ts`
```ts
export function coverageGrid(lengthFt, widthFt, maxTravelFt, maxAreaFt2, minCount = 1): { nx; ny; maxTravelActualFt }
export function designExtinguisherZone(zone: ExtinguisherZoneInput): ExtinguisherZoneDesign   // tags assigned later
export function designExtinguishers(input: FireDesignInput): ExtinguisherSystemDesign | null  // null when !input.extinguishers
export function generateExtinguisherZonesFromFloors(building: BuildingInput): ExtinguisherZoneInput[]
```
**coverageGrid:** search nx, ny ∈ 1…50; feasible when nx·ny ≥ minCount, ½·√((L/nx)² + (W/ny)²) ≤ maxTravel + 1e-9 and
(L/nx)(W/ny) ≤ maxArea + 1e-9; minimise key (nx·ny, |L/nx − W/ny|, nx). maxTravelActualFt = ½·√((L/nx)² + (W/ny)²). Infinity allowed for maxArea.

**General units** (zone needs A, or B ≠ none, or C): candidates = FE_CATALOG minus wheeled, K-only (WETCHEM) and D units, filtered:
A → aRating ≥ minA; B spill → bRating ≥ bShort; B deep → surfaceFt2 = deepLayerSurfaceM2 × 10.7639 ≤ 10 and bRating ≥ ⌈20·surfaceFt2⌉;
C → cRated; sensitiveElectronics → agent ∈ {co2, clean-agent}.
Per candidate: travel = min(A ? 75 : ∞, spill ? (bRating ≥ bLong ? 50 : 30) : ∞, deep ? 50 : ∞), ∞ → 75; maxArea = A ? min(aRating·areaPerA, 11250) : ∞;
grid = coverageGrid(L, W, travel, maxArea). Select min count, tie → lower grossWeightLb, tie → catalog order. `candidates` lists every
feasible candidate (sorted the same way). If none is feasible (e.g. deep > 10 ft²): selectedUnitId null, count 0, check fail.
Fields: minARating/areaPerAFt2/maxAreaPerUnitFt2 (A only), minBRating (spill: bShort, deep: ⌈20·s⌉), bRequirement text
(spill: `${bLong}-B @ 50 ft or ${bShort}-B @ 30 ft (spill)`; deep: `${req}-B @ 50 ft (appreciable depth, ${s.toFixed(1)} ft²)`), maxTravelFt of the selected.
**Positions:** cell centres, iterate iy = 0…ny−1 (outer), ix = 0…nx−1 (inner): x = (ix + 0.5)·lengthM/nx, y = (iy + 0.5)·widthM/ny.
**Class K:** fryers > 0 → kUnits = ⌈fryers/4⌉ WETCHEM-6L, grid = coverageGrid(L, W, 30, ∞, kUnits) positions; maxFryerOilLb > 80 → warn check.
**Class D:** classD → dUnits = coverageGrid(L, W, 75, ∞).count CLASSD-30 (at least 1).
**Mounting:** gross ≤ 40 lb → top 1200 mm; > 40 lb → top 1000 mm; wheeled → top = height, mounting 'wheeled'; bottom = top − heightMm;
mounting = zone.mounting otherwise. coverageRadiusFt = travel used for that unit (general: selected travel, K 30, D 75).
**Tags** (in `designExtinguishers`): per floorId in input zone order, sequence `FE-${floorId}-${nn}` (2 digits) over the zone's
general units, then K, then D.
**Zone checks** (id `${base}:${zoneId}`): `fe-a-rating` (A), `fe-a-area` (A: maxAreaPerUnit·count ≥ area), `fe-travel` (actual ≤ allowed),
`fe-b-rating` (spill/deep), `fe-deep-b` (deep: fail when surface > 10 ft² "fixed system required, NFPA 10 §6.3.2"), `fe-c-agent`
(C: pass; sensitive → no dry chemical), `fe-k` (fryers > 0: pass, warn when > 80 lb), `fe-d` (classD: pass, detail names dMetal and
"size agent per manufacturer for the metal"), `fe-mounting` (every unit top ≤ limit and bottom ≥ 102). Only applicable checks are added.
**System checks:** `fe-every-floor` (building present: every non-roof floor has ≥ 1 unit, else fail listing floorsMissing; no
building: pass), `fe-total` (pass, detail total & per type), `fe-inspection` (pass, NFPA 10 Ch. 7/8 schedule text).
`totals` = per unit id with qty > 0 in catalog order; totalCount; floorsCovered = distinct floorIds in zone order.
**generateExtinguisherZonesFromFloors:** one zone per non-roof floor: id `Z-${floor.id}`, name = floor.usage, hazard: usage contains
"park"/"plant"/"garage"/"storage"/"retail" (case-insensitive) → ordinary, else light; classB 'spill' for parking/garage; L × W from
area with 4:3 ratio (W = √(area·3/4), L = area/W, rounded to 0.1 m); classA true; others off; mounting 'bracket'.

### X1.3 Defaults & engine
`DEFAULT_FIRE_INPUT.extinguishers.zones` (SIMPLE_FIRE_INPUT has none):
| id | name | floor | hazard | L×W m | A | B | C | sens | K | other |
|---|---|---|---|---|---|---|---|---|---|---|
|Z1|Parking|B1|ordinary|40×30|✓|spill|||||
|Z2|Electrical Room|B1|ordinary|6×5|✓||✓|✓|||
|Z3|Fire Pump Room|B1|ordinary|13.8×6.5|✓|spill|✓||||
|Z4|Lobby|GF|light|40×27.5|✓|||||
|Z5|Kitchen|GF|ordinary|10×10|✓||||3 fryers × 50 lb|
|Z6…Z13|Offices Level n|L1…L8|light|40×30|✓|||||
(deepLayerSurfaceM2 0, dMetal '', fryers 0 / maxFryerOilLb 0 unless stated, mounting 'bracket'; Electrical Room 'cabinet'.)
Learning example: `extinguishers: { zones: generateExtinguisherZonesFromFloors(building) }`.
Engine: `extinguishers = designExtinguishers(input)`; append its system + zone checks to `checks`; `result.extinguishers`.

### X1.4 Report
`report.ts`: section "PORTABLE FIRE EXTINGUISHERS (NFPA 10)" in buildFireCalcReport, and `buildExtinguisherReport(result): string` — a
standalone design report: project header, standards & design basis, hazard rules table, catalog/spec of used units, per-zone
calculation (area, requirement, candidates with counts, selection, grid, travel, K/D), extinguisher schedule (tag, floor, zone,
unit, rating, mounting top/bottom, cabinet), totals, inspection/maintenance schedule (monthly, annual, 6-yr, hydrostatic per type),
installation specification (≥ 10 items), checks, code note. Print areas as plain integers (e.g. `11250 ft²`, no thousands separators).

## Task X2 — Drawings (Sonnet) — `drawing/sheetExtinguishers.ts`, `drawing/subsetDrawing.ts`, register in `sheets.ts`
When `result.extinguishers` is non-null append (after the standpipe sheets, or after FP-105 if none):
- **FP-108 PORTABLE FIRE EXTINGUISHER LAYOUT — SCHEMATIC FLOOR PLANS** (more pages FP-108.2 … if floors do not fit; scale from
  {100, 150, 200, 250, 500, 1000}): one framed mini-plan per floor in floor order titled `<floor name> — FFL ±x.xxx` (level text with
  floor name). Zones as rectangles (FP-WALL) packed left→right in input order with 2 m gaps, each labelled name / hazard / classes
  ("CLASS A:B:C"). Every extinguisher: symbol (filled triangle in circle) with the tag, unit id next to it, dashed coverage circle
  of radius coverageRadiusFt (FP-HIDN), K units and D units with their own symbols; north arrow per sheet; legend; notes ("Positions are
  coverage points — mount on the nearest wall / column along the path of travel, near exits; verify walking travel distance …").
- **FP-109 FIRE EXTINGUISHER DETAILS, SCHEDULE & SPECIFICATIONS** (scale 1:20 for details): (a) "MOUNTING DETAIL — UNITS ≤ 40 LB"
  elevation with floor, wall, bracket, extinguisher, dimensions top 1200 (max 1530) and bottom clearance ≥ 102; (b) "MOUNTING DETAIL —
  UNITS > 40 LB" top 1000 (max 1070); (c) "SEMI-RECESSED CABINET DETAIL" (front + section); (d) "SIGN DETAIL" (FIRE EXTINGUISHER sign);
  (e) "EXTINGUISHER SCHEDULE" table (tag, floor, zone, unit, rating, agent, mounting, top/bottom mm); (f) "QUANTITY SUMMARY";
  (g) "SELECTION MATRIX" (classes A/B/C/D/K vs agents); (h) "INSPECTION & MAINTENANCE" (NFPA 10 Ch. 7/8, hydrostatic intervals per type);
  (i) "EXTINGUISHER SPECIFICATIONS & NOTES" (≥ 10, NFPA 10 §5.4, Table 6.2.1.1, Table 6.3.1.1, §6.3.2, §6.4, §6.5, §6.6, §6.1.3.8, IFC §906).
- `subsetDrawing(drawing, sheetNumbers: string[]): Drawing` — keep only those sheets and the entities inside their frames, then shift
  them so the first kept sheet starts at x = 0 (for the "Extinguisher DXF" export).

## Task X3 — UI (Sonnet)
- Input section **FIRE EXTINGUISHERS (NFPA 10)**: enable checkbox (on → zones from DEFAULT or generated from building floors),
  button "Generate zones from building floors", editable zone table (name, floor select (building floors or free text), hazard,
  L, W, A, B (none/spill/deep) + deep surface, C, sensitive, D + metal, fryers + max oil lb, mounting), add/duplicate/delete rows.
- Results tab **Extinguishers**: totals cards, per-zone calculation cards (requirement, candidates table with the selected one
  highlighted, grid & actual travel, K/D), extinguisher schedule table, checks.
- Exports on that tab: "Extinguisher report (.txt)" (buildExtinguisherReport), "Extinguisher report (HTML, printable)" — the report
  sections as HTML tables plus the FP-108/FP-109 SVGs (renderSvg, white background) embedded, print CSS, and
  "Extinguisher drawings (.dxf)" = writeDxf(subsetDrawing(drawing, ['FP-108…', 'FP-109'])).
- Learning tab: add a step "Step 12 - Portable fire extinguishers (NFPA 10)" before the report step, with live values and actions.
