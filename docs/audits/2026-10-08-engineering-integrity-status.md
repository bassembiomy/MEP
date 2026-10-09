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

Current results: 34 Vitest files (442 tests) and 113 legacy tests pass, and `npm run typecheck` reports no errors. The earlier baseline files (addLShapedZoneStability, closedLoopDesignOptimizer, master9PointValidation, standardsLayer, terminalsAndReturns, endToEndAirDistribution, lecture06EquipmentVerification) pass on this tree; whether they were fixed by the first stage or this one was not isolated. The AI assistant modal now passes `project.units` and `project.scale` to the generator, and return ducts keep their `return` type.

The stepped-return regression fixture supplies a real grille and asserts that absent grilles produce no fabricated connected return route.

Engine gaps found in that stage, now fixed (regression tests in `systemDesignerIntegrity.test.ts` and `deploymentIntegrity.test.ts`):

- `generateSystemCandidates` now rejects ducted candidates whose per-unit airflow lies outside the rated fan range (`ERR_AIRFLOW_OUTSIDE_EQUIPMENT_RANGE`), matching what deployment enforces.
- Indoor-unit placement now uses the catalog physical footprint, axis-aligned rotation and the same containment predicates as deployment acceptance. Units that cannot fit produce a planning diagnostic. The legacy placement path is unchanged when no footprint is supplied. A footprint-aware placement moved a unit in the L-shaped fixture and exposed a return grille placed outside a concave zone; return grille placement is now verified against the polygon. One test that expected a 45-degree footprint bounding box now expects the axis-aligned 2 ft footprint (physical equivalence across scales is still asserted).
- Per-unit and per-diffuser airflow is no longer rounded to integers in deployment and cassette planning, so delivered supply equals the calculated demand within the existing 1 CFM tolerance.

New known gaps:

- The generator's estimated external static pressure has no filter allowance or safety factor. With the three fixes above, the only valid real-catalog candidate for a 30 ft x 25 ft, 2-person office (53QDMT-18N x1) is rejected at deployment with "Actual per-unit fan pressure is insufficient" (about 0.30 in.wg available against about 0.36 required). Deployment checks were not loosened.
- `planCassetteDistribution` may return fewer cassettes than the requested quantity (observed 2 of 3); its per-unit airflow split is exact but the count is not enforced.

## Release limitations

This stage improves software integrity; it does not establish a construction-ready professional release. The full test suite is a release gate; it passes as of the follow-up stage, but passing tests do not establish engineering issue readiness. Further work from the original audit remains necessary:

- CAD semantic understanding: room boundaries, openings, obstacles, elevations, layers, uncertainty and explicit user correction.
- Detailed envelope, glazing, solar, schedules, psychrometrics and ventilation/exhaust design; the current load model is preliminary.
- Verified manufacturer catalogs and capacities/fan curves at actual operating conditions; uploaded catalog integration is not complete.
- Complete outdoor-air source/relief arrangements, actual fittings and accessories, 3D clashes, maintenance clearances, rated barriers and safety review.
- Unified schedule/design artifacts, editable engineering CAD export, traceable engineering issue/review workflow and commissioning verification.

See [the full audit](2026-10-08-cad-hvac-engine-audit.md) and [approved implementation plan](../superpowers/plans/2026-10-08-engineering-integrity.md).
