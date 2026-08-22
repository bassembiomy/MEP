# AI HVAC Air Distribution and Ducted System Design Engine Specification

## 1. Executive Summary & Purpose
The **Deterministic AI HVAC Air Distribution and Ducted System Design Engine** automatically engineers, sizes, coordinates, and places complete ducted air distribution systems for conditioned spaces.

Rather than stopping at room cooling load or gross CFM calculations, the engine deterministically generates:
1. **HVAC Equipment Selection & Multi-Unit Optimization**: Proposing single vs. multi-unit configurations scored against comprehensive engineering criteria with an explainable Design Decision Log.
2. **Dynamic Service Zone Partitioning**: Solar-, load-, and geometry-weighted service zones for multi-unit spaces.
3. **Air Terminal Placement**: Supply diffusers and return grilles positioned and verified against catalog throw data, overlap, occupied zone velocity, and anti-short-circuit rules.
4. **Stepped Supply & Return Duct Networks**: Progressive CFM decrements at every branch takeoff with SMACNA aerodynamic sizing and upfront static pressure budgeting.
5. **Dedicated Outdoor Air / Fresh Air Subsystems**: Sized, routed, and balanced ventilation networks with equipment compatibility checks and louver free-area sizing.
6. **Comprehensive 9-Point Engineering Validation Suite**: Airflow balance tolerances, Room CFM adherence, System Air Mass balance, Velocity limits, Acoustic compliance, Throw & Comfort, Equipment ESP margins, Derated capacity, and 3D Spatial Coordination.
7. **Interactive UI & 5 Engineering Schedules**: CAD canvas overlay with user overrides (unit count, positions, bay dividers), dependency-based auto-regeneration, and an element design control state (`ai` | `user-modified` | `user-locked`).

---

## 2. Core Architectural Principles

### 2.1 Cooling Source vs. Air Distribution Decoupling
The Air Distribution Engine operates independently of the cooling source:
- **Cooling Source**: DX refrigerant, Chilled Water, Heat Pump, or Hybrid.
- **Air Distribution Equipment**: Concealed Ducted Split, Fan Coil Unit (FCU), Modular AHU, Packaged RTU, Rooftop Package.
- **Air Distribution System**: Supply Duct Network, Return Air System (Ducted or Plenum), Outdoor Air Intake Network, Terminal Devices.

Equipment selection determines available cooling capacity, supply airflow, external static pressure (ESP), outdoor air intake compatibility, and connection geometry. The air distribution engine designs the terminal layouts, duct trees, and fresh air systems based on airflow requirements and pressure budgets.

### 2.2 Configurable Design Standards Layer
Engineering constraints (allowable velocities, friction rates, NC targets, ventilation rates, comfort velocity envelopes) are isolated in a pluggable Standards Layer rather than hardcoded in algorithms:
- `ASHRAE Profile` (ASHRAE Fundamentals, 62.1, 90.1, 55)
- `SMACNA Profile` (SMACNA HVAC Duct Construction Standards)
- `Project-Specific Profile`
- `Custom User Profile`

### 2.3 Element Ownership & Design Control States
To ensure reliable interactive overrides without loss of manual modifications, all primary equipment, terminals, and duct runs maintain an ownership state:
- `ai`: Generated and fully managed by the AI optimization engine. Overwritten during optimization runs.
- `user-modified`: Modified by the designer (e.g. moved position, customized CFM). Downstream dependent elements regenerate automatically, but the element's direct parameters are preserved.
- `user-locked`: Explicitly locked against automatic relocation, resizing, or deletion.

---

## 3. Modular Architecture & Directory Layout

