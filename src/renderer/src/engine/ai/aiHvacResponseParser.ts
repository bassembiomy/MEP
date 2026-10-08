import { Zone, Diffuser, DuctSegment } from '../../store/projectStore';

export interface AiDiffuserItem {
  id: string;
  x: number;
  y: number;
  modelId: string;
  size: string;
  cfm: number;
  coverageRadiusFt: number;
  throwDistanceFt: number;
  ncLevel: number;
  type?: 'supply' | 'return';
}

export interface AiDuctItem {
  id: string;
  type: 'trunk' | 'branch' | 'return';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  shape: 'rectangular' | 'round';
  widthIn: number;
  heightIn: number;
  diameterIn?: number;
  cfm: number;
  velocityFpm: number;
  frictionRateInWgPer100Ft: number;
}

export interface AiHvacDesignOutput {
  systemSummary: {
    selectedAcuModel: string;
    totalCfm: number;
    totalBtuPerHour: number;
    estimatedTotalStaticPressureInWg: number;
    fanSpeedSetting?: 'low' | 'medium' | 'high';
  };
  acuPlacement: {
    x: number;
    y: number;
    serviceClearanceOk: boolean;
  };
  diffuserLayout: AiDiffuserItem[];
  ductNetwork: AiDuctItem[];
  compliance: {
    score: number;
    ashrae621VentilationCompliant: boolean;
    ashrae55DraftCompliant: boolean;
    maxVelocityCompliant: boolean;
    aspectRatioCompliant: boolean;
  };
  warnings: string[];
}

export interface ParsedAiHvacResult {
  success: boolean;
  data?: AiHvacDesignOutput;
  diffusers: Diffuser[];
  ducts: DuctSegment[];
  unitPos?: { x: number; y: number };
  catalogModel?: string;
  catalogQty?: number;
  catalogEsp?: string;
  complianceScore: number;
  warnings: string[];
  errors: string[];
}

/**
 * Calculates rectangular duct equivalent diameter using Huebscher's formula
 */
export function calculateEquivalentDiameterInches(widthIn: number, heightIn: number): number {
  if (widthIn <= 0 || heightIn <= 0) return 0;
  const num = Math.pow(widthIn * heightIn, 0.625);
  const den = Math.pow(widthIn + heightIn, 0.25);
  return Math.round(1.30 * (num / den) * 10) / 10;
}

/**
 * Calculates actual duct velocity in FPM
 */
export function calculateDuctVelocityFpm(
  cfm: number,
  shape: 'rectangular' | 'round',
  widthIn: number,
  heightIn: number,
  diameterIn?: number
): number {
  if (cfm <= 0) return 0;
  let areaSqFt = 0;
  if (shape === 'round' && diameterIn && diameterIn > 0) {
    const radiusFt = (diameterIn / 2) / 12;
    areaSqFt = Math.PI * radiusFt * radiusFt;
  } else if (widthIn > 0 && heightIn > 0) {
    areaSqFt = (widthIn / 12) * (heightIn / 12);
  }
  if (areaSqFt <= 0) return 0;
  return Math.round(cfm / areaSqFt);
}

/**
 * Extracts and parses JSON from raw LLM output strings (handling markdown blocks)
 */
export function extractJsonFromAiResponse(raw: string | object): any {
  if (typeof raw === 'object' && raw !== null) {
    return raw;
  }

  let text = String(raw).trim();
  // Strip Markdown code block delimiters if present
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  // Find first '{' and last '}'
  const startIdx = text.indexOf('{');
  const endIdx = text.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    text = text.substring(startIdx, endIdx + 1);
  }

  return JSON.parse(text);
}

/**
 * Validates and converts AI HVAC JSON into project store entities
 */
