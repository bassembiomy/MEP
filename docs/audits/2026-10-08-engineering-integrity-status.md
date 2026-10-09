# Engineering integrity implementation status

Date: 2026-10-08. Scope: the first implementation stage approved after the CAD/HVAC audit. Changes are local on `fix/engineering-integrity-audit`; existing user changes are preserved and no commit, push or merge was performed.

## Implemented

- Geometry rejects nonfinite, degenerate, overlapping and self-intersecting polygons. Drawing scale and metric/imperial units normalize into physical feet once at the calculation boundary.
- Application and orchestration use one preliminary load service. Internal selection and deployment retain unrounded Btu/h/CFM; display rounding and W/L/s conversion happen separately. Explicit zero inputs survive. Invalid or insufficient airflow overrides block calculation.
- Equipment selection enforces requested system type, total/sensible/latent capacity, airflow and supplied ESP constraints. No compatible catalog record produces a blocked selection, without invented capacity or incompatible substitution.
- Master validation evaluates each room and equipment unit. Missing equipment, orphan/nonfinite ducts, deficient capacity/flow, disconnected pressure paths, missing return evidence and plan containment violations fail checks. Parallel pressure paths use their governing connected path. Reports explicitly retain `issueReady: false` and preliminary limitations.
- Partial recalculation preserves unrelated user modifications. Optimization retains requested NC and coverage criteria instead of weakening them to obtain PASS.
- CAD deployment rechecks current zone/project revisions and actual locked components before accepting state. It validates canonical loads, catalog capacities, physical rotated equipment footprints, actual duct flow/velocity/aspect/depth, terminal connections and fan pressure. Rejection leaves workspace arrays unchanged. Equipment planning is physically equivalent across drawing scales and units.
- Deferred generation does not overwrite edited/deleted zones. Invalid calculations appear as editable zone errors. Zone property edits mark designs stale; generated CAD placement uses the validated transaction. Schedule row clicks are read-only, and the schedule cannot directly deploy an unchecked design. Supply labels exclude return air and convert CFM to L/s correctly.
- Generic pressure previews and unknown ceiling depth are explicitly provisional. Without a declared depth, deployment uses a preliminary 14-inch sizing envelope and warns that actual ceiling fit needs verification.

## Verification

Verification at the end of the first stage (superseded by the follow-up results below):

- `npm test`: 24 Vitest files, **273 tests passed**. Legacy Node/assertion tests: **42 passed, 9 failed**. Full command exit 1; release gate remains failing.
- `npm run build`: exit 0; node and web TypeScript checks plus production main/preload/renderer bundles succeeded.
- Independent scoped specification and code-quality review: PASS after fixes. Final architecture review used the available reviewer after the requested frontier reviewer was unavailable due a usage limit.
- Existing build warning: LibreDWG imports `node:module`, externalized for browser compatibility. Existing npm configuration warnings remain.

`npm test` runs both Vitest and legacy assertion/Node suites; failures are not hidden by discovery filtering.

Local implementation evidence, red/green logs, snapshots and review reports are retained under the ignored `.superpowers/sdd/2026-10-08-engineering-integrity/` directory. Required commands are `npm test`, `npm run typecheck` and `npm run build`. UI compilation was checked; no live Electron interaction or installation package was verified in this stage.

## Resolution of remaining failures

Subsequent stage: `npm test` is green after these changes (verified by running the suite).

- `detailedZoneLoad`: the sensible-airflow denominator is validated (finite, positive) before dividing, so overflowing air properties are rejected rather than reported as zero demand.
- `aiHvacGenerator`: the generator now normalizes the polygon to feet once, places diffusers at scale 1 (it previously passed scale 10 for feet-based geometry, collapsing the room to 3 ft x 3 ft and under-covering it), and maps results back to drawing units. Return grilles keep their type. Coverage targets were not lowered.
- `deploymentAcceptance`: fixture updated to derive candidates from the canonical zone load, use a 20 ft x 15 ft room with a validated 350 CFM design override, pass the project to every deployment transaction, and check port connectivity instead of a duct type name. No thresholds were weakened.

