# CAD Air Distribution Visualization & Universal HVAC Catalogs Design Spec

## 1. Overview & Objective
This specification defines the comprehensive expansion of HVAC equipment catalogs (AHU, Rooftop Package Units, ACU / DX Split Systems, Ducted FCU, VRF, Chilled Water, and DOAS Louvers) and the rich 2D CAD visual representation of all air-distribution components on the interactive canvas (`FloorPlanCanvas.tsx`).

Every supply diffuser, return grille, duct branch, DOAS connection, and HVAC unit will be assigned directly to the CAD workspace with real-time inline engineering callout badges (CFM, duct dimensions, velocity in FPM, NC noise levels, and model tags).

---

## 2. Universal Equipment Catalog Expansion

### 2.1 Catalog Ranges & Categories (`src/renderer/src/engine/hvacCatalogs.ts`)
The standard equipment catalog will be expanded to support any HVAC design type across residential, commercial, industrial, and institutional projects:

1. **Central Air Handling Units (AHU - Chilled Water & DX)**:
   - **Nominal Capacity**: 3 to 60 Tons (36,000 to 720,000 BTU/h).
   - **Airflow Range**: 1,000 CFM to 20,000+ CFM.
   - **ESP Capability**: 0.75" to 2.50" w.g.
   - **Modular Internal Footprint**: Mixing plenum, 2" pre-filter + 4" final filter rack, chilled water / DX cooling coil, and centrifugal/plug supply blower fan.

2. **Rooftop & Package Units (RTU)**:
   - **Nominal Capacity**: 2 to 30 Tons (24,000 to 360,000 BTU/h).
   - **Airflow Range**: 800 CFM to 12,000 CFM.
   - **ESP Capability**: 0.50" to 1.50" w.g.
   - **Footprint**: Dual scroll compressors, condenser fan deck, supply and return drop collars.

3. **ACU / DX Split Concealed Ducted Systems**:
   - **Nominal Capacity**: 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.5, and 10.0 Tons (18,000 to 120,000 BTU/h).
   - **Airflow Range**: 600 CFM to 4,000 CFM.
   - **ESP Capability**: 0.30" to 0.80" w.g.
   - **Footprint**: Low/medium-profile indoor evaporator unit paired with outdoor condensing unit (ODU / ACU).

4. **Ducted Fan Coil Units (FCU) & VRF Indoor Units**:
   - **Airflow Range**: 200 CFM to 2,400 CFM.
   - **ESP Capability**: 0.20" to 0.60" w.g.

5. **DOAS Intake Louvers & Terminals**:
   - **Airflow Range**: 200 CFM to 8,000 CFM.
   - **Free Area %**: 45% to 58%.
   - **Water Penetration Sizing**: Max face velocity 500 FPM.

---

## 3. CAD Visual Representation & Annotation System

### 3.1 Stepped Duct Segments & Progressive Branches
- **Geometry**: Rendered with physical double-line walls according to width ($W\text{ in}$) converted to CAD scale, plus a dashed centerline axis.
- **Color Coding**:
  - Supply Trunk & Branches: Deep Electric Blue (`#2563eb` / `#3b82f6`) with fill opacity `0.22`.
  - Return Duct & Plenum: Slate Purple / Grey (`#64748b` / `#7c3aed`) with fill opacity `0.22`.
  - DOAS Fresh Air Duct: Forest Emerald (`#059669` / `#10b981`).
- **Directional Chevrons**: Forward-facing flow arrows positioned along the duct centerline.
- **Centerline Integrated Badge**:
  - High-contrast rounded pill badge displaying:
    $$\boxed{\textbf{Size (e.g. 24"}\times\textbf{10")}\ \bullet\ \mathbf{1,345\text{ CFM}}\ \bullet\ \mathbf{807\text{ FPM}}}$$
  - For return ducts:
    $$\boxed{\textbf{Size (e.g. 20"}\times\textbf{10")}\ \bullet\ \mathbf{1,020\text{ CFM}}\ \bullet\ \mathbf{734\text{ FPM}}}$$

### 3.2 Supply Diffusers
- **Graphic**: 4-way square diffuser symbol with center circle and 4 diagonal guide vanes.
- **Throw Envelope**: Dashed circular throw contour representing calculated $T_{50}$ radius in feet, visible at LOD 2+.
- **Multi-Line Tag**:
  - Top Line: Diffuser ID and Neck/Face Size (e.g. `CD-1 (12"x12")`).
  - Bottom Line: Individual Terminal Airflow & Noise (e.g. `340 CFM • NC 28`).

### 3.3 Return Air Grilles
- **Graphic**: Rectangular grille box with standard MEP single diagonal slash line and inward airflow chevrons.
- **Multi-Line Tag**:
  - Top Line: Return Grille ID and Size (e.g. `RG-1 (24"x12")`).
  - Bottom Line: Individual Return Airflow (e.g. `680 CFM`).

### 3.4 Equipment Graphics & Connections
- **AHU**: Detailed multi-compartment graphic showing intake mixing plenum, filter zig-zag, cooling coil rows, and blower scroll.
- **RTU / Package Unit**: Packaged casing with dual fan circles and supply/return stubs.
- **DX Split / ACU**: Indoor evaporator unit + outdoor condensing unit with orthogonal copper refrigerant line-set (`#f97316`), isolator valve symbol, and yellow engineering callout tag.
- **DOAS Louver**: Wall-mounted intake louver symbol with green outdoor air supply runout.

---

## 4. Engine-to-Store Synchronization

### 4.1 Deployment to CAD Workspace
- When the AI Air Distribution engine executes (or user selects "Apply AI Air Distribution to CAD" in `AirDistributionSchedulePanel.tsx`), the engine outputs will be mapped and committed to the `projectStore.zones`:
  - `zone.diffusers`: Populated with all supply diffusers and return grilles (with `cfm`, `size`, `type`, `throwT50Ft`, `actualNc`).
  - `zone.ducts`: Populated with all supply and return duct segments (with `points`, `widthIn`, `heightIn`, `cfm`, `sizeLabel`, `velocityFpm`, `type`).
  - `zone.unitPos` & `zone.outdoorUnitPos`: Populated with equipment coordinates and model tags (`catalogModel`, `catalogQty`, `catalogEsp`).

### 4.2 Interactive Drag & Recalculation
- All diffusers, return grilles, and indoor/outdoor units can be dragged interactively on the CAD canvas.
- Moving diffusers or equipment triggers immediate visual connector updates and recalculation of branch airflow.

---

## 5. Verification Plan
- **Unit Tests**:
  - Verify all new equipment models in `hvacCatalogs.ts` for valid capacities, CFMs, fan tables, and ESPs.
  - Verify `selectEquipmentForLoad` selects appropriate models for small, medium, and heavy loads across all system types (AHU, RTU, Concealed Split, FCU, VRF).
  - Verify CAD sync data structures in `projectStore.ts` and `airDistributionEngine.ts`.
- **Canvas Rendering Tests**:
  - Verify inline badges render accurately without visual clipping on various zoom scales.
- **Integration Tests**:
  - Verify end-to-end air distribution pipeline correctly outputs and populates CAD elements with matching schedule values.