```text
src/renderer/src/engine/
├── airDistributionEngine.ts          # Master orchestration pipeline (10-Phase Pipeline)
│
├── standards/
│   ├── designStandards.ts            # Standard profile definitions (ASHRAE, SMACNA, Custom)
│   ├── acousticRules.ts              # Room NC/RC limits and allowable duct velocities
│   ├── ventilationRules.ts           # ASHRAE 62.1 breathing zone ventilation rates
│   ├── diffuserRules.ts              # Throw ratios, room length factors, terminal velocity limits
│   ├── comfortRules.ts               # Occupied-zone velocity envelopes per activity & draft sensitivity
│   └── ductSizingRules.ts            # Max friction rate, velocity limits, aspect ratios
│
├── systemArchitecture/
│   ├── hvacSystemResolver.ts         # Resolves cooling source and equipment category
│   ├── equipmentSelector.ts          # Queries catalog for compliant models
│   ├── equipmentOptimizer.ts         # Multi-unit evaluation & multi-criteria scoring algorithm
│   └── designDecisionLogger.ts       # Generates human-readable engineering rationale & traces
│
├── zoning/
│   ├── zonePartitioner.ts            # Voronoi/bay partitioning across service boundaries
│   ├── loadDistribution.ts           # Subdivides sensible and latent loads across service bays
│   └── solarLoadWeighting.ts         # Biases airflow towards exterior/glass envelopes
│
├── terminals/
│   ├── terminalPlacer.ts             # Supply diffuser layout generator
│   ├── diffuserSelector.ts           # Catalog matching for neck/face size, throw, and NC
│   ├── returnPlacer.ts               # Return grille placement & anti-short-circuit logic
│   └── airDistributionValidator.ts   # Throw ratio, overlap, and occupied zone velocity checks
│
├── ducts/
│   ├── steppedDuctRouter.ts          # Generates supply trunks with decrementing CFM branches
│   ├── returnDuctRouter.ts           # Routes return ducted networks or plenum paths
│   ├── aerodynamicDuctSizer.ts       # Rectangular/round SMACNA sizing per velocity limits
│   ├── ductPressureCalculator.ts     # Darcy-Weisbach / Colebrook friction loss calculation
│   └── fittingLossCalculator.ts      # Equivalent length and dynamic local loss coefficients (C-factors)
│
├── outdoorAir/
│   ├── outdoorAirCalculator.ts       # Fresh air requirements per room occupancy and area
│   ├── louverSizer.ts                # Louver gross vs. free area sizing per manufacturer data
│   ├── freshAirRouter.ts             # Intake louvers, FA ducting, and equipment connection collars
│   └── ventilationValidator.ts       # Fresh air balance and building pressurization checks
│
├── validation/
│   ├── hvacValidator.ts              # Master 9-point validation aggregator
│   ├── airflowValidator.ts           # Tolerance-based airflow & room CFM matching
│   ├── massBalanceValidator.ts       # Supply + OA = Return + Exhaust + Relief ± Pressurization
│   ├── acousticValidator.ts          # Duct-generated/transmitted noise & terminal NC compliance
│   ├── pressureValidator.ts          # Critical path ESP vs. equipment fan ESP margin
│   ├── comfortValidator.ts           # Comfort criteria & occupied-zone air velocity envelope
│   └── spatialValidator.ts           # 3D clearance, wall penetration, and clash detection
│
└── export/
    ├── exportSchedules.ts            # 5 schedules: Air Distribution, Duct, Diffuser, Equipment, Outdoor Air
    └── exportDesignReport.ts         # PDF/Text engineering calculation report + Decision Log
```

---

## 4. Engineering Data Schemas (`types.ts`)

### 4.1 Design Control Mode
```typescript
export type DesignControlMode = 'ai' | 'user-modified' | 'user-locked';
```

