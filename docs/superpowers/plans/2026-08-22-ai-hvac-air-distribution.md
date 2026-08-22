# AI HVAC Air Distribution and Ducted System Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, deterministic, ASHRAE/SMACNA-compliant AI HVAC Air Distribution and Ducted System Design Engine that selects equipment, partitions multi-unit service zones, places terminals, routes progressive stepped duct networks, sizes fresh air systems, executes a 9-point validation suite, renders interactive CAD layers, and exports 5 engineering schedules with an explainable Design Decision Log.

**Architecture:** A decoupled, modular TypeScript engine where the cooling source is abstracted from the air-distribution network. Configurable design standards govern velocity/acoustic/throw/ventilation limits. A 10-phase pipeline deterministically calculates airflow, scores single vs. multi-unit options, partitions geometry, positions terminals, steps duct airflow, budgets pressure, and validates against 9 engineering criteria with dependency-scoped recalculation upon user overrides (`ai`, `user-modified`, `user-locked`).

**Tech Stack:** TypeScript 5.9, React 19, React-Konva / HTML5 Canvas, Zustand 5, Electron 39 / Vite 7, `tsx` for test execution.

**Spec:** [`docs/superpowers/specs/2026-08-22-ai-hvac-air-distribution-design.md`](file:///G:/mep%20prog/docs/superpowers/specs/2026-08-22-ai-hvac-air-distribution-design.md)

## Global Constraints
- Decouple cooling source (DX, Chilled Water, Heat Pump, Package) from air distribution networks.
- No hardcoded velocity, NC, or friction constants in algorithms; load from pluggable `standards/` profiles.
- Upfront static pressure budgeting before duct sizing: $\Delta P_{budget} \le \text{ESP}_{rated} - \Delta P_{internal}$.
- Support 3 element ownership states: `ai`, `user-modified`, `user-locked`.
- 9-Point validation suite strictly enforces: Supply Airflow Balance %, Room CFM tolerance, Mass Balance (pressurization), Velocity Limits, Acoustics (duct-transmitted & terminal NC), Throw & Comfort Envelope, ESP Margin, Derated Equipment Capacity, and Spatial Coordination.
- Louver sizing must calculate Gross vs. Free Area with manufacturer water-penetration velocity curves.
- Test runner: `npx tsx <path/to/test.ts>`.

---

## File Structure Map
```text
src/renderer/src/engine/
├── standards/
│   ├── designStandards.ts            # Defines StandardsProfile, ASHRAE_PROFILE, SMACNA_PROFILE, CUSTOM_PROFILE
│   ├── acousticRules.ts              # NC/RC limits and allowable duct velocity envelopes
│   ├── ventilationRules.ts           # ASHRAE 62.1 breathing zone ventilation formulas
│   ├── diffuserRules.ts              # Throw ratios, characteristic room length criteria
│   ├── comfortRules.ts               # Occupied-zone velocity envelopes per activity & draft sensitivity
│   └── ductSizingRules.ts            # Max friction rates, velocity limits, max aspect ratio
│
├── systemArchitecture/
│   ├── hvacSystemResolver.ts         # Resolves cooling source and equipment category
│   ├── equipmentSelector.ts          # Queries catalog for compliant models
│   ├── equipmentOptimizer.ts         # Multi-unit evaluation & multi-criteria scoring algorithm
│   └── designDecisionLogger.ts       # Generates human-readable engineering rationale & traces
│
├── zoning/
│   ├── zonePartitioner.ts            # Voronoi/bay partitioning across service boundaries
│   ├── loadDistribution.ts           # Subdivides sensible and latent loads across service bays
│   └── solarLoadWeighting.ts         # Biases airflow towards exterior/glass envelopes
│
├── terminals/
│   ├── terminalPlacer.ts             # Supply diffuser layout generator
│   ├── diffuserSelector.ts           # Catalog matching for neck/face size, throw, and NC
│   ├── returnPlacer.ts               # Return grille placement & anti-short-circuit logic
│   └── airDistributionValidator.ts   # Throw ratio, overlap, and occupied zone velocity checks
│
├── ducts/
│   ├── steppedDuctRouter.ts          # Generates supply trunks with decrementing CFM branches
│   ├── returnDuctRouter.ts           # Routes return ducted networks or plenum paths
│   ├── aerodynamicDuctSizer.ts       # Rectangular/round SMACNA sizing per velocity limits
│   ├── ductPressureCalculator.ts     # Darcy-Weisbach / Colebrook friction loss calculation
│   └── fittingLossCalculator.ts      # Equivalent length and dynamic local loss coefficients (C-factors)
│
├── outdoorAir/
│   ├── outdoorAirCalculator.ts       # Fresh air requirements per room occupancy and area
│   ├── louverSizer.ts                # Louver gross vs. free area sizing per manufacturer data
│   ├── freshAirRouter.ts             # Intake louvers, FA ducting, and equipment connection collars
│   └── ventilationValidator.ts       # Fresh air balance and building pressurization checks
│
├── validation/
│   ├── hvacValidator.ts              # Master 9-point validation aggregator
│   ├── airflowValidator.ts           # Tolerance-based airflow & room CFM matching
│   ├── massBalanceValidator.ts       # Supply + OA = Return + Exhaust + Relief ± Pressurization
│   ├── acousticValidator.ts          # Duct-generated/transmitted noise & terminal NC compliance
│   ├── pressureValidator.ts          # Critical path ESP vs. equipment fan ESP margin
│   ├── comfortValidator.ts           # Comfort criteria & occupied-zone air velocity envelope
│   └── spatialValidator.ts           # 3D clearance, wall penetration, and clash detection
│
├── export/
│   ├── exportSchedules.ts            # 5 schedules: Air Distribution, Duct, Diffuser, Equipment, Outdoor Air
│   └── exportDesignReport.ts         # PDF/Text engineering calculation report + Decision Log
│
├── airDistributionEngine.ts          # Master 10-phase orchestration & dependency recalculator
└── __tests__/
    ├── standardsLayer.test.ts
    ├── multiUnitOptimizer.test.ts
    ├── zonePartitioner.test.ts
    ├── terminalsAndReturns.test.ts
    ├── steppedDuctsAndSizing.test.ts
    ├── outdoorAirAndLouver.test.ts
    ├── master9PointValidation.test.ts
    ├── schedulesAndDecisionLog.test.ts
    └── endToEndAirDistribution.test.ts
```

---

### Task 1: Design Standards Layer & Pluggable Profiles

**Files:**
- Create: `src/renderer/src/engine/standards/designStandards.ts`
- Create: `src/renderer/src/engine/standards/acousticRules.ts`
- Create: `src/renderer/src/engine/standards/ventilationRules.ts`
- Create: `src/renderer/src/engine/standards/diffuserRules.ts`
- Create: `src/renderer/src/engine/standards/comfortRules.ts`
- Create: `src/renderer/src/engine/standards/ductSizingRules.ts`
- Test: `src/renderer/src/engine/__tests__/standardsLayer.test.ts`

**Interfaces:**
- Produces: `StandardsProfile`, `ASHRAE_PROFILE`, `SMACNA_PROFILE`, `getAcousticVelocityLimit(role, ncTarget, profile)`, `getVentilationRates(spaceType, profile)`, `getComfortVelocityEnvelope(activity, draftSensitive, mode, profile)`, `getDuctSizingConstraints(role, profile)`.

- [ ] **Step 1: Write failing test for standards layer**
Create `src/renderer/src/engine/__tests__/standardsLayer.test.ts` testing retrieval of velocity limits, NC thresholds, ventilation CFM rates, and comfort velocity envelopes.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx src/renderer/src/engine/__tests__/standardsLayer.test.ts`
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement standards layer modules**
Implement `designStandards.ts`, `acousticRules.ts`, `ventilationRules.ts`, `diffuserRules.ts`, `comfortRules.ts`, and `ductSizingRules.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx tsx src/renderer/src/engine/__tests__/standardsLayer.test.ts`
Expected: PASS (100% assertions satisfied)

---

### Task 2: System Architecture Resolver, Multi-Unit Optimizer & Decision Logger

**Files:**
- Create: `src/renderer/src/engine/systemArchitecture/hvacSystemResolver.ts`
- Create: `src/renderer/src/engine/systemArchitecture/equipmentSelector.ts`
- Create: `src/renderer/src/engine/systemArchitecture/equipmentOptimizer.ts`
- Create: `src/renderer/src/engine/systemArchitecture/designDecisionLogger.ts`
- Test: `src/renderer/src/engine/__tests__/multiUnitOptimizer.test.ts`

**Interfaces:**
- Consumes: `StandardsProfile` from Task 1, `STANDARD_EQUIPMENT_CATALOG` from `hvacCatalogs.ts`.
- Produces: `resolveSystemCategory(source, equipmentType)`, `selectEquipmentForLoad(reqCfm, loadBtu, systemType)`, `optimizeMultiUnitCandidates(roomLoad, reqCfm, geometry, profile)`, `generateDesignDecisionLog(zoneName, selectedOption, allOptions, validationResults)`.

- [ ] **Step 1: Write failing test for multi-unit optimization and decision logging**
Test 4,000 CFM conference hall evaluating 1-unit (4000 CFM AHU), 2-unit (2000 CFM FCU), and 3-unit (1345 CFM concealed DX) options, scoring each and logging the engineering rationale.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx src/renderer/src/engine/__tests__/multiUnitOptimizer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement equipment resolver, selector, optimizer, and decision logger**
Implement multi-criteria scoring:
$$\text{Score} = S_{cap} + S_{dist} + S_{acoustic} + S_{esp} + S_{duct} + S_{depth} + S_{cost} + S_{redun} - P_{units}$$
and decision log text formatter.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx tsx src/renderer/src/engine/__tests__/multiUnitOptimizer.test.ts`
Expected: PASS

---

### Task 3: Solar- & Load-Weighted Service Zone Partitioner

**Files:**
- Create: `src/renderer/src/engine/zoning/zonePartitioner.ts`
- Create: `src/renderer/src/engine/zoning/loadDistribution.ts`
- Create: `src/renderer/src/engine/zoning/solarLoadWeighting.ts`
- Test: `src/renderer/src/engine/__tests__/zonePartitioner.test.ts`

**Interfaces:**
- Consumes: Room polygon, unit candidate count, equipment positions, external wall / window orientations.
- Produces: `EquipmentServiceZone[]` with non-uniform load-aware polygon coordinates, sensible/latent load breakdowns, and initial pressure budgets.

- [ ] **Step 1: Write failing test for zone partitioning**
Test 3-unit partition of rectangular and L-shaped polygons, verifying polygon area conservation and solar-load weighting.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx src/renderer/src/engine/__tests__/zonePartitioner.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement zone partitioning and solar load weighting algorithms**
Implement Voronoi / orthogonal slicing respecting equipment mounting walls, envelope heat gain, and user-modified boundaries.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx tsx src/renderer/src/engine/__tests__/zonePartitioner.test.ts`
Expected: PASS

---

### Task 4: Supply Diffuser & Anti-Short-Circuit Return Grille Placers

**Files:**
- Create: `src/renderer/src/engine/terminals/diffuserSelector.ts`
- Create: `src/renderer/src/engine/terminals/terminalPlacer.ts`
- Create: `src/renderer/src/engine/terminals/returnPlacer.ts`
- Create: `src/renderer/src/engine/terminals/airDistributionValidator.ts`
- Test: `src/renderer/src/engine/__tests__/terminalsAndReturns.test.ts`

**Interfaces:**
- Consumes: `EquipmentServiceZone[]`, `StandardsProfile`, `STANDARD_DIFFUSER_CATALOG`.
- Produces: `CoordinatedAirTerminal[]` for supply and return, throw/overlap verification, and anti-short-circuit distance check ($D \ge 0.6 \times T_{50}$).

- [ ] **Step 1: Write failing test for terminal placement and throw validation**
Test placement of 4 diffusers per bay @ 335 CFM each, validating $T_{50} / L$, neck velocity $\le 600\text{ FPM}$, NC $\le 25$, and return grille separation.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx src/renderer/src/engine/__tests__/terminalsAndReturns.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement terminal placer, return placer, and throw validator**
Implement catalog-based terminal selection, centroid distribution, and performance-based throw/overlap checking.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx tsx src/renderer/src/engine/__tests__/terminalsAndReturns.test.ts`
Expected: PASS

---

### Task 5: Stepped Supply & Return Duct Routers with Progressive Decrements

**Files:**
- Create: `src/renderer/src/engine/ducts/steppedDuctRouter.ts`
- Create: `src/renderer/src/engine/ducts/returnDuctRouter.ts`
- Test: `src/renderer/src/engine/__tests__/steppedDuctsAndSizing.test.ts` (Part 1: Routing)

**Interfaces:**
- Consumes: `EquipmentServiceZone[]`, `CoordinatedAirTerminal[]`.
- Produces: `SteppedDuctSection[]` supply and return trees with exact decrementing downstream CFM ($1345 \to 1005 \to 670 \to 335\text{ CFM}$) and parent-child hierarchy.

- [ ] **Step 1: Write failing test for stepped duct routing**
Test supply trunk generation from unit collar to 4 diffusers, verifying exact CFM reduction at each takeoff branch.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx src/renderer/src/engine/__tests__/steppedDuctsAndSizing.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement stepped duct router and return duct router**
Implement orthogonal centerline spine routing, branch takeoffs, and CFM decrement propagation.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx tsx src/renderer/src/engine/__tests__/steppedDuctsAndSizing.test.ts`
Expected: PASS

---

### Task 6: SMACNA Aerodynamic Duct Sizer & Fitting Loss Calculator

**Files:**
- Create: `src/renderer/src/engine/ducts/aerodynamicDuctSizer.ts`
- Create: `src/renderer/src/engine/ducts/ductPressureCalculator.ts`
- Create: `src/renderer/src/engine/ducts/fittingLossCalculator.ts`
- Test: `src/renderer/src/engine/__tests__/steppedDuctsAndSizing.test.ts` (Part 2: Sizing & Pressure)

**Interfaces:**
- Consumes: `SteppedDuctSection[]`, `StandardsProfile`, available ceiling depth limit.
- Produces: Sized standard rectangular ($W \times H$) and round duct sections, actual velocity, friction loss per 100 ft, local fitting losses, and total pressure drop.

- [ ] **Step 1: Write failing test for SMACNA sizing and Darcy-Weisbach loss calculation**
Test sizing of $1345\text{ CFM}$ trunk ($18\times12$ or equivalent), $670\text{ CFM}$ branch ($12\times10$), and $335\text{ CFM}$ runout ($10\times8$), verifying velocity limits and critical path ESP sum.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx src/renderer/src/engine/__tests__/steppedDuctsAndSizing.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement aerodynamic duct sizer, friction loss calculator, and C-factor fitting calculator**
Implement standard SMACNA sizing tables, max aspect ratio constraints ($\le 3:1$), and Colebrook friction equations.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx tsx src/renderer/src/engine/__tests__/steppedDuctsAndSizing.test.ts`
Expected: PASS

---

### Task 7: Dedicated Outdoor Air System & Louver Sizer

**Files:**
- Create: `src/renderer/src/engine/outdoorAir/outdoorAirCalculator.ts`
- Create: `src/renderer/src/engine/outdoorAir/louverSizer.ts`
- Create: `src/renderer/src/engine/outdoorAir/freshAirRouter.ts`
- Create: `src/renderer/src/engine/outdoorAir/ventilationValidator.ts`
- Test: `src/renderer/src/engine/__tests__/outdoorAirAndLouver.test.ts`

**Interfaces:**
- Consumes: Room occupancy, area, `EquipmentServiceZone[]`, `StandardsProfile`.
- Produces: `OutdoorAirSystem`, `IntakeLouverItem` (Gross vs. Free Area, free-area velocity, water penetration rating), and connection routing.

- [ ] **Step 1: Write failing test for outdoor air ventilation and louver sizing**
Test 592 CFM outdoor air intake for 3 units, sizing intake louver ($500\text{ FPM}$ free-area velocity, $50\%$ free area ratio $\to$ gross dimensions), and verifying unit connection compatibility.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx src/renderer/src/engine/__tests__/outdoorAirAndLouver.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement outdoor air calculator, louver sizer, and router**
Implement ASHRAE 62.1 breathing zone ventilation formulas, louver catalog selection, and fresh air duct branches.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx tsx src/renderer/src/engine/__tests__/outdoorAirAndLouver.test.ts`
Expected: PASS

---

### Task 8: Master 9-Point Engineering Validation Suite

**Files:**
- Create: `src/renderer/src/engine/validation/airflowValidator.ts`
- Create: `src/renderer/src/engine/validation/massBalanceValidator.ts`
- Create: `src/renderer/src/engine/validation/acousticValidator.ts`
- Create: `src/renderer/src/engine/validation/pressureValidator.ts`
- Create: `src/renderer/src/engine/validation/comfortValidator.ts`
- Create: `src/renderer/src/engine/validation/spatialValidator.ts`
- Create: `src/renderer/src/engine/validation/hvacValidator.ts`
- Test: `src/renderer/src/engine/__tests__/master9PointValidation.test.ts`

**Interfaces:**
- Consumes: All outputs from Tasks 1–7.
- Produces: `MasterValidationReport` containing pass/warning/fail status, percentage tolerances, acoustic checks, critical path ESP vs. equipment rating, and spatial clash detection.

- [ ] **Step 1: Write failing test for 9-point validation suite**
Test each validation rule individually with passing and failing mocks (airflow imbalance, excessive duct velocity, NC violation, ESP deficit, and wall penetration clash).

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx src/renderer/src/engine/__tests__/master9PointValidation.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement all 9 validation sub-modules and master aggregator**
Implement tolerance checks, mass balance with pressurization strategies (`positive`, `neutral`, `negative`), acoustic ratings, critical path ESP margins, comfort velocity checks, and 2D/3D geometric clash detection.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx tsx src/renderer/src/engine/__tests__/master9PointValidation.test.ts`
Expected: PASS

---

### Task 9: Master Air Distribution Pipeline with Scoped Dependency Recalculation

**Files:**
- Create: `src/renderer/src/engine/airDistributionEngine.ts`
- Modify: `src/renderer/src/engine/types.ts`
- Test: `src/renderer/src/engine/__tests__/endToEndAirDistribution.test.ts` (Part 1: Pipeline)

**Interfaces:**
- Produces: `executeAirDistributionDesign(input: AirDistributionDesignInput): AirDistributionDesignResult`, `recalculateScopedOverride(modifiedElementId: string, currentDesign: AirDistributionDesignResult): AirDistributionDesignResult`.

- [ ] **Step 1: Write failing test for master pipeline and scoped override recalculation**
Execute full 10-phase pipeline on conference hall data, verify complete design generation, then simulate moving FCU-02 position (`user-modified`) and verify only downstream branches recalculate while preserving user-locked elements.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx src/renderer/src/engine/__tests__/endToEndAirDistribution.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement master 10-phase pipeline and scoped dependency engine**
Integrate Phases 1 through 8 in `airDistributionEngine.ts`, with dependency graph resolution for user edits.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx tsx src/renderer/src/engine/__tests__/endToEndAirDistribution.test.ts`
Expected: PASS

---

### Task 10: 5 Engineering Schedules & Design Decision Log Exporter

**Files:**
- Create: `src/renderer/src/engine/export/exportSchedules.ts`
- Create: `src/renderer/src/engine/export/exportDesignReport.ts`
- Test: `src/renderer/src/engine/__tests__/schedulesAndDecisionLog.test.ts`

**Interfaces:**
- Consumes: `AirDistributionDesignResult`.
- Produces: Structured tables for Air Distribution Schedule, Duct Schedule, Diffuser Schedule, Equipment Schedule, Outdoor Air Schedule, and formatted Design Decision Log.

- [ ] **Step 1: Write failing test for 5 schedules and report generation**
Test tabular output extraction, formatting, and markdown/text report creation for all 5 schedules.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx src/renderer/src/engine/__tests__/schedulesAndDecisionLog.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement export schedules and design report formatter**
Implement data mappers and tabular formatters matching standard engineering drawing schedules.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx tsx src/renderer/src/engine/__tests__/schedulesAndDecisionLog.test.ts`
Expected: PASS

---

### Task 11: Multi-Layer CAD Canvas Visualization & Interactive Overrides

**Files:**
- Modify: `src/renderer/src/store/projectStore.ts`
- Modify: `src/renderer/src/canvas/FloorPlanCanvas.tsx`
- Create: `src/renderer/src/panels/AirDistributionSchedulePanel.tsx`
- Create: `src/renderer/src/panels/DesignDecisionLogPanel.tsx`

**Interfaces:**
- Renders supply ducts (cyan with progressive CFM labels), supply diffusers (green 4-way arrows), return grilles (purple), equipment blocks (red/yellow), and fresh air system (orange) with drag & edit interaction and ownership locks.

- [ ] **Step 1: Update project store with air distribution state and design control modes**
Add `airDistributionResult`, `selectedStandardProfile`, `elementControlModes`, and mutation actions to `projectStore.ts`.

- [ ] **Step 2: Update FloorPlanCanvas to render progressive CFM stepped ducts and CAD layers**
Add dedicated Konva rendering layers matching the CAD drawing: supply duct CFM callouts (`1345 -> 1005 -> 670 -> 335`), supply/return symbols, louver blocks, and drag handlers for equipment and bay dividers.

- [ ] **Step 3: Create UI panels for the 5 engineering schedules and Design Decision Log**
Implement `AirDistributionSchedulePanel.tsx` and `DesignDecisionLogPanel.tsx` with tabs for each schedule, validation badges, and CSV/PDF export buttons.

- [ ] **Step 4: Verify typecheck and build**
Run: `npm run typecheck`
Expected: PASS with 0 errors.

---

### Task 12: Comprehensive 12-Scenario End-to-End HVAC Design Integration Tests

**Files:**
- Create: `src/renderer/src/engine/__tests__/endToEndAirDistribution.test.ts`

**Interfaces:**
- Validates all 12 real-world engineering test scenarios:
  1. Small single-unit room
  2. Large conference hall with 3 units (matching the CAD drawing)
  3. Room with high solar load on one façade
  4. Irregular L-shaped room
  5. Room with ceiling beams and lighting obstacles
  6. User override scenario (3 units to 2 units)
  7. Insufficient equipment ESP warning
  8. Insufficient ceiling depth warning
  9. Diffuser throw failure detection
  10. Outdoor-air louver sizing failure
  11. Equipment catalog fallback
  12. Return-air short-circuit detection

- [ ] **Step 1: Write complete 12-scenario integration test suite**
Implement automated test cases in `src/renderer/src/engine/__tests__/endToEndAirDistribution.test.ts` covering every scenario with explicit assertions.

- [ ] **Step 2: Run test suite**
Run: `npx tsx src/renderer/src/engine/__tests__/endToEndAirDistribution.test.ts`
Expected: PASS (All 12 scenarios passing with 100% assertions satisfied).

---

## Execution Choice Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-22-ai-hvac-air-distribution.md`.
