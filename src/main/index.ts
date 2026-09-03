import { app, BrowserWindow, globalShortcut, nativeTheme, shell } from 'electron'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { registerIpc } from './ipc'
import { deepLinkActionFromArgv, parseDeepLinkAction, PROTOCOL_SCHEME, type DeepLink } from './protocol'
import {
  ensureMainWindow,
  deliverExternalUrl,
  publishUpdateAvailability,
  prewarmQuickWindow,
  hasVisibleWindow,
  setWindowIdleProbe
} from './windows'
import { createTray, setTrayActiveCount } from './tray'
import { updateTaskbar } from './taskbar'
import { loadSettings } from './settings'
import { downloadManager } from './downloader'
import { checkForUpdates, shouldAutoCheck } from './updates'
import { refreshInstalledBrowserExtension } from './extension'
import { applyLaunchAtLogin, TRAY_START_FLAG } from './startup'
import { startLocalApi } from './localApi'
import { getStorageStatus, importSandboxedUserData } from './storage'
import { applyGlobalShortcut } from './shortcuts'
import { startClipboardWatcher } from './clipboardWatcher'
import { updateYtdlp, resetToolCache } from './ytdlp'
import { clearAnalysisCache } from './metadata'
import { notifyInfo } from './notify'

// Windows: needed for notifications to show the app identity/name correctly.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.flodisterhoft.snag')
}

// Register snag:// with the OS so browsers can hand links to Snag. In dev the
// registration must point at the electron binary plus the app path; a moved
// portable exe re-registers itself here on every launch (best effort).
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [resolve(process.argv[1])])
  }
} else {
  // electron-builder portable apps run from a temporary extracted executable.
  // Register the stable launcher the user actually opened, not that temp path.
  const executable = process.env['PORTABLE_EXECUTABLE_FILE']?.trim() || process.execPath
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, executable)
}

// Buttons on Snag's own Windows toasts come back as snag://job links. Only a
// job Snag itself finished may be opened, never an arbitrary path.
function openJobFile(id: string, action: 'open' | 'reveal'): void {
  const job = downloadManager.getJob(id)
  if (!job || job.status !== 'completed' || !job.filepath || !existsSync(job.filepath)) {
    ensureMainWindow()
    return
  }
  if (action === 'reveal') shell.showItemInFolder(job.filepath)
  else void shell.openPath(job.filepath)
}

function routeDeepLink(link: DeepLink): void {
  if (link.kind === 'job') {
    openJobFile(link.id, link.action)
    return
  }
  if (link.kind === 'open') {
    // The browser panel only needs the local API up. Stay in the tray when
    // that is how Snag lives anyway; otherwise a window is the only sign of life.
    if (!loadSettings().runInBackground) ensureMainWindow()
    return
  }
  console.log('[snag] browser handoff:', link.url)
  deliverExternalUrl(link.url, loadSettings().browserHandoff)
}

// macOS delivers custom protocols through open-url rather than argv. Queue an
// early event until BrowserWindow creation is legal.
const pendingOpenUrls: DeepLink[] = []
app.on('open-url', (event, rawUrl) => {
  event.preventDefault()
  const link = parseDeepLinkAction(rawUrl)
  if (!link) return
  if (app.isReady()) routeDeepLink(link)
  else pendingOpenUrls.push(link)
})

