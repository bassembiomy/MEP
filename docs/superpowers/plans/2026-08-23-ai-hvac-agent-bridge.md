# AI HVAC Design Agent Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and integrate an AI HVAC Design Agent Bridge with dynamic prompt generation, catalog slicing, multi-variation layout generation, neural-scoring, fluid dynamics validation, and direct CAD canvas sync.

**Architecture:** A modular AI engine layer in `src/renderer/src/engine/ai/` comprising `aiHvacPromptBuilder.ts`, `aiHvacResponseParser.ts`, `aiHvacScoringEngine.ts`, and `aiHvacGenerator.ts`, with an interactive React modal (`AiHvacAssistantModal.tsx`) integrated into `Toolbar.tsx` and connected to `projectStore.ts`.

**Tech Stack:** TypeScript, React 19, Lucide React, Zustand, Konva CAD Canvas, Vitest/Node test runner.

**Spec:** [2026-08-23-ai-hvac-agent-bridge-design.md](file:///g:/mep%20prog/docs/superpowers/specs/2026-08-23-ai-hvac-agent-bridge-design.md)

## Global Constraints
- Strictly adhere to ASHRAE 62.1, ASHRAE 55, Equal Friction sizing ($0.08\text{ in. w.g.}/100\text{ ft}$).
- Main duct velocity: $1000\text{--}1500\text{ fpm}$; Branch duct velocity: $700\text{--}1000\text{ fpm}$.
- Maximum rectangular aspect ratio: $4.0:1$.
- Diffuser boundary rule: distance from wall $\le 70\%$ of diffuser-to-diffuser pitch.
- Output schema must strictly format `Diffuser` and `DuctSegment` records for `projectStore.ts`.

---

### Task 1: AI Prompt Builder & Dynamic Catalog Slicer

**Files:**
- Create: `src/renderer/src/engine/ai/aiHvacPromptBuilder.ts`
- Test: `src/renderer/src/engine/__tests__/aiHvacPromptBuilder.test.ts`

**Interfaces:**
- Consumes: `Zone` from `../types`, `STANDARD_EQUIPMENT_CATALOG` and `STANDARD_DIFFUSER_CATALOG` from `../hvacCatalogs`
- Produces: `buildAiHvacPrompt(zone: Zone, options?: PromptOptions): { systemPrompt: string; userPrompt: string; catalogSlice: any }`

- [ ] **Step 1: Write test for AI Prompt Builder**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement `aiHvacPromptBuilder.ts`**
- [ ] **Step 4: Run test to verify it passes**

---

### Task 2: AI Response Parser, Fluid Dynamics Validator & CAD Adapter

**Files:**
- Create: `src/renderer/src/engine/ai/aiHvacResponseParser.ts`
- Test: `src/renderer/src/engine/__tests__/aiHvacResponseParser.test.ts`

**Interfaces:**
- Consumes: Raw JSON string or object matching `AiHvacDesignOutput`
- Produces: `validateAndParseAiHvacResponse(jsonStr: string, zone: Zone): { success: boolean; data?: AiHvacDesignOutput; diffusers: Diffuser[]; ducts: DuctSegment[]; errors: string[] }`

- [ ] **Step 1: Write test for Response Parser & Validator**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement `aiHvacResponseParser.ts`**
- [ ] **Step 4: Run test to verify it passes**

---

### Task 3: Multi-Variation Scoring Engine & Layout Generator

**Files:**
- Create: `src/renderer/src/engine/ai/aiHvacScoringEngine.ts`
- Create: `src/renderer/src/engine/ai/aiHvacGenerator.ts`
- Test: `src/renderer/src/engine/__tests__/aiHvacScoringEngine.test.ts`

**Interfaces:**
- Consumes: `Zone`, `STANDARD_EQUIPMENT_CATALOG`
- Produces: `generateCandidateVariations(zone: Zone): AiHvacCandidate[]` and `scoreHvacVariation(layout: AiHvacDesignOutput, zone: Zone): HvacScoreBreakdown`

- [ ] **Step 1: Write test for Multi-Variation Generator and Scoring Engine**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement `aiHvacScoringEngine.ts` and `aiHvacGenerator.ts`**
- [ ] **Step 4: Run test to verify it passes**

---

### Task 4: Interactive AI HVAC Assistant UI Modal & Toolbar Integration

**Files:**
- Create: `src/renderer/src/components/AiHvacAssistantModal.tsx`
- Modify: `src/renderer/src/components/Toolbar.tsx`
- Modify: `src/renderer/src/store/projectStore.ts` (if needed for quick apply actions)

**Interfaces:**
- Consumes: `useProjectStore`, `buildAiHvacPrompt`, `generateCandidateVariations`, `validateAndParseAiHvacResponse`
- Produces: Modal with Prompt Copy, Layout Variation Selector, Radar/Metrics Comparison, Direct Canvas Sync.

- [ ] **Step 1: Implement `AiHvacAssistantModal.tsx`**
- [ ] **Step 2: Integrate into `Toolbar.tsx` with AI Sparkles button**
- [ ] **Step 3: Verify build and typecheck with `npm run typecheck`**
