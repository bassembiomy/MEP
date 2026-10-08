# AC System Optimizer Studio Design Specification

## Overview
This specification details the end-to-end algorithmic pipeline in Optimizer Studio for automated AC system design. The workflow reads zone spatial boundaries, queries the equipment database to select the lowest-cost equipment (FCU, ACU/Packaged DX, or AHU based on user toggles), determines the minimal diffuser layout achieving $\ge 98\%$ geometric room coverage within space Noise Criteria (NC) limits, and computes telescopic duct network sizing with acoustic and velocity constraints.

---

## 1. Algorithmic Pipeline Stages

### Stage 1: Zone Boundary & Load Ingestion
- **Spatial Geometry**: Ingests the 2D polygon vertices of the selected zone. Computes accurate floor area ($ft^2$ or $m^2$), aspect ratio ($W/L$), centroid, and bounding box.
- **Cooling/Heating Demand**: Calculates total cooling load ($Btu/h$ / Tons), sensible load, and required supply airflow ($CFM_{design}$).
- **Acoustic Target**: Extracts the zone's design Noise Criterion ($NC_{space}$, default $NC \le 30$ for standard commercial/office, $NC \le 25$ for quiet spaces).

### Stage 2: Lowest-Cost Equipment Selection (FCU / ACU / AHU)
- **User Selection Toggles**: Respects user-filtered equipment families (`fcu`, `packaged`/`acu`, `ahu`, `concealed`).
- **Database Query**: Filters loaded equipment catalog (`STANDARD_EQUIPMENT_CATALOG` and custom user databases) for models meeting or exceeding the thermal capacity and design CFM.
- **Cost Ranking**: Evaluates total initial capital cost:
  $$\text{Total Cost Index} = \text{Unit Cost Index} \times \text{Quantity}$$
  Selects the configuration with the minimum total cost index that satisfies all thermal and fan static pressure requirements.
- **Static Pressure Validation**: Validates that the unit's maximum rated ESP is sufficient to overcome downstream network losses.

### Stage 3: Minimal Diffuser Count with ≥98% Room Coverage & Noise Gate
- **Objective**: Use the minimum number of diffusers ($N \ge 1$) to achieve $\ge 98\%$ room coverage without violating $NC_{diffuser} \le NC_{space}$.
- **Iterative Search**:
  1. Initialize terminal count $N = 1$.
  2. Compute airflow per terminal: $CFM_{term} = CFM_{total} / N$.
  3. Query diffuser catalog database for models matching $CFM_{term}$.
  4. Filter by acoustic compliance: $NC_{model} \le NC_{space}$.
  5. Compute spatial throw coverage across the room polygon using catalog $T_{50}$ throw distance.
  6. If coverage $< 98\%$:
     - **Step A**: Test if selecting a larger face/neck size diffuser model from the database expands throw to meet $\ge 98\%$ coverage while maintaining $NC \le NC_{space}$.
     - **Step B**: If no larger model achieves $\ge 98\%$ coverage within noise limits, increment diffuser count $N \to N + 1$ and repeat.
  7. Generate optimal coordinates using Lloyd's centroidal relaxation or orthogonal grid layout to ensure balanced spatial coverage without perimeter collisions.

### Stage 4: Telescopic Duct Distribution & Acoustic Reducing
- **Trunk & Branch Routing**: Routes an orthogonal main supply duct trunk through the zone centerline, with perpendicular runouts connecting to each diffuser.
- **Downstream CFM-Based Sizing**:
  - Traverses the trunk from the indoor unit outlet outwards.
  - At each branch junction, subtracts the branch CFM from the total downstream CFM.
  - Calculates reduced rectangular duct cross-section ($W \times H$) in 2-inch standard increments using the Equal Friction / Velocity Reduction method.
- **Velocity & Noise Constraints**:
  - Main trunk velocity constrained to $900 - 1200\text{ FPM}$.
  - Branch duct velocity constrained to $600 - 800\text{ FPM}$.
  - Regenerated aerodynamic noise in duct transitions and fittings verified against space NC limits.

---

## 2. Component Architecture & Affected Files

| Component / Module | Path | Responsibility |
| :--- | :--- | :--- |
| **System Designer** | `src/renderer/src/engine/systemDesigner.ts` | Multi-objective ranking prioritizing lowest-cost equipment selection based on active user toggles; integrates 98% coverage search. |
| **Diffuser Placer** | `src/renderer/src/engine/diffuserPlacer.ts` | Minimal-diffuser iterative search loop optimizing model size vs. count to achieve $\ge 98\%$ coverage and $NC \le NC_{space}$. |
| **Spatial Planner** | `src/renderer/src/engine/spatialPlanner.ts` | Generates telescopic duct step-down reductions based on remaining downstream CFM at each branch takeoff. |
| **Duct Sizing & Acoustics** | `src/renderer/src/engine/ductSizer.ts` & `acousticDuctEngine.ts` | Sizes reduced duct sections with standard gauge lookups, velocity limits, and in-duct sound attenuation checks. |
| **Optimizer Studio UI** | `src/renderer/src/panels/OptimizerStudioPanel.tsx` | UI checkboxes for FCU, ACU, AHU, and visual badges for coverage percentage and acoustic compliance. |

---

## 3. Verification & Testing Plan

### Automated Unit Tests
- **Equipment Cost Ranking**: Test verifying that among eligible FCU, ACU, and AHU units, the candidate with the lowest total cost index is ranked #1 for cost.
- **Minimal Diffuser 98% Coverage**: Test verifying that starting from $N=1$, the optimizer attempts larger diffuser sizes before incrementing $N$, successfully hitting $\ge 98\%$ coverage without exceeding the NC limit.
- **Telescopic Duct Reduction**: Test verifying that duct segments decrease in size ($W \times H$) along the trunk as branch flows are subtracted, with all velocities and regenerated noise compliant with standards.
- **Execution Command**: `npm run test` or `npx vitest run src/renderer/src/engine/__tests__/`
