import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { compareVersions } from './version'
import type { AppUpdateProgress } from '@shared/types'

// In-app update flow: download the new installer in the background with
// progress, then run it silently on "Restart to update" — no setup wizard.
// Works only for the installed (NSIS) build; the portable exe and dev runs
// fall back to opening the release page.

type Phase = 'idle' | 'downloading' | 'downloaded' | 'error'

let phase: Phase = 'idle'
let listenersAttached = false

export function canAutoUpdate(): boolean {
  return app.isPackaged && !process.env['PORTABLE_EXECUTABLE_FILE']
}

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function attachListeners(): void {
  if (listenersAttached) return
  listenersAttached = true

  autoUpdater.autoDownload = false
  // Explicit install via the Restart button; don't surprise-install on quit.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('download-progress', (p) => {
    phase = 'downloading'
    const progress: AppUpdateProgress = {
      percent: Math.max(0, Math.min(100, p.percent ?? 0)),
      bytesPerSecond: p.bytesPerSecond ?? 0,
      transferred: p.transferred ?? 0,
      total: p.total ?? 0
    }
    broadcast('appUpdateProgress', progress)
  })

  autoUpdater.on('update-downloaded', () => {
    phase = 'downloaded'
    broadcast('appUpdateDownloaded')
  })

  autoUpdater.on('error', (err) => {
    if (phase === 'downloading') {
      phase = 'error'
      broadcast('appUpdateError', err.message || 'Update download failed.')
    }
  })
}

export async function downloadAppUpdate(): Promise<{
  ok: boolean
  downloaded?: boolean
  error?: string
}> {
  if (!canAutoUpdate()) {
    return { ok: false, error: 'Automatic updates are not available in this build.' }
  }
  if (phase === 'downloaded') return { ok: true, downloaded: true }
  if (phase === 'downloading') return { ok: true }

  attachListeners()
  try {
    const check = await autoUpdater.checkForUpdates()
    const latest = check?.updateInfo?.version
    if (!latest || compareVersions(latest, app.getVersion()) <= 0) {
      return { ok: false, error: 'No newer version was found to download.' }
    }
    phase = 'downloading'
    void autoUpdater.downloadUpdate().catch(() => {
      /* surfaced via the 'error' event */
    })
    return { ok: true }
  } catch (err) {
    phase = 'error'
    return { ok: false, error: (err as Error).message || 'Could not reach the update server.' }
  }
}

export function installAppUpdate(): boolean {
  if (phase !== 'downloaded') return false
  // Silent NSIS run + relaunch: the user sees Snag close and come back updated.
  autoUpdater.quitAndInstall(true, true)
  return true
}