export function validateAndParseAiHvacResponse(
  raw: string | object,
  _zone?: Zone
): ParsedAiHvacResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  let json: AiHvacDesignOutput;
  try {
    json = extractJsonFromAiResponse(raw);
  } catch (err: any) {
    return {
      success: false,
      diffusers: [],
      ducts: [],
      complianceScore: 0,
      warnings: [],
      errors: [`JSON Parse Error: ${err.message || String(err)}`]
    };
  }

  // 1. Validate System Summary
  if (!json.systemSummary || !json.systemSummary.selectedAcuModel) {
    errors.push('Missing systemSummary.selectedAcuModel in AI output.');
  }

  // 2. Validate ACU Placement
  const unitPos = json.acuPlacement && typeof json.acuPlacement.x === 'number' && typeof json.acuPlacement.y === 'number'
    ? { x: json.acuPlacement.x, y: json.acuPlacement.y }
    : undefined;

  // 3. Process Diffusers
  const diffusers: Diffuser[] = [];
  if (Array.isArray(json.diffuserLayout)) {
    json.diffuserLayout.forEach((d, idx) => {
      const id = d.id || `ai-diffuser-${idx + 1}`;
      const cfm = Number(d.cfm) || 150;
      const size = d.size || '24"x24"';
      const actualNc = Number(d.ncLevel) || 25;
      const throwT50Ft = Number(d.throwDistanceFt) || Number(d.coverageRadiusFt) || 8;

      diffusers.push({
        id,
        x: Number(d.x) || 0,
        y: Number(d.y) || 0,
        cfm,
        size,
        type: d.type || 'supply',
        actualNc,
        throwT50Ft,
        deltaPInWg: 0.05
      });
    });
  } else {
    warnings.push('No diffuserLayout array found in AI output.');
  }

  // 4. Process Ducts & Validate Fluid Dynamics
  const ducts: DuctSegment[] = [];
  if (Array.isArray(json.ductNetwork)) {
    json.ductNetwork.forEach((d, idx) => {
      const id = d.id || `ai-duct-${idx + 1}`;
      const type = d.type || (idx === 0 ? 'trunk' : 'branch');
      const cfm = Number(d.cfm) || 400;
      const shape = d.shape || 'rectangular';
      let widthIn = Number(d.widthIn) || 12;
      let heightIn = Number(d.heightIn) || 10;
      const diameterIn = d.diameterIn ? Number(d.diameterIn) : undefined;

      // Aspect Ratio Check
      if (shape === 'rectangular' && widthIn > 0 && heightIn > 0) {
        const aspect = Math.max(widthIn, heightIn) / Math.min(widthIn, heightIn);
        if (aspect > 4.0) {
          warnings.push(`Duct ${id} exceeds 4:1 aspect ratio (${widthIn}"x${heightIn}", aspect: ${aspect.toFixed(1)}:1).`);
        }
      }

      // Velocity Check
      const actualVelocity = calculateDuctVelocityFpm(cfm, shape, widthIn, heightIn, diameterIn);
      const isTrunk = type === 'trunk';
      const maxRecommended = isTrunk ? 1500 : 1000;
      if (actualVelocity > maxRecommended) {
        warnings.push(`Duct ${id} velocity (${actualVelocity} FPM) exceeds ASHRAE ${type} limit of ${maxRecommended} FPM.`);
      }

      const sizeLabel = shape === 'round' && diameterIn
        ? `Ø${diameterIn}" (${actualVelocity} FPM)`
        : `${widthIn}"x${heightIn}" (${actualVelocity} FPM)`;

      ducts.push({
        id,
        type,
        points: [Number(d.startX) || 0, Number(d.startY) || 0, Number(d.endX) || 0, Number(d.endY) || 0],
        widthIn,
        heightIn,
        diameterIn,
        cfm,
        sizeLabel,
        velocityFpm: actualVelocity,
        shape
      });
    });
  } else {
    warnings.push('No ductNetwork array found in AI output.');
  }

  // 5. Score calculation
  let complianceScore = json.compliance && typeof json.compliance.score === 'number'
    ? json.compliance.score
    : 85;

  if (warnings.length > 0) {
    complianceScore = Math.max(50, complianceScore - warnings.length * 5);
  }

  if (Array.isArray(json.warnings)) {
    warnings.push(...json.warnings);
  }

  return {
    success: errors.length === 0,
    data: json,
    diffusers,
    ducts,
    unitPos,
    catalogModel: json.systemSummary?.selectedAcuModel,
    catalogQty: 1,
    catalogEsp: json.systemSummary?.estimatedTotalStaticPressureInWg
      ? `${json.systemSummary.estimatedTotalStaticPressureInWg.toFixed(2)}" w.g.`
      : '0.40" w.g.',
    complianceScore,
    warnings,
    errors
  };
}
