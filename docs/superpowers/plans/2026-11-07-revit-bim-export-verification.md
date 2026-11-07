# Revit-Ready Deliverables (IFC + Link DWG), HVAC Shop Drawings & Design Verification — Plan

User: "I want all the designs from all the application to be ready to be taken as Revit links for modeling, fully
ready as shop drawings, and verify the HVAC and fire fighting designs."

Revit consumes: **IFC** (Insert ▸ Link IFC → 3D MEP elements with systems, sizes, properties) and **DWG/DXF**
(Insert ▸ Link CAD, "Auto - Origin to Origin" → 2D overlays at true coordinates). So every design gets:
1. IFC4 3D model (per discipline + combined MEP), validated with `scripts/validate_ifc.py` (ifcopenshell schema +
   geometry), 2. a model-space link DXF/DWG per storey (true coordinates, mm, NCS layers, no sheet frame),
3. the existing / new shop-drawing sheets (DXF/DWG), 4. a verification report.

Contract: `src/renderer/src/engine/bim/bimTypes.ts`. Tests (must pass unchanged): `__tests__/bimExport.test.ts` (R1),
`__tests__/hvacShopDrawings.test.ts` (R2), `__tests__/designVerification.test.ts` (R3); plus the existing
`__tests__/deploymentAcceptance.test.ts` must pass (currently fails "Airflow not conserved").

## R1 — BIM core (`engine/bim/`)
- `ifcWriter.ts` `writeIfc(model, { timestamp? })`: ISO-10303-21, FILE_SCHEMA(('IFC4')), IfcProject (mm length unit,
  plane-angle degree? → radians default ok), IfcGeometricRepresentationContext 'Model' 3D + subcontext 'Body',
  IfcSite → IfcBuilding → IfcBuildingStorey per storey (Elevation mm, placement z = elevation), IfcRelAggregates;
  each element: IfcLocalPlacement relative to its storey (z − storey elevation), IfcProductDefinitionShape 'Body'
  'SweptSolid' with IfcExtrudedAreaSolid (segment: circle/rect profile, extruded along its axis: placement at start,
  Axis = direction, RefDirection ⟂; box: rectangle profile w×d extruded h, rotated; cylinder: circle profile extruded
  up), IfcStyledItem with IfcSurfaceStyle colour of its system, IfcPropertySet 'MEP_Design' (IfcPropertySingleValue
  IfcLabel / IfcReal / IfcBoolean) via IfcRelDefinesByProperties, IfcRelContainedInSpatialStructure per storey,
  IfcDistributionSystem per system (PredefinedType) + IfcRelAssignsToGroup + IfcRelServicesBuildings. Element
  PredefinedType / ObjectType as given. Deterministic GlobalIds: 22 chars of the IFC base64 alphabet
  (0-9A-Za-z_$) from a 128-bit hash (e.g. FNV/xmur over `${discipline}|${key}`), unique; all numbers with a decimal
  point; strings escaped per ISO 10303-21 ('' and \X2\ for non-ASCII). Deterministic output for the same timestamp.
- `bimModel.ts`: `mergeBimModels(models, discipline)` (union of storeys by id — same id must have same elevation;
  systems & elements concatenated; keys prefixed by discipline when colliding; warnings concatenated),
  `detectClashes(model, { toleranceMm })`: envelopes = segment capsules (radius = half diagonal for rect) and
  boxes / cylinders as OBB/AABB; pairs of elements from different systems (or a duct vs any pipe), geometry is
  absolute (storeys ignored), AABB pre-filter, clearance = surface distance; report clearance < toleranceMm with the
  closest point; connected elements of the same system (shared end points) are not clashes.
- `fireBim.ts` `fireBimModel(result, placement?)` (spec in the test):
  storeys = building floors (id, name, elevation) ∪ sprinkler / CO2 floors; sprinklers: heads IfcFireSuppressionTerminal
  SPRINKLER cylinder Ø50 × 60 mm whose top = FFL + ceiling − deflector (answers.deflectorBelowCeilingMm ?? 100);
  below-obstruction heads: top = FFL + ceiling − obstruction bottom − deflector, with a vertical drop pipe; pipes
  IfcPipeSegment RIGIDSEGMENT at z = FFL + ceiling − 300 mm, OD from pipeData, properties size/schedule/length/flow;
  system per floor zone ('fire-sprinkler'); zone control valves IfcValve. Standpipes: per riser vertical segments
  bottom→top at placement.standpipes[tag] (default: schematic x = 2000 + 6000·i, y = −3000, warning), hose valves
  IfcValve (name 'Hose valve …', predefinedType FAUCET) at each outlet elevation; express risers when present.
  Pump room: placement.pumpRoom (default origin 0,0 on the lowest floor rotation 0, warning) → room coordinates
  rotated / translated: pumps (IfcPump, box from the equipment rect, height 1.2 × CL height), controllers & others
  (IfcBuildingElementProxy USERDEFINED 'CONTROLPANEL' …), pipes (PipeSegment2D, z = pump CL for suction/discharge/
  jockey/relief/drain? at pad top + 0.2 m for drain, test at high-level pipe), valves (IfcValve by kind:
  os&y-gate GATESTATIC? use GATE; butterfly BUTTERFLY? (IFC4 IfcValveTypeEnum: AIRRELEASE, ANTIVACUUM, CHANGEOVER,
  CHECK, COMMISSIONING, DIVERTING, DRAWOFFCOCK, DOUBLECHECK, DOUBLEREGULATING, FAUCET, FLUSHING, GASCOCK, GASTAP,
  ISOLATING, MIXING, PRESSUREREDUCING, PRESSURERELIEF, REGULATING, SAFETYCUTOFF, STEAMTRAP, STOPCOCK, USERDEFINED,
  NOTDEFINED) — map gate/butterfly → ISOLATING, check → CHECK, relief → PRESSURERELIEF, others USERDEFINED with
  ObjectType), fire water tank IfcTank STORAGE box from TankDesign beside the tank wall. CO2: cylinders IfcTank
  PRESSUREVESSEL cylinders (Ø267 × 1500 mm, name 'CO2 cylinder …') in rows at the storage point, nozzles
  IfcFireSuppressionTerminal USERDEFINED objectType 'CO2NOZZLE', pipes, devices (detectors IfcSensor SMOKESENSOR /
  HEATSENSOR, horns IfcAlarm SIREN, strobes IfcAlarm LIGHT, manual release IfcAlarm MANUALPULLBOX, others proxy).
  Extinguishers: IfcFireSuppressionTerminal USERDEFINED 'FIREEXTINGUISHER' cylinders at placement.extinguisherZones
  [zoneId] (default schematic grid, warning) + (xM, yM)·1000, top at mountingTopMm. Warnings list every schematic
  placement.
