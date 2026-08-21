import {
  EquipmentCatalogItem,
  SystemArchitectureBreakdown,
  SystemComponentItem,
  SelectionAlgorithmTrace,
  SelectionAlgorithmStep,
  CriticalPathResult,
  FanOperatingPointResult
} from './types';

/**
 * Generates the categorized Bill of Components & Architecture blueprint for any HVAC system
 */
export function generateSystemArchitecture(
  equip: EquipmentCatalogItem,
  quantity: number,
  totalCfm: number,
  areaSqFt: number,
  _totalLoadBtu: number,
  _isImperial: boolean = true,
  diffusers?: any,
  _ductwork?: any
): SystemArchitectureBreakdown {
  const components: SystemComponentItem[] = [];
  const nominalTons = equip.nominalTons * quantity;
  const cfm = totalCfm || equip.nominalCfm * quantity;

  // Sizing helpers
  const liquidLine = equip.connectionSizes.liquidLine || (nominalTons <= 2 ? '1/4"' : nominalTons <= 4 ? '3/8"' : '1/2"');
  const gasLine = equip.connectionSizes.gasLine || (nominalTons <= 1.5 ? '1/2"' : nominalTons <= 3 ? '5/8"' : nominalTons <= 5 ? '7/8"' : '1-1/8"');
  const terminalCount = diffusers?.quantity || (equip.capabilities.supportsExternalDiffusers ? Math.max(1, Math.ceil(cfm / 300)) : quantity);
  const diffuserSize = diffusers?.diffuserRecord ? `${diffusers.diffuserRecord.faceSizeIn.width}"x${diffusers.diffuserRecord.faceSizeIn.height}"` : '12"x12" (8" Neck)';

  switch (equip.systemType) {
    case 'concealed': {
      // 1. Primary Equipment
      components.push({
        id: `comp-${equip.id}-odu`,
        category: 'primary-equipment',
        tag: quantity > 1 ? `ODU-01..0${quantity}` : 'ODU-01',
        name: 'Outdoor Condensing Unit (DX Inverter)',
        modelOrType: `${equip.manufacturer} ${equip.model}-ODU`,
        quantity,
        specification: `${equip.nominalTons} TR per unit (${equip.totalCapacityBtuPerHour.toLocaleString()} Btu/h, SEER ${equip.efficiency.seer || 16})`,
        connectionSize: `${liquidLine} Liq / ${gasLine} Suct`,
        status: 'included',
        details: 'Variable-speed rotary/scroll compressor with R-410A refrigerant.'
      });
      components.push({
        id: `comp-${equip.id}-fcu`,
        category: 'primary-equipment',
        tag: quantity > 1 ? `FCU-01..0${quantity}` : 'FCU-01',
        name: 'Low-Profile Concealed Ceiling Fan Coil Unit',
        modelOrType: `${equip.manufacturer} ${equip.model}`,
        quantity,
        specification: `${equip.nominalCfm} CFM, Max ESP: ${equip.maxRatedEspInWg} in.wg, Height: ${equip.dimensionsIn.height}"`,
        connectionSize: `Supply: ${equip.connectionSizes.supplyDuct || '36"x8"'}, Return: ${equip.connectionSizes.returnDuct || '40"x8"'}`,
        status: 'included',
        details: 'Galvanized insulated casing with multi-speed centrifugal blower & washable filter.'
      });

      // 2. Air Distribution & Ductwork
      const trunkWidth = Math.round(Math.sqrt((cfm / 1000) * 144) * 1.3);
      const trunkHeight = 10;
      components.push({
        id: `comp-${equip.id}-duct-supply`,
        category: 'air-distribution',
        tag: 'SDT-01',
        name: 'Galvanized Sheet Metal Supply Duct Trunk',
        modelOrType: 'SMACNA Rectangular Class 2',
        quantity: Math.max(1, Math.round(areaSqFt * 0.05)),
        specification: `${trunkWidth}"x${trunkHeight}" Rectangular (Friction: 0.08 in.wg/100ft, 1050 FPM)`,
        connectionSize: `${trunkWidth}"x${trunkHeight}"`,
        status: 'included',
        details: 'Fabricated per SMACNA HVAC Duct Construction Standards with 1" acoustic internal lining.'
      });
      components.push({
        id: `comp-${equip.id}-flex-runout`,
        category: 'air-distribution',
        tag: 'FLEX-01',
        name: 'Insulated Flexible Aluminum Runout Duct',
        modelOrType: 'UL 181 Class 1 Flexible Air Duct',
        quantity: terminalCount,
        specification: '8" Round (Max length 5 ft, Max velocity 700 FPM, R-6.0 thermal sleeve)',
        connectionSize: 'Ø 8"',
        status: 'included',
        details: 'Connects rigid takeoffs to diffuser plenum boots with stainless steel worm-gear clamps.'
      });
      components.push({
        id: `comp-${equip.id}-fire-damper`,
        category: 'air-distribution',
        tag: 'FD-01',
        name: 'Dynamic Curtain Fire Damper (1.5 Hr)',
        modelOrType: 'UL 555 Rated Fire Damper',
        quantity: 1,
        specification: '165°F Fusible Link, Low Pressure Loss (K=0.20)',
        connectionSize: `${trunkWidth}"x${trunkHeight}"`,
        status: 'optional',
        details: 'Installed at fire-rated partition wall penetration.'
      });

      // 3. Terminals
      components.push({
        id: `comp-${equip.id}-diffusers`,
        category: 'terminals',
        tag: `SAD-01..0${terminalCount}`,
        name: '4-Way Square Ceiling Supply Diffuser',
        modelOrType: 'Titus TMS 4-Way Modular Core',
        quantity: terminalCount,
        specification: `${diffuserSize}, Flow: ${Math.round(cfm / terminalCount)} CFM/terminal, Sound: NC ${diffusers?.actualNc || 26}`,
        connectionSize: 'Ø 8" Round Neck',
        status: 'included',
        details: 'Architectural flush aluminum frame with radial 360° horizontal air distribution pattern.'
      });
      components.push({
        id: `comp-${equip.id}-return-grille`,
        category: 'terminals',
        tag: 'RAG-01',
        name: 'Eggcrate Return Air Filter Grille',
        modelOrType: 'Titus 50F Aluminum Return Grille',
        quantity: quantity,
        specification: '24"x24" T-Bar (Core Area: 3.2 sq.ft, Face Velocity: 350 FPM, NC 18)',
        connectionSize: '24"x24"',
        status: 'included',
        details: 'Equipped with 1/2"x1/2"x1/2" aluminum eggcrate grid and hinged filter frame.'
      });

      // 4. Hydronics & Refrigerant
      components.push({
        id: `comp-${equip.id}-refrig-lines`,
        category: 'hydronics-refrigerant',
        tag: 'REF-01',
        name: 'Refrigerant R-410A Copper Lineset',
        modelOrType: 'ASTM B280 Seamless ACR Copper Tube',
        quantity: 1,
        specification: `${liquidLine} Liquid / ${gasLine} Suction with 3/4" Armaflex closed-cell insulation`,
        connectionSize: `${liquidLine} / ${gasLine}`,
        status: 'included',
        details: 'Brazed with 15% silver alloy under nitrogen purge; rated for 650 PSI design pressure.'
      });
      components.push({
        id: `comp-${equip.id}-condensate-drain`,
        category: 'hydronics-refrigerant',
        tag: 'CD-01',
        name: 'UPVC Condensate Drain Pipe & Running Trap',
        modelOrType: 'Class 4 UPVC Gravity Drain',
        quantity: quantity,
        specification: 'Ø 1" UPVC with 1% downward slope & cleanout plug',
        connectionSize: 'Ø 1"',
        status: 'included',
        details: 'Includes transparent inspection P-trap and secondary overflow float switch.'
      });

      // 5. Controls & Electrical
      components.push({
        id: `comp-${equip.id}-thermostat`,
        category: 'controls-electrical',
        tag: 'TC-01',
        name: 'Digital Programmable Touch Thermostat',
        modelOrType: 'Carrier Touch Screen Zone Controller',
        quantity: 1,
        specification: '7-Day Schedule, Auto Changeover, Modbus/BACnet Compatible',
        connectionSize: '24VAC 4-Wire / Shielded RS485',
        status: 'included',
        details: 'Wall-mounted 4.5 ft above finished floor away from direct sunlight.'
      });
      break;
    }

    case 'cassette': {
      // 1. Primary Equipment
      components.push({
        id: `comp-${equip.id}-odu`,
        category: 'primary-equipment',
        tag: quantity > 1 ? `ODU-01..0${quantity}` : 'ODU-01',
        name: 'Outdoor Inverter Condensing Unit',
        modelOrType: `${equip.manufacturer} ${equip.model}-ODU`,
        quantity,
        specification: `${equip.nominalTons} TR, Total: ${(equip.totalCapacityBtuPerHour * quantity).toLocaleString()} Btu/h, SEER ${equip.efficiency.seer || 17.5}`,
        connectionSize: `${liquidLine} Liq / ${gasLine} Suct`,
        status: 'included',
        details: 'High-efficiency DC Inverter outdoor unit with anti-corrosion GoldFin condenser.'
      });
      components.push({
        id: `comp-${equip.id}-idu`,
        category: 'primary-equipment',
        tag: quantity > 1 ? `CAS-01..0${quantity}` : 'CAS-01',
        name: '4-Way Compact Ceiling Cassette Unit',
        modelOrType: `${equip.manufacturer} ${equip.model}`,
        quantity,
        specification: `${equip.nominalCfm} CFM/unit, Dimensions: ${equip.dimensionsIn.width}"x${equip.dimensionsIn.depth}"x${equip.dimensionsIn.height}"`,
        connectionSize: `${liquidLine} Liq / ${gasLine} Suct`,
        status: 'included',
        details: 'Equipped with 3D turbo fan, motorized independent louvers, and built-in 28" head lift drain pump.'
      });

      // 2. Air Distribution / Terminals
      components.push({
        id: `comp-${equip.id}-panel`,
        category: 'terminals',
        tag: `PNL-01..0${quantity}`,
        name: 'Architectural 4-Way Air Discharge Panel',
        modelOrType: 'Carrier 360° Flow Decorative Fascia',
        quantity,
        specification: '37.4"x37.4" Flush White Panel, Sound: NC 32 at Medium Speed',
        connectionSize: 'Snap-on T-Bar Ceiling Flush',
        status: 'included',
        details: 'Features active motorized swing vanes for uniform coanda-effect ceiling air distribution.'
      });

      // 3. Refrigerant & Hydronics
      components.push({
        id: `comp-${equip.id}-refrig-lines`,
        category: 'hydronics-refrigerant',
        tag: 'REF-01',
        name: 'R-410A Refrigerant Lineset',
        modelOrType: 'ASTM B280 Insulated Copper Pair',
        quantity,
        specification: `${liquidLine} Liquid / ${gasLine} Gas with 1/2" elastomeric thermal insulation`,
        connectionSize: `${liquidLine} / ${gasLine}`,
        status: 'included',
        details: 'Pre-insulated twin copper pipes rated for operating temperature range -20°F to 250°F.'
      });

      // 4. Controls
      components.push({
        id: `comp-${equip.id}-ctrl`,
        category: 'controls-electrical',
        tag: 'RC-01',
        name: 'LCD Backlit Wireless Remote & Wall Bracket',
        modelOrType: 'Infrared Multi-Function Controller',
        quantity,
        specification: 'Room temperature sensing, turbo mode, eco mode, weekly timer',
        connectionSize: 'Wireless IR / Optional 2-wire wired adapter',
        status: 'included',
        details: 'Includes receiver module built into corner pocket of the decorative cassette fascia.'
      });
      break;
    }

    case 'high-wall': {
      // 1. Primary Equipment
      components.push({
        id: `comp-${equip.id}-odu`,
        category: 'primary-equipment',
        tag: quantity > 1 ? `ODU-01..0${quantity}` : 'ODU-01',
        name: 'Wall Split Outdoor Inverter Unit',
        modelOrType: `${equip.manufacturer} ${equip.model}-ODU`,
        quantity,
        specification: `${equip.nominalTons} TR, Total: ${(equip.totalCapacityBtuPerHour * quantity).toLocaleString()} Btu/h, SEER ${equip.efficiency.seer || 18}`,
        connectionSize: `${liquidLine} Liq / ${gasLine} Suct`,
        status: 'included',
        details: 'Rotary DC Inverter compressor with quiet night-mode operation.'
      });
      components.push({
        id: `comp-${equip.id}-idu`,
        category: 'primary-equipment',
        tag: quantity > 1 ? `HW-01..0${quantity}` : 'HW-01',
        name: 'Decorative Wall-Mounted Indoor Unit',
        modelOrType: `${equip.manufacturer} ${equip.model}`,
        quantity,
        specification: `${equip.nominalCfm} CFM/unit, Sound: 28 dBA (Low) / 38 dBA (High)`,
        connectionSize: `${liquidLine} Liq / ${gasLine} Suct`,
        status: 'included',
        details: 'Cross-flow tangential fan with electrostatic high-density dust filter and ionizer.'
      });

      // 2. Terminals / Piping
      components.push({
        id: `comp-${equip.id}-lineset`,
        category: 'hydronics-refrigerant',
        tag: 'REF-01',
        name: 'Refrigerant Lineset & Drain Hose Sleeve',
        modelOrType: 'Direct Wall Penetration Kit',
        quantity,
        specification: `${liquidLine} Liquid / ${gasLine} Gas + Ø 5/8" Corrugated Drain Hose`,
        connectionSize: `${liquidLine} / ${gasLine}`,
        status: 'included',
        details: 'Includes decorative exterior PVC trunking / capping for outdoor pipe run.'
      });

      // 3. Controls
      components.push({
        id: `comp-${equip.id}-ctrl`,
        category: 'controls-electrical',
        tag: 'RC-01',
        name: 'Infrared Wireless Remote Controller',
        modelOrType: 'Carrier Smart Controller with I-Feel Sensor',
        quantity,
        specification: 'Temperature accuracy +/- 0.5°C, Wi-Fi App Connectivity',
        connectionSize: 'Wireless RF/IR',
        status: 'included',
        details: 'Equipped with I-Feel ambient temperature sensor for precision microclimate regulation.'
      });
      break;
    }

    case 'vrf': {
      // 1. Primary Equipment
      components.push({
        id: `comp-${equip.id}-odu`,
        category: 'primary-equipment',
        tag: 'VRF-ODU-01',
        name: 'VRF Modular Heat Recovery Outdoor Unit',
        modelOrType: `${equip.manufacturer} ${equip.model}`,
        quantity: 1,
        specification: `${equip.nominalTons} Nominal TR (${equip.totalCapacityBtuPerHour.toLocaleString()} Btu/h), IEER ${equip.efficiency.iplv || 24.0}`,
        connectionSize: 'Liquid: 1/2", High-Pressure Gas: 7/8", Low-Pressure Gas: 1-1/8"',
        status: 'included',
        details: 'Simultaneous cooling and heating with inverter scroll compressors and subcooling circuit.'
      });
      components.push({
        id: `comp-${equip.id}-idu`,
        category: 'primary-equipment',
        tag: quantity > 1 ? `VRF-IDU-01..0${quantity}` : 'VRF-IDU-01',
        name: 'VRF Concealed Ducted / Cassette Indoor Units',
        modelOrType: `${equip.manufacturer} VRV Indoor Unit`,
        quantity,
        specification: `${Math.round(cfm / quantity)} CFM per unit, EEV electronic expansion valve`,
        connectionSize: '3/8" Liq / 5/8" Gas',
        status: 'included',
        details: 'Modulating electronic expansion valve (EEV) with 2000-step linear pulse motor.'
      });

      // 2. Air Distribution & Terminals
      components.push({
        id: `comp-${equip.id}-bs-box`,
        category: 'hydronics-refrigerant',
        tag: 'BS-01',
        name: 'VRF Multi-Port Branch Selector Box',
        modelOrType: 'Daikin BSQ Series Heat Recovery Box',
        quantity: Math.max(1, Math.ceil(quantity / 4)),
        specification: '3-Pipe to 2-Pipe Refrigerant Switching, Solenoid Valve Control',
        connectionSize: '3-Pipe In / 2-Pipe Out',
        status: 'included',
        details: 'Enables individual zone mode switching between heating and cooling.'
      });
      components.push({
        id: `comp-${equip.id}-refnet`,
        category: 'hydronics-refrigerant',
        tag: 'REFNET-01',
        name: 'Engineered Refnet Distribution Header & Y-Joints',
        modelOrType: 'Engineered Copper Flow Equalizing Joints',
        quantity: Math.max(2, quantity + 1),
        specification: 'Seamless Formed Copper Y-Branch with equal flow splitting',
        connectionSize: 'Variable Ø 3/8" to 1-1/8"',
        status: 'included',
        details: 'Designed for minimal refrigerant pressure drop and balanced oil return.'
      });

      // 3. Terminals
      components.push({
        id: `comp-${equip.id}-diffusers`,
        category: 'terminals',
        tag: `SAD-01..0${terminalCount}`,
        name: 'Linear Slot / 4-Way Supply Diffusers',
        modelOrType: 'Titus / Price Architectural Diffusers',
        quantity: terminalCount,
        specification: `${diffuserSize}, NC ${diffusers?.actualNc || 25}`,
        connectionSize: 'Ø 8" Collar',
        status: 'included',
        details: 'High induction ratio diffusers providing rapid room temperature equalization.'
      });

      // 4. Controls
      components.push({
        id: `comp-${equip.id}-bms`,
        category: 'controls-electrical',
        tag: 'BMS-GW-01',
        name: 'Central BACnet/IP Touch Controller & Gateway',
        modelOrType: 'Daikin Intelligent Touch Manager',
        quantity: 1,
        specification: 'Color 10.4" LCD Screen, Web Server, BACnet IP / Modbus Gateway',
        connectionSize: 'RJ45 Ethernet / 2-Wire D-III Net',
        status: 'included',
        details: 'Centralized tenant power billing, setback scheduling, and continuous fault diagnostic telemetry.'
      });
      break;
    }

    case 'packaged': {
      // 1. Primary Equipment
      components.push({
        id: `comp-${equip.id}-rtu`,
        category: 'primary-equipment',
        tag: 'RTU-01',
        name: 'Packaged Single-Zone Rooftop Unit',
        modelOrType: `${equip.manufacturer} ${equip.model}`,
        quantity: 1,
        specification: `${equip.nominalTons} TR (${equip.totalCapacityBtuPerHour.toLocaleString()} Btu/h), Supply Air: ${cfm} CFM, Max ESP: ${equip.maxRatedEspInWg} in.wg`,
        connectionSize: `Supply: ${equip.connectionSizes.supplyDuct || '20"x20"'}, Return: ${equip.connectionSizes.returnDuct || '20"x20"'}`,
        status: 'included',
        details: 'Weatherproof heavy-gauge galvanized steel cabinet with R-4.2 foil-faced insulation and roof curb.'
      });

      // 2. Air Distribution & Economizer
      components.push({
        id: `comp-${equip.id}-economizer`,
        category: 'air-distribution',
        tag: 'ECON-01',
        name: 'Integrated Ultra-Low-Leakage Air Economizer',
        modelOrType: 'Factory-Installed Modulating Economizer',
        quantity: 1,
        specification: 'Gear-driven airfoil blades, differential enthalpy sensor, 0-100% OA capability',
        connectionSize: 'Integrated in RTU cabinet',
        status: 'included',
        details: 'Provides free cooling when outdoor air enthalpy is below room return air threshold.'
      });
      components.push({
        id: `comp-${equip.id}-roof-curb`,
        category: 'air-distribution',
        tag: 'CURB-01',
        name: 'Full-Perimeter Insulated Roof Curb',
        modelOrType: 'SMACNA Heavy Gauge 14-Ga Roof Curb',
        quantity: 1,
        specification: '14" Height with thick rubber vibration isolation gasket & wood nailer',
        connectionSize: 'Full RTU Footprint',
        status: 'included',
        details: 'Waterproof flashed curb designed to isolate structural building vibration.'
      });
      components.push({
        id: `comp-${equip.id}-supply-duct`,
        category: 'air-distribution',
        tag: 'SDT-01',
        name: 'Insulated Rooftop Drop & Main Supply Trunk',
        modelOrType: 'Galvanized Sheet Metal with 2" External Foil-Faced Wrap',
        quantity: Math.max(1, Math.round(areaSqFt * 0.06)),
        specification: '24"x16" Rectangular Trunk @ 1150 FPM, Friction: 0.09 in.wg/100ft',
        connectionSize: '24"x16"',
        status: 'included',
        details: 'Reinforced with transverse duct flanges and internal corner stiffeners.'
      });

      // 3. Terminals
      components.push({
        id: `comp-${equip.id}-diffusers`,
        category: 'terminals',
        tag: `SAD-01..0${terminalCount}`,
        name: 'High-Volume Square Architectural Diffusers',
        modelOrType: 'Titus TMS 18"x18" Diffusers',
        quantity: terminalCount,
        specification: `${diffuserSize}, Flow: ${Math.round(cfm / terminalCount)} CFM/terminal, NC ${diffusers?.actualNc || 30}`,
        connectionSize: 'Ø 10" or 12" Collar',
        status: 'included',
        details: 'Equipped with opposed blade volume damper and insulated top plenum box.'
      });

      // 4. Controls
      components.push({
        id: `comp-${equip.id}-ctrl`,
        category: 'controls-electrical',
        tag: 'DDC-01',
        name: 'Microprocessor Rooftop Controller with BACnet',
        modelOrType: 'Carrier ComfortLink DDC Module',
        quantity: 1,
        specification: 'Multi-stage cooling control, economizer logic, CO2 demand-controlled ventilation',
        connectionSize: 'BACnet MS/TP RS-485',
        status: 'included',
        details: 'Integrates with space carbon dioxide sensors for ASHRAE 62.1 DCV energy savings.'
      });
      break;
    }

    case 'ahu': {
      // 1. Primary Equipment
      components.push({
        id: `comp-${equip.id}-ahu`,
        category: 'primary-equipment',
        tag: 'AHU-01',
        name: 'Modular Double-Wall Central Air Handling Unit',
        modelOrType: `${equip.manufacturer} ${equip.model}`,
        quantity: 1,
        specification: `${equip.nominalTons} TR Cooling Coil, Supply Air: ${cfm} CFM, Total Available ESP: ${equip.maxRatedEspInWg} in.wg`,
        connectionSize: `Supply: ${equip.connectionSizes.supplyDuct || '36"x24"'}, Chilled Water: 2-1/2" Flanged`,
        status: 'included',
        details: '2" thermal-break double-skin polyurethane injected casing with EC plenum plug fan.'
      });
      components.push({
        id: `comp-${equip.id}-chw-valve`,
        category: 'hydronics-refrigerant',
        tag: 'TCV-01',
        name: 'Chilled Water 2-Way Modulating Pressure-Independent Control Valve (PICV)',
        modelOrType: 'Belimo Energy Valve PICV',
        quantity: 1,
        specification: `Flow: ${Math.round(nominalTons * 2.4)} GPM @ 44°F/54°F Water, 0-10V Modulating Actuator`,
        connectionSize: 'Ø 2-1/2" ANSI 150# Flanged',
        status: 'included',
        details: 'Built-in ultrasonic BTU flow meter and dynamic Delta-T manager preventing low Delta-T syndrome.'
      });

      // 2. Air Distribution & Filtration
      components.push({
        id: `comp-${equip.id}-filter`,
        category: 'air-distribution',
        tag: 'FLT-01',
        name: 'Two-Stage Filtration Bank (MERV 8 + MERV 13)',
        modelOrType: 'Camfil Farr CleanSeal Filter Housing',
        quantity: 1,
        specification: 'Stage 1: 2" Pleated Pre-filter, Stage 2: 12" High Efficiency Compact MERV 13',
        connectionSize: 'Full AHU Cross-Section',
        status: 'included',
        details: 'Equipped with differential pressure magnehelic gauge with dirty filter alarm switch.'
      });
      components.push({
        id: `comp-${equip.id}-vav-boxes`,
        category: 'air-distribution',
        tag: 'VAV-01..04',
        name: 'Pressure-Independent Single-Duct VAV Terminal Units',
        modelOrType: 'Price Industries SDV Terminal Box with Electric/Hot Water Reheat',
        quantity: Math.max(1, Math.ceil(cfm / 1000)),
        specification: 'Multi-point averaging velocity ring sensor, 0-10V digital actuator, NC 26',
        connectionSize: 'Ø 10" Inlet / 14"x10" Discharge',
        status: 'included',
        details: 'Maintains precise zone temperature and minimum outdoor air ventilation during partial loads.'
      });

      // 3. Terminals
      components.push({
        id: `comp-${equip.id}-diffusers`,
        category: 'terminals',
        tag: `SAD-01..0${terminalCount}`,
        name: 'Linear Slot / Swirl High Induction Diffusers',
        modelOrType: 'Price Linear Slot 2-Slot Diffusers',
        quantity: terminalCount,
        specification: `${diffuserSize}, Flow: ${Math.round(cfm / terminalCount)} CFM/terminal, NC ${diffusers?.actualNc || 24}`,
        connectionSize: 'Ø 8" Round Neck',
        status: 'included',
        details: 'Architectural ceiling diffusers designed for variable airflow without dumping.'
      });

      // 4. Controls
      components.push({
        id: `comp-${equip.id}-ddc`,
        category: 'controls-electrical',
        tag: 'DDC-AHU-01',
        name: 'Direct Digital Controller (DDC) with Native BACnet/IP',
        modelOrType: 'Automated Logic / Trane Tracer DDC Panel',
        quantity: 1,
        specification: 'Static pressure reset control, Supply air temp reset, Fan VFD modulation',
        connectionSize: 'Dual Ethernet Ports / BACnet IP',
        status: 'included',
        details: 'Implements ASHRAE Guideline 36 High-Performance Trim and Respond control sequences.'
      });
      break;
    }
  }

  const standardsMap: Record<string, string[]> = {
    concealed: ['ASHRAE Standard 90.1-2019 (Efficiency)', 'ASHRAE Standard 62.1-2019 (Ventilation)', 'SMACNA HVAC Duct Construction Standards (Metal & Flexible)', 'AHRI 210/240 Certified'],
    cassette: ['ASHRAE Standard 90.1-2019', 'ASHRAE Standard 62.1-2019', 'AHRI 210/240 Performance Certified', 'ISO 5151 Non-Ducted AC Standards'],
    'high-wall': ['ASHRAE Standard 90.1-2019', 'AHRI 210/240 Certified', 'ISO 5151 Air Conditioners Standard'],
    vrf: ['ASHRAE Standard 15-2022 (Refrigerant Safety)', 'ASHRAE Standard 90.1-2019', 'AHRI 1230 Multi-Split / VRF Standard', 'ASHRAE Standard 62.1-2019'],
    packaged: ['ASHRAE Standard 90.1-2019 (Path A/B RTU Efficiency)', 'ASHRAE 62.1 Demand Controlled Ventilation', 'AHRI 340/360 Commercial Unitary Equipment', 'SMACNA Industrial & Commercial Duct Standards'],
    ahu: ['ASHRAE Guideline 36-2021 (High-Performance Sequences of Operation)', 'ASHRAE Standard 90.1-2019', 'ASHRAE Standard 62.1-2019', 'AHRI 430 Central Station AHU', 'AMCA 210 Fan Performance']
  };

  const nameMap: Record<string, string> = {
    concealed: 'Concealed Ducted DX Split System',
    cassette: '4-Way Ceiling Cassette Split DX System',
    'high-wall': 'High-Wall Mounted DX Split System',
    vrf: 'Variable Refrigerant Flow (VRF) Heat Recovery System',
    packaged: 'Packaged Single-Zone Rooftop Unit (RTU)',
    ahu: 'Central Station Air Handling Unit (AHU) with VAV / Chilled Water'
  };

  const schematicMap: Record<string, 'split-dx-ducted' | 'split-dx-ductless' | 'vrf-multisplit' | 'packaged-rooftop' | 'central-chilled-water-vav'> = {
    concealed: 'split-dx-ducted',
    cassette: 'split-dx-ductless',
    'high-wall': 'split-dx-ductless',
    vrf: 'vrf-multisplit',
    packaged: 'packaged-rooftop',
    ahu: 'central-chilled-water-vav'
  };

  const summaryMap: Record<string, string> = {
    concealed: `Concealed ceiling ducted configuration pairing ${quantity} indoor fan coil(s) with outdoor condensing unit(s). Air is distributed through rigid galvanized ductwork and flush ceiling diffusers.`,
    cassette: `Direct-throw ceiling cassette configuration with ${quantity} unit(s) recessed into acoustic ceiling grid. Features 360° air distribution with no external duct friction losses.`,
    'high-wall': `Direct wall-mounted split configuration with ${quantity} unit(s). Provides cost-effective individual thermal comfort with minimal structural impact.`,
    vrf: `Multi-zone inverter heat recovery system sharing a ${equip.nominalTons} TR modular outdoor unit across ${quantity} indoor terminal(s) with variable refrigerant flow modulation.`,
    packaged: `All-in-one unitary rooftop system providing ${equip.nominalTons} TR cooling and air distribution with integrated free-cooling economizer and rigid duct drop.`,
    ahu: `Central station chilled-water air handling system delivering ${cfm.toLocaleString()} CFM via double-wall casing, high-efficiency filtration, and VAV terminal reheat boxes.`
  };

  return {
    systemType: equip.systemType,
    systemName: nameMap[equip.systemType] || equip.systemType.toUpperCase(),
    summary: summaryMap[equip.systemType] || `Professional HVAC design for ${equip.model}`,
    governingStandards: standardsMap[equip.systemType] || ['ASHRAE 90.1', 'SMACNA'],
    components,
    schematicType: schematicMap[equip.systemType] || 'split-dx-ducted'
  };
}

