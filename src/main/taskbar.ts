// Windows taskbar and tray feedback for running downloads: a progress bar on
// Snag's taskbar button, a numbered overlay badge with the active count, and
// a dot on the tray icon. Badge bitmaps are drawn by a renderer (canvas) on
// request — the main process cannot rasterize — and cached per count.
import { BrowserWindow, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import { readFileSync } from 'fs'
import type { DownloadJob } from '@shared/types'
import { getMainWindow } from './windows'
import { setTrayImage } from './tray'
import trayIconPath from '../../resources/tray.png?asset'

const badgeCache = new Map<number, NativeImage>()
let trayActiveImage: NativeImage | null = null
let trayBase64: string | null = null
let lastBadgeCount = -1
let lastTrayActive = false
let rendering: Promise<void> | null = null

function anyRenderer(): BrowserWindow | null {
  const main = getMainWindow()
  if (main && !main.isDestroyed() && !main.webContents.isLoading()) return main
  return (
    BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && !win.webContents.isLoading()) ??
    null
  )
}

async function drawInRenderer(script: string): Promise<NativeImage | null> {
  const win = anyRenderer()
  if (!win) return null
  try {
    const dataUrl = (await win.webContents.executeJavaScript(script, true)) as unknown
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) return null
    const image = nativeImage.createFromDataURL(dataUrl)
    return image.isEmpty() ? null : image
  } catch {
    return null
  }
}

async function badgeImage(count: number): Promise<NativeImage | null> {
  const cached = badgeCache.get(count)
  if (cached) return cached
  const image = await drawInRenderer(`window.__snagBadge ? window.__snagBadge(${count}) : null`)
  if (image) badgeCache.set(count, image)
  return image
}

async function trayImageWithDot(): Promise<NativeImage | null> {
  if (trayActiveImage) return trayActiveImage
  if (trayBase64 == null) {
    try {
      trayBase64 = readFileSync(trayIconPath).toString('base64')
    } catch {
      trayBase64 = ''
    }
  }
  if (!trayBase64) return null
  const image = await drawInRenderer(
    `window.__snagTrayIcon ? window.__snagTrayIcon(${JSON.stringify('data:image/png;base64,' + trayBase64)}) : null`
  )
  if (image) trayActiveImage = image
  return image
}

// Mean progress of everything moving; queued jobs count as 0 so a long queue
// reads as "a lot left", paused-only shows the yellow paused bar.
export function taskbarState(jobs: readonly DownloadJob[]): {
  active: number
  progress: number
  paused: boolean
} {
  const running = jobs.filter((j) => j.status === 'downloading' || j.status === 'processing')
  const queued = jobs.filter((j) => j.status === 'queued')
  const pausedJobs = jobs.filter((j) => j.status === 'paused')
  const active = running.length + queued.length + pausedJobs.length
  if (active === 0) return { active: 0, progress: 0, paused: false }
  const moving = [...running, ...queued]
  const paused = moving.length === 0
  const pool = paused ? pausedJobs : moving
  const sum = pool.reduce((acc, j) => acc + Math.max(0, Math.min(100, j.progress || 0)), 0)
  return { active, progress: sum / pool.length / 100, paused }
}

export function updateTaskbar(jobs: readonly DownloadJob[]): void {
  const state = taskbarState(jobs)
  const main = getMainWindow()
  if (main && !main.isDestroyed()) {
    if (state.active === 0) main.setProgressBar(-1)
    else main.setProgressBar(Math.max(0.02, state.progress), { mode: state.paused ? 'paused' : 'normal' })
  }

  const wantTrayActive = state.active > 0
  const badgeCount = Math.min(state.active, 10)
  if (badgeCount === lastBadgeCount && wantTrayActive === lastTrayActive) return
  if (rendering) return
  rendering = (async () => {
    if (main && !main.isDestroyed()) {
      if (badgeCount === 0) {
        main.setOverlayIcon(null, '')
        lastBadgeCount = 0
      } else {
        const image = await badgeImage(badgeCount)
        if (image && !main.isDestroyed()) {
          main.setOverlayIcon(image, `${state.active} active download${state.active > 1 ? 's' : ''}`)
          lastBadgeCount = badgeCount
        }
      }
    } else {
      // No taskbar button while Snag lives in the tray; forget the badge so a
      // window opened later gets one immediately.
      lastBadgeCount = -1
    }
    if (wantTrayActive !== lastTrayActive) {
      if (!wantTrayActive) {
        setTrayImage(null)
        lastTrayActive = false
      } else {
        const image = await trayImageWithDot()
        if (image) {
          setTrayImage(image)
          lastTrayActive = true
        }
      }
    }
  })().finally(() => {
    rendering = null
  })
}
