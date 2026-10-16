import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface CatalogDecorativeUnit {
    spaceName: string
    hapLoad: number
    hapCfm: number
    unitType: string
    capacity: number
    cfm: number
    model: string
    rowNumber: number
    source: string
  }

  interface CatalogDuctedUnit {
    spaceName: string
    hapTotal: number
    hapSensible: number
    hapCfm: number
    enteringDbWb: string
    capacity: number
    sensibleCapacity: number
    cfm: number
    model: string
    esp: string
    qty: number
    rowNumber: number
    source: string
  }

  interface CatalogDecorativeSet {
    highWall: CatalogDecorativeUnit[]
    cassette: CatalogDecorativeUnit[]
  }

  type CustomCatalogResult =
    | { data: CatalogDecorativeSet | CatalogDuctedUnit[]; filePath: string; name: string | undefined; error?: undefined }
    | { error: string; data?: undefined }
    | null

  interface Window {
    electron: ElectronAPI
    api: {
      loadDefaultCatalogs: () => Promise<{
        decorative: CatalogDecorativeSet | null
        ducted: CatalogDuctedUnit[] | null
        errors: string[]
      }>
      selectCustomCatalog: (type: 'decorative' | 'ducted') => Promise<CustomCatalogResult>
    }
  }
}
