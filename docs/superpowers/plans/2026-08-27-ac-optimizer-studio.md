# AC Optimizer Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the end-to-end AC design optimization pipeline that reads zone boundaries, selects the lowest-cost equipment (FCU / ACU / AHU) from the catalog database based on user toggles, optimizes for the minimal number of diffusers achieving $\ge 98\%$ room coverage within space Noise Criteria (NC) limits, and computes telescopic duct sizing respecting downstream CFM and acoustic velocity constraints.

**Architecture:**
- Ingestion of zone polygon boundaries and room load parameters.
- Query-driven equipment selector filtering FCU, ACU/Packaged DX, and AHU from the database, ranked strictly by lowest total installed cost.
- Multi-tier diffuser optimizer testing larger database models before incrementing diffuser count to guarantee $\ge 98\%$ coverage and $NC \le NC_{space}$.
- Telescopic duct sizing engine stepping down duct cross-sections per downstream branch CFM with SMACNA gauge and acoustic velocity checks.
- Synchronized Optimizer Studio UI controls and diagnostic badges.

**Tech Stack:** TypeScript, React, Vite, Vitest, Zustand

**Spec:** `docs/superpowers/specs/2026-08-27-ac-optimizer-studio-design.md`

## Global Constraints
- Target Coverage: $\ge 98\%$ geometric room coverage.
- Noise Constraint: Terminal actual NC $\le$ Zone maximum NC limit ($NC_{space}$).
- Sizing Method: Standard 2-inch increment rectangular sizing with aspect ratio $\le 3.5$.
- Duct Velocity Constraints: Main trunks $\le 1200\text{ FPM}$, branch runouts $\le 800\text{ FPM}$.
- Strict database catalog usage: Diffuser throws ($T_{50}$) and NC ratings must directly reference database tables with no fabricated numbers.

---

### Task 1: Lowest-Cost Equipment Selection Engine with Family Toggles

**Files:**
- Modify: `src/renderer/src/engine/systemDesigner.ts`
- Test: `src/renderer/src/engine/__tests__/equipmentLowestCostOptimization.test.ts`

**Interfaces:**
- Consumes: `STANDARD_EQUIPMENT_CATALOG`, `calculateZoneLoad`, `selectedSystemTypes`
- Produces: `generateSystemCandidates` with strict lowest-cost candidate sorting and multi-type filtering

- [ ] **Step 1: Write the failing unit test**
Create `src/renderer/src/engine/__tests__/equipmentLowestCostOptimization.test.ts` testing that when FCU, ACU, and AHU are enabled, candidate designs meeting capacity requirements are generated with the absolute lowest initial cost index candidate designated as `lowestCost` and ranked #1 when cost weight is prioritized.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/renderer/src/engine/__tests__/equipmentLowestCostOptimization.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement lowest-cost equipment filtering and ranking**
In `src/renderer/src/engine/systemDesigner.ts`:
- Ensure `selectedSystemTypes` properly filters `fcu`, `packaged` (ACU), `ahu`, and `concealed`.
- Compute total installed capital cost ($\text{unit cost} \times \text{quantity}$).
- Sort candidates strictly by cost index when cost is prioritized or for `lowestCost` designation.
- Validate unit nominal CFM and total cooling capacity ($Btu/h$) against zone load.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/renderer/src/engine/__tests__/equipmentLowestCostOptimization.test.ts`
Expected: PASS

---

### Task 2: Minimal-Diffuser Optimization with 98% Spatial Coverage & NC Noise Gate

**Files:**
- Modify: `src/renderer/src/engine/diffuserPlacer.ts`
- Modify: `src/renderer/src/engine/systemDesigner.ts`
- Test: `src/renderer/src/engine/__tests__/diffuser98CoverageAcoustic.test.ts`

**Interfaces:**
- Consumes: `selectBestDiffuserFromCatalog`, `calculateZoneDiffuserCoverage`, `STANDARD_DIFFUSER_CATALOG`
- Produces: `placeDiffusersWithCircularOptimization` and `generateDiffuserDistributionOptions` guaranteeing minimal diffuser count meeting $\ge 98\%$ coverage and $NC \le NC_{space}$

- [ ] **Step 1: Write the failing unit test**
Create `src/renderer/src/engine/__tests__/diffuser98CoverageAcoustic.test.ts` verifying that:
1. For a given room polygon and CFM, the algorithm starts at $N=1$ and evaluates coverage.
2. If coverage $< 98\%$, it searches the database for a larger face/neck size diffuser model with higher $T_{50}$ throw while verifying $NC \le NC_{space}$.
3. If larger diffuser models cannot reach 98% coverage without exceeding NC limits, it increments diffuser count $N \to N + 1$ until $\ge 98\%$ coverage is achieved.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/renderer/src/engine/__tests__/diffuser98CoverageAcoustic.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement minimal-diffuser 98% coverage search**
In `src/renderer/src/engine/diffuserPlacer.ts`:
- Update the placement and sizing loop to test catalog models with larger throw radii before incrementing terminal count.
- Update `calculateZoneDiffuserCoverage` to use exact $T_{50}$ catalog throw values and enforce the 98% target.
- In `src/renderer/src/engine/systemDesigner.ts`, update `generateDiffuserDistributionOptions` to calculate realistic coverage percentages based on room boundary geometry and minimal diffuser counts.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/renderer/src/engine/__tests__/diffuser98CoverageAcoustic.test.ts`
Expected: PASS

