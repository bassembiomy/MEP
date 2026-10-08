# Professional CAD/HVAC Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining CAD understanding, standards, engineering and drawing deliverables from the full audit.

**Architecture:** Extend native CAD import and approved semantic geometry into the existing canonical calculation and validated deployment pipeline. Persist versioned source/evidence and export editable DXF in original coordinates. Treat unverified engineering requirements as unresolved evidence, never as automatic compliance.

**Tech Stack:** Electron, React, TypeScript, Zustand, Vitest/Node tests, LibreDWG WASM.

**Spec:** docs/superpowers/specs/2026-10-08-professional-cad-design-design.md.

## Global constraints

- Primary jurisdiction Egypt, selectable sourced ASHRAE/SMACNA/NFPA editions.
- Preserve dirty local work and first-stage integrity gates.
- Canonical feet/Btu/h/CFM; native drawing units retained and converted once.
- Never silently approximate unsupported CAD into approved room boundaries.
- Test behavioral changes red before implementation, then green. Use independent geometric/engineering fixtures.
- Full goal is not complete until all acceptance requirements are demonstrated.

### Task 1: Faithful native CAD import and rendering

**Files:** dxfParser.ts; new cad/nativeGeometry.ts; store/projectStore.ts DxfEntity; dwgParser.ts; FloorPlanCanvas.tsx; Toolbar.tsx; new __tests__/cadNativeIntegrity.test.ts.

**Interfaces:** Extend DxfEntity with optional handle, closed, bulges, startAngleDeg/endAngleDeg (original CAD angles), ellipse major-axis vector/ratio/parameters, text height/rotation and provenance. ParsedDxf adds diagnostics and declared/estimated unit confidence. Export `getCadEntityPath(entity, tolerance?)` for canvas paths and `getCadEntityBounds(entity)` for exact bounds where supported. Parser keeps existing parseDxfText interface.

- [ ] Snapshot task files; add and run failing regressions: blank DXF value preserves following pairs; malformed/nonfinite LINE is rejected; legacy VERTEX/SEQEND assembles closed polygon; ARC 0→90 retains angles; LWPOLYLINE bulge/closure retained; nested BLOCK INSERT base/rotation/scales transform faithfully; nonuniform transformed circle becomes ellipse; missing/cyclic block and nonplanar extrusion emit diagnostics.
- [ ] Implement record-based DXF pair parsing with empty values preserved. Keep supported native parameters and finite validation. Apply nested affine transforms before canvas Y inversion; retain native curves or produce a declared unsupported diagnostic.
- [ ] Add shared native path/bounds helpers; render open vs closed polylines, bulges, arcs and ellipses correctly. Import UI displays diagnostics and asks confirmation of estimated units.
- [ ] Run `npm test -- cadNativeIntegrity cadLayersAndVisibility cadUnitDetection dxfScaleAndCatalogThrow`, typecheck and scoped review.

### Task 2: CAD semantic recognition and approval

**Files:** new cad/roomRecognition.ts, cad/semanticTypes.ts, panels/CadUnderstandingPanel.tsx; projectStore.ts; App.tsx; __tests__/cadRoomRecognition.test.ts.

**Interfaces:** `recognizeCadRooms(entities, options)` returns source-linked candidates/diagnostics; `CadRoomCandidate` contains polygon, source handles, labels, confidence, unresolved conditions and approval state. Approve/correct creates ordinary canonical input zones through existing store actions.

- [ ] Test closed rectangular/L-shaped polylines, joined wall-line networks, door gaps, disconnected/ambiguous networks, duplicate boundaries, labels inside rooms, source-layer filters and unit equivalence. Example rectangle [0,0,20,0,20,15,0,15] has area300ft²; an open door gap must remain unapproved.
- [ ] Implement planar boundary graph traversal with explicit tolerance and deterministic candidates. Distinguish closed boundary evidence from semantic guesses; avoid treating all visible lines as walls.
- [ ] Provide candidate preview, selected layers, names/use/height, correction and approval. Openings/obstructions/rated barriers are explicitly assigned, never inferred as verified by a name alone.
- [ ] Feed approved geometry and obstacles into deployment/routing; test room containment and obstacle avoidance on concave rooms.
- [ ] Verify UI approval-to-design path plus regressions/typecheck/review.

### Task 3: Versioned native projects and reproducible state

