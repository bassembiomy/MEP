# Engineering Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Prevent invalid or infeasible HVAC designs from being calculated, selected, validated, or committed as successful designs.

**Architecture:** Reuse the existing calculation and layout modules behind explicit input normalization and strict validation. Share the preliminary load model between application and orchestrator. Preserve current public interfaces with optional engineering inputs, and distinguish preliminary verification from issue readiness.

**Tech Stack:** Electron, React, TypeScript, Zustand, Vitest 5.0.3.

**Spec:** docs/audits/2026-10-08-cad-hvac-engine-audit.md (approved first implementation scope on 2026-10-08).

## Global Constraints

- Preserve all pre-existing uncommitted changes; no reset, cleanup, bulk formatting, or automatic commit of unrelated work.
- Canonical orchestrator geometry uses feet, loads use Btu/h, and flow uses CFM; convert metric input geometry exactly once.
- Retain the current load model as an explicitly preliminary model; do not claim detailed building-load or standards certification.
- No feasible equipment means an explicit blocked selection; no fabricated capacity or silent type substitution.
- Missing required validation cannot produce a passing design.
- A blocked or stale deployment cannot mutate project state.
- Add failing behavioral regressions before implementation and report existing baseline failures honestly.
- Complete the authorized scope in this session without publishing, pushing, or merging.

### Task 1: Authoritative geometry and preliminary calculations

**Files:** adapters/zoningAdapter.ts; adapters/loadAirflowAdapter.ts; loadCalc.ts; new engine input/unit helpers if needed; __tests__/engineeringInputIntegrity.test.ts; __tests__/loadCalculationIntegrity.test.ts.

**Interfaces:** Retain adaptZoneGeometry(name, polygon, ceilingHeightFt). Export normalizePolygonToFeet(polygon: number[], units: 'imperial' | 'metric', drawingUnitsPerLength?: number): number[]. Retain calculateZoneLoad(zone, project) output units. Retain adaptCalculateLoadAndAirflow positional arguments and add an optional final settings object containing perimeterFt, spaceTypeId, outdoorDbF, indoorDbF, humidityRatioDelta, exposedWallFraction, roofExposureFraction. Implement this adapter by calling the same load service as calculateZoneLoad. Add optional project humidityRatioDelta, supplyDeltaTF, exposedWallFraction and roofExposureFraction.

- [x] Configure a pinned test runner and collect baseline results.
- [x] Add regressions rejecting NaN, Infinity, odd coordinate count, self-intersecting and zero-area polygons. Example: expect(adaptZoneGeometry('bad', [0,0,NaN,0,10,10]).valid).toBe(false).
- [x] Add unit and zero-value tests. Hand fixture: 10 m square normalized area is 1076.39104167 ft², and office ventilation for 10 people plus 100 m² is 54.07737216 L/s before output rounding. Verify zero people and zero lighting survive.
- [x] Add tests rejecting negative inputs, nonpositive scales, and manual airflow below outdoor-air or thermal demand. Compare adapter and application using equivalent geometry and input conditions.
- [x] Run each regression red; implement finite and simple polygon validation, shared preliminary calculation, and dimensional conversion; run targeted tests green.
- [x] Record exact test evidence and limitations. Do not commit files; the workspace contains existing work in these paths.

### Task 2: Feasible equipment selection

**Files:** systemArchitecture/equipmentSelector.ts; __tests__/equipmentSelectionIntegrity.test.ts.

**Interfaces:** Retain selectEquipmentForLoad(reqCfm, reqBtu, systemType, catalog). Add an optional constraints object with requiredSensibleBtu, requiredLatentBtu, requiredEspInWg. Continue returning SelectedEquipmentResult | null; null means no feasible candidate.

- [x] Test impossible demand: expect(selectEquipmentForLoad(1000000,100000000)).toBeNull().
- [x] Test explicit type mismatch, 95% undersizing, sensible/latent deficiency, fan ESP deficiency, and nonfinite input; use small independent catalog fixtures with literal capacities.
- [x] Verify regressions fail before edits.
- [x] Remove fallback to insufficient or incompatible candidates; filter on all provided hard constraints and rank only feasible results.
- [x] Verify existing feasible-selection tests and new regressions. Record baseline conflicts with tests that require incompatible fallbacks.

