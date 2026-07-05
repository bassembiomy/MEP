export interface SystemRecommendation {
  type: 'high-wall' | 'cassette' | 'concealed' | 'packaged' | 'vrf' | 'ahu';
  name: string;
  score: number; // 0 to 100
  reason: string;
  pros: string[];
  cons: string[];
  estUnits: number;
  unitCapacity: number; // Btu/h
  estCost: 'Low' | 'Medium' | 'Medium-High' | 'High' | 'Very High';
  estEfficiency: 'Standard' | 'High' | 'Very High';
}

export function recommendSystemsForZone(
  areaSqFt: number,
  totalLoadBtu: number,
  spaceTypeId: string,
  isImperial: boolean
): SystemRecommendation[] {
  const recommendations: SystemRecommendation[] = [];
  const loadBtu = isImperial ? totalLoadBtu : totalLoadBtu * 3.412; // Convert Watts to Btu/h
  const area = isImperial ? areaSqFt : areaSqFt * 10.764; // Convert sqm to sqft

  // 1. High Wall Split Unit
  // Sized based on Cairo DWG: 12K (12,050), 18K (18,000), 24K (22,800), 30K (29,300)
  let hwScore = 0;
  let hwReason = '';
  let hwUnits = 1;
  let hwCap = 12050;
  
  if (loadBtu <= 30000 && area <= 400 && spaceTypeId !== 'toilet-public' && spaceTypeId !== 'computer-lab') {
    hwScore = 90;
    hwReason = 'Highly suitable for small, single-zone applications. Cost-effective and simple installation.';
    if (loadBtu <= 12050) hwCap = 12050;
    else if (loadBtu <= 18000) hwCap = 18000;
    else if (loadBtu <= 22800) hwCap = 22800;
    else hwCap = 29300;
  } else if (loadBtu > 30000 && loadBtu <= 90000) {
    hwScore = 55;
    hwUnits = Math.ceil(loadBtu / 29300);
    hwCap = 29300;
    hwReason = `Requires installing ${hwUnits} High Wall Split units to satisfy load. Good redundancy, but higher wall space usage.`;
  } else {
    hwScore = 15;
    hwReason = 'Not recommended due to excessive cooling load or space size.';
  }
  recommendations.push({
    type: 'high-wall',
    name: 'High Wall Split System',
    score: hwScore,
    reason: hwReason,
    pros: ['Lowest initial equipment cost', 'Very easy installation & maintenance', 'No ductwork required'],
    cons: ['Visible wall-mounted indoor units', 'Limited air throw/coverage', 'Poorer ventilation integration'],
    estUnits: hwUnits,
    unitCapacity: hwCap,
    estCost: 'Low',
    estEfficiency: 'Standard'
  });

  // 2. Cassette Split Unit
  // Sized based on Cairo DWG: 24K (24,000), 36K (34,000), 48K (42,500)
  let casScore = 0;
  let casReason = '';
  let casUnits = 1;
  let casCap = 34000;

  if (area >= 300 && area <= 1000 && loadBtu <= 42500) {
    casScore = 88;
    casReason = 'Excellent for open-plan offices, lobbies, or conference rooms with suspended false ceilings.';
    if (loadBtu <= 24000) casCap = 24000;
    else if (loadBtu <= 34000) casCap = 34000;
    else casCap = 42500;
  } else if (loadBtu > 42500 && loadBtu <= 130000) {
    casScore = 70;
    casUnits = Math.ceil(loadBtu / 42500);
    casCap = 42500;
    casReason = `Good choice utilizing ${casUnits} Cassette Split units to provide even, 4-way distributed cooling.`;
  } else {
    casScore = 30;
    casReason = 'Not ideal for very small rooms or spaces lacking suspended ceilings.';
  }
  recommendations.push({
    type: 'cassette',
    name: 'Cassette Split System',
    score: casScore,
    reason: casReason,
    pros: ['Under-ceiling flush mount looks premium', '4-way airflow distribution', 'Quiet operation'],
    cons: ['Requires ceiling void spacing', 'Slightly higher cost than high wall', 'Condensate drain pump maintenance'],
    estUnits: casUnits,
    unitCapacity: casCap,
    estCost: 'Medium',
    estEfficiency: 'High'
  });

  // 3. Concealed Ducted Split System
  // Sized based on Cairo Plans selection: 18K (17,470), 24K (22,355), 30K (26,450), 42K (35,590), 60K (47,005)
  let ductScore = 0;
  let ductReason = '';
  let ductUnits = 1;
  let ductCap = 35590;

  const isQuietOffice = spaceTypeId === 'conference' || spaceTypeId === 'office' || spaceTypeId === 'classroom';
  
  if (isQuietOffice) {
    ductScore = 95;
    ductReason = 'Top recommended choice. Standard ceiling concealed ducted split unit provides silent, uniform air distribution and easy fresh-air integration.';
  } else {
    ductScore = 80;
    ductReason = 'Solid engineering choice. Hidden ceiling units offer excellent aesthetic appeal and high external static pressure (ESP).';
  }

  // Sizing and unit selection logic matching the Cairo Office plans
  if (loadBtu <= 17470) {
    ductCap = 17470;
  } else if (loadBtu <= 22355) {
    ductCap = 22355;
  } else if (loadBtu <= 26450) {
    ductCap = 26450;
  } else if (loadBtu <= 35590) {
    ductCap = 35590;
  } else if (loadBtu <= 47005) {
    ductCap = 47005;
  } else {
    // If the load exceeds one 60K unit, we split it
    ductUnits = Math.ceil(loadBtu / 47005);
    ductCap = 47005;
  }

  recommendations.push({
    type: 'concealed',
    name: 'Concealed Ducted Split',
    score: ductScore,
    reason: ductReason,
    pros: ['Completely hidden inside ceiling', 'Uniform air distribution via diffusers', 'Can integrate fresh air intake'],
    cons: ['Requires sheet metal ductwork design', 'Higher installation costs', 'Needs static pressure calculation (ESP)'],
    estUnits: ductUnits,
    unitCapacity: ductCap,
    estCost: 'Medium-High',
    estEfficiency: 'Standard'
  });

  // 4. VRF System (Variable Refrigerant Flow)
  let vrfScore = 80; // Always a strong premium recommendation
  let vrfReason = 'Premium choice for multi-zone spaces. Highly efficient, saves ceiling space, and allows precise zone control.';
  recommendations.push({
    type: 'vrf',
    name: 'Variable Refrigerant Flow (VRF)',
    score: vrfScore,
    reason: vrfReason,
    pros: ['Extremely high seasonal energy efficiency', 'Simultaneous heating & cooling possible', 'Long piping/elevation limits'],
    cons: ['Highest initial equipment cost', 'Complex installation & programming', 'Requires specialized maintenance'],
    estUnits: Math.ceil(loadBtu / 48000), // Assumes 4-HP indoor units
    unitCapacity: 48000,
    estCost: 'High',
    estEfficiency: 'Very High'
  });

  // 5. Packaged Rooftop Unit
  // Sized in 5 TR, 7.5 TR, 10 TR, 15 TR, 20 TR (60k, 90k, 120k, 180k, 240k Btu/h)
  let pkgScore = 0;
  let pkgReason = '';
  if (loadBtu >= 60000) {
    pkgScore = 75;
    pkgReason = 'Excellent for single-volume large spaces or multiple zones using constant volume (VAV).';
  } else {
    pkgScore = 40;
    pkgReason = 'Low load makes a dedicated rooftop packaged unit cost-ineffective.';
  }
  recommendations.push({
    type: 'packaged',
    name: 'Packaged Rooftop Unit',
    score: pkgScore,
    reason: pkgReason,
    pros: ['No indoor equipment space required', 'All maintenance happens outdoors/rooftop', 'Factory charged and tested'],
    cons: ['Heavy weight requiring roof support', 'Large external duct penetrations', 'Higher fan power consumption'],
    estUnits: 1,
    unitCapacity: Math.ceil(loadBtu / 12000) * 12000,
    estCost: 'Medium-High',
    estEfficiency: 'Standard'
  });

  // 6. Central Air Handling Unit (AHU) / Chilled Water
  let ahuScore = 0;
  let ahuReason = '';
  if (loadBtu >= 120000 || spaceTypeId === 'hospital' || spaceTypeId === 'computer-lab') {
    ahuScore = 85;
    ahuReason = 'Best option for large floors, cleanrooms, and facilities requiring high ventilation & HEPA filtration.';
  } else {
    ahuScore = 30;
    ahuReason = 'Oversized and expensive for small commercial spaces.';
  }
  recommendations.push({
    type: 'ahu',
    name: 'Central Air Handling Unit (AHU)',
    score: ahuScore,
    reason: ahuReason,
    pros: ['Excellent ventilation and air quality control', 'Very long system life', 'Centralized water cooling plant'],
    cons: ['Requires dedicated mechanical room space', 'High initial piping/valving plant cost', 'Complex operations'],
    estUnits: 1,
    unitCapacity: loadBtu,
    estCost: 'Very High',
    estEfficiency: 'Very High'
  });

  return recommendations.sort((a, b) => b.score - a.score);
}
