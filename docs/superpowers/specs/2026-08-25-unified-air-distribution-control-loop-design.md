# Unified HVAC Air Distribution Closed-Loop Optimization Engine Specification

## 1. Overview and Problem Statement
In HVAC air distribution design, independent or uncoordinated calculations between equipment capacity (ACU / FCU / AHU), terminal count & CFM apportionment, room noise criteria (NC), duct sizing, and spatial layout lead to engineering inconsistencies:
- Diffusers operating outside catalog performance envelopes (excessive neck velocity causing draft/noise, or under-throw stagnation).
- Fan external static pressure (ESP) mismatch caused by unoptimized duct friction and dynamic fitting losses.
- Single high-tonnage units placed in elongated or multi-wing zones leading to excessive duct runs and high noise levels.

This specification defines a **Physics-Informed Closed-Loop Optimization Controller** that couples equipment partitioning, diffuser selection, CFM balancing, acoustic constraints, and duct sizing into an intelligent iterative feedback control loop.

---

## 2. Mathematical Formulation & Control Loop Architecture

### 2.1 State Input ($\mathbf{S}$)
- **Zone Polygon ($P$)**: 2D boundary vertices, Area ($A$, sq.ft), Aspect ratio, Characteristic lengths.
- **Thermal & Airflow Requirements**: Total Load $Q_{btu}$ (Btu/h), Total Supply Airflow $V_{total}$ (CFM).
- **Acoustic Design Target**: Space Noise Criteria $NC_{target}$ (e.g., NC 25–40 based on ASHRAE space type).
- **Equipment & Catalog Constraints**: Available ACU/FCU catalog items with rated ESP ($ESP_{rated}$) and diffuser performance tables.

### 2.2 Control Variables ($\mathbf{u}$)
- **$K_{acu}$**: Number of equipment units (1 to $K_{max}$) and their capacity split.
- **$N_{diff}$**: Number of supply diffusers and return grilles.
- **$\{ (x_i, y_i, CFM_i, Model_i) \}_{i=1}^{N_{diff}}$**: Spatial coordinates, air distribution flow, and catalog models.
- **$\{ W_j, H_j, V_j \}_{j=1}^{M}$**: Width, height, and air velocity for duct trunks, branches, and runouts.

### 2.3 Closed-Loop Loss / Objective Function
The controller minimizes the multi-objective loss function $L(\mathbf{u})$:

$$L(\mathbf{u}) = w_{cov} L_{cov} + w_{nc} L_{nc} + w_{esp} L_{esp} + w_{cfm} L_{cfm} + w_{geom} L_{geom}$$

- **Coverage Loss ($L_{cov}$)**:
  $$L_{cov} = \max(0, 0.95 - CoverageRatio)^2$$
- **Acoustic Loss ($L_{nc}$)**:
  $$L_{nc} = \sum_{i=1}^{N_{diff}} \max(0, NC_{diff, i} - NC_{target})^2 + \sum_{j=1}^{M} \max(0, NC_{duct, j} - NC_{target})^2$$
- **Static Pressure Loss ($L_{esp}$)**:
  $$L_{esp} = \max(0, \Delta P_{total} - ESP_{rated})^2$$
- **CFM Catalog Band Loss ($L_{cfm}$)**:
  $$L_{cfm} = \sum_{i=1}^{N_{diff}} \left( \max(0, CFM_{min, i} - CFM_i)^2 + \max(0, CFM_i - CFM_{max, i})^2 \right)$$
- **Throw Comfort Ratio Loss ($L_{geom}$)**:
  $$L_{geom} = \sum_{i=1}^{N_{diff}} \left( \frac{T_{50, i}}{L_{char, i}} - 1.0 \right)^2$$

---

## 3. Subsystem Components & Coordination

### 3.1 ACU / FCU Equipment Partitioning Loop
1. Evaluates zone aspect ratio and total CFM.
2. For zones with $V_{total} > 2000\text{ CFM}$ or aspect ratio $> 2.2:1$, evaluates partitioning into $K \in \{1, 2, 3\}$ units.
3. Subdivides the floor polygon into balanced clusters for each unit, minimizing maximum duct run lengths.

### 3.2 Diffuser Sizing & Catalog Integration
1. Slices $V_{total}$ into $N_{diff}$ balanced terminals ($CFM_i = V_{total} / N_{diff}$).
2. Queries `STANDARD_DIFFUSER_CATALOG` for exact catalog match (face size, neck size, $T_{50}$ throw, pressure drop $\Delta P$, and generated NC).
3. If $NC_{diff} > NC_{target}$, automatically increments $N_{diff}$ to reduce per-terminal velocity until acoustic compliance is met.

### 3.3 Spatial Relaxation & Return Air Separation
1. Applies Lloyd's Centroidal Voronoi Relaxation with Furthest Point Sampling to guarantee uniform spatial coverage.
2. Enforces minimum terminal separation distance ($d_{min} \ge 6\text{ ft}$) to prevent colliding throw jets.
3. Places dedicated return air grilles positioned at least $8\text{ ft}$ away from supply diffusers to eliminate air short-circuiting.

### 3.4 Duct Tree Sizing & ESP Calculation
1. Routes duct network connecting ACU/FCU outlets to diffusers.
2. Applies Equal Friction sizing with ASHRAE acoustic velocity caps (Main Trunk $\le 1100\text{ FPM}$, Branches $\le 800\text{ FPM}$, Runouts $\le 600\text{ FPM}$).
3. Calculates total pressure drop including straight duct friction and dynamic fitting losses (elbows, transitions, boots, dampers).
4. Verifies $\Delta P_{total} \le ESP_{rated}$.

---

## 4. Software Architecture & Implementation Files

### 4.1 Modules
1. **`src/renderer/src/engine/neuralControlLoopEngine.ts` (New)**:
   - Contains `optimizeUnifiedAirDistributionSystem(...)`.
   - Iterative feedback loop orchestrating equipment partitioning, diffuser placement, acoustic checks, duct routing, and loss evaluation.
2. **`src/renderer/src/engine/diffuserPlacer.ts` (Update)**:
   - Enhances catalog selection with direct acoustic penalty evaluation and multi-unit cluster support.
3. **`src/renderer/src/engine/systemDesigner.ts` (Update)**:
   - Integrates the closed-loop optimization results into candidate generation and ranking.
4. **`src/renderer/src/panels/OptimizerStudioPanel.tsx` (Update)**:
   - Shows feedback trace details (loss convergence, acoustic safety margins, ESP headroom, coverage %).

---

## 5. Verification and Acceptance Criteria
- **CFM Conservation**: Total sum of diffuser CFM exactly matches room required CFM without rounding leaks.
- **Acoustic Compliance**: All selected terminals and duct velocities strictly satisfy $NC \le NC_{target}$.
- **Catalog Validity**: Diffusers and equipment use real manufacturer models with zero fabricated performance values.
- **ESP Guarantee**: Total static pressure drop $\Delta P_{total} \le ESP_{rated}$.
- **Coverage**: Zone throw coverage achieves $\ge 95\%$ across standard and complex polygon shapes.
- **Unit Tests**: Full automated test suite verifying convergence across rectangular, L-shaped, and high-CFM spaces.
