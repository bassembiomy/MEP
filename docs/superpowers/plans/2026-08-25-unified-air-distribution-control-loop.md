# Unified HVAC Air Distribution Closed-Loop Optimization Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a physics-informed closed-loop optimization control engine that unifies ACU/FCU equipment partitioning, diffuser CFM apportionment, acoustic Noise Criteria (NC) limits, duct static pressure (ESP), and geometric spatial distribution.

**Architecture:** A multi-variable iterative feedback control loop that evaluates candidate MEP air distribution states against a multi-objective loss function ($L = w_{cov}L_{cov} + w_{nc}L_{nc} + w_{esp}L_{esp} + w_{cfm}L_{cfm} + w_{geom}L_{geom}$), iteratively refining equipment count, terminal sizing, catalog selection, and duct velocities until global convergence.

**Tech Stack:** TypeScript, Node.js (tested via `npx tsx`), React, Zustand, SMACNA & ASHRAE standards database.

**Spec:** `docs/superpowers/specs/2026-08-25-unified-air-distribution-control-loop-design.md`

## Global Constraints
- **Strict Conservation of Airflow**: $\sum CFM_i = CFM_{total}$ with no air volume leaks.
- **Catalog Bounds**: $CFM_i$ must remain inside valid catalog operating ranges ($150 \le CFM_i \le 450$ for standard ceiling diffusers).
- **Acoustic Compliance**: $NC_{actual} \le NC_{target}$ for all selected diffusers and duct segments.
- **Static Pressure Headroom**: $\Delta P_{total} \le ESP_{rated}$.
- **Coverage Guarantee**: Zone throw coverage $\ge 95.0\%$.

---

### Task 1: Core Closed-Loop Control Engine (`neuralControlLoopEngine.ts`)

**Files:**
- Create: `src/renderer/src/engine/neuralControlLoopEngine.ts`
- Test: `src/renderer/src/engine/__tests__/neuralControlLoopEngine.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface UnifiedOptimizationInput {
    roomPolygon: number[];
    roomAreaSqFt: number;
    requiredCfm: number;
    totalLoadBtu: number;
    spaceNcLimit: number;
    systemType: 'concealed' | 'packaged' | 'cassette' | 'high-wall' | 'vrf' | 'ahu' | 'fcu';
    scale?: number;
    isImperial?: boolean;
    dxfEntities?: any[];
  }

  export interface UnifiedOptimizationResult {
    equipmentCount: number;
    supplyDiffusers: DiffuserPos[];
    returnDiffusers: DiffuserPos[];
    totalCfm: number;
    maxDiffuserNc: number;
    coveragePercent: number;
    estimatedEspInWg: number;
    loss: number;
    iterations: number;
    converged: boolean;
    trace: {
      iteration: number;
      diffuserCount: number;
      coverage: number;
      maxNc: number;
      loss: number;
    }[];
  }

  export function optimizeUnifiedAirDistributionSystem(
    input: UnifiedOptimizationInput
  ): UnifiedOptimizationResult;
  ```

- [ ] **Step 1: Write the failing unit test for `optimizeUnifiedAirDistributionSystem`**

Create `src/renderer/src/engine/__tests__/neuralControlLoopEngine.test.ts`:
```typescript
import { optimizeUnifiedAirDistributionSystem } from '../neuralControlLoopEngine';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Testing Unified Neural Control Loop Engine ===');

// Test 1: Standard 400 CFM Office (NC target 30)
const res1 = optimizeUnifiedAirDistributionSystem({
  roomPolygon: [0, 0, 20, 0, 20, 15, 0, 15],
  roomAreaSqFt: 300,
  requiredCfm: 400,
  totalLoadBtu: 15000,
  spaceNcLimit: 30,
  systemType: 'concealed'
});

assert(res1.converged, 'Optimization must converge');
assert(res1.coveragePercent >= 95.0, `Coverage must be >= 95%, got ${res1.coveragePercent}%`);
assert(res1.maxDiffuserNc <= 30, `Diffuser NC must be <= 30, got ${res1.maxDiffuserNc}`);
assert(res1.supplyDiffusers.reduce((sum, d) => sum + d.cfm, 0) === 400, 'CFM sum must be 400');

console.log('Unified Control Loop Test Passed!');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx "src/renderer/src/engine/__tests__/neuralControlLoopEngine.test.ts"`
Expected: FAIL with "Cannot find module '../neuralControlLoopEngine'"

