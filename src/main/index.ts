import { app, BrowserWindow } from 'electron'
import { resolve } from 'path'
import { registerIpc } from './ipc'
import { deepLinkFromArgv, parseDeepLink, PROTOCOL_SCHEME } from './protocol'
import {
  ensureMainWindow,
  deliverExternalUrl,
  publishUpdateAvailability,
  prewarmQuickWindow,
  hasVisibleWindow,
  setWindowIdleProbe
} from './windows'
import { createTray, setTrayActiveCount } from './tray'
import { loadSettings } from './settings'
import { downloadManager } from './downloader'
import { checkForUpdates, shouldAutoCheck } from './updates'
import { refreshInstalledBrowserExtension } from './extension'
import { applyLaunchAtLogin, TRAY_START_FLAG } from './startup'
import { startLocalApi } from './localApi'

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

function routeDeepLink(url: string): void {
  console.log('[snag] browser handoff:', url)
  deliverExternalUrl(url, loadSettings().browserHandoff)
}

// macOS delivers custom protocols through open-url rather than argv. Queue an
// early event until BrowserWindow creation is legal.
const pendingOpenUrls: string[] = []
app.on('open-url', (event, rawUrl) => {
  event.preventDefault()
  const url = parseDeepLink(rawUrl)
  if (!url) return
  if (app.isReady()) routeDeepLink(url)
  else pendingOpenUrls.push(url)
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
    const url = deepLinkFromArgv(argv)
    if (url) routeDeepLink(url)
    else ensureMainWindow()
  })

  app.whenReady().then(() => {
    downloadManager.initializePersistence()
    registerIpc()
    createTray(() => ensureMainWindow())
    setWindowIdleProbe(maybeQuitWhenIdle)
    void startLocalApi()

    // Heal the login-item registration (a moved portable exe changes paths).
    applyLaunchAtLogin(loadSettings().launchAtLogin)

    const extensionRefresh = refreshInstalledBrowserExtension()
    if (extensionRefresh && !extensionRefresh.ok) {
      console.error('[snag] Could not refresh the Chrome extension:', extensionRefresh.error)
    }

    const updateTray = (): void => {
      const active = downloadManager
        .getJobs()
        .filter((j) => j.status === 'downloading' || j.status === 'processing').length
      setTrayActiveCount(active)
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
    const coldUrl = deepLinkFromArgv(process.argv)
    if (coldUrl) routeDeepLink(coldUrl)
    const queuedOpenUrls = pendingOpenUrls.splice(0)
    for (const url of queuedOpenUrls) routeDeepLink(url)
    if (!coldUrl && queuedOpenUrls.length === 0 && !trayStart) ensureMainWindow()

    // Load the quick popup invisibly once startup work settles, so the first
    // browser handoff appears instantly instead of booting a renderer.
    setTimeout(() => prewarmQuickWindow(), 1200)

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
}
