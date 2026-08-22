# CAD Air Distribution Visualization & Universal HVAC Catalogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand HVAC equipment catalogs to support any system type/capacity (AHU, RTU/Package, ACU/DX Split, FCU, VRF, DOAS) and render full air-distribution networks with inline CFM, size, velocity, and equipment symbols on the CAD workspace.

**Architecture:** 
1. Rich multi-system equipment catalogs in `hvacCatalogs.ts` with enhanced selection scoring in `equipmentSelector.ts`.
2. CAD canvas drafting layer in `FloorPlanCanvas.tsx` rendering physical stepped double-line ducts with inline badges (`Size • CFM • FPM`), supply diffusers with CFM & throw rings, return grilles with CFM tags, and modular equipment symbols.
3. Bidirectional engine-to-store synchronization in `airDistributionEngine.ts`, `projectStore.ts`, and `AirDistributionSchedulePanel.tsx`.

**Tech Stack:** TypeScript, React, Konva / react-konva, Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-cad-air-distribution-and-catalogs-design.md`

## Global Constraints
- ASHRAE 62.1-2019, ASHRAE 55, SMACNA sizing tables.
- All inline duct badges must display `Size • CFM • FPM`.
- All supply diffusers must display `Tag (Size) • CFM • NC`.
- All return grilles must display `Tag (Size) • CFM`.
- Zero TypeScript errors (`npm run typecheck`).

---

### Task 1: Universal Equipment Catalogs Expansion & Enhanced Selector
**Files:**
- Modify: `src/renderer/src/engine/hvacCatalogs.ts`
- Modify: `src/renderer/src/engine/systemArchitecture/equipmentSelector.ts`
- Test: `src/renderer/src/engine/__tests__/equipmentCatalogs.test.ts`

**Interfaces:**
- Produces: Expanded `STANDARD_EQUIPMENT_CATALOG` covering AHU (3-60 Ton), RTU (2-30 Ton), DX Split (1.5-10 Ton), FCU/VRF (200-2,400 CFM), DOAS Louvers (200-8,000 CFM).
- Produces: `selectEquipmentForLoad(reqCfm, reqBtu, systemType, catalog)` supporting all normalized types.

- [ ] **Step 1: Write failing test for universal catalog selection across all system types**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement comprehensive catalog models and robust matching logic**
- [ ] **Step 4: Run test to verify pass**
- [ ] **Step 5: Typecheck & commit**

---

### Task 2: CAD Canvas Inline Badges, Diffuser Tags & Equipment Symbols
**Files:**
- Modify: `src/renderer/src/canvas/FloorPlanCanvas.tsx`
- Test: `src/renderer/src/engine/__tests__/cadCanvasRendering.test.ts`

**Interfaces:**
- Consumes: `Zone.ducts`, `Zone.diffusers`, `Zone.unitPos`, `Zone.outdoorUnitPos`
- Produces: High-contrast CAD double-line ducts with centerline badges (`24"x10" • 1,345 CFM • 807 FPM`), 4-way diffusers with CFM/throw tags, return grilles with CFM tags, and detailed multi-section equipment graphics (AHU, RTU, DX Split, DOAS Louver).

- [ ] **Step 1: Write tests verifying duct, terminal, and equipment annotation data formatting**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Update `FloorPlanCanvas.tsx` with enhanced inline badges, tags, and symbols**
- [ ] **Step 4: Run test to verify pass**
- [ ] **Step 5: Typecheck & commit**

---

### Task 3: Engine-to-Store Synchronization & "Apply to CAD" Action
**Files:**
- Modify: `src/renderer/src/engine/airDistributionEngine.ts`
- Modify: `src/renderer/src/panels/AirDistributionSchedulePanel.tsx`
- Modify: `src/renderer/src/store/projectStore.ts`
- Test: `src/renderer/src/engine/__tests__/cadAirDistributionSync.test.ts`

**Interfaces:**
- Produces: `applyDesignToZone(zoneId, designResult)` syncing diffusers, return grilles, stepped ducts, and equipment into active store zone.
- Produces: "Apply AI Air Distribution to CAD" interactive button in schedule panel.

- [ ] **Step 1: Write failing integration test for engine-to-zone synchronization**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement store sync helper and UI button**
- [ ] **Step 4: Run test to verify pass**
- [ ] **Step 5: Typecheck & commit**

---

### Task 4: Full System Verification & End-to-End Test Suite
**Files:**
- Test: `src/renderer/src/engine/__tests__/endToEndAirDistribution.test.ts`
- Test: All unit and integration test suites

- [ ] **Step 1: Run all test suites (`npm run test`)**
- [ ] **Step 2: Run TypeScript typecheck (`npm run typecheck`)**
- [ ] **Step 3: Validate end-to-end multi-zone scenarios**