// Quit once the last download finishes if the user closed all windows and
// doesn't want Snag lingering in the tray. The warm (hidden) quick window
// still counts as "closed" here — only visible windows keep the app alive.
function maybeQuitWhenIdle(): void {
  if (
    !hasVisibleWindow() &&
    !loadSettings().runInBackground &&
    !downloadManager.hasActiveWork()
  ) {
    app.quit()
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // A second launch either carries a snag:// link (browser handoff) or is the
  // user starting the app again — surface the right window for each.
  app.on('second-instance', (_e, argv) => {
    const link = deepLinkActionFromArgv(argv)
    if (link) routeDeepLink(link)
    else ensureMainWindow()
  })

  app.whenReady().then(() => {
    // Find out where this process's files really go before anything reads or
    // writes userData. A normal start also rescues what an earlier sandboxed
    // run (Snag launched from inside a packaged app) left in that app's
    // private folder, so the user keeps their settings and pairing token.
    const storage = getStorageStatus()
    if (storage.redirected) {
      console.warn(
        `[snag] AppData writes are redirected by packaged app ${storage.packageFamily}; files land in ${storage.physicalPath}`
      )
    } else {
      const imported = importSandboxedUserData(app.getPath('userData'))
      if (imported.length > 0) console.log('[snag] Imported from a sandboxed run:', imported.join(', '))
    }

    downloadManager.initializePersistence()
    // Anything deleted from the downloads folder while Snag was closed is not
    // part of the list any more.
    downloadManager.pruneMissingFiles()
    nativeTheme.themeSource = loadSettings().theme
    registerIpc()
    createTray(() => ensureMainWindow())
    setWindowIdleProbe(maybeQuitWhenIdle)
    void startLocalApi()
    applyGlobalShortcut(loadSettings().globalShortcutEnabled)
    startClipboardWatcher()

    // Heal the login-item registration (a moved portable exe changes paths).
    applyLaunchAtLogin(loadSettings().launchAtLogin)

    const extensionRefresh = refreshInstalledBrowserExtension()
    if (!extensionRefresh.ok) {
      console.error('[snag] Could not refresh the Chrome extension:', extensionRefresh.error)
    }

    const updateTray = (): void => {
      const jobs = downloadManager.getJobs()
      const active = jobs.filter((j) => j.status === 'downloading' || j.status === 'processing').length
      setTrayActiveCount(active)
      updateTaskbar(jobs)
    }
    downloadManager.on('added', updateTray)
    downloadManager.on('progress', () => {
      updateTray()
      maybeQuitWhenIdle()
    })
    updateTray()

    // Cold start via a protocol click opens only the window the handoff needs.
    // A login-item start stays in the tray entirely (no window at all).
    const trayStart = process.argv.includes(TRAY_START_FLAG)
    const coldLink = deepLinkActionFromArgv(process.argv)
    if (coldLink) routeDeepLink(coldLink)
    const queuedOpenUrls = pendingOpenUrls.splice(0)
    for (const link of queuedOpenUrls) routeDeepLink(link)
    if (!coldLink && queuedOpenUrls.length === 0 && !trayStart) ensureMainWindow()

    // Load the quick popup invisibly once startup work settles, so the first
    // browser handoff appears instantly instead of booting a renderer. Skip it
    // when the extension hasn't checked in for a week (or ever) — those users
    // would pay the hidden renderer's RAM without ever getting a handoff.
    const EXTENSION_RECENCY_MS = 7 * 24 * 60 * 60 * 1000
    const extensionLastSeen = loadSettings().browserExtensionLastSeen
    if (extensionLastSeen && Date.now() - extensionLastSeen < EXTENSION_RECENCY_MS) {
      setTimeout(() => prewarmQuickWindow(), 1200)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) ensureMainWindow()
    })

    // Always check shortly after launch (a fresh start deserves fresh info —
    // the persisted daily throttle otherwise hides releases published right
    // after the previous check). The hourly re-checks keep the throttle so a
    // long-running tray process stays polite to the API.
    let updateCheckRunning = false
    const runAutomaticUpdateCheck = async (force: boolean): Promise<void> => {
      if (updateCheckRunning) return
      if (force ? !loadSettings().autoCheckUpdates : !shouldAutoCheck()) return
      updateCheckRunning = true
      try {
        const update = await checkForUpdates()
        // yt-dlp releases are small and frequent; apply them quietly unless a
        // download is using the executable right now, then prompt as before.
        if (update.ytdlp && loadSettings().autoUpdateYtdlp && !downloadManager.hasActiveWork()) {
          const result = await updateYtdlp(loadSettings().ytdlpPath)
          resetToolCache()
          clearAnalysisCache()
          if (result.ok) {
            console.log(`[snag] yt-dlp updated to ${update.ytdlp.latest} in the background`)
            update.ytdlp = null
            for (const win of BrowserWindow.getAllWindows()) {
              if (!win.isDestroyed()) win.webContents.send('toolsChanged')
            }
            notifyInfo('yt-dlp updated', `Now on ${update.ytdlp === null ? 'the latest release' : ''}`.trim(), false)
          }
        }
        if (update.status === 'success' || update.app || update.ytdlp) {
          publishUpdateAvailability(update)
        }
      } catch (err) {
        console.error('Update check failed:', err)
      } finally {
        updateCheckRunning = false
      }
    }
    setTimeout(() => void runAutomaticUpdateCheck(true), 5000)
    setInterval(() => void runAutomaticUpdateCheck(false), 60 * 60 * 1000)
  })

  app.on('window-all-closed', () => {
    // Stay alive for tray mode or while downloads are still running.
    if (!loadSettings().runInBackground && !downloadManager.hasActiveWork()) {
      app.quit()
    }
  })

  app.on('before-quit', () => downloadManager.shutdown())
  app.on('will-quit', () => globalShortcut.unregisterAll())
}