---

### Task 3: Acoustic-Constrained Telescopic Stepped Duct Distribution & Sizing

**Files:**
- Modify: `src/renderer/src/engine/spatialPlanner.ts`
- Modify: `src/renderer/src/engine/ductSizer.ts`
- Test: `src/renderer/src/engine/__tests__/telescopicDuctAcousticSizing.test.ts`

**Interfaces:**
- Consumes: `sizeDuct`, `planDuctedAirDistribution`, `verifyDuctSectionAcoustics`
- Produces: Telescopically reduced `DuctSegment[]` with compliant dimensions, velocities, and acoustic criteria

- [ ] **Step 1: Write the failing unit test**
Create `src/renderer/src/engine/__tests__/telescopicDuctAcousticSizing.test.ts` verifying that:
1. Main supply trunk segments reduce in width/height as branch takeoffs reduce remaining downstream CFM.
2. Main trunk velocities remain within $900 - 1200\text{ FPM}$ and branch velocities remain $\le 800\text{ FPM}$.
3. In-duct noise criteria is verified compliant with space NC limit.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/renderer/src/engine/__tests__/telescopicDuctAcousticSizing.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement dynamic telescopic duct reduction & acoustic verification**
In `src/renderer/src/engine/spatialPlanner.ts`:
- Refactor `planDuctedAirDistribution` to trace the main trunk from indoor unit outlet to each branch junction, subtracting branch CFM and applying `sizeDuct` with equal friction and velocity reduction.
- Step down trunk dimensions in 2-inch increments while preserving uniform height where feasible.
- Verify branch and trunk segments against acoustic velocity limits.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/renderer/src/engine/__tests__/telescopicDuctAcousticSizing.test.ts`
Expected: PASS

---

### Task 4: Optimizer Studio UI Integration & End-to-End Acceptance

**Files:**
- Modify: `src/renderer/src/panels/OptimizerStudioPanel.tsx`
- Test: `src/renderer/src/engine/__tests__/optimizerStudioEndToEnd.test.ts`

**Interfaces:**
- Consumes: `OptimizerStudioPanel`, `useProjectStore`, `generateSystemCandidates`, `createDeploymentPreview`
- Produces: Complete UI with equipment toggles (FCU, ACU, AHU), 98% coverage badge, and 1-click preview

- [ ] **Step 1: Write end-to-end integration test**
Create `src/renderer/src/engine/__tests__/optimizerStudioEndToEnd.test.ts` validating complete pipeline execution: zone polygon $\to$ load calc $\to$ lowest-cost equipment candidate $\to$ minimal diffusers $\ge 98\%$ coverage $\to$ telescopic duct deployment manifest.

- [ ] **Step 2: Run test to verify it passes**
Run: `npx vitest run src/renderer/src/engine/__tests__/optimizerStudioEndToEnd.test.ts`
Expected: PASS

- [ ] **Step 3: Update Optimizer Studio Panel UI**
In `src/renderer/src/panels/OptimizerStudioPanel.tsx`:
- Ensure equipment family filter buttons/checkboxes include FCU, ACU/Packaged DX, AHU, and Ducted Concealed.
- Display the exact room coverage percentage ($\ge 98\%$), diffuser count, catalog face/neck dimensions, and space NC compliance badge.
- Ensure the preview and apply transaction seamlessly renders the telescopically reduced duct network and diffusers.

- [ ] **Step 4: Run complete engine test suite**
Run: `npx vitest run`
Expected: All tests pass.