**Files:** new project/projectSerialization.ts; projectStore.ts; Toolbar.tsx; persistence tests.

**Interfaces:** `serializeProject(state)` / `parseProjectDocument(text)` with schema/version and finite validation. Persist CAD/native fields, approved semantics, project conditions, zones, locks and evidence. Loading recomputes stale/blocked statuses rather than accepting claimed issue readiness.

- [ ] Test round-trip native CAD and locks, malformed schema/version/NaN/duplicate IDs, migrated older documents, revision invalidation and undo/redo.
- [ ] Implement save/open project actions with errors and explicit replace behavior. Store original source coordinate/units metadata and review evidence.
- [ ] Verify deterministic serialize/load/calculate reruns; cancel stale background calculations and exercise large-drawing responsiveness.

### Task 4: Editable engineering CAD deliverables

**Files:** new export/exportDxf.ts; export reports/schedules; Toolbar.tsx; export round-trip tests and sample fixtures.

**Interfaces:** `exportProjectDxf(state, options)` returns native DXF text plus issue diagnostics. Native curves export with original Y/units; separate HVAC supply/return/equipment/piping/tags layers. Report includes source revisions, status and unresolved requirements.

- [ ] Test reopen/export: original line endpoints, arc/bulge/ellipse parameters, units, equipment count, terminal flow tags and duct dimensions; equivalent metric/imperial projects preserve physical dimensions.
- [ ] Implement native DXF writer with layer/unit tables, original CAD and editable system entities. Provide meaningful dimensions, tags, schedules and report provenance.
- [ ] Connect export UI; mark preliminary drawings explicitly and prevent issue-ready output with unresolved mandatory evidence.
- [ ] Verify a real sample CAD import→room approval→design→export→reopen workflow.

### Task 5: Detailed engineering inputs and manufacturer conditions

**Files:** preliminaryLoad/loadCalc/types/knowledgeBase, new detailed calculation modules, equipment catalogs/adapters, ZoneProperties and project settings; independent analytical tests.

- [ ] Define explicit envelope/glazing/orientation/solar/schedules/humidity/ventilation/exhaust inputs and traceable component results. Use sourced equations and documented applicability; compare independent worked examples.
- [ ] Retain preliminary mode separately; detailed mode blocks absent required physical data rather than filling assumptions silently.
- [ ] Integrate actual uploaded catalogs with manufacturer source/date/operating conditions. Filter equipment at project conditions and verify sensible/latent/fan envelopes; unresolved data blocks engineering issue readiness.
- [ ] Ensure schedules, drawing and calculation reports all consume the same selected validated artifacts.

### Task 6: Egypt jurisdiction and sourced standards profiles

**Files:** standards/designStandards.ts; new standards/profileRegistry.ts; project settings; validators/report evidence; standards applicability tests.

- [ ] Verify current authoritative Egypt and selectable ASHRAE/SMACNA/NFPA references/edition metadata. Record exact public sources and distinguish available rule evidence from inaccessible normative text.
- [ ] Add project-selected jurisdiction/editions, applicability and documented project overrides. No profile name alone certifies compliance.
- [ ] Implement evidence-backed checks for ventilation, duct velocity/friction/aspect, comfort/acoustic criteria, accessories/barriers and clearance. Missing applicable rule or physical evidence blocks issue readiness.
- [ ] Verify literal independent rule fixtures and report project-specific governing sources/editions and unresolved checks.

### Task 7: Complete release acceptance

**Files:** existing nine failing tests and responsible engines; new native CAD/project/UI/export fixtures; CI scripts; release audit documentation.

- [ ] Investigate all nine current failures individually. Repair real geometry/engineering defects; update obsolete fixture assumptions only with explicit evidence preserving strict gates.
- [ ] Run full suite, typecheck/build, live UI-to-engine-to-CAD-export workflow and independent analytical/manufacturer examples.
- [ ] Verify native project save/reopen, units, large-drawing responsiveness, cancellation, determinism, meaningful undo/redo and exported quantities/geometry.
- [ ] Review all explicit spec requirements against current artifacts; keep goal active for missing/weak evidence. Record exact final results and limitations.

## Authorization and sequence

User instructed finishing the entire audited plan and selected Egypt. Continue these stages without repeated permission requests for authorized local work. Start Task1 now; refine the subsequent implementation interfaces using authoritative source evidence and working fixtures, retaining every requirement. No commit/push/merge requested.
