# AI HVAC Design Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate and orchestrate existing deterministic HVAC engineering modules into a unified, traceable, and failure-aware AI HVAC Design Orchestration Engine (`autoDesignHVAC`).

**Architecture:** A 16-phase pipeline utilizing typed phase contracts and zero-rewrite adapters around existing deterministic modules, governed by a live state machine, a failure-aware earliest-dependency optimization loop, an engineering decision trace logger, and a dependency-graph partial recalculation engine.

**Tech Stack:** TypeScript 5.9, React 19, Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-hvac-design-orchestrator-spec.md`

## Global Constraints
- Do not modify existing calculation logic in `diffuserPlacer.ts`, `steppedDuctRouter.ts`, `aerodynamicDuctSizer.ts`, or `hvacValidator.ts`. Wrap them in `adapters/`.
- Maintain strict separation: live execution state (`HVACDesignExecution`) vs final immutable engineering output (`HVACDesignResult`).
- All 44 existing Vitest test files must continue to pass without regression.

---

### Task 1: Orchestrator Core Types, Phase Contracts & Decision Logging

**Files:**
- Create: `src/renderer/src/engine/orchestrator/orchestratorTypes.ts`
- Test: `src/renderer/src/engine/__tests__/orchestratorTypes.test.ts`

**Interfaces:**
- Produces: `HVACDesignPhase`, `HVACDesignPhaseContract`, `DesignDecisionLog`, `OptimizationAction`, `HVACDesignExecution`, `HVACDesignArtifacts`, `HVACDesignResult`.

- [ ] **Step 1: Write the failing unit test for types and contracts**

```typescript
// src/renderer/src/engine/__tests__/orchestratorTypes.test.ts
import { describe, it, expect } from 'vitest';
import { HVACDesignPhase, createEmptyDesignArtifacts } from '../orchestrator/orchestratorTypes';

