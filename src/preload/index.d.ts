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
    }
  }
}
