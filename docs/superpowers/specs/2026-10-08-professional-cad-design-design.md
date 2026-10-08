# Professional CAD/HVAC design tool — remaining approved scope

User objective: finish the complete audited plan, understand CAD drawings, perform standards-based engineering and draw the systems on the original CAD. Primary jurisdiction: Egypt, with selectable ASHRAE/SMACNA/NFPA references (user choice, 2026-10-08).

## Architecture and decisions

Extend the existing validated pipeline. Do not introduce another competing HVAC engine. Retain original CAD coordinates and native geometric parameters; canvas coordinates invert Y exactly once. Imported geometry has source handles, layers and explicit diagnostics. Unsupported or approximated geometry cannot silently become an engineering boundary.

Room recognition produces candidates with evidence and uncertainty, not automatically approved engineering rooms. Users can select layers and confirm/correct room polygons, openings, obstructions and barrier roles. Confirmed semantics feed canonical geometry, loads, routing and validation. System placement respects room boundaries and declared obstacles; unknown elevations/clearances remain explicit.

Versioned project persistence retains CAD, semantic approvals, engineering inputs, selections, locks and revision provenance. Native layered DXF export writes the original coordinate system, physical units, native curves, equipment/terminal/duct entities, tags and schedules. Exported geometry is reopened and quantitatively compared. A report lists actual checks, assumptions, overrides and unresolved conditions.

Engineering mode separates preliminary assumptions from detailed input evidence. Detailed loads require explicit construction/glazing/solar/internal-gain/ventilation/psychrometric inputs and reviewable component calculations. Equipment evidence includes catalog source and operating conditions. Egypt jurisdiction does not imply adoption of an international edition: profiles retain edition/source/applicability and local project requirements, with unknown normative requirements preventing compliance claims.

## Completion requirements

- Faithful supported DXF/DWG geometry, transformations and native curves; diagnostics for malformed, unsupported, nonplanar and incomplete geometry. Drawing units must be confirmed when absent.
- Tested recognition of closed polylines and bounded line networks; confidence/evidence; correction and approval; distinguish walls, openings, obstacles and rated barriers without inventing semantic certainty.
- One authoritative input-to-load-to-selection-to-layout pipeline, per-zone and per-fan validation, obstacle-aware system drawing and explicit unresolved checks.
- Versioned save/load and undo/redo, revision invalidation, cancellation and deterministic reruns.
- Editable CAD export preserving units/original transforms with separate system layers, tags, dimensions, schedules and engineering reports; verify reopen/round trip.
- Egypt project profiles with selectable sourced ASHRAE/SMACNA/NFPA editions and project overrides; source and applicability evidence; no automatic code-certification claims.
- Detailed engineering inputs and component outputs; manufacturer provenance and operating-condition evidence; missing evidence blocks engineering issue readiness.
- Resolve the nine current regression failures from real engineering evidence, not loosen checks. Add independent analytical examples, native CAD fixtures and UI-to-engine-to-export acceptance. Verify performance on large drawings and cancellation.

## Acceptance evidence

Each requirement needs source-level regression tests plus appropriate runtime verification. A green focused suite alone cannot prove this objective. Maintain the full requirement checklist and test results in the implementation plan. The goal remains active until every requirement above has current evidence.

## Preservation

Keep the existing dirty checkout on `fix/engineering-integrity-audit`; do not reset, move or commit unrelated user changes. Retain task-only snapshots/review evidence. No publishing or merging is requested.