Results at the end of that stage: 34 Vitest files (442 tests) and 113 legacy tests passed; after the gap fixes below, 35 files (see the verification run recorded with the commit), and `npm run typecheck` reports no errors. The earlier baseline files (addLShapedZoneStability, closedLoopDesignOptimizer, master9PointValidation, standardsLayer, terminalsAndReturns, endToEndAirDistribution, lecture06EquipmentVerification) pass on this tree; whether they were fixed by the first stage or this one was not isolated. The AI assistant modal now passes `project.units` and `project.scale` to the generator, and return ducts keep their `return` type.

The stepped-return regression fixture supplies a real grille and asserts that absent grilles produce no fabricated connected return route.

Engine gaps found in that stage, now fixed (regression tests in `systemDesignerIntegrity.test.ts` and `deploymentIntegrity.test.ts`):

- `generateSystemCandidates` now rejects ducted candidates whose per-unit airflow lies outside the rated fan range (`ERR_AIRFLOW_OUTSIDE_EQUIPMENT_RANGE`), matching what deployment enforces.
- Indoor-unit placement now uses the catalog physical footprint, axis-aligned rotation and the same containment predicates as deployment acceptance. Units that cannot fit the zone produce a planning diagnostic (for a single unit; with several units each is checked against its bounding-box strip, so concave zones can still be rejected at acceptance). The legacy placement path is unchanged when no footprint is supplied. A footprint-aware placement moved a unit in the L-shaped fixture and exposed a return grille placed outside a concave zone; return grille placement is now verified against the polygon (a diagnostic is raised when no connectable location exists), duct feeders connect to any offset unit position, and the return duct starts exactly at the unit. One test that expected a 45-degree footprint bounding box now expects the axis-aligned 2 ft footprint (physical equivalence across scales is still asserted).
- Per-unit and per-diffuser airflow is no longer rounded to integers in deployment and cassette planning, so delivered supply equals the calculated demand within the existing 1 CFM tolerance.

Gaps recorded at that stage, **now fixed** in the third stage (each with tests written first and confirmed failing for the stated reason):

