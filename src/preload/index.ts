import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  Api,
  DownloadRequest,
  Settings,
  ProgressUpdate,
  DownloadJob,
  UpdateAvailability
} from '@shared/types'

const api: Api = {
  analyze: (url: string) => ipcRenderer.invoke('analyze', url),
  enqueue: (request: DownloadRequest) => ipcRenderer.invoke('enqueue', request),
  cancel: (jobId: string) => ipcRenderer.invoke('cancel', jobId),
  retry: (jobId: string) => ipcRenderer.invoke('retry', jobId),
  clearCompleted: () => ipcRenderer.invoke('clearCompleted'),
  removeJob: (jobId: string) => ipcRenderer.invoke('removeJob', jobId),
  getJobs: () => ipcRenderer.invoke('getJobs'),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('setSettings', patch),
  pickFolder: (current?: string) => ipcRenderer.invoke('pickFolder', current),
  openPath: (target: string) => ipcRenderer.invoke('openPath', target),
  showInFolder: (target: string) => ipcRenderer.invoke('showInFolder', target),
  readClipboard: () => ipcRenderer.invoke('readClipboard'),
  getToolStatus: () => ipcRenderer.invoke('getToolStatus'),
  updateYtdlp: () => ipcRenderer.invoke('updateYtdlp'),
  onProgress: (cb: (u: ProgressUpdate) => void) => {
    const listener = (_e: IpcRendererEvent, u: ProgressUpdate): void => cb(u)
    ipcRenderer.on('progress', listener)
    return () => ipcRenderer.removeListener('progress', listener)
  },
  onJobAdded: (cb: (j: DownloadJob) => void) => {
    const listener = (_e: IpcRendererEvent, j: DownloadJob): void => cb(j)
    ipcRenderer.on('jobAdded', listener)
    return () => ipcRenderer.removeListener('jobAdded', listener)
  },
  consumePendingExternalUrl: () => ipcRenderer.invoke('consumePendingExternalUrl'),
  onExternalUrl: (cb: (url: string) => void) => {
    const listener = (_e: IpcRendererEvent, url: string): void => cb(url)
    ipcRenderer.on('externalUrl', listener)
    return () => ipcRenderer.removeListener('externalUrl', listener)
  },
  openInMainWindow: (url: string) => ipcRenderer.invoke('openInMainWindow', url),
  installBrowserExtension: () => ipcRenderer.invoke('installBrowserExtension'),
  getBrowserExtensionPath: () => ipcRenderer.invoke('getBrowserExtensionPath'),
  checkForUpdates: () => ipcRenderer.invoke('checkForUpdates'),
  onUpdateAvailable: (cb: (u: UpdateAvailability) => void) => {
    const listener = (_e: IpcRendererEvent, u: UpdateAvailability): void => cb(u)
    ipcRenderer.on('updateAvailable', listener)
    return () => ipcRenderer.removeListener('updateAvailable', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
