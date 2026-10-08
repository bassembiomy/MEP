import { selectEquipmentForLoad, SelectedEquipmentResult, EquipmentSelectionConstraints } from '../systemArchitecture/equipmentSelector';
import { STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs';
import { EquipmentCatalogItem } from '../types';

export function adaptSelectEquipment(
  reqCfm: number,
  reqBtu: number,
  systemType: string = 'concealed',
  customCatalog?: EquipmentCatalogItem[],
  constraints?: EquipmentSelectionConstraints
): SelectedEquipmentResult | null {
  const catalog = customCatalog || STANDARD_EQUIPMENT_CATALOG;
  return selectEquipmentForLoad(reqCfm, reqBtu, systemType, catalog, constraints);
}
