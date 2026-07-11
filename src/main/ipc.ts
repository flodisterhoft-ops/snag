import { ipcMain, dialog, shell, clipboard, BrowserWindow, app } from 'electron'
import { existsSync } from 'fs'
import { analyze } from './metadata'
import { downloadManager } from './downloader'
import { loadSettings, saveSettings } from './settings'
import { getToolStatus, updateYtdlp, resetToolCache } from './ytdlp'
import { consumePendingExternalUrl, deliverExternalUrl, ensureMainWindow } from './windows'
import { installBrowserExtension, getInstalledExtensionPath } from './extension'
import { isHttpUrl } from './protocol'
import { checkForUpdates } from './updates'
import type {
  AnalyzeResult,
  DownloadRequest,
  Settings,
  ProgressUpdate,
  DownloadJob
} from '@shared/types'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function registerIpc(): void {
  downloadManager.on('progress', (u: ProgressUpdate) => broadcast('progress', u))
  downloadManager.on('added', (j: DownloadJob) => broadcast('jobAdded', j))

  ipcMain.handle('analyze', async (_e, url: string): Promise<AnalyzeResult> => {
    try {
      const settings = loadSettings()
      const info = await analyze(url, settings.ytdlpPath)
      return { ok: true, info }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('enqueue', async (_e, request: DownloadRequest): Promise<DownloadJob> => {
    // Persist last-used kind so the picker can restore it next time.
    const settings = loadSettings()
    if (settings.rememberLastChoices && settings.lastKind !== request.kind) {
      saveSettings({ lastKind: request.kind })
    }
    return downloadManager.enqueue(request)
  })

  ipcMain.handle('cancel', async (_e, jobId: string): Promise<void> => {
    downloadManager.cancel(jobId)
  })

  ipcMain.handle('retry', async (_e, jobId: string): Promise<DownloadJob | null> => {
    return downloadManager.retry(jobId)
  })

  ipcMain.handle('clearCompleted', async (): Promise<void> => {
    downloadManager.clearCompleted()
  })

  ipcMain.handle('removeJob', async (_e, jobId: string): Promise<void> => {
    downloadManager.removeJob(jobId)
  })

  ipcMain.handle('getJobs', async (): Promise<DownloadJob[]> => {
    return downloadManager.getJobs()
  })

  ipcMain.handle('getSettings', async (): Promise<Settings> => {
    return loadSettings()
  })

  ipcMain.handle('setSettings', async (_e, patch: Partial<Settings>): Promise<Settings> => {
    const next = saveSettings(patch)
    if ('ytdlpPath' in patch) resetToolCache()
    return next
  })

  ipcMain.handle('pickFolder', async (_e, current?: string): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose download folder',
      properties: ['openDirectory', 'createDirectory']
    }
    if (current && existsSync(current)) opts.defaultPath = current
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('openPath', async (_e, target: string): Promise<void> => {
    if (target) await shell.openPath(target)
  })

  ipcMain.handle('showInFolder', async (_e, target: string): Promise<void> => {
    if (target && existsSync(target)) shell.showItemInFolder(target)
    else if (target) await shell.openPath(target)
  })

  ipcMain.handle('readClipboard', async (): Promise<string> => {
    return clipboard.readText() || ''
  })

  ipcMain.handle('getToolStatus', async () => {
    const settings = loadSettings()
    return getToolStatus(settings.ytdlpPath)
  })

  ipcMain.handle('updateYtdlp', async () => {
    const settings = loadSettings()
    const res = await updateYtdlp(settings.ytdlpPath)
    resetToolCache()
    return res
  })

  ipcMain.handle('getAppVersion', async (): Promise<string> => app.getVersion())

  // --- Browser handoff (snag:// deep links) ---

  ipcMain.handle('consumePendingExternalUrl', async (e): Promise<string | null> => {
    return consumePendingExternalUrl(e.sender.id)
  })

  ipcMain.handle('openInMainWindow', async (_e, url: string): Promise<void> => {
    if (typeof url === 'string' && isHttpUrl(url)) deliverExternalUrl(url, 'main')
    else ensureMainWindow()
  })

  ipcMain.handle('installBrowserExtension', async () => installBrowserExtension())

  ipcMain.handle('getBrowserExtensionPath', async (): Promise<string | null> => {
    return getInstalledExtensionPath()
  })

  ipcMain.handle('checkForUpdates', async () => checkForUpdates())
}
