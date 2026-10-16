# Professional HVAC Precision Overhaul — Plan

Source: three audits (selection, air distribution, CAD drawing), 2026-10-16.
Roles: planner/tester = Opus; executors = Sonnet (one per task, isolated worktree, disjoint files).
Baseline: typecheck clean; 18/19 test scripts pass (deploymentAcceptance Test 8 fails: airflow not conserved).
Shared module: `src/renderer/src/engine/units.ts` (all conversions — use it, never inline constants).
Run tests: `npx -y tsx src/renderer/src/engine/__tests__/<file>.test.ts`; typecheck: `npm run typecheck`.

## Wave 1 (parallel)
- T1 Loads & ventilation — loadCalc, knowledgeBase, ventilationRules, loadDistribution, solarLoadWeighting, projectStore(draft occupants).
- T2 Equipment selection — systemDesigner, systemArchitecture/*, hvacCatalogs, hvacArchitecture, ZonePropertiesPanel.
- T3 Terminals & placement — zonePartitioner, terminals/*, diffuserPlacer, geometry, spatial/massBalance validators.
- T4 Ducts & pressure — ductSizer, ducts/*, ductRouter, acousticDuctEngine, staticPressureCalc, pressureValidator, spatialPlanner, deploymentManager.
- T6 CAD import — dxfParser, dwgParser, Toolbar (INSUNITS, Y-flip, arcs, bulges, POLYLINE, INSERT/blocks, radians).

## Wave 2
- T5 Engine scale integration — airDistributionEngine px→ft at entry/exit, ASHRAE 62.1 OA, AirDistributionSchedulePanel.
- T7 Canvas true-scale drawing — physical-size diffusers/ducts/units/throw, fittings, arcs, snapping, polygon close, pan, perf.

## Wave 3
- Opus full verification: typecheck, all tests, adversarial review, fix round.

## Acceptance (global)
- No unit mixing: metric inputs converted once via units.ts.
- No undersized selection; oversize ≤ 20 %; sensible capacity ≥ room sensible.
- Every terminal inside room polygon, unique positions, regular grid.
- Ducts orthogonal, CFM conserved, trunk sizes monotonic, friction ≤ 0.10 in.wg/100ft, aspect ≤ 4:1.
- Canvas: 24" diffuser = 2 ft × pxPerFt; duct width true scale; DXF in mm/m/in/ft lands at correct size, not mirrored.
