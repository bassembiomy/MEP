import { EquipmentServiceZone, DesignControlMode } from '../zoning/zonePartitioner';
import { sizeOutdoorAirLouver, IntakeLouverItem } from './louverSizer';

export interface OutdoorAirSystem {
  id: string;
  designControlMode: DesignControlMode;
  designOutdoorAirCfm: number;
  sourceType: 'direct-intake' | 'fresh-air-fan' | 'fahu' | 'doas';
  louver: IntakeLouverItem;
  connectedUnitIds: string[];
  ductSectionIds: string[];
  intakePosition: { x: number; y: number };
  pressureLossInWg: number;
  pressurizationStrategy: 'positive' | 'neutral' | 'negative';
  targetPressurizationCfm: number;
  isBalancedWithExhaust: boolean;
}

export function routeFreshAirDucts(
  zones: EquipmentServiceZone[],
  totalOaCfm: number,
  louverPos: { x: number; y: number } = { x: 50, y: 0 }
): OutdoorAirSystem {
  const louver = sizeOutdoorAirLouver(totalOaCfm);
  const connectedUnitIds: string[] = [];
  const ductSectionIds: string[] = [];

  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (z.outdoorAirConnectionApproved) {
      connectedUnitIds.push(z.id);
      ductSectionIds.push(`FAD-${z.unitTag}-1`);
    }
  }

  // Calculate overall outdoor air duct pressure loss
  const pressureLoss = parseFloat((louver.pressureDropInWg + 0.05).toFixed(3));

  return {
    id: 'OAS-01',
    designControlMode: 'ai',
    designOutdoorAirCfm: totalOaCfm,
    sourceType: 'direct-intake',
    louver,
    connectedUnitIds,
    ductSectionIds,
    intakePosition: louverPos,
    pressureLossInWg: pressureLoss,
    pressurizationStrategy: 'positive',
    targetPressurizationCfm: Math.round(totalOaCfm * 0.15),
    isBalancedWithExhaust: true
  };
}