- `hvacBim.ts` `hvacBimModel(zones, opts)`: units → mm (imperial: /scale·304.8, metric: /scale·1000); storey from
  opts; ducts: one IfcDuctSegment per polyline leg, rect (widthIn, heightIn) or round (diameterIn), centre-line
  z = FFL + ceiling + 50 mm + h/2; diffusers IfcAirTerminal DIFFUSER (supply / cassette), GRILLE (return / exhaust),
  box from the size label (e.g. 12x12 in) 250 mm high hanging below the ceiling; indoor units IfcUnitaryEquipment
  (by system type: concealed/fcu AIRHANDLER 1200×600×300 above ceiling, cassette 840×840×300, high-wall
  1000×250×300 at FFL + 2400, packaged/ahu ROOFTOPUNIT …), outdoor units IfcUnitaryEquipment SPLITSYSTEM at
  FFL (1000×400×800); systems: supply, return, equipment; properties CFM, size, velocity, NC.
- `modelDxf.ts` `writeModelDxf(model, storeyId)`: AutoCAD R12 (reuse dxfWriter / DrawingBuilder with no sheets),
  $INSUNITS 4, plan projection at true coordinates: pipes single line + size text, ducts double line + size text,
  terminals/devices symbols (circle / box outline) + tag, equipment outlines + tag; NCS layers: FP-SPRK-PIPE,
  FP-SPRK-HEAD, FP-STND-PIPE, FP-STND-VALV, FP-PUMP-EQPM, FP-PUMP-PIPE, FP-CO2-PIPE, FP-CO2-NOZZ, FP-CO2-EQPM,
  FP-EXTG, FA-DEVC, M-DUCT-SUPP, M-DUCT-RETN, M-HVAC-DIFF, M-HVAC-EQPM, *-ANNO; no frame / title block.

## R2 — HVAC shop drawings (`engine/hvacDrawing/hvacSheets.ts`)
`generateHvacDrawings({ zones, project, projectNumber, designer })` → { plan (M-101), schedules (M-601), combined }
built with the fire drawing kernel (DrawingBuilder, sheetKit Placer / tables / notes / title block, standards line
'ASHRAE 62.1 / ASHRAE 55 / SMACNA HVAC Duct Construction / ASHRAE Handbook'): plan in true drawing coordinates
(converted to mm), zone outlines + names + CFM, double-line ducts (supply / return layers) with size & CFM tags,
diffusers / grilles symbols with tag + CFM + neck size, indoor / outdoor units with model, refrigerant piping
indication, legend, notes, north arrow, scale; M-601: diffuser & grille schedule (tag, zone, type, size, CFM, NC,
throw), duct schedule (id, zone, type, size, CFM, velocity FPM, area), equipment schedule (zone, system type, model,
qty, ESP, CFM), zone summary.

## R3 — Verification (`engine/verification/designVerification.ts`)
`verifyDesigns({ fire?, hvac?: { zones, project }, bim? })` → { items: { discipline, system, id, title, status,
detail, reference }[], summary { total, pass, warn, fail }, html }. Fire: every result.checks entry (same id/status).
HVAC per zone (zones with ducts): hvac-airflow:<zone> (Σ supply terminal CFM vs the CFM of the first / root supply
trunk segment, ±1 %), hvac-return-balance:<zone> (Σ return CFM vs Σ supply, ±10 %), hvac-velocity:<zone> (all
segments ≤ maxVelocityLimitFpm ?? 900 fpm), hvac-nc:<zone> (terminal actualNc ≤ maxSpaceNcLimit ?? 35), plus the
existing executeMasterHvacValidation results when available. BIM: bim-integrity (storey & system references, finite
geometry, non-zero sizes), bim-clashes (detectClashes tolerance 25 mm; fail with pairs), bim-placement (model
warnings → warn). Fix the HVAC deployment airflow-conservation defect so deploymentAcceptance.test.ts passes
(determine whether the manifest double-counts return terminals or the trunk CFM is wrong; fix the engine, not the
test, unless the test is demonstrably wrong — then explain).

## R4 — UI "BIM / Revit export" (Fire workspace tab + HVAC export menu)
Placement inputs (pump room origin / floor / rotation, standpipe riser positions, extinguisher zone origins — click on
the plan where a floor plan exists), HVAC storey (name / elevation), downloads: Fire IFC, HVAC IFC, combined MEP IFC,
link DXF / DWG per storey (fire, HVAC), HVAC shop drawings DXF / DWG, verification report HTML; instructions for
Revit (Link IFC, Link CAD origin-to-origin, units mm).
