# CAD and HVAC engine audit — 2026-10-08

## Assessment and scope

The engine has useful CAD import, load calculation, catalog selection, terminal placement, duct sizing, preview, and schedule components. It is not yet demonstrated to be suitable for professional engineering issue. Several paths can accept infeasible inputs, produce unverified selections, or describe incomplete checks as compliance.

This audit covers the current working tree, including existing uncommitted changes. No implementation files were changed. Evidence consists of source inspection, successful TypeScript checks, and direct execution of selected functions using the installed TypeScript transpiler. It is not a standards certification, manufacturer-data verification, or live CAD/UI acceptance test. The repository primarily implements HVAC; other MEP disciplines were not established by this review.

## Findings

### Critical — enforce design eligibility at the transaction boundary

`src/renderer/src/engine/deploymentManager.ts`, `executeDeploymentTransaction`, checks whether the target zone exists but does not reject `manifest.isEligibleToApply === false` or blocking diagnostics. Preview gating cannot protect callers that invoke the transaction directly. Locked components are substituted after manifest generation without revalidating the resulting design. Post-commit verification checks only whether the combined component count is zero.

Required change: validate eligibility and input revision inside the transaction, assemble the actual locked/unlocked result, validate that exact result, and commit atomically only when it is eligible. Test a blocked manifest, stale revisions, and locked components that invalidate airflow or pressure.

### Critical — units are not authoritative across engine paths

`orchestrator/hvacDesignWorkflow.ts` passes raw polygons to `adapters/zoningAdapter.ts`, whose area is named `areaSqFt` without using `context.units` or a drawing scale. The public project input accepts metric units. A 10 m by 10 m polygon is reported as 100 square feet by this adapter. Raw coordinates also feed equipment placement and routing.

`dxfParser.ts` guesses units from bounding-box span when the header is absent. Its small-span default reports feet while assigning ten drawing units per foot. Such a guess must not become an approved measurement silently. Drawing extents can include title blocks, remote objects, and unrelated details.

Required change: normalize geometry once at import using explicit unit provenance and transforms; retain original coordinates for export. Require calibration for ambiguous units. Test the same room represented in mm, m, inches, feet, and shifted/rotated CAD coordinates.

### Critical — geometric validation accepts nonfinite coordinates

`adapters/zoningAdapter.ts` checks vertex count and a positive-area comparison, but does not check finite values or an even coordinate count. The direct probe `[0,0,NaN,0,10,10]` returns `valid: true` with NaN area, perimeter, and centroid. A comparison against NaN does not reject it.

Required change: reject nonfinite values, odd-length coordinate arrays, degeneracy, self-intersections, and duplicate zone IDs. Establish handling for holes and disconnected regions. Fail before any downstream calculation and preserve an actionable error.

### Critical — selection can return infeasible equipment

`systemArchitecture/equipmentSelector.ts` accepts 95% of required capacity/airflow as sufficient, then searches insufficient candidates when no sufficient candidate exists. It can silently substitute other system types. A direct request for 100,000,000 Btu/h and 1,000,000 CFM still returns `42QSS120-D (10 Ton)`.

The selector does not accept required sensible load or calculated pressure as selection constraints. In the orchestrator, missing equipment can become a generic unit whose capacity equals the requested load, with assumed ESP and approved outdoor-air connection. Equipment decision records are marked PASS regardless of these fallbacks, and service zones are labeled concealed-split/DX even for other requested types.

Required change: explicit feasible/infeasible selection results, strict capacity/airflow/sensible/latent/pressure constraints at supported operating conditions, compatible system topology, and separate unverified placeholder equipment. Rank cost or preferences only among feasible candidates. Manufacturer provenance and applicable operating conditions must be reviewable.

### High — competing load and ventilation models

`loadCalc.ts` and `adapters/loadAirflowAdapter.ts` implement separate models. The adapter uses a fixed envelope estimate, floors area to 50 square feet, ignores ceiling height, assumes office ventilation rates, and lacks climate, construction, glazing, orientation, or space-use inputs. The main calculator assumes half the walls exposed, a roof for each room, and a fixed humidity-ratio difference. These are preliminary assumptions rather than a detailed building load model.

In `loadCalc.ts`, the metric people ventilation term uses the catalog's CFM/person value directly as L/s/person, while `knowledgeBase.ts` declares `rp` in CFM/person. The area rate is converted separately. This creates a reproducible dimensional inconsistency. Overrides also have different sensible/latent splits between engines.

