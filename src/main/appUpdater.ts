import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { appendFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { compareVersions } from './version'
import type { AppUpdateProgress } from '@shared/types'

// In-app update flow: download the new installer in the background with
// progress, then run it silently on "Restart to update" — no setup wizard.
// Works only for the installed (NSIS) build; the portable exe and dev runs
// fall back to opening the release page.

type Phase = 'idle' | 'downloading' | 'downloaded' | 'error'

let phase: Phase = 'idle'
let listenersAttached = false
let activeVersion: string | null = null
let downloadedVersion: string | null = null

function isDownloaded(): boolean {
  return phase === 'downloaded'
}

function logUpdate(message: string): void {
  try {
    const path = join(app.getPath('userData'), 'updater.log')
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    // Logging must never prevent an update.
  }
}

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

  autoUpdater.on('update-downloaded', (event) => {
    phase = 'downloaded'
    downloadedVersion = event.version || activeVersion
    logUpdate(`Update downloaded: ${downloadedVersion ?? 'unknown version'}`)
    broadcast('appUpdateDownloaded', downloadedVersion)
  })

  autoUpdater.on('error', (err) => {
    logUpdate(`Updater error: ${err.message || String(err)}`)
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
  if (phase === 'downloading') return { ok: true }

  attachListeners()
  try {
    logUpdate(`Checking for an update from ${app.getVersion()}`)
    const check = await autoUpdater.checkForUpdates()
    const latest = check?.updateInfo?.version
    if (!latest || compareVersions(latest, app.getVersion()) <= 0) {
      logUpdate(`No newer update found (latest: ${latest ?? 'unknown'})`)
      return { ok: false, error: 'No newer version was found to download.' }
    }

    // The renderer can be hidden and the app can restart while electron-updater
    // keeps a completed installer in its cache. Revalidate the cached target
    // before reporting it as ready, especially when releases arrive quickly.
    if (phase === 'downloaded' && downloadedVersion === latest) {
      logUpdate(`Reusing downloaded update ${latest}`)
      return { ok: true, downloaded: true }
    }

    if (phase === 'downloaded') {
      logUpdate(`Downloaded target changed from ${downloadedVersion ?? 'unknown'} to ${latest}`)
      phase = 'idle'
      downloadedVersion = null
    }

    activeVersion = latest
    phase = 'downloading'
    logUpdate(`Downloading update ${latest}`)
    await autoUpdater.downloadUpdate()

    // A cached installer can resolve immediately. Set the ready state here as
    // well as in update-downloaded so it survives a renderer that was hidden.
    if (!isDownloaded()) {
      phase = 'downloaded'
      downloadedVersion = latest
      logUpdate(`Update ready from cache/download promise: ${latest}`)
      broadcast('appUpdateDownloaded', latest)
    }
    return { ok: true, downloaded: true }
  } catch (err) {
    phase = 'error'
    const message = (err as Error).message || 'Could not reach the update server.'
    logUpdate(`Update download failed: ${message}`)
    broadcast('appUpdateError', message)
    return { ok: false, error: message }
  }
}

export function installAppUpdate(): boolean {
  if (phase !== 'downloaded') return false
  logUpdate(`Installing update ${downloadedVersion ?? activeVersion ?? 'unknown'}`)
  // Silent NSIS run + relaunch: the user sees Snag close and come back updated.
  autoUpdater.quitAndInstall(true, true)
  return true
}