- **Cassette count and footprint (`planCassetteDistribution`).** The count is now authoritative: the placer's airflow-band clamp is skipped for a caller-fixed count (3 cassettes at 442.767 CFM now yields 3, not 2), the catalog footprint is passed from `deploymentManager` instead of a hardcoded 30 units, and grid snapping is applied only when it keeps the footprint contained. If the optimiser returns too few or uncontained positions a deterministic equal-area placement is used, otherwise `ERR_COMPONENT_OUTSIDE_ZONE` is raised (4 cassettes in an 8x8 ft room, L-shaped room with 4). Tests: 7 new in `deploymentIntegrity.test.ts`; one existing expectation changed (the pinned "2 of 3" known-gap test now expects 3).
- **One pressure budget (`engine/pressureBudget.ts`).** `FILTER_ALLOWANCE_IN_WG`, `PRESSURE_SAFETY_FACTOR`, `requiredExternalStaticPressure` and `availableFanPressureAtFlow` (moved unchanged from `deploymentValidation.ts`) are used by both the generator and deployment; deployment numbers are identical. The generator replaces its flat estimate with a conservative routed-path estimate (0.10 in.wg/100 ft friction floor over the room's Manhattan extent, an elbow and branch take-off at the unit trunk velocity, diffuser drop, return grille and run, filter, x1.15), puts the filter into `totalLossInWg`, and judges the fan with the deployment curve at the unrounded per-unit flow (new `ERR_FAN_CURVE_UNAVAILABLE` when the curve has no evidence). Calibration tests compare the estimate with the pressure deployment actually computes for 7 rooms (30x25, 20x15, 40x30, 50x20, 60x40, the L-shape fixture, a metric copy) using a fan that always delivers; the estimate was never below it (smallest margin 0.006 in.wg). Tests: 30 in the new `pressureBudget.test.ts`. One existing expectation changed (see outcome below).
- **Auto-deploy fall-through.** `addZone` now tries up to 5 valid candidates in rank order and stops at the first successful transaction; skipped candidates' reasons go to `engineeringNotice` (success) or `engineeringError` (all rejected, or none valid). Tests: 2 new in `projectStoreIntegrity.test.ts` with a stubbed catalog.
- **Ports tied to footprint and duct attachment.** New pure `getFootprintPortLayout`; supply/return ports sit where the ray along the first duct segment leaving the unit centre crosses the catalog footprint, in the same direction, recomputed after `mapIndoor`; refrigerant/drain are on or inside the footprint; ports are physically identical at scale 10 and in a mm project. The return duct avoids the supply direction so ports stay distinct. Tests: 6 new in `deploymentIntegrity.test.ts`.
- **Multi-unit partition uses the real polygon.** New `engine/polygonClip.ts` (Sutherland-Hodgman clip, detection of clips that split into pieces, equal-area bisection with axis fallback). Units are planned inside their own sub-polygon (largest inscribed rectangle for concave pieces, with a warning); anything not containable is blocked with `ERR_ZONE_PARTITION_UNSUPPORTED` instead of failing at acceptance. L-shaped rooms with 2 and 3 units are now eligible and deploy. Tests: 11 in the new `polygonClip.test.ts` and 4 in `deploymentIntegrity.test.ts`.

**A1 outcome (stated plainly).** With the shared budget the 30x25 ft, 2-person office has **no valid ducted candidate in the bundled catalog**: 53QDMT-18N x1 is now rejected by the generator with `ERR_FAN_ESP_DEFICIT` (about 0.30 in.wg available at 443 CFM against 0.37 required by deployment, 0.39 estimated), so auto-deploy for that room is reported **blocked** with the rejection reason, rather than appearing valid and failing at apply. The same holds for the 40x30 ft, 6-person room. The existing 20x15 ft / 350 CFM acceptance case (53QDMT-18N, 0.356 required vs 0.38 available) still deploys. Nothing in deployment was loosened. Existing expectation changed: `systemDesignerIntegrity.test.ts` "valid ducted candidates stay inside the fan range" expected at least one valid ducted candidate for 30x25 and 40x30 ft; those candidates were valid only because the old estimate under-reported pressure.

Verification after this stage: `npm test` green (Vitest 38 files, **517 tests** passed, up from 457; legacy Node tests **113 passed**), `npm run typecheck` clean, `npm run build` exit 0 (LibreDWG `node:module` warning only).

Remaining known limitations of these fixes: the routed-path estimate is deliberately conservative (about 0.01 to 0.1 in.wg above deployment), so a design that would marginally pass deployment can be rejected by the generator; a concave sub-polygon is served only by its largest inscribed rectangle; outlines whose slabs split into pieces on both axes are blocked, not partitioned.

## Release limitations

This stage improves software integrity; it does not establish a construction-ready professional release. The full test suite is a release gate; it passes as of the follow-up stage, but passing tests do not establish engineering issue readiness. Further work from the original audit remains necessary:

- CAD semantic understanding: room boundaries, openings, obstacles, elevations, layers, uncertainty and explicit user correction.
- Detailed envelope, glazing, solar, schedules, psychrometrics and ventilation/exhaust design; the current load model is preliminary.
- Verified manufacturer catalogs and capacities/fan curves at actual operating conditions; uploaded catalog integration is not complete.
- Complete outdoor-air source/relief arrangements, actual fittings and accessories, 3D clashes, maintenance clearances, rated barriers and safety review.
- Unified schedule/design artifacts, editable engineering CAD export, traceable engineering issue/review workflow and commissioning verification.

See [the full audit](2026-10-08-cad-hvac-engine-audit.md) and [approved implementation plan](../superpowers/plans/2026-10-08-engineering-integrity.md).
