import { app, BrowserWindow } from 'electron'
import { resolve } from 'path'
import { registerIpc } from './ipc'
import { deepLinkFromArgv, PROTOCOL_SCHEME } from './protocol'
import { ensureMainWindow, deliverExternalUrl } from './windows'
import { createTray, setTrayActiveCount } from './tray'
import { loadSettings } from './settings'
import { downloadManager } from './downloader'

// Windows: needed for notifications to show the app identity/name correctly.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.julia.snag')
}

// Register snag:// with the OS so browsers can hand links to Snag. In dev the
// registration must point at the electron binary plus the app path; a moved
// portable exe re-registers itself here on every launch (best effort).
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME)
}

function routeDeepLink(url: string): void {
  console.log('[snag] browser handoff:', url)
  deliverExternalUrl(url, loadSettings().browserHandoff)
}

// Quit once the last download finishes if the user closed all windows and
// doesn't want Snag lingering in the tray.
function maybeQuitWhenIdle(): void {
  if (
    BrowserWindow.getAllWindows().length === 0 &&
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
    registerIpc()
    createTray(() => ensureMainWindow())

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

    // Cold start via a protocol click opens only the window the handoff needs.
    const coldUrl = deepLinkFromArgv(process.argv)
    if (coldUrl) routeDeepLink(coldUrl)
    else ensureMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) ensureMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Stay alive for tray mode or while downloads are still running.
    if (!loadSettings().runInBackground && !downloadManager.hasActiveWork()) {
      app.quit()
    }
  })
}