describe('Orchestrator Types', () => {
  it('should define all 19 phases of the HVAC design pipeline', () => {
    expect(HVACDesignPhase.INPUT_ANALYSIS).toBe('INPUT_ANALYSIS');
    expect(HVACDesignPhase.FINAL_VALIDATION).toBe('FINAL_VALIDATION');
    expect(HVACDesignPhase.OPTIMIZATION).toBe('OPTIMIZATION');
    expect(HVACDesignPhase.COMPLETE).toBe('COMPLETE');
  });

  it('should create default empty artifacts container', () => {
    const artifacts = createEmptyDesignArtifacts();
    expect(artifacts.zones).toEqual([]);
    expect(artifacts.terminals).toEqual([]);
    expect(artifacts.ductNetwork).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/engine/__tests__/orchestratorTypes.test.ts`
Expected: FAIL (Cannot find module)

- [ ] **Step 3: Implement `orchestratorTypes.ts`**

```typescript
// src/renderer/src/engine/orchestrator/orchestratorTypes.ts
import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { SteppedDuctSection } from '../ducts/steppedDuctRouter';
import { MasterValidationReport } from '../validation/hvacValidator';
import { SelectedEquipmentResult } from '../systemArchitecture/equipmentSelector';
import { StandardsProfile } from '../standards/designStandards';

export enum HVACDesignPhase {
  INPUT_ANALYSIS = 'INPUT_ANALYSIS',
  ZONE_VALIDATION = 'ZONE_VALIDATION',
  LOAD_ANALYSIS = 'LOAD_ANALYSIS',
  AIRFLOW_CALCULATION = 'AIRFLOW_CALCULATION',
  SYSTEM_SELECTION = 'SYSTEM_SELECTION',
  EQUIPMENT_SELECTION = 'EQUIPMENT_SELECTION',
  AIR_DISTRIBUTION = 'AIR_DISTRIBUTION',
  TERMINAL_SELECTION = 'TERMINAL_SELECTION',
  TERMINAL_PLACEMENT = 'TERMINAL_PLACEMENT',
  DUCT_TOPOLOGY = 'DUCT_TOPOLOGY',
  DUCT_ROUTING = 'DUCT_ROUTING',
  DUCT_SIZING = 'DUCT_SIZING',
  PRESSURE_ANALYSIS = 'PRESSURE_ANALYSIS',
  ACOUSTIC_VALIDATION = 'ACOUSTIC_VALIDATION',
  COMFORT_VALIDATION = 'COMFORT_VALIDATION',
  FINAL_VALIDATION = 'FINAL_VALIDATION',
  OPTIMIZATION = 'OPTIMIZATION',
  COMPLETE = 'COMPLETE',
  FAILED = 'FAILED'
}

export interface PhaseValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface HVACDesignContext {
  projectId: string;
  units: 'imperial' | 'metric';
  profile: StandardsProfile;
  spaceNcLimit: number;
  coverageTargetPercent: number;
  optimizationWeights?: Record<string, number>;
}

export interface DesignDecisionLog {
  id: string;
  phase: HVACDesignPhase;
  decisionType:
    | 'SYSTEM_SELECTION'
    | 'EQUIPMENT_SELECTION'
    | 'DIFFUSER_SELECTION'
    | 'DIFFUSER_PLACEMENT'
    | 'DUCT_ROUTE'
    | 'DUCT_SIZE'
    | 'OPTIMIZATION';
  inputs: Record<string, unknown>;
  constraintsApplied: string[];
  engineeringRulesApplied: string[];
  candidatesEvaluated?: Array<{ id: string; name: string; score: number; details: Record<string, unknown> }>;
  selectedCandidate: string;
  rejectionReasons?: string[];
  deterministicEngine: string;
  reasonForSelection: string;
  validationResult?: 'PASS' | 'WARNING' | 'FAIL';
  timestamp: number;
}

export interface OptimizationAction {
  id: string;
  iteration: number;
  failureCategory:
    | 'CAPACITY'
    | 'AIRFLOW'
    | 'COVERAGE'
    | 'THROW'
    | 'NOISE'
    | 'VELOCITY'
    | 'PRESSURE'
    | 'COMFORT'
    | 'GEOMETRY';
  affectedZones: string[];
  affectedComponents: string[];
  restartPhase: HVACDesignPhase;
  actionType: string;
  beforeValues: Record<string, unknown>;
  afterValues: Record<string, unknown>;
  expectedImprovement: string;
  actualValidationResult?: 'PASS' | 'WARNING' | 'FAIL';
}

export interface HVACDesignArtifacts {
  zones: EquipmentServiceZone[];
  loads: Record<string, { sensibleBtu: number; latentBtu: number; totalBtu: number; areaSqFt: number }>;
  airflows: Record<string, { supplyCfm: number; returnCfm: number; outdoorAirCfm: number }>;
  selectedEquipment: Record<string, SelectedEquipmentResult>;
  terminals: CoordinatedAirTerminal[];
  returnGrilles: CoordinatedAirTerminal[];
  ductNetwork: SteppedDuctSection[];
  returnDuctNetwork?: SteppedDuctSection[];
  validationReport?: MasterValidationReport;
}

export function createEmptyDesignArtifacts(): HVACDesignArtifacts {
  return {
    zones: [],
    loads: {},
    airflows: {},
    selectedEquipment: {},
    terminals: [],
    returnGrilles: [],
    ductNetwork: []
  };
}

export interface HVACDesignResult {
  status: 'PASS' | 'WARNING' | 'FAIL';
  artifacts: HVACDesignArtifacts;
  validationReport: MasterValidationReport;
  optimizationHistory: OptimizationAction[];
  decisionLog: DesignDecisionLog[];
  executionSummary: {
    totalDurationMs: number;
    iterationsRun: number;
    phasesExecuted: HVACDesignPhase[];
    initialPassStatus: 'PASS' | 'WARNING' | 'FAIL';
    finalPassStatus: 'PASS' | 'WARNING' | 'FAIL';
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/engine/__tests__/orchestratorTypes.test.ts`
Expected: PASS

---

### Task 2: Engineering Adapters for Existing Modules

**Files:**
- Create: `src/renderer/src/engine/adapters/zoningAdapter.ts`
- Create: `src/renderer/src/engine/adapters/loadAirflowAdapter.ts`
- Create: `src/renderer/src/engine/adapters/equipmentAdapter.ts`
- Create: `src/renderer/src/engine/adapters/terminalAdapter.ts`
- Create: `src/renderer/src/engine/adapters/ductAdapter.ts`
- Create: `src/renderer/src/engine/adapters/validationAdapter.ts`
- Test: `src/renderer/src/engine/__tests__/orchestratorAdapters.test.ts`

**Interfaces:**
- Consumes: Existing engines in `zoning/`, `loadCalc.ts`, `systemArchitecture/`, `diffuserPlacer.ts`, `terminals/`, `ducts/`, `validation/`.
- Produces: Normalized adapter calls for the orchestrator phases.

- [ ] **Step 1: Write adapter test suite**

```typescript
// src/renderer/src/engine/__tests__/orchestratorAdapters.test.ts
import { describe, it, expect } from 'vitest';
import { adaptZoneGeometry } from '../adapters/zoningAdapter';
import { adaptCalculateLoadAndAirflow } from '../adapters/loadAirflowAdapter';
import { adaptSelectEquipment } from '../adapters/equipmentAdapter';
import { adaptPlaceTerminals } from '../adapters/terminalAdapter';
import { adaptRouteAndSizeDucts } from '../adapters/ductAdapter';
import { adaptValidateHvacDesign } from '../adapters/validationAdapter';

describe('Orchestrator Adapters', () => {
  const samplePoints = [0, 0, 400, 0, 400, 300, 0, 300]; // 20ft x 15ft approx

  it('should validate and partition zone geometry', () => {
    const res = adaptZoneGeometry('Room 1', samplePoints, 10);
    expect(res.valid).toBe(true);
    expect(res.areaSqFt).toBeGreaterThan(0);
  });

  it('should calculate load and airflow using standard heat transfer rates', () => {
    const load = adaptCalculateLoadAndAirflow(400, 10, 2);
    expect(load.totalBtu).toBeGreaterThan(5000);
    expect(load.supplyCfm).toBeGreaterThan(200);
  });

  it('should select equipment from catalog meeting load', () => {
    const eq = adaptSelectEquipment(500, 15000, 'concealed');
    expect(eq).not.toBeNull();
    expect(eq?.supplyCfm).toBeGreaterThanOrEqual(450);
  });

  it('should place terminals and route stepped ducts', () => {
    const terminals = adaptPlaceTerminals(samplePoints, 500, 30, 95);
    expect(terminals.length).toBeGreaterThan(0);

    const zone = {
      id: 'z1', unitTag: 'ACU-1', designControlMode: 'ai' as const, equipmentModel: 'Model-1',
      coolingSource: 'dx' as const, equipmentType: 'concealed-split' as const, nominalTonnage: 1.5,
      actualCapacityBtu: 18000, supplyCfm: 500, returnCfm: 500, outdoorAirCfm: 50,
      outdoorAirConnectionApproved: true, espInWg: 0.4,
      equipmentPosition: { x: 50, y: 50, rotation: 0, wallSide: 'ceiling' as const },
      serviceAreaPolygon: samplePoints, sensibleLoadBtu: 14000, latentLoadBtu: 2000,
      totalLoadBtu: 16000, targetNc: 30, pressureBudgetInWg: { supplyDuct: 0.1, returnDuct: 0.05, terminals: 0.05, fittings: 0.05, totalAvailable: 0.4 },
      isUserOverridden: false
    };

    const ducts = adaptRouteAndSizeDucts(zone, terminals);
    expect(ducts.length).toBeGreaterThan(0);

    const report = adaptValidateHvacDesign({
      roomName: 'Room 1', roomPolygon: samplePoints, requiredRoomCfm: 500, designLoadBtu: 16000,
      zones: [zone], terminals, ducts
    });
    expect(report.points.length).toBeGreaterThanOrEqual(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/engine/__tests__/orchestratorAdapters.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement adapter files**
  - Implement `zoningAdapter.ts`, `loadAirflowAdapter.ts`, `equipmentAdapter.ts`, `terminalAdapter.ts`, `ductAdapter.ts`, `validationAdapter.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/engine/__tests__/orchestratorAdapters.test.ts`
Expected: PASS

---

### Task 3: Live State Machine & Event Tracking

**Files:**
- Create: `src/renderer/src/engine/orchestrator/designStateMachine.ts`
- Test: `src/renderer/src/engine/__tests__/designStateMachine.test.ts`

**Interfaces:**
- Produces: `DesignStateMachine` with transitions: `transitionTo(phase)`, `recordWarning(msg)`, `recordError(msg)`, `setIteration(n)`, `subscribe(listener)`.

- [ ] **Step 1: Write State Machine tests**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `designStateMachine.ts`**
- [ ] **Step 4: Run test to verify it passes**

---

### Task 4: Linear Workflow Coordinator & Phase Execution

**Files:**
- Create: `src/renderer/src/engine/orchestrator/hvacDesignWorkflow.ts`
- Test: `src/renderer/src/engine/__tests__/hvacDesignWorkflow.test.ts`

**Interfaces:**
- Consumes: Adapters, `orchestratorTypes.ts`, `designStateMachine.ts`.
- Produces: `executeDesignWorkflow(zonesInput, context, stateMachine, decisionLogger, startPhase?, artifacts?)`.

- [ ] **Step 1: Write failing workflow execution test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `hvacDesignWorkflow.ts`**
- [ ] **Step 4: Run test to verify it passes**

---

### Task 5: Failure-Aware Optimization Loop

**Files:**
- Create: `src/renderer/src/engine/orchestrator/optimizationLoop.ts`
- Test: `src/renderer/src/engine/__tests__/optimizationLoop.test.ts`

**Interfaces:**
- Consumes: `MasterValidationReport`, `HVACDesignArtifacts`, `DesignDecisionLog`.
- Produces: `analyzeFailuresAndDetermineActions(report, artifacts, iteration)` returning `OptimizationAction[]` and earliest restart phase.

- [ ] **Step 1: Write test verifying that NC failure restarts at `TERMINAL_SELECTION` and ESP failure restarts at `DUCT_SIZING`**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `optimizationLoop.ts`**
- [ ] **Step 4: Run test to verify it passes**

---

### Task 6: Dependency-Graph Partial Recalculation Engine

**Files:**
- Create: `src/renderer/src/engine/orchestrator/partialRecalculationEngine.ts`
- Test: `src/renderer/src/engine/__tests__/partialRecalculationEngine.test.ts`

**Interfaces:**
- Produces: `recalculatePartialDesign(existingResult, modification, context)` updating only affected zones/ducts.

- [ ] **Step 1: Write test verifying that moving a diffuser only recalculates that zone's throw & runout ducts**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `partialRecalculationEngine.ts`**
- [ ] **Step 4: Run test to verify it passes**

---

### Task 7: Master HVAC Design Orchestrator (`autoDesignHVAC`)

**Files:**
- Create: `src/renderer/src/engine/orchestrator/hvacDesignOrchestrator.ts`
- Test: `src/renderer/src/engine/__tests__/hvacDesignOrchestrator.test.ts`

**Interfaces:**
- Produces: `autoDesignHVAC(projectInput, options)` -> `Promise<HVACDesignResult>`.

- [ ] **Step 1: Write end-to-end orchestrator test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `hvacDesignOrchestrator.ts`**
- [ ] **Step 4: Run test to verify it passes**

---

### Task 8: Acceptance Scenarios (SC-01 to SC-10) & Full Regression Suite

**Files:**
- Create: `src/renderer/src/engine/__tests__/hvacOrchestratorAcceptance.test.ts`

- [ ] **Step 1: Implement all 10 test scenarios (SC-01 to SC-10)**
- [ ] **Step 2: Run `npx vitest run` across the entire engine test suite (all 45+ test files)**
- [ ] **Step 3: Verify all tests pass with 0 regressions**