- [ ] **Step 3: Implement `neuralControlLoopEngine.ts`**

Write `src/renderer/src/engine/neuralControlLoopEngine.ts` implementing the closed-loop optimization controller with equipment splitting, diffuser catalog evaluation, Voronoi relaxation, acoustic loss, and ESP evaluation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx "src/renderer/src/engine/__tests__/neuralControlLoopEngine.test.ts"`
Expected: PASS

---

### Task 2: Enhance Diffuser Placer & Acoustic Catalog Integration (`diffuserPlacer.ts`)

**Files:**
- Modify: `src/renderer/src/engine/diffuserPlacer.ts`
- Test: `src/renderer/src/engine/__tests__/coverage95Optimization.test.ts`

**Interfaces:**
- Consumes: `STANDARD_DIFFUSER_CATALOG`, `calculateZoneDiffuserCoverage`, `selectBestDiffuserFromCatalog`
- Produces: Enhanced `placeDiffusersWithCircularOptimization` utilizing the closed-loop controller when optimization options are active.

- [ ] **Step 1: Update `placeDiffusersWithCircularOptimization` in `diffuserPlacer.ts`**

Update `placeDiffusersWithCircularOptimization` to incorporate adaptive throw scaling, fine-tuned Lloyd relaxation, and exact $\ge 95\%$ coverage guarantees under catalog NC constraints.

- [ ] **Step 2: Run `coverage95Optimization.test.ts` to verify it passes**

Run: `npx tsx "src/renderer/src/engine/__tests__/coverage95Optimization.test.ts"`
Expected: PASS (Small room, conference hall, and elongated gallery all achieve $\ge 95\%$ coverage and $NC \le 30$).

---

### Task 3: Integrate Closed-Loop Engine into `airDistributionEngine.ts` and `systemDesigner.ts`

**Files:**
- Modify: `src/renderer/src/engine/airDistributionEngine.ts`
- Modify: `src/renderer/src/engine/systemDesigner.ts`
- Test: `src/renderer/src/engine/__tests__/endToEndAirDistribution.test.ts`

**Interfaces:**
- Integrates `optimizeUnifiedAirDistributionSystem` into `executeAirDistributionDesign` and system candidate architecture generation.

- [ ] **Step 1: Update `airDistributionEngine.ts` to delegate to `optimizeUnifiedAirDistributionSystem`**
- [ ] **Step 2: Run `endToEndAirDistribution.test.ts`**

Run: `npx tsx "src/renderer/src/engine/__tests__/endToEndAirDistribution.test.ts"`
Expected: PASS

- [ ] **Step 3: Run full engine test suite**

Run: `npx tsx "src/renderer/src/engine/__tests__/engineeringEngine.test.ts"`
Expected: PASS

---

### Task 4: UI & Feedback Trace Visualization (`OptimizerStudioPanel.tsx` & `SelectionTraceViewer.tsx`)

**Files:**
- Modify: `src/renderer/src/panels/OptimizerStudioPanel.tsx`
- Modify: `src/renderer/src/components/SelectionTraceViewer.tsx`
- Modify: `src/renderer/src/engine/types.ts`

**Interfaces:**
- Updates `SelectionAlgorithmTrace` to include closed-loop convergence trace (iterations, loss, acoustic safety margin, ESP headroom, throw ratio).

- [ ] **Step 1: Add closed-loop trace metrics to `types.ts`**
- [ ] **Step 2: Update `SelectionTraceViewer.tsx` to render the closed-loop optimization graph/steps**
- [ ] **Step 3: Run TypeScript compiler validation**

Run: `npm run typecheck:web`
Expected: PASS with 0 type errors.