### 4.2 Equipment Service Zone
```typescript
export interface EquipmentServiceZone {
  id: string;
  unitTag: string;                          // e.g. 'FCU-01', 'DSU-01'
  designControlMode: DesignControlMode;
  
  equipmentModel: string;                  // e.g. 'Carrier 40QMK048'
  coolingSource: 'dx' | 'chilled-water' | 'heat-pump' | 'package';
  equipmentType: 'concealed-split' | 'fcu' | 'ahu' | 'rtu' | 'package';
  
  nominalTonnage: number;                  // e.g. 4.0 TR
  actualCapacityBtu: number;               // e.g. 47,005 Btu/h (derated at design conditions)
  
  supplyCfm: number;                       // e.g. 1,345 CFM
  returnCfm: number;                       // e.g. 1,148 CFM
  outdoorAirCfm: number;                   // e.g. 197 CFM
  outdoorAirConnectionApproved: boolean;   // Equipment compatibility flag
  
  espInWg: number;                         // e.g. 0.35 in. w.g.
  
  equipmentPosition: {
    x: number;
    y: number;
    rotation: number;
    wallSide: 'north' | 'south' | 'east' | 'west' | 'ceiling';
  };
  
  serviceAreaPolygon: number[];            // Coordinate array [x1, y1, x2, y2, ...]
  occupiedAreaPolygon?: number[];
  
  sensibleLoadBtu: number;
  latentLoadBtu: number;
  totalLoadBtu: number;
  
  targetNc: number;                        // e.g. NC 30
  targetRc?: number;
  
  maxDuctLengthFt?: number;
  maxAvailableCeilingDepthIn?: number;     // e.g. 14 in.
  
  pressureBudgetInWg: {
    supplyDuct: number;                    // e.g. 0.12 in. w.g.
    returnDuct: number;                    // e.g. 0.06 in. w.g.
    terminals: number;                     // e.g. 0.05 in. w.g.
    fittings: number;                      // e.g. 0.07 in. w.g.
    totalAvailable: number;                // e.g. 0.35 in. w.g.
  };
  
  isUserOverridden: boolean;
}
```

### 4.3 Stepped Duct Section
```typescript
export interface SteppedDuctSection {
  id: string;                              // e.g. 'DS-01'
  unitId: string;
  designControlMode: DesignControlMode;
  systemType: 'supply' | 'return' | 'outdoor-air';
  role: 'main-trunk' | 'branch' | 'runout';
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  airflowCfm: number;                      // Decrements downstream (e.g. 1345 -> 1005 -> 670 -> 335)
  shape: 'rectangular' | 'round';
  widthIn: number;                         // e.g. 18"
  heightIn: number;                        // e.g. 12"
  diameterIn?: number;                     // e.g. 14"
  velocityFpm: number;                     // CFM / Area
  allowableVelocityFpm: number;            // Profile constraint (e.g. 1,000 FPM)
  frictionLossPer100Ft: number;            // in. w.g. / 100 ft
  fittingLossInWg: number;                 // Dynamic local loss
  totalSectionLossInWg: number;
  ncRating: number;
  connectedDiffuserCount: number;
  connectedDiffusers: string[];
  parentDuctId?: string;
  childDuctIds: string[];
}
```

### 4.4 Coordinated Air Terminal
```typescript
export interface CoordinatedAirTerminal {
  id: string;                              // e.g. 'SAD-01', 'RAG-01'
  unitId: string;
  designControlMode: DesignControlMode;
  type: 'supply' | 'return' | 'exhaust' | 'outdoor-intake';
  subtype: '4-way-ceiling' | '2-way' | 'linear-slot' | 'swirl' | 'eggcrate' | 'perforated' | 'sidewall';
  position: { x: number; y: number };
  cfm: number;
  catalogModel: string;
  neckDimension: string;                   // e.g. '10" dia' or '12"x12"'
  faceDimension: string;                   // e.g. '24"x24"' (600x600 mm)
  throwT50Ft: number;
  throwRatio: number;                      // T50 / Characteristic Room Length L
  adjacentOverlapRatio: number;
  occupiedZoneVelocityFpm: number;
  ncRating: number;
  deltaPInWg: number;
  status: 'pass' | 'warning' | 'fail';
}
```

