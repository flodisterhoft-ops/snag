import { ipcMain, dialog, shell, clipboard, BrowserWindow, app } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'fs'
import { analyze } from './metadata'
import { downloadManager } from './downloader'
import { loadSettings, saveSettings } from './settings'
import { getToolStatus, updateYtdlp, resetToolCache } from './ytdlp'
import {
  consumePendingExternalUrl,
  deliverExternalUrl,
  ensureMainWindow,
  clearCachedYtdlpUpdate,
  clearCachedUpdates,
  isKnownRenderer,
  isTrustedRendererUrl,
  publishUpdateAvailability
} from './windows'
import { installBrowserExtension, getInstalledExtensionPath } from './extension'
import { applyLaunchAtLogin } from './startup'
import { isHttpUrl } from './protocol'
import { checkForUpdates } from './updates'
import { canAutoUpdate, downloadAppUpdate, installAppUpdate } from './appUpdater'
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

function assertTrustedCaller(event: IpcMainInvokeEvent, channel: string): void {
  const frame = event.senderFrame
  const trusted =
    frame !== null &&
    frame.parent === null &&
    frame.frameTreeNodeId === event.sender.mainFrame.frameTreeNodeId &&
    isKnownRenderer(event.sender.id) &&
    isTrustedRendererUrl(frame.url)
  if (!trusted) {
    console.warn(`[snag] Blocked unauthorized IPC call: ${channel}`)
    throw new Error('Unauthorized IPC caller.')
  }
}

function handleTrusted<Args extends unknown[], Result>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedCaller(event, channel)
    return listener(event, ...(args as Args))
  })
}

export function registerIpc(): void {
  downloadManager.on('progress', (u: ProgressUpdate) => broadcast('progress', u))
  downloadManager.on('added', (j: DownloadJob) => broadcast('jobAdded', j))

  handleTrusted('analyze', async (_e, url: string): Promise<AnalyzeResult> => {
    try {
      const settings = loadSettings()
      const info = await analyze(url, settings.ytdlpPath)
      return { ok: true, info }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  handleTrusted('enqueue', async (_e, request: DownloadRequest): Promise<DownloadJob> => {
    // Persist last-used kind so the picker can restore it next time.
    const settings = loadSettings()
    if (settings.rememberLastChoices && settings.lastKind !== request.kind) {
      saveSettings({ lastKind: request.kind })
    }
    return downloadManager.enqueue(request)
  })

  handleTrusted('cancel', async (_e, jobId: string): Promise<void> => {
    downloadManager.cancel(jobId)
  })

  handleTrusted('retry', async (_e, jobId: string): Promise<DownloadJob | null> => {
    return downloadManager.retry(jobId)
  })

  handleTrusted('clearCompleted', async (): Promise<void> => {
    downloadManager.clearCompleted()
  })

  handleTrusted('removeJob', async (_e, jobId: string): Promise<void> => {
    downloadManager.removeJob(jobId)
  })

  handleTrusted('getJobs', async (): Promise<DownloadJob[]> => {
    return downloadManager.getJobs()
  })

  handleTrusted('getSettings', async (): Promise<Settings> => {
    return loadSettings()
  })

  handleTrusted('setSettings', async (_e, patch: Partial<Settings>): Promise<Settings> => {
    const previous = loadSettings()
    const next = saveSettings(patch)
    if ('ytdlpPath' in patch) resetToolCache()
    if (
      'parallelDownloads' in patch &&
      next.parallelDownloads > previous.parallelDownloads
    ) {
      downloadManager.reschedule()
    }
    if ('launchAtLogin' in patch && next.launchAtLogin !== previous.launchAtLogin) {
      applyLaunchAtLogin(next.launchAtLogin)
    }
    return next
  })

  handleTrusted('pickFolder', async (_e, current?: string): Promise<string | null> => {
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

  handleTrusted('openPath', async (_e, target: string): Promise<string> => {
    if (!target) return 'No path was provided.'
    return shell.openPath(target)
  })

  handleTrusted('showInFolder', async (_e, target: string): Promise<string> => {
    if (!target) return 'No path was provided.'
    if (existsSync(target)) {
      shell.showItemInFolder(target)
      return ''
    }
    return shell.openPath(target)
  })

  handleTrusted('readClipboard', async (): Promise<string> => {
    return clipboard.readText() || ''
  })

  handleTrusted('getToolStatus', async () => {
    const settings = loadSettings()
    return getToolStatus(settings.ytdlpPath)
  })

  handleTrusted('getAppVersion', async (): Promise<string> => app.getVersion())

  handleTrusted('updateYtdlp', async () => {
    const settings = loadSettings()
    const res = await updateYtdlp(settings.ytdlpPath)
    resetToolCache()
    if (res.ok) clearCachedYtdlpUpdate()
    return res
  })

  // --- Browser handoff (snag:// deep links) ---

  handleTrusted('consumePendingExternalUrl', async (e): Promise<string | null> => {
    return consumePendingExternalUrl(e.sender.id)
  })

  handleTrusted('openInMainWindow', async (_e, url: string): Promise<void> => {
    if (typeof url === 'string' && isHttpUrl(url)) deliverExternalUrl(url, 'main')
    else ensureMainWindow()
  })

  handleTrusted('installBrowserExtension', async () => installBrowserExtension())

  handleTrusted('getBrowserExtensionPath', async (): Promise<string | null> => {
    return getInstalledExtensionPath()
  })

  handleTrusted('checkForUpdates', async () => {
    const update = await checkForUpdates()
    if (update.status === 'success' || update.app || update.ytdlp) {
      publishUpdateAvailability(update)
    }
    return update
  })

  handleTrusted('dismissUpdates', async (): Promise<void> => {
    clearCachedUpdates()
  })

  handleTrusted('canAutoUpdate', async (): Promise<boolean> => canAutoUpdate())

  handleTrusted('downloadAppUpdate', async () => downloadAppUpdate())

  handleTrusted('installAppUpdate', async (): Promise<boolean> => installAppUpdate())
}
