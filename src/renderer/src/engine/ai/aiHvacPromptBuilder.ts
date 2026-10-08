import { Zone } from '../../store/projectStore';
import {
  STANDARD_EQUIPMENT_CATALOG,
  STANDARD_DIFFUSER_CATALOG
} from '../hvacCatalogs';

export interface PromptCatalogSlice {
  recommendedAcuUnits: Array<{
    id: string;
    manufacturer: string;
    model: string;
    nominalTons: number;
    totalCapacityBtu: number;
    nominalCfm: number;
    maxRatedEspInWg: number;
    dimensionsIn: { width: number; depth: number; height: number };
  }>;
  recommendedDiffusers: Array<{
    id: string;
    model: string;
    terminalType: string;
    neckSize: string;
    minCfm: number;
    maxCfm: number;
    performance: Array<{
      cfm: number;
      throwT50Ft: number;
      ncRating: number;
      deltaPInWg: number;
    }>;
  }>;
}

export interface BuildAiPromptParams {
  zone: Zone;
  units?: 'imperial' | 'metric';
  plenumHeightIn?: number;
  designFrictionRateInWgPer100Ft?: number;
  outdoorAirCfm?: number;
}

export interface AiPromptPayload {
  systemPrompt: string;
  userPrompt: string;
  catalogSlice: PromptCatalogSlice;
  zoneMetrics: {
    polygon: Array<[number, number]>;
    areaSqFt: number;
    ceilingHeightFt: number;
    plenumHeightIn: number;
    totalLoadBtuPerHour: number;
    sensibleLoadBtuPerHour: number;
    totalAirflowCfm: number;
    outdoorAirCfm: number;
  };
}

/**
 * Slices matching equipment catalog items suited for the zone CFM and BTU requirements
 */
export function sliceEquipmentCatalogForZone(
  _requiredCfm: number,
  totalLoadBtu: number,
  preferredSystemType: string = 'concealed'
): PromptCatalogSlice['recommendedAcuUnits'] {
  const matchingUnits = STANDARD_EQUIPMENT_CATALOG.filter(
    (item) => item.systemType === preferredSystemType && item.capabilities.supportsDuctNetwork
  );

  // Sort by closest capacity matching
  const sorted = [...matchingUnits].sort((a, b) => {
    const diffA = Math.abs(a.totalCapacityBtuPerHour - totalLoadBtu);
    const diffB = Math.abs(b.totalCapacityBtuPerHour - totalLoadBtu);
    return diffA - diffB;
  });

  return sorted.slice(0, 5).map((u) => ({
    id: u.id,
    manufacturer: u.manufacturer,
    model: u.model,
    nominalTons: u.nominalTons,
    totalCapacityBtu: u.totalCapacityBtuPerHour,
    nominalCfm: u.nominalCfm,
    maxRatedEspInWg: u.maxRatedEspInWg,
    dimensionsIn: u.dimensionsIn
  }));
}

/**
 * Slices matching diffusers from catalog
 */
export function sliceDiffuserCatalogForZone(
  _requiredCfm: number
): PromptCatalogSlice['recommendedDiffusers'] {
  const supplyDiffusers = STANDARD_DIFFUSER_CATALOG.filter(
    (d) => d.terminalType === 'square-ceiling' || d.terminalType === 'round-ceiling'
  );

  return supplyDiffusers.map((d) => ({
    id: d.id,
    model: d.model,
    terminalType: d.terminalType,
    neckSize: d.neckSizeIn.diameter ? `${d.neckSizeIn.diameter}" Round` : `${d.neckSizeIn.width}"x${d.neckSizeIn.height}"`,
    minCfm: d.minCfm,
    maxCfm: d.maxCfm,
    performance: d.performanceTable.map((p) => ({
      cfm: p.cfm,
      throwT50Ft: p.throwFt.t50,
      ncRating: p.ncRating,
      deltaPInWg: p.deltaPInWg
    }))
  }));
}

/**
 * Computes polygon area in square units
 */
