import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  loadDefaultCatalogs: () => ipcRenderer.invoke('hvac:load-catalogs-default'),
  selectCustomCatalog: (type: 'decorative' | 'ducted') => ipcRenderer.invoke('hvac:load-catalogs-custom', type)
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