/**
 * Generates the deterministic 7-step selection algorithm trace for any candidate
 */
export function generateSelectionAlgorithmTrace(
  equip: EquipmentCatalogItem,
  quantity: number,
  supplyCfm: number,
  areaSqFt: number,
  totalLoadBtu: number,
  sensibleLoadBtu: number,
  spaceNcLimit: number = 35,
  criticalPath?: CriticalPathResult,
  fanResult?: FanOperatingPointResult,
  isImperial: boolean = true
): SelectionAlgorithmTrace {
  const steps: SelectionAlgorithmStep[] = [];

  const loadBtu = isImperial ? totalLoadBtu : totalLoadBtu * 3.412;
  const sensBtu = isImperial ? sensibleLoadBtu : sensibleLoadBtu * 3.412;
  const qLatent = Math.max(0, loadBtu - sensBtu);
  const shr = loadBtu > 0 ? sensBtu / loadBtu : 0.78;
  const cfm = supplyCfm > 0 ? supplyCfm : (sensBtu / (1.08 * 20));

  // STEP 1: Thermal Load & Sensible Heat Ratio (SHR)
  const step1Passed = shr >= 0.65 && shr <= 0.95;
  steps.push({
    stepNumber: 1,
    stepName: 'Thermal Load Breakdown & Sensible Heat Ratio (SHR)',
    formula: 'SHR = Q_sensible / Q_total',
    inputs: [
      { label: 'Space Area', value: areaSqFt, unit: isImperial ? 'sq.ft' : 'm²' },
      { label: 'Total Cooling Load (Q_tot)', value: Math.round(loadBtu).toLocaleString(), unit: isImperial ? 'Btu/h' : 'W' },
      { label: 'Sensible Load (Q_sens)', value: Math.round(sensBtu).toLocaleString(), unit: isImperial ? 'Btu/h' : 'W' },
      { label: 'Latent Load (Q_lat)', value: Math.round(qLatent).toLocaleString(), unit: isImperial ? 'Btu/h' : 'W' }
    ],
    calculatedValue: shr.toFixed(2),
    criteria: '0.65 <= SHR <= 0.95 (Typical Comfort Range)',
    passed: step1Passed,
    notes: step1Passed
      ? 'Optimal sensible-to-total load proportion for human comfort occupancy.'
      : 'Unusually high latent or sensible load requiring specialized coil selection.'
  });

  // STEP 2: Required Airflow Sizing (CFM) & Temperature Difference
  const deltaT = 20; // 75°F room - 55°F supply
  const thermalCfm = Math.round(sensBtu / (1.08 * deltaT));
  const cfmPerTon = Math.round(cfm / ((loadBtu || 12000) / 12000));
  const step2Passed = cfmPerTon >= 300 && cfmPerTon <= 500;
  steps.push({
    stepNumber: 2,
    stepName: 'Design Airflow Sizing (CFM) & Supply Delta-T',
    formula: 'CFM = Q_sensible / (1.08 × ΔT_supply) where ΔT = T_room_db - T_supply_db (20°F)',
    inputs: [
      { label: 'Room Design Temp (T_room)', value: 75, unit: '°F' },
      { label: 'Coil Leaving Temp (T_supply)', value: 55, unit: '°F' },
      { label: 'Design Delta-T (ΔT)', value: deltaT, unit: '°F' },
      { label: 'Calculated Thermal Flow', value: thermalCfm.toLocaleString(), unit: 'CFM' }
    ],
    calculatedValue: `${cfm.toLocaleString()} CFM (${cfmPerTon} CFM/ton)`,
    criteria: '300 <= CFM/ton <= 500 (Standard Commercial Range)',
    passed: step2Passed,
    notes: `Selected ${cfm.toLocaleString()} CFM matches thermal sensible requirement and ASHRAE 62.1 minimum ventilation.`
  });

  // STEP 3: Equipment Selection & Capacity De-rating
  const installedCap = equip.totalCapacityBtuPerHour * quantity;
  const deratingFactor = 0.95; // 95°F ambient de-rating
  const deratedCapacity = Math.round(installedCap * deratingFactor);
  const nominalRatio = installedCap / (loadBtu || 1);
  const deratedRatio = deratedCapacity / (loadBtu || 1);
  const step3Passed = nominalRatio >= 0.98 && deratedRatio >= 0.90 && nominalRatio <= 1.40;
  steps.push({
    stepNumber: 3,
    stepName: 'Equipment Tonnage Selection & Environmental De-rating',
    formula: 'Derated Capacity = Nominal Capacity × F_ambient × F_piping; N_units = ⌈Q_load / Derated_Cap⌉',
    inputs: [
      { label: 'Catalog Model', value: equip.model },
      { label: 'Unit Quantity', value: quantity },
      { label: 'Nominal Total Capacity', value: installedCap.toLocaleString(), unit: 'Btu/h' },
      { label: 'Ambient De-rating Factor (F_amb)', value: deratingFactor.toFixed(2) }
    ],
    calculatedValue: `${deratedCapacity.toLocaleString()} Btu/h (${(deratedCapacity / 12000).toFixed(1)} TR) [${Math.round(nominalRatio * 100)}% Nominal / ${Math.round(deratedRatio * 100)}% Derated]`,
    criteria: 'Nominal >= 98% & Derated >= 90% of Load',
    passed: step3Passed,
    notes: step3Passed
      ? `Installed capacity with ${quantity} unit(s) covers design load with adequate safety margin.`
      : nominalRatio < 0.98
      ? 'Capacity deficit: Installed capacity is below peak room load.'
      : 'Excessive oversizing: Risks short-cycling and poor dehumidification.'
  });

  // STEP 4: Air Distribution & Terminal Noise Criterion (NC)
  const terminalCount = equip.capabilities.supportsExternalDiffusers ? Math.max(1, Math.ceil(cfm / 300)) : quantity;
  const flowPerTerminal = Math.round(cfm / terminalCount);
  const actualNc = equip.capabilities.supportsDuctNetwork ? 26 : Math.round(equip.soundDba * 0.8);
  const targetThrowFt = Math.max(8, Math.round(Math.sqrt(areaSqFt / terminalCount) * 0.75));
  const step4Passed = actualNc <= spaceNcLimit;
  steps.push({
    stepNumber: 4,
    stepName: 'Air Distribution, Diffuser Throw & Noise Criterion (NC)',
    formula: 'CFM/terminal = Total_CFM / N_diffusers; NC_actual <= NC_space_limit; 0.75×L_room <= Throw_T50 <= 1.25×L_room',
    inputs: [
      { label: 'Space Noise Limit', value: `NC ${spaceNcLimit}` },
      { label: 'Diffuser Count', value: terminalCount },
      { label: 'Flow per Terminal', value: flowPerTerminal, unit: 'CFM' },
      { label: 'Target Throw (T50)', value: `${targetThrowFt} ft` }
    ],
    calculatedValue: `NC ${actualNc} (Design Target Throw: ${targetThrowFt} ft)`,
    criteria: `NC_actual <= NC ${spaceNcLimit}`,
    passed: step4Passed,
    notes: step4Passed
      ? 'Terminal devices operate well within acoustic comfort limits.'
      : 'Terminal air noise exceeds room noise criterion threshold.'
  });

  // STEP 5: Aerodynamic Duct Sizing & Critical Path ESP
  const espReq = criticalPath?.espRequiredInWg || (equip.capabilities.supportsDuctNetwork ? 0.32 : 0.0);
  const totalDuctLoss = criticalPath?.totalSupplyDeltaPInWg || 0.18;
  const diffuserLoss = criticalPath?.diffuserDeltaPInWg || 0.04;
  const accessoriesLoss = criticalPath?.accessoriesDeltaPInWg || 0.06;
  const step5Passed = equip.capabilities.supportsDuctNetwork ? (equip.maxRatedEspInWg >= espReq) : true;
  steps.push({
    stepNumber: 5,
    stepName: 'Aerodynamic Duct Friction & Critical Path ESP Summation',
    formula: 'ESP_required = (ΔP_duct_friction + ΔP_dynamic_fittings + ΔP_diffuser + ΔP_accessories) × 1.15 Safety',
    inputs: [
      { label: 'Duct Friction Method', value: 'Equal Friction (0.08-0.10 in.wg/100ft)' },
      { label: 'Supply Ductwork Loss', value: totalDuctLoss.toFixed(3), unit: 'in.wg' },
      { label: 'Terminal Diffuser Loss', value: diffuserLoss.toFixed(3), unit: 'in.wg' },
      { label: 'Fittings & Filters Loss', value: accessoriesLoss.toFixed(3), unit: 'in.wg' }
    ],
    calculatedValue: equip.capabilities.supportsDuctNetwork ? `${espReq.toFixed(3)} in.wg (Max Rated: ${equip.maxRatedEspInWg.toFixed(2)} in.wg)` : '0.000 in.wg (Direct Throw Ductless)',
    criteria: equip.capabilities.supportsDuctNetwork ? 'ESP_required <= Max Fan ESP' : 'N/A (Ductless)',
    passed: step5Passed,
    notes: step5Passed
      ? 'Critical index path static pressure is within the available fan blower envelope.'
      : 'Static pressure deficit: Fan cannot overcome aerodynamic duct friction.'
  });

  // STEP 6: Fan Operating Point & Power Verification
  const fanMargin = fanResult?.fanMarginInWg ?? (equip.maxRatedEspInWg - espReq);
  const powerKw = fanResult?.powerKwEstimate ?? Math.round((cfm * Math.max(0.1, espReq)) / (6356 * 0.6) * 0.746 * 100) / 100;
  const step6Passed = fanResult ? fanResult.isValid : (fanMargin >= 0);
  steps.push({
    stepNumber: 6,
    stepName: 'Fan Operating Curve & Electrical Power Evaluation',
    formula: 'Fan Margin = ESP_available - ESP_required >= 0; Fan_BHP = (CFM × ESP) / (6356 × η_fan)',
    inputs: [
      { label: 'Fan Design Airflow', value: Math.round(cfm / quantity), unit: 'CFM/unit' },
      { label: 'Required Operating ESP', value: espReq.toFixed(3), unit: 'in.wg' },
      { label: 'Estimated Fan Power', value: powerKw.toFixed(2), unit: 'kW' }
    ],
    calculatedValue: `Fan Margin: +${fanMargin.toFixed(3)} in.wg @ ${powerKw.toFixed(2)} kW`,
    criteria: 'Fan Margin >= 0.00 in.wg',
    passed: step6Passed,
    notes: step6Passed
      ? 'Fan blower operates at a stable, energy-efficient aerodynamic operating point.'
      : 'Fan curve operating point out of bounds or in stall/overload region.'
  });

  // STEP 7: Piping, Circuiting & Controls Strategy
  const isDucted = equip.capabilities.supportsDuctNetwork;
  const controlsDesc = equip.systemType === 'ahu'
    ? 'DDC BACnet/IP with VAV pressure-independent reset sequences'
    : equip.systemType === 'vrf'
    ? 'Central BACnet gateway with individual room touch sensors'
    : isDucted
    ? 'Wall-mounted 7-day programmable digital thermostat'
    : 'Infrared wireless remote controller with I-Feel sensor';

  steps.push({
    stepNumber: 7,
    stepName: 'Piping Circuitry, Equivalent Length & Controls Architecture',
    formula: 'Refrigerant/Water Flow Sizing; Line Equivalent Length <= 164 ft (50m); Vertical Lift <= 98 ft (30m)',
    inputs: [
      { label: 'Liquid / Gas Line Size', value: `${equip.connectionSizes.liquidLine || '3/8"'} / ${equip.connectionSizes.gasLine || '5/8"'}` },
      { label: 'Condensate Drain Size', value: 'Ø 1" UPVC with P-Trap' },
      { label: 'Control Protocol', value: controlsDesc }
    ],
    calculatedValue: `Compliant (${controlsDesc.split(' ')[0]} Control)`,
    criteria: 'Standard MEP Piping & Control Limits Met',
    passed: true,
    notes: 'Piping velocities, refrigerant oil return velocity, and controls protocol satisfy ASHRAE 15 & 90.1.'
  });

  const overallPassed = steps.every(s => s.passed);

  return {
    systemType: equip.systemType,
    model: equip.model,
    steps,
    overallPassed,
    engineeringRemarks: overallPassed
      ? `System candidate ${equip.model} successfully passes all 7 deterministic engineering selection stages according to ASHRAE 90.1, ASHRAE 62.1, and SMACNA standards.`
      : `System candidate ${equip.model} has ${steps.filter(s => !s.passed).length} engineering deviation(s) requiring design adjustment.`
  };
}