export function calculatePolygonArea(points: number[]): number {
  if (!points || points.length < 6) return 0;
  let area = 0;
  const n = points.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = points[i * 2];
    const yi = points[i * 2 + 1];
    const xj = points[j * 2];
    const yj = points[j * 2 + 1];
    area += xi * yj;
    area -= xj * yi;
  }
  return Math.abs(area / 2);
}

/**
 * Builds the complete, highly structured engineering prompt for an AI agent
 */
export function buildAiHvacPrompt(params: BuildAiPromptParams): AiPromptPayload {
  const {
    zone,
    units = 'imperial',
    plenumHeightIn = 16,
    designFrictionRateInWgPer100Ft = 0.08
  } = params;

  // Compute geometry
  const polygonPairs: Array<[number, number]> = [];
  for (let i = 0; i < zone.points.length; i += 2) {
    polygonPairs.push([Math.round(zone.points[i] * 100) / 100, Math.round(zone.points[i + 1] * 100) / 100]);
  }

  const rawArea = calculatePolygonArea(zone.points);
  const areaSqFt = rawArea > 0 ? Math.round(rawArea) : 500;
  const ceilingHeightFt = zone.ceilingHeight || 9;
  const occupants = zone.occupants || Math.max(1, Math.round(areaSqFt / 100));

  // Loads & CFM
  const sensibleLoadBtu = zone.manualCoolingOverride
    ? Math.round(zone.manualCoolingOverride * 0.8)
    : Math.round(areaSqFt * 35 + occupants * 250);
  const totalLoadBtu = zone.manualCoolingOverride || Math.round(sensibleLoadBtu / 0.78);
  const totalAirflowCfm = zone.manualCfmOverride || Math.round(sensibleLoadBtu / (1.08 * 20));
  const outdoorAirCfm = params.outdoorAirCfm || Math.max(150, Math.round(occupants * 5 + areaSqFt * 0.06));

  // Catalog Slices
  const systemType = zone.systemType || 'concealed';
  const recommendedAcuUnits = sliceEquipmentCatalogForZone(totalAirflowCfm, totalLoadBtu, systemType);
  const recommendedDiffusers = sliceDiffuserCatalogForZone(totalAirflowCfm);

  const catalogSlice: PromptCatalogSlice = {
    recommendedAcuUnits,
    recommendedDiffusers
  };

  const systemPrompt = `You are an Expert HVAC Design AI and Automated Engineering Agent. Your task is to algorithmically design, spatially distribute, and size a concealed ducted HVAC system (ACU, ducts, and diffusers) for a specific zone. Your designs must strictly adhere to ASHRAE standards, manufacturer catalog limitations, and fluid dynamics principles, mimicking the precision of Revit MEP and professional duct sizers.

**Inputs Provided to You:**
1. **Zone Geometry:** A closed 2D polygon representing the zone area (in sq. ft. or sq. m) and ceiling height.
2. **Load & Airflow Requirements:** Total Cooling/Heating Load (BTU/hr) and Total Airflow (CFM).
3. **Catalog Data:** Available ACU capacities, diffuser models (with max CFM, throw distance, and coverage radius), and duct material friction rates.

**Execution Instructions - Step-by-Step:**

#### Phase 1: Spatial Distribution (Diffusers & ACU Placement)
* **Diffuser Coverage Calculation:**
  * Calculate the required number of diffusers: Total Zone CFM / Selected Diffuser CFM.
  * Verify spatial coverage: Ensure the selected diffuser's maximum coverage radius (based on catalog throw at terminal velocity 50 fpm) adequately covers the zone. Increase count if necessary to prevent dead zones.
  * **Layout Pattern:** Distribute diffusers in an optimal grid or staggered pattern. Ensure distance from any wall to nearest diffuser is <= 70% of diffuser-to-diffuser spacing.
* **ACU Placement:**
  * Place the concealed ACU to minimize duct run length and pressure drop. Prefer central perimeter or ceiling service shafts with maintenance clearance.

#### Phase 2: Duct Routing & Topology
* **Routing Logic:** Route ducts using an optimized tree or reverse-return topology for balanced flow.
* **Pathfinding:** Minimize elbows and transitions. Keep runs straight. Respect plenum height of ${plenumHeightIn} inches.

#### Phase 3: Engineering & Sizing (Duct Sizer Logic)
* **Sizing Method:** Equal Friction Method at ${designFrictionRateInWgPer100Ft} in. w.g. / 100 ft (~1.0 Pa/m).
* **Velocity Limits (Noise Control):**
  * Main ducts: 1,000 - 1,500 fpm
  * Branch ducts: 700 - 1,000 fpm
  * Diffuser neck connections: <= catalog rated neck velocity.
* **Aspect Ratio:** Rectangular ducts must maintain aspect ratio <= 4:1 (targeting 1:1 to 2:1).
* **Calculations:** For every duct segment calculate: Airflow (CFM), Equivalent Diameter (in), Dimensions (W x H in.), Velocity (fpm), Friction Rate (in. w.g./100ft).

#### Phase 4: Validation & Compliance Check
* ASHRAE 62.1 ventilation compliance (OA >= ${outdoorAirCfm} CFM).
* ASHRAE 55 thermal comfort & ADPI throw coverage.
* Catalog limits (no diffuser over CFM, no velocity breach).
* Total External Static Pressure (ESP) check against ACU blower curve.

**Required Output Format:**
Return ONLY valid JSON matching this schema:
{
  "systemSummary": {
    "selectedAcuModel": "string (from catalog)",
    "totalCfm": number,
    "totalBtuPerHour": number,
    "estimatedTotalStaticPressureInWg": number
  },
  "acuPlacement": {
    "x": number,
    "y": number,
    "serviceClearanceOk": true
  },
  "diffuserLayout": [
    {
      "id": "string",
      "x": number,
      "y": number,
      "modelId": "string",
      "size": "string",
      "cfm": number,
      "coverageRadiusFt": number,
      "throwDistanceFt": number,
      "ncLevel": number
    }
  ],
  "ductNetwork": [
    {
      "id": "string",
      "type": "trunk" | "branch" | "return",
      "startX": number,
      "startY": number,
      "endX": number,
      "endY": number,
      "shape": "rectangular" | "round",
      "widthIn": number,
      "heightIn": number,
      "cfm": number,
      "velocityFpm": number,
      "frictionRateInWgPer100Ft": number
    }
  ],
  "compliance": {
    "score": number (0-100),
    "ashrae621VentilationCompliant": boolean,
    "ashrae55DraftCompliant": boolean,
    "maxVelocityCompliant": boolean,
    "aspectRatioCompliant": boolean
  },
  "warnings": ["string"]
}`;

  const userPrompt = `### ZONE DESIGN REQUEST: ${zone.name || 'Zone-1'}

**Zone Parameters:**
- Boundary Polygon Coordinates: ${JSON.stringify(polygonPairs)}
- Floor Area: ${areaSqFt} sq ft (${units})
- Ceiling Height: ${ceilingHeightFt} ft
- Plenum Available Depth: ${plenumHeightIn} inches
- Design Sensible Cooling Load: ${sensibleLoadBtu.toLocaleString()} BTU/hr
- Design Total Cooling Load: ${totalLoadBtu.toLocaleString()} BTU/hr
- Required Supply Airflow: ${totalAirflowCfm.toLocaleString()} CFM
- Required Minimum Outdoor Air (ASHRAE 62.1): ${outdoorAirCfm} CFM

**Available ACU Equipment Catalog Options:**
${JSON.stringify(recommendedAcuUnits, null, 2)}

**Available Diffuser Catalog Options:**
${JSON.stringify(recommendedDiffusers, null, 2)}

Please generate the optimal concealed ducted layout, diffuser placements, and duct sizing meeting all ASHRAE and catalog criteria. Return strictly the required JSON format.`;

  return {
    systemPrompt,
    userPrompt,
    catalogSlice,
    zoneMetrics: {
      polygon: polygonPairs,
      areaSqFt,
      ceilingHeightFt,
      plenumHeightIn,
      totalLoadBtuPerHour: totalLoadBtu,
      sensibleLoadBtuPerHour: sensibleLoadBtu,
      totalAirflowCfm,
      outdoorAirCfm
    }
  };
}
