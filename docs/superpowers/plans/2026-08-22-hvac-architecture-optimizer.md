# HVAC Architecture & Selection Algorithm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement dynamic Bill of Components breakdown and professional 7-step engineering selection algorithm traces for all 6 HVAC system types in the Deterministic HVAC Optimizer Studio.

**Architecture:** Create an engineering domain module (`hvacArchitecture.ts`) that models system-specific component architectures, physical sizing parameters, and deterministic 7-step selection pathways. Integrate this into the candidate optimization engine (`systemDesigner.ts`) and enhance the Optimizer Studio UI (`OptimizerStudioPanel.tsx`) with interactive candidate tabs and a dedicated System Architecture Inspector modal.

**Tech Stack:** TypeScript, React, TailwindCSS, Lucide-react, Zustand, Vitest/npx tsx test runner.

**Spec:** [`docs/superpowers/specs/2026-08-22-hvac-architecture-optimizer-design.md`](file:///g:/mep%20prog/docs/superpowers/specs/2026-08-22-hvac-architecture-optimizer-design.md)

## Global Constraints
- Every HVAC system candidate must produce a valid `systemArchitecture` with itemized components in 5 categories.
- Every candidate must produce a complete 7-step `selectionAlgorithmTrace` with formulas, inputs, calculated values, and pass criteria.
- Support all 6 system types: `concealed`, `cassette`, `high-wall`, `vrf`, `packaged`, `ahu`.
- All calculations must follow ASHRAE Fundamentals and SMACNA standard design criteria.
- Must pass `npm run typecheck` and test suites without regression.

---

### Task 1: Extend Data Types for System Architecture & Algorithm Trace

**Files:**
- Modify: `src/renderer/src/engine/types.ts`
- Test: `src/renderer/src/engine/__tests__/typesIntegrity.test.ts`

**Interfaces:**
- Produces: `ComponentCategory`, `SystemComponentItem`, `SystemArchitectureBreakdown`, `SelectionAlgorithmStep`, `SelectionAlgorithmTrace`
- Modifies: `SystemDesignCandidate` to include `systemArchitecture: SystemArchitectureBreakdown` and `algorithmTrace: SelectionAlgorithmTrace`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/src/engine/__tests__/typesIntegrity.test.ts
import { SystemComponentItem, SelectionAlgorithmTrace, SystemDesignCandidate } from '../types';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

const mockComp: SystemComponentItem = {
  id: 'comp-1',
  category: 'primary-equipment',
  tag: 'ODU-01',
  name: 'Outdoor Condensing Unit',
  modelOrType: 'Carrier 42QSS024-D',
  quantity: 1,
  specification: '2.0 TR, 614 CFM',
  connectionSize: '3/8" Liq / 5/8" Gas',
  status: 'included'
};

assert(mockComp.tag === 'ODU-01', 'Tag must match');
console.log('✔ Types integrity test passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/renderer/src/engine/__tests__/typesIntegrity.test.ts`
Expected: FAIL with missing exported types.

- [ ] **Step 3: Write minimal implementation in `types.ts`**

Add `ComponentCategory`, `SystemComponentItem`, `SystemArchitectureBreakdown`, `SelectionAlgorithmStep`, and `SelectionAlgorithmTrace` to `src/renderer/src/engine/types.ts` and update `SystemDesignCandidate`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/renderer/src/engine/__tests__/typesIntegrity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/engine/types.ts src/renderer/src/engine/__tests__/typesIntegrity.test.ts
git commit -m "feat(types): add HVAC system architecture and selection algorithm trace models"
```

---

### Task 2: Implement HVAC Architecture Engine & Selection Algorithm Trace Generator

**Files:**
- Create: `src/renderer/src/engine/hvacArchitecture.ts`
- Test: `src/renderer/src/engine/__tests__/hvacArchitecture.test.ts`

**Interfaces:**
- Produces: `generateSystemArchitecture(equip, qty, cfm, areaSqFt, loadBtu, isImperial, diffusers, ductwork)`, `generateSelectionAlgorithmTrace(equip, qty, cfm, areaSqFt, totalLoadBtu, sensibleLoadBtu, spaceNcLimit, criticalPath, fanResult, isImperial)`

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/src/engine/__tests__/hvacArchitecture.test.ts
import { generateSystemArchitecture, generateSelectionAlgorithmTrace } from '../hvacArchitecture';
import { STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

const equip = STANDARD_EQUIPMENT_CATALOG[0]; // Concealed Ducted
const arch = generateSystemArchitecture(equip, 1, 600, 300, 20000, true);
assert(arch.components.length >= 5, 'Concealed ducted must have at least 5 component items');
assert(arch.components.some(c => c.category === 'primary-equipment'), 'Must include primary equipment');
assert(arch.components.some(c => c.category === 'air-distribution'), 'Must include ductwork/distribution');

const trace = generateSelectionAlgorithmTrace(equip, 1, 600, 300, 20000, 15000, 32, null as any, null as any, true);
assert(trace.steps.length === 7, 'Selection trace must contain exactly 7 engineering steps');
assert(trace.steps[0].stepName.includes('Thermal Load'), 'Step 1 must be Thermal Load');
assert(trace.steps[1].stepName.includes('Airflow'), 'Step 2 must be Airflow');
assert(trace.steps[4].stepName.includes('Static Pressure'), 'Step 5 must be Static Pressure');
console.log('✔ HVAC Architecture engine test passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/renderer/src/engine/__tests__/hvacArchitecture.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/renderer/src/engine/hvacArchitecture.ts`**

Implement comprehensive architecture blueprints, itemized component generator for all 6 system types, and the 7-step mathematical trace generator (Load $\rightarrow$ CFM $\rightarrow$ De-rating $\rightarrow$ Throw/NC $\rightarrow$ Duct/ESP $\rightarrow$ Fan Operating Point $\rightarrow$ Piping & Controls).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/renderer/src/engine/__tests__/hvacArchitecture.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/engine/hvacArchitecture.ts src/renderer/src/engine/__tests__/hvacArchitecture.test.ts
git commit -m "feat(engine): implement HVAC architecture blueprints and 7-step selection trace generator"
```

---

### Task 3: Integrate Architecture Breakdown into Candidate Optimization Engine

**Files:**
- Modify: `src/renderer/src/engine/systemDesigner.ts`
- Test: `src/renderer/src/engine/__tests__/engineeringEngine.test.ts`

**Interfaces:**
- Consumes: `generateSystemArchitecture`, `generateSelectionAlgorithmTrace` from `hvacArchitecture.ts`
- Modifies: `generateSystemCandidates()` to attach `systemArchitecture` and `algorithmTrace` to every candidate.

- [ ] **Step 1: Write the failing test**

```typescript
// in engineeringEngine.test.ts
// Verify that every returned candidate has populated architecture and algorithm trace
const summary = generateSystemCandidates(24000, 18000, 800, 'office', 400);
for (const cand of summary.candidates) {
  assert(cand.systemArchitecture !== undefined, 'Candidate must have systemArchitecture');
  assert(cand.systemArchitecture.components.length > 0, 'Candidate must have components');
  assert(cand.algorithmTrace !== undefined, 'Candidate must have algorithmTrace');
  assert(cand.algorithmTrace.steps.length === 7, 'Algorithm trace must have 7 steps');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/renderer/src/engine/__tests__/engineeringEngine.test.ts`
Expected: FAIL (missing fields).

- [ ] **Step 3: Modify `systemDesigner.ts` to attach architecture & algorithm trace**

Update `generateSystemCandidates()` to call `generateSystemArchitecture` and `generateSelectionAlgorithmTrace` for each candidate.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/renderer/src/engine/__tests__/engineeringEngine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/engine/systemDesigner.ts src/renderer/src/engine/__tests__/engineeringEngine.test.ts
git commit -m "feat(optimizer): attach system architecture and selection trace to all design candidates"
```

---

### Task 4: Build Architecture Inspector & Selection Trace Viewer UI Components

**Files:**
- Create: `src/renderer/src/components/ArchitectureInspectorModal.tsx`
- Create: `src/renderer/src/components/SelectionTraceViewer.tsx`
- Modify: `src/renderer/src/panels/OptimizerStudioPanel.tsx`

**Interfaces:**
- Produces: `ArchitectureInspectorModal` (Full visual diagram, ASHRAE/SMACNA rules, Bill of Materials schedule), `SelectionTraceViewer` (Interactive 7-step calculation trail with formulas and inputs)
- Enhances: `OptimizerStudioPanel.tsx` with candidate card subtabs (`Overview`, `Bill of Materials`, `Selection Algorithm`) and modal trigger.

- [ ] **Step 1: Create `SelectionTraceViewer.tsx`**

Build interactive step-by-step accordion renderer for the 7 engineering steps displaying formula, input variables, computed result, and pass/fail badges.

- [ ] **Step 2: Create `ArchitectureInspectorModal.tsx`**

Build modal dialog rendering the system schematic diagram, equipment specifications, categorized component table, and MEP code references.

- [ ] **Step 3: Update `OptimizerStudioPanel.tsx`**

Integrate active tab states per candidate (`overview`, `components`, `algorithm`), render the `SelectionTraceViewer` and component table inline, and connect the `ArchitectureInspectorModal`.

- [ ] **Step 4: Verify typecheck & build**

Run: `npm run typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ArchitectureInspectorModal.tsx src/renderer/src/components/SelectionTraceViewer.tsx src/renderer/src/panels/OptimizerStudioPanel.tsx
git commit -m "feat(ui): add interactive HVAC architecture inspector and selection trace viewer to Optimizer Studio"
```

---

### Task 5: End-to-End Acceptance Testing & Verification

**Files:**
- Create: `src/renderer/src/engine/__tests__/hvacArchitectureAcceptance.test.ts`
- Run: `npm run typecheck` & `npx tsx src/renderer/src/engine/__tests__/hvacArchitectureAcceptance.test.ts`

- [ ] **Step 1: Write acceptance test validating all 6 system types**

Test generating candidates for `concealed`, `cassette`, `high-wall`, `vrf`, `packaged`, `ahu` across different room loads and space types. Verify non-empty bills of materials, proper sizing tags, valid calculations, and pass criteria.

- [ ] **Step 2: Run all engine tests**

Run:
```bash
npx tsx src/renderer/src/engine/__tests__/engineeringEngine.test.ts
npx tsx src/renderer/src/engine/__tests__/hvacArchitectureAcceptance.test.ts
npm run typecheck
```
Expected: All tests PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/engine/__tests__/hvacArchitectureAcceptance.test.ts
git commit -m "test: add comprehensive acceptance tests for HVAC system architecture and selection algorithms"
```
