import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  loadDefaultCatalogs: () => ipcRenderer.invoke('hvac:load-catalogs-default'),
  selectCustomCatalog: (type: 'decorative' | 'ducted') => ipcRenderer.invoke('hvac:load-catalogs-custom', type),
  /** Installed DWG converter (ODA File Converter / AutoCAD / LibreDWG) or null. */
  dwgConverter: () => ipcRenderer.invoke('cad:dwg-converter'),
  /** Convert DXF text to a DWG chosen in a Save dialog. */
  exportDwg: (dxf: string, suggestedName: string) => ipcRenderer.invoke('cad:export-dwg', { dxf, suggestedName })
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
