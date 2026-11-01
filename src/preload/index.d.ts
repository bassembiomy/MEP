import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      loadDefaultCatalogs: () => Promise<{
        decorative: { highWall: any[]; cassette: any[] } | null
        ducted: any[] | null
        errors: string[]
      }>
      selectCustomCatalog: (type: 'decorative' | 'ducted') => Promise<any>
      dwgConverter?: () => Promise<{ kind: 'oda' | 'autocad' | 'libredwg'; path: string } | null>
      exportDwg?: (
        dxf: string,
        suggestedName: string
      ) => Promise<{ ok: boolean; converter?: string; converterPath?: string; outputPath?: string; error?: string }>
    }
  }
}
