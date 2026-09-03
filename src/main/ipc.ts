import { ipcMain, dialog, shell, clipboard, nativeTheme, BrowserWindow, app } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'fs'
import { analyzeCached, clearAnalysisCache } from './metadata'
import { cookieArgs, cookieStatus, forgetCookies } from './cookies'
import { applyGlobalShortcut, isGlobalShortcutRegistered } from './shortcuts'
import { downloadManager } from './downloader'
import { cleanupTelegramMediaPath, shareFile, shareInfo } from './share'
import { openWithPlayer } from './player'
import { basename, extname, join } from 'path'
import { loadSettings, saveSettings } from './settings'
import { getToolStatus, updateYtdlp, resetToolCache } from './ytdlp'
import {
  consumePendingExternalUrl,
  consumePendingOpenSettings,
  deliverExternalUrl,
  ensureMainWindow,
  clearCachedYtdlpUpdate,
  clearCachedUpdates,
  isKnownRenderer,
  isTrustedRendererUrl,
  publishUpdateAvailability
} from './windows'
import { installBrowserExtension, getInstalledExtensionPath } from './extension'
import { getStorageStatus, relaunchOutsideSandbox } from './storage'
import {
  defaultBrowser,
  openBrowserPage,
  openExternalUrlIn,
  registerChromeExternalExtension
} from './browsers'
import {
  CHROME_WEB_STORE_PUBLISHED,
  CHROME_WEB_STORE_URL,
  SNAG_EXTENSION_ID
} from '@shared/browserIntegration'
import { GLOBAL_SHORTCUT } from '@shared/types'
import { applyLaunchAtLogin } from './startup'
import { isHttpUrl } from './protocol'
import { checkForUpdates } from './updates'
import { canAutoUpdate, downloadAppUpdate, installAppUpdate } from './appUpdater'
import type {
  AnalyzeResult,
  BrowserExtensionStatus,
  BrowserInfo,
  CookieStatus,
  DownloadRequest,
  ExtensionSetupResult,
  GlobalShortcutStatus,
  Settings,
  SettingsSection,
  ProgressUpdate,
  DownloadJob,
  StorageStatus
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
  downloadManager.on('reordered', (jobs: DownloadJob[]) => broadcast('jobsReordered', jobs))
  downloadManager.on('removed', (ids: string[]) => broadcast('jobsRemoved', ids))

  handleTrusted('analyze', async (_e, url: string): Promise<AnalyzeResult> => {
    try {
      const settings = loadSettings()
      const info = await analyzeCached(url, settings.ytdlpPath, cookieArgs(settings))
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

  handleTrusted('pauseJob', async (_e, jobId: string): Promise<void> => {
    downloadManager.pause(jobId)
  })

  handleTrusted('resumeJob', async (_e, jobId: string): Promise<void> => {
    downloadManager.resume(jobId)
  })

  handleTrusted('reorderJobs', async (_e, jobIds: unknown): Promise<void> => {
    if (!Array.isArray(jobIds)) return
    downloadManager.reorderJobs(jobIds.filter((id): id is string => typeof id === 'string'))
  })

  handleTrusted('clearCompleted', async (): Promise<void> => {
    downloadManager.clearCompleted()
  })

  // The queue is a list of files, so files deleted in Explorer while Snag was
  // in the background should not still be sitting in it. The renderer asks for
  // this whenever the window comes forward.
  handleTrusted('syncJobFiles', async (): Promise<string[]> => downloadManager.pruneMissingFiles())

  handleTrusted('deleteJobFile', async (_e, jobId: string) => {
    const job = downloadManager.getJob(jobId)
    if (job?.filepath) cleanupTelegramMediaPath(job.filepath)
    return downloadManager.deleteCompletedFile(jobId)
  })

  handleTrusted('deleteCompletedFiles', async () => {
    for (const job of downloadManager.getJobs()) {
      if (job.status === 'completed' && job.filepath) cleanupTelegramMediaPath(job.filepath)
    }
    return downloadManager.deleteAllCompletedFiles()
  })

  handleTrusted('shareFile', async (_e, jobId: string, targetId?: string): Promise<string> => {
    const job = downloadManager.getJob(jobId)
    if (!job || job.status !== 'completed' || !job.filepath || !existsSync(job.filepath)) {
      return 'The completed file could not be found.'
    }
    return shareFile(job.filepath, typeof targetId === 'string' ? targetId : undefined)
  })

  handleTrusted('getShareInfo', async () => shareInfo())

  handleTrusted('playFile', async (_e, jobId: string): Promise<string> => {
    const job = downloadManager.getJob(jobId)
    if (!job || job.status !== 'completed' || !job.filepath || !existsSync(job.filepath)) {
      return 'The completed file could not be found.'
    }
    return openWithPlayer(job.filepath)
  })

  handleTrusted('pickShareApp', async (e): Promise<{ path: string; label: string } | null> => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow()
    // The Start Menu's Programs folder lists installed apps as shortcuts, which
    // is where people know their apps by name; shortcuts resolve to the program.
    const programs = process.env['APPDATA']
      ? join(process.env['APPDATA'], 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      : undefined
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose an app that can receive a file',
      defaultPath: programs && existsSync(programs) ? programs : undefined,
      properties: ['openFile'],
      filters: [
        { name: 'Apps and shortcuts', extensions: ['lnk', 'exe', 'bat', 'cmd'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    const chosen = result.filePaths[0]
    let path = chosen
    if (extname(chosen).toLowerCase() === '.lnk') {
      try {
        path = shell.readShortcutLink(chosen).target
      } catch {
        return null
      }
    }
    if (!path || !existsSync(path)) return null
    return { path, label: basename(chosen, extname(chosen)) || basename(path, extname(path)) }
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
    if ('ytdlpPath' in patch) {
      resetToolCache()
      clearAnalysisCache()
    }
    if (
      'parallelDownloads' in patch &&
      next.parallelDownloads > previous.parallelDownloads
    ) {
      downloadManager.reschedule()
    }
    if ('launchAtLogin' in patch && next.launchAtLogin !== previous.launchAtLogin) {
      applyLaunchAtLogin(next.launchAtLogin)
    }
    if ('globalShortcutEnabled' in patch && next.globalShortcutEnabled !== previous.globalShortcutEnabled) {
      applyGlobalShortcut(next.globalShortcutEnabled)
    }
    if ('theme' in patch && next.theme !== previous.theme) nativeTheme.themeSource = next.theme
    if (('cookieSource' in patch || 'cookiesFile' in patch) && (next.cookieSource !== previous.cookieSource || next.cookiesFile !== previous.cookiesFile)) {
      clearAnalysisCache()
    }
    return next
  })

  handleTrusted('getCookieStatus', async (): Promise<CookieStatus> => cookieStatus(loadSettings()))

  handleTrusted('pickCookiesFile', async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a cookies.txt file',
      properties: ['openFile'],
      filters: [
        { name: 'Cookies file', extensions: ['txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  handleTrusted('forgetCookies', async (): Promise<void> => {
    forgetCookies()
    saveSettings({ cookiesSyncedAt: 0 })
    clearAnalysisCache()
  })

  handleTrusted('getGlobalShortcutStatus', async (): Promise<GlobalShortcutStatus> => ({
    accelerator: GLOBAL_SHORTCUT,
    registered: isGlobalShortcutRegistered()
  }))

  handleTrusted('pickFolder', async (e, current?: string): Promise<string | null> => {
    // Attach the dialog to the window that asked for it; the first window in
    // the list can be the hidden, prewarmed quick popup, which would leave the
    // dialog parented to something the user cannot see.
    const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow()
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
    clearAnalysisCache()
    if (res.ok) clearCachedYtdlpUpdate()
    return res
  })

  // --- Browser handoff (snag:// deep links) ---

  handleTrusted('consumePendingExternalUrl', async (e): Promise<string | null> => {
    return consumePendingExternalUrl(e.sender.id)
  })

  handleTrusted('consumePendingOpenSettings', async (e): Promise<SettingsSection | null> => {
    return consumePendingOpenSettings(e.sender.id)
  })

  handleTrusted('openInMainWindow', async (_e, url: string): Promise<void> => {
    if (typeof url === 'string' && isHttpUrl(url)) deliverExternalUrl(url, 'main')
    else ensureMainWindow()
  })

  handleTrusted('installBrowserExtension', async () => installBrowserExtension())

  handleTrusted('getBrowserExtensionPath', async (): Promise<string | null> => {
    return getInstalledExtensionPath()
  })

  handleTrusted('getBrowserExtensionStatus', async (): Promise<BrowserExtensionStatus> => {
    const settings = loadSettings()
    const lastSeen = settings.browserExtensionLastSeen
    const age = Date.now() - lastSeen
    return {
      detected: lastSeen > 0 && age < 30 * 24 * 60 * 60 * 1000,
      // The extension heartbeats once a minute while Snag runs and the
      // heartbeat is persisted at most every five minutes.
      live: lastSeen > 0 && age < 10 * 60 * 1000,
      lastSeen,
      path: getInstalledExtensionPath(),
      redirected: getStorageStatus().redirected
    }
  })

  // Everything that can be automated for the extension install, in one call:
  // prepare the folder, put its path on the clipboard, and open the user's
  // default Chromium browser at its extensions page. Once the extension is in
  // the Chrome Web Store, Chrome installs it by itself from a registry entry
  // and only asks the user to enable it.
  handleTrusted('beginExtensionSetup', async (): Promise<ExtensionSetupResult> => {
    const preferred = await defaultBrowser()
    if (CHROME_WEB_STORE_PUBLISHED && (preferred?.id ?? 'chrome') === 'chrome') {
      const registerError = await registerChromeExternalExtension(SNAG_EXTENSION_ID)
      const opened = openExternalUrlIn(preferred, CHROME_WEB_STORE_URL)
      return {
        ok: !registerError,
        browser: opened.browser,
        mode: 'store',
        error: registerError || opened.error || undefined
      }
    }
    const installed = installBrowserExtension()
    if (!installed.ok || !installed.path) {
      return { ok: false, browser: null, mode: 'unpacked', error: installed.error }
    }
    clipboard.writeText(installed.path)
    const opened = openBrowserPage(preferred, 'extensions/')
    return {
      ok: true,
      path: installed.path,
      redirected: installed.redirected,
      browser: opened.browser,
      mode: 'unpacked',
      error: opened.error || undefined
    }
  })

  handleTrusted('getDefaultBrowser', async (): Promise<BrowserInfo | null> => defaultBrowser())

  handleTrusted('openBrowserExtensionsPage', async (): Promise<string> => {
    return openBrowserPage(await defaultBrowser(), 'extensions/').error
  })

  handleTrusted('revealBrowserExtensionFolder', async (): Promise<string> => {
    const path = getInstalledExtensionPath()
    if (!path) return 'The extension folder has not been prepared yet.'
    return shell.openPath(path)
  })

  // The main-process clipboard works regardless of renderer focus, unlike
  // navigator.clipboard in a sandboxed window.
  handleTrusted('copyText', async (_e, text: string): Promise<void> => {
    if (typeof text === 'string' && text) clipboard.writeText(text)
  })

  handleTrusted('getStorageStatus', async (): Promise<StorageStatus> => getStorageStatus())

  handleTrusted('relaunchOutsideSandbox', async (): Promise<boolean> => relaunchOutsideSandbox())

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
