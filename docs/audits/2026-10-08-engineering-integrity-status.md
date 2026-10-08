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

Final integrated verification on the final source tree:

- `npm test`: 24 Vitest files, **273 tests passed**. Legacy Node/assertion tests: **42 passed, 9 failed**. Full command exit 1; release gate remains failing.
- `npm run build`: exit 0; node and web TypeScript checks plus production main/preload/renderer bundles succeeded.
- Independent scoped specification and code-quality review: PASS after fixes. Final architecture review used the available reviewer after the requested frontier reviewer was unavailable due a usage limit.
- Existing build warning: LibreDWG imports `node:module`, externalized for browser compatibility. Existing npm configuration warnings remain.

`npm test` runs both Vitest and legacy assertion/Node suites; failures are not hidden by discovery filtering.

Local implementation evidence, red/green logs, snapshots and review reports are retained under the ignored `.superpowers/sdd/2026-10-08-engineering-integrity/` directory. Required commands are `npm test`, `npm run typecheck` and `npm run build`. UI compilation was checked; no live Electron interaction or installation package was verified in this stage.

## Existing failures and changed acceptance assumptions

The pre-implementation baseline had seven failing legacy files. They still require resolution:

| Legacy test | Remaining issue |
| --- | --- |
| addLShapedZoneStability | Expects automatic placement although the design can be blocked |
| ashraeComplexShapeDistribution | Boardroom coverage below its required target |
| closedLoopDesignOptimizer | Existing failure; current early assertion assumes a fixed validation point count |
| deploymentAcceptance | Original branch/topology assertion fails; later assertions also assume deployment without current project evidence |
| master9PointValidation | Assumes exactly nine checks despite expanded evidence validation |
| standardsLayer | Expects the older throw-ratio threshold |
| terminalsAndReturns | Expects a pass despite actual return short-circuit warnings |

Two further legacy acceptance files, `endToEndAirDistribution` and `lecture06EquipmentVerification`, expect unconditional PASS/PASS-or-WARNING from shared design fixtures that now fail stricter evidence checks. They must be reviewed against actual engineering evidence; thresholds were not weakened and their expectations were not edited to manufacture a passing release.

The stepped-return regression fixture was updated to supply a real grille. It now also asserts that absent grilles produce no fabricated connected return route.

## Release limitations

This stage improves software integrity; it does not establish a construction-ready professional release. The full test suite remains a release gate until the documented failures are resolved. Further work from the original audit remains necessary:

- CAD semantic understanding: room boundaries, openings, obstacles, elevations, layers, uncertainty and explicit user correction.
- Detailed envelope, glazing, solar, schedules, psychrometrics and ventilation/exhaust design; the current load model is preliminary.
- Verified manufacturer catalogs and capacities/fan curves at actual operating conditions; uploaded catalog integration is not complete.
- Complete outdoor-air source/relief arrangements, actual fittings and accessories, 3D clashes, maintenance clearances, rated barriers and safety review.
- Unified schedule/design artifacts, editable engineering CAD export, traceable engineering issue/review workflow and commissioning verification.

See [the full audit](2026-10-08-cad-hvac-engine-audit.md) and [approved implementation plan](../superpowers/plans/2026-10-08-engineering-integrity.md).