### 4.5 Outdoor Air System & Louver Model
```typescript
export interface IntakeLouverItem {
  id: string;
  manufacturer: string;
  model: string;
  grossWidthIn: number;
  grossHeightIn: number;
  grossAreaSqFt: number;
  freeAreaPercent: number;                 // e.g. 45% - 55%
  freeAreaSqFt: number;                    // Free Area = Gross Area * freeAreaPercent
  designCfm: number;
  freeAreaVelocityFpm: number;             // CFM / Free Area
  maxAllowableFreeAreaVelocityFpm: number; // e.g. 500 FPM (or per water penetration curve)
  pressureDropInWg: number;
  waterPenetrationRatingMph?: number;
}

export interface OutdoorAirSystem {
  id: string;                              // e.g. 'OAS-01'
  designControlMode: DesignControlMode;
  designOutdoorAirCfm: number;             // e.g. 592 CFM
  sourceType: 'direct-intake' | 'fresh-air-fan' | 'fahu' | 'doas';
  louver: IntakeLouverItem;
  connectedUnitIds: string[];              // Connected equipment IDs
  ductSectionIds: string[];
  intakePosition: { x: number; y: number };
  pressureLossInWg: number;
  pressurizationStrategy: 'positive' | 'neutral' | 'negative';
  targetPressurizationCfm: number;
  isBalancedWithExhaust: boolean;
}
```

---

## 5. Ten-Phase Execution Pipeline

### Phase 1: Room Load & Airflow Calculation
- Calculates sensible cooling load $Q_{sens}$ and latent load $Q_{lat}$.
- Calculates required supply airflow: $\text{CFM}_{supply} = \frac{Q_{sens}}{1.08 \times \Delta T_{design}}$.
- Calculates outdoor air ventilation per ASHRAE 62.1: $V_{bz} = R_p \cdot P_z + R_a \cdot A_z$.
- Calculates required return airflow: $\text{CFM}_{return} = \text{CFM}_{supply} - \text{CFM}_{outdoor\_air} \pm \text{Pressurization CFM}$.

### Phase 2: Multi-Unit Optimization & Service Zone Partitioning
- Queries catalog for equipment options: Single-unit, 2-unit, 3-unit, 4-unit combinations.
- Scores candidates using multi-criteria optimization:
  $$\text{Total Score} = S_{cap} + S_{dist} + S_{acoustic} + S_{esp} + S_{duct} + S_{depth} + S_{cost} + S_{redun} - P_{units}$$
- Generates **Design Decision Log** with the engineering rationale.
- Establishes upfront static pressure budget per service bay: $\Delta P_{available} = \text{ESP}_{rated} - \Delta P_{internal}$.
- Partitions room geometry into service bays using solar- and load-weighted Voronoi slicing along available mounting walls.
- Exposes user override hook: Unit count, equipment model, physical location, and bay dividing lines.

### Phase 3: Supply Diffuser Selection & Layout Generation
- Slices service area into diffuser bays based on practical CFM per terminal (e.g. 300–400 CFM).
- Determines characteristic bay length $L$.
- Selects catalog diffuser to achieve target throw $T_{50}$, neck velocity $< V_{limit}$, and $NC \le NC_{target}$.
- Places diffusers on bay centroids avoiding jet collision and ceiling obstruction.

### Phase 4: Return Grille Distribution & Anti-Short-Circuiting
- Selects return devices (eggcrate/perforated grilles or return diffusers).
- Offsets return positions relative to supply diffusers ($D_{return-supply} \ge 0.6 \times T_{50}$) to eliminate short-circuiting.
- Ensures uniform air sweep across the occupied breathing zone.

### Phase 5: Supply Duct Network Routing & Progressive Sizing
- Connects equipment supply collar to main centerline trunk.
- Routes orthogonal branch ducts and final runouts to each supply diffuser.
- Decrements duct airflow at each branch takeoff: $\text{CFM}_{section} = \sum \text{Downstream Diffuser CFMs}$.
- Sizes each section using SMACNA standard increments ($W \times H$ or Diameter) respecting aspect ratio $\le 3:1$ and allowable velocity per acoustic profile.

