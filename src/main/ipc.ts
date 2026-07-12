import { ipcMain, dialog, shell, clipboard, BrowserWindow, app } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'fs'
import { execFile, spawn } from 'child_process'
import { join } from 'path'
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

const SHARE_SCRIPT = `
$target = $env:SNAG_SHARE_FILE
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { exit 2 }
$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace((Split-Path -LiteralPath $target -Parent))
$item = $folder.ParseName((Split-Path -Leaf $target))
$verb = $item.Verbs() | Where-Object { $_.Name.Replace('&', '') -eq 'Share' } | Select-Object -First 1
if (-not $verb) { exit 3 }
$verb.DoIt()
`

function openWindowsShareSheet(target: string): Promise<string> {
  if (process.platform !== 'win32') return Promise.resolve('File sharing is currently supported on Windows.')
  const encoded = Buffer.from(SHARE_SCRIPT, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 10000, env: { ...process.env, SNAG_SHARE_FILE: target } },
      (error) => resolve(error ? 'Windows could not open the Share panel for this file.' : '')
    )
  })
}

function launchChromeExtensions(): string {
  const candidates = [
    process.env['PROGRAMFILES'] && join(process.env['PROGRAMFILES'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['LOCALAPPDATA'] && join(process.env['LOCALAPPDATA'], 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter((value): value is string => !!value)
  const chrome = candidates.find((candidate) => existsSync(candidate))
  if (!chrome) return 'Google Chrome was not found. Open chrome://extensions manually.'
  try {
    const child = spawn(chrome, ['chrome://extensions/'], { detached: true, stdio: 'ignore' })
    child.unref()
    return ''
  } catch (err) {
    return (err as Error).message || 'Chrome could not be opened.'
  }
}

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

  handleTrusted('deleteJobFile', async (_e, jobId: string) => {
    return downloadManager.deleteCompletedFile(jobId)
  })

  handleTrusted('deleteCompletedFiles', async () => {
    return downloadManager.deleteAllCompletedFiles()
  })

  handleTrusted('shareFile', async (_e, jobId: string): Promise<string> => {
    const job = downloadManager.getJob(jobId)
    if (!job || job.status !== 'completed' || !job.filepath || !existsSync(job.filepath)) {
      return 'The completed file could not be found.'
    }
    return openWindowsShareSheet(job.filepath)
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

  handleTrusted('getBrowserExtensionStatus', async () => {
    const settings = loadSettings()
    const lastSeen = settings.browserExtensionLastSeen
    return {
      detected: lastSeen > 0 && Date.now() - lastSeen < 30 * 24 * 60 * 60 * 1000,
      lastSeen,
      path: getInstalledExtensionPath()
    }
  })

  handleTrusted('openBrowserExtensionSetup', async () => {
    const installed = installBrowserExtension()
    if (!installed.ok || !installed.path) return installed
    clipboard.writeText(installed.path)
    const error = launchChromeExtensions()
    return error ? { ...installed, error } : installed
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