`hvacDesignWorkflow.ts` uses `||` defaults, replacing explicit zero occupancy, lighting, and equipment inputs. The adapter permits an undersized manual airflow: a 1,000-square-foot room with 100 occupants and manual 100 CFM produces outdoor air 560 CFM and return air 50 CFM.

Required change: one authoritative calculation service, unit-aware inputs, component-by-component outputs, explicit assumptions and preliminary/detailed modes, humidity inputs, space-use ventilation, and validation of manual overrides. Represent room return, recirculated air, relief, exhaust, and outdoor air distinctly; the two current calculators use different return-air definitions.

### High — project validation is not zone or fan specific

`hvacDesignWorkflow.ts` validates all zones and terminals against only the first room polygon. `validation/pressureValidator.ts` sums every duct section rather than solving the governing connected path per fan and compares against the first zone's ESP. Fixed terminal and return drops replace actual component losses.

`validation/hvacValidator.ts` checks aggregate equipment capacity, so overcapacity in one room can conceal undercapacity in another. It labels 95% capacity coverage PASS and treats inadequate capacity or pressure as WARNING. `autoDesignHVAC` completes WARNING results and defaults absent validation status to PASS.

Required change: mandatory validation artifacts, individual room/unit checks plus project aggregation, graph-based pressure paths and connectivity, explicit infeasibility severity, and distinct draft/review-required/issue-ready states. Missing required evidence must not pass.

### High — spatial and safety assertions exceed performed checks

`validation/spatialValidator.ts` ignores the room polygon, uses only the first zone's ceiling depth, and checks duct height and aspect ratio. It does not establish wall penetrations, obstacles, equipment service clearance, elevations, or actual 3D clashes. The displayed aspect-ratio criterion is 3.0 while the implementation rejects only above 4.0.

The master validator's safety check uses existence of any smoke detector across the network rather than demonstrating the required association per unit. It describes damper compliance without checking rated barriers or all relevant damper placements. Standard-name strings and lecture references do not establish project compliance.

Required change: checks must disclose what was evaluated and what is unknown. Add semantic barriers, elevations and clearances, per-system accessory relationships, project-selected standards editions, and evidence for applicable rules. Verify normative requirements against authoritative publications during implementation.

### High — CAD parsing can silently lose geometry

`dxfParser.ts` removes all empty lines before pairing group codes and values; empty string values can shift subsequent pairs. INSERT/BLOCK references are unsupported on this path; legacy POLYLINE VERTEX records are not assembled; bulges, closure flags, and ARC angles are not retained. Invalid LINE coordinates can be converted to zero by `|| 0` during filtering.

`dwgParser.ts` has block handling, but transformed circles use average X/Y scale, which cannot faithfully represent nonuniformly scaled circles. CAD geometry display is not equivalent to recognizing rooms, openings, walls, construction, or fire-rated barriers. The current workflow asks the user to create zone polygons.

Required change: import diagnostics for unsupported entities and malformed records, faithful entity/transformation handling, semantic extraction with confidence and user correction, and round-trip geometry fixtures. Never infer engineering boundaries solely from every visible line.

### High — drawing deliverables and project lifecycle are incomplete

The inspected UI provides CAD import and an internal canvas overlay. `AirDistributionSchedulePanel.tsx` downloads a text report. No connected DXF/DWG writer or complete CAD drawing issue workflow was found in the inspected source. A canvas preview is not an editable CAD deliverable.

No persistent project save/load pipeline was found in the inspected application source. Zustand keeps live state, and `updateZone` directly changes properties without a general invalidation/recalculation contract. Deferred auto-deployment closes over a draft zone and can overwrite subsequent user edits. A zero-delay timer postpones work but still runs it on the renderer thread.

Required change: versioned project persistence, input revisions, stale-result detection, dependency invalidation, cancellable background calculations, undo/redo, and editable DXF output with original coordinate transforms, system layers, tags, dimensions, schedules, units, and a validation report. Verify export by reopening it and comparing quantities and geometry.

### Medium — reported scores and execution trace need evidence

`systemDesigner.ts` computes estimated coverage using a bounded heuristic rather than the actual room polygon. That estimate must be distinguished from measured geometric coverage. Orchestrator switch cases execute the same operation repeatedly for adjacent phases; initial executed phases are not added to the returned `phasesExecuted` list. Decision records assert selection PASS before actual validation and can overstate engineering rules applied.