### Phase 6: Return Duct Network / Plenum Routing
- If ducted return: routes progressive return trunk back to equipment return intake collar.
- If plenum return: verifies ceiling plenum free area, return air velocity $< 400\text{ FPM}$, and intake sound attenuation.

### Phase 7: Dedicated Outdoor Air System & Compatibility Check
- Verifies equipment outdoor-air connection compatibility (mixing box, approved collar, or dedicated FAHU/DOAS).
- Sizes outdoor air intake louver using catalog free-area percentage and water-penetration velocity limits.
- Routes outdoor air duct branches to each compatible unit or mixing box.

### Phase 8: Comprehensive 9-Point Engineering Validation Suite
1. **Supply Airflow Balance**:
   $$\frac{|\sum \text{Terminal Supply CFM} - \text{Equipment Supply CFM}|}{\text{Equipment Supply CFM}} \le \text{Tolerance \% (e.g. 5\%)}$$
2. **Room Airflow Verification**:
   $$|\text{Delivered Room CFM} - \text{Design Room CFM}| \le \text{Configured Tolerance CFM}$$
   Verifies terminal airflow is strictly between catalog $CFM_{min}$ and $CFM_{max}$.
3. **System Air Mass Balance**:
   $$\text{Supply} + \text{Outdoor Air} = \text{Return} + \text{Exhaust} + \text{Relief} \pm \text{Pressurization Airflow}$$
   Verifies target pressure strategy (positive, neutral, negative).
4. **Velocity Compliance Check**:
   $$\text{Actual Duct Velocity} \le \text{Profile Limit (Trunk / Branch / Runout)}$$
5. **Acoustic Compliance Check**:
   - Terminal $NC \le NC_{room\_target}$
   - Equipment sound rating compliance
   - Duct-generated and transmitted noise checks
6. **Throw and Thermal Comfort Check**:
   - Throw ratio $T_{50}/L$ within comfort envelope
   - Diffuser jet collision avoidance
   - Occupied-zone air velocity complies with `ComfortCriteria` (cooling/heating mode limits)
   - Supply-to-return short-circuiting distance checked
7. **Static Pressure / ESP Check**:
   $$\text{Total Critical Path Pressure Loss} + \text{Safety Margin} \le \text{Available Equipment ESP}$$
8. **Equipment Capacity Check**:
   $$\text{Derated Equipment Capacity (ambient, altitude, airflow)} \ge \text{Calculated Design Load}$$
9. **Spatial Coordination & Clash Check**:
   - Ducts do not penetrate unauthorized walls or structural columns
   - Duct depth fits available ceiling plenum clearance
   - Duct aspect ratio $\le 3:1$
   - Terminals avoid light fixtures and ceiling beams
   - Equipment maintenance clearance zones respected

### Phase 9: Multi-Layer Canvas Visualization & Interactive Overrides
- Canvas rendering shall use dedicated CAD layers:
  - **Supply Ductwork** — Cyan, with progressive CFM callouts (`1345 → 1005 → 670 → 335 CFM`).
  - **Supply Diffusers** — Green terminal symbols with diffuser ID and CFM callouts.
  - **Return Grilles / Diffusers** — Purple symbols with return airflow callouts.
  - **Equipment & Collars** — Red/Yellow equipment blocks with supply, return, and outdoor-air connection points and airflow direction.
  - **Fresh Air System** — Orange ducting, outdoor-air louvers, and outdoor-air CFM labels.
- Interactive user edits shall include:
  - Moving equipment.
  - Changing equipment quantity.
  - Repositioning equipment.
  - Dragging service-zone or bay divider boundaries.
  - Changing diffuser locations.
  - Changing return grille locations.
  - Locking selected equipment, terminals, or ducts against automatic regeneration (`user-locked`).