### Task 3: Orchestration and engineering validation

**Files:** orchestrator/hvacDesignWorkflow.ts; orchestrator/hvacDesignOrchestrator.ts; orchestrator/orchestratorTypes.ts; orchestrator/partialRecalculationEngine.ts; validation/hvacValidator.ts; validation/pressureValidator.ts; validation/spatialValidator.ts; validation/comfortValidator.ts; ducts/steppedDuctRouter.ts; __tests__/engineeringValidationIntegrity.test.ts; __tests__/orchestratorIntegrity.test.ts.

**Interfaces:** Consume Tasks 1 and 2 signatures. Add optional zoneId to validation points and per-zone room polygons to master input. Expose per-unit pressure results through validation metrics and reject incomplete graph evidence. Add issueReady: boolean and verification limitations to master report as optional backwards-compatible fields, populated by the validator.

- [x] Add tests for an empty project, duplicate IDs, invalid units, normalized metric/imperial equivalence, explicit zero inputs, and no catalog match without a generic unit.
- [x] Add per-zone capacity and airflow tests so an oversized unit cannot cover another room's deficiency.
- [x] Add pressure fixtures: a shared trunk plus two parallel branches must use the maximum path, not sum branches; two units must compare each against its own ESP; missing parents/cycles must fail.
- [x] Run red. Normalize inputs once at workflow boundary; route from in-room equipment positions; log actual phases; retain missing-equipment failures; invoke one calculation per phase group; validate each room and system.
- [x] Replace warning-only hard capacity/pressure/airflow failures. Missing reports fail. Never equate preliminary PASS with issue readiness; record missing detailed load, construction/clash, and manufacturer operating-condition verification.
- [x] Build parent/child topology for stepped routes and calculate section velocities and losses from actual geometry instead of fixed reported values.
- [x] Run targeted regressions and review behavior conflicts in older optimistic acceptance tests against approved integrity requirements.

### Task 4: Atomic deployment and application integration

**Files:** deploymentTypes.ts; deploymentManager.ts; store/projectStore.ts; panels/OptimizerStudioPanel.tsx if diagnostic visibility requires it; __tests__/deploymentIntegrity.test.ts; README.md; audit status.

**Interfaces:** Add sourceZoneRevision and sourceProjectRevision to generated manifests, derived from deterministic engineering input snapshots. Add optional currentProject argument to executeDeploymentTransaction(manifest, currentZones, currentProject?). Existing sourceZoneRevision is checked whenever present; sourceProjectRevision requires supplied project for generated manifests. Calls within application pass current project.

- [x] Test a blocked manifest, a stale changed zone/project, and a locked diffuser set that changes delivered airflow; rejection must return unchanged zones.
- [x] Run red. Gate eligibility and blocking diagnostics inside transaction; compare input snapshots; assemble locks then revalidate actual airflow, geometry, connectivity and pressure before returning updated zones.
- [x] Prevent deferred deployment from overwriting edited/deleted zones; expose calculation/deployment errors in zone state rather than only console output.
- [x] Run focused tests, full test suite, typecheck and production build; document results and any remaining baseline failures. Review exact changes against the first-scope acceptance gates.

## Execution decisions

- Work on fix/engineering-integrity-audit in the current checkout because the audited engine depends on existing uncommitted files. No worktree is created or existing work moved.
- Use isolated-context implementation assistance as prescribed by subagent-driven-development, sequentially, with root-owned integration and review. No implementer may spawn agents or commit existing user work.
- New regressions establish integrity expectations. Existing tests that asserted unverified PASS must be evaluated against actual engineering evidence rather than preserved by weakening validation.

## Verification qualification

The implementation steps are complete subject to final review. A green focused integrity suite does not imply a green legacy suite or engineering issue readiness. Final release status is tracked in docs/audits/2026-10-08-engineering-integrity-status.md.