Required change: one operation per phase with real inputs/outputs, trace actual phase execution, record attempted and rejected candidates, distinguish estimate from verified metric, and maintain deterministic provenance linking calculations to issued geometry.

### High — automated assurance is not operational

`package.json` has no test script or Vitest dependency; `node_modules/vitest` is absent. Many test files import Vitest, and `tsconfig.web.json` excludes the engine tests. Successful type checking therefore does not execute or type-check those tests. Existing tests cannot substantiate engineering acceptance until a runner and reproducible CI are configured.

Required change: install/configure a pinned runner, run existing tests without weakening failures, add independent analytical fixtures and adversarial input tests, and compare approved engineering examples. Tests must include real CAD fixtures, unit equivalence, impossible selections, per-zone failures, pressure-path calculations, transaction rejection, and CAD export round trips.

## Verification performed

- `npm run typecheck`: exit code 0, node and web compilation succeeded. npm emitted configuration deprecation warnings.
- Direct function probes reproduced nonfinite polygon acceptance, raw metric area interpreted as square feet, outdoor air greater than overridden supply, and selection despite impossible capacity/airflow requirements.
- No complete test-suite execution: runner unavailable in the current installation.
- No live Electron interaction, real-drawing import benchmark, manufacturer certification, or exported CAD round-trip verification performed.

## Recommended professionalization design

Use the existing engine modules behind one authoritative pipeline rather than introducing another competing solver:

1. **Engineering integrity first:** normalize units; reject invalid inputs; unify loads/airflows; enforce feasible equipment selection; validate per zone and fan; gate transactions; propagate missing evidence and stale revisions.
2. **CAD understanding and coordination:** preserve native geometry/transforms; provide import diagnostics; extract candidate rooms/walls/openings with confidence; let users approve/correct semantics; route against real obstacles and barriers.
3. **Professional deliverables:** versioned save/load and revisions; verified equipment provenance; editable layered DXF drawings and schedules; calculation reports documenting assumptions, overrides, governing inputs, and unresolved checks.
4. **Independent acceptance:** automated engineering fixtures and real CAD projects; deterministic reruns; full UI-to-engine-to-export checks; performance and cancellation checks for large drawings.

Alternative A is to keep the app explicitly as a preliminary layout estimator, with smaller effort but limited engineering scope. Alternative B is the staged hardening above, retaining useful code and establishing measurable release gates; this is recommended. Alternative C is a full engine replacement, which carries higher migration risk and is not justified before repairing and testing the existing interfaces.

The first implementation scope should be engineering integrity plus a runnable regression suite. CAD semantic recognition and CAD issue output should each receive a subsequent focused design. This avoids treating a broad professional-tool request as a single unreviewable rewrite.

## Acceptance gates for the first implementation scope

- Equivalent physical rooms in all supported units produce equivalent normalized loads and dimensions within documented numerical tolerances.
- Nonfinite, malformed, degenerate, and unsupported geometry cannot receive an eligible design status.
- No feasible equipment means an explicit blocked selection; no fabricated capacity or silent type substitution.
- A deficient room or unit cannot be hidden by aggregate totals; each fan is checked against its actual governing path.
- Manual overrides retain explicit zeros where allowed and fail when engineering constraints are breached.
- A blocked/stale manifest cannot mutate project state, including through direct transaction calls.
- Required validations that were not run are reported as unknown/unverified and prevent issue-ready status.
- Existing tests run through a documented command, with meaningful regression fixtures and reported failures.

## Task status

- [x] Inspect engine and application integration across CAD, calculations, selection, layout, validation, and output.
- [x] Run available static checks and targeted behavioral probes.
- [x] Record prioritized findings, evidence, limitations, and recommended architecture.
- [ ] Obtain approval of the first implementation scope before architectural changes, as required by the workspace brainstorming skill.
- [ ] Write the approved focused design and implementation plan.
- [ ] Implement, review, and verify the approved changes.


## Implementation follow-up

The approved first integrity stage is implemented locally. See [implementation and release status](2026-10-08-engineering-integrity-status.md) for fixes, verification evidence and remaining release limitations. The findings above describe the audited starting point; the status document identifies the changes already addressed.