- After a user override, the engine executes **dependency-based scoped recalculation**:
  ```text
  Move Equipment / Service Zone
        ↓
  Reassign Diffusers (preserving user-locked terminals)
        ↓
  Regenerate Supply Duct Tree
        ↓
  Regenerate Return Duct Tree
        ↓
  Resize Affected Ducts
        ↓
  Re-run 9-Point Validation
  ```

### Phase 10: Engineering Schedules & Design Decision Log Export
The application generates 5 comprehensive engineering schedules and an explainable Design Decision Log:

#### 1. Air Distribution Schedule
| Room | Design Load | Required CFM | Delivered CFM | Diffusers | CFM/Diffuser | Return CFM | Status |
| ---- | ----------: | -----------: | ------------: | --------: | -----------: | ---------: | ------ |

#### 2. Duct Schedule
| Duct ID | System | Airflow | Size | Velocity | Pressure Loss | NC Status | Validation |
| ------- | ------ | ------: | ---- | -------: | ------------: | --------- | ---------- |

#### 3. Diffuser Schedule
| Terminal ID | Type | Model | Neck Size | Face Size | CFM | Throw | NC | Status |
| ----------- | ---- | ----- | --------- | --------- | --: | ----: | -: | ------ |

#### 4. Equipment Schedule
| Tag | Model | System Type | Capacity | Supply CFM | Return CFM | ESP | Power | Status |
| --- | ----- | ----------- | -------: | ---------: | ---------: | --: | ----: | ------ |

#### 5. Outdoor Air Schedule
| OA System | Unit/Zone | Required OA CFM | Delivered OA CFM | Louver | Free Area | Face Velocity | Status |
| --------- | --------- | --------------: | ---------------: | ------ | --------: | ------------: | ------ |

#### 6. Design Decision Log
- Traceable summary explaining why specific equipment counts, unit models, duct routes, and terminal counts were selected by the AI, including trade-off comparisons and active design warnings.

---

## 6. Verification & Test Plan

### 6.1 Unit & Algorithmic Tests
- Unit tests for `standards/` profiles verifying fallback limits and tolerance values.
- Algorithmic tests for `zonePartitioner.ts` verifying Voronoi polygon subdivision and solar load weighting.
- Catalog tests for `louverSizer.ts` calculating gross vs. free area and water penetration velocity.
- Test `terminalPlacer.ts` and `airDistributionValidator.ts` against catalog performance curves.
- Test `steppedDuctRouter.ts` and `aerodynamicDuctSizer.ts` with the 4,000 CFM conference hall test case (3 concealed split units, 1,345 CFM each, 4 diffusers per unit @ 335 CFM).
- Master 9-point validation suite test covering all pass/warning/fail triggers.

### 6.2 End-to-End HVAC Design Integration Tests
1. **Small single-unit room**: Direct 1-unit split with 4-way diffuser and return grille.
2. **Large conference hall with 3 units**: 4,000 CFM multi-unit concealed split with progressive CFM reductions ($1345 \to 1005 \to 670 \to 335$).
3. **Room with high solar load on one façade**: Solar-weighted bay slicing allocating higher airflow to the perimeter.
4. **Irregular L-shaped room**: Non-rectangular Voronoi partitioning and branch routing.
5. **Room with beams and lighting obstacles**: Terminal placement clash avoidance.
6. **User override scenario (3 units to 2 units)**: Dynamic downstream recalculation with `user-modified` and `user-locked` preservation.
7. **Insufficient equipment ESP**: Triggering ESP margin warning and proposing duct size enlargement.
8. **Insufficient ceiling depth**: Triggering aspect ratio / flat duct adjustment warnings.
9. **Diffuser throw failure**: Detecting jet collision or under-throw and adjusting terminal count.
10. **Outdoor-air louver sizing failure**: Detecting excessive free-area face velocity.
11. **Equipment catalog fallback**: Proper error handling when no single model satisfies load.
12. **Return-air short-circuit detection**: Detecting and flagging return grille within $0.6 \times T_{50}$ of supply diffuser.
