import { app, BrowserWindow, shell } from 'electron'
import { join, normalize, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { BrowserHandoff, UpdateAvailability } from '@shared/types'
import { isSafeExternalUrl } from './protocol'

let mainWindow: BrowserWindow | null = null
let quickWindow: BrowserWindow | null = null

// URLs are queued for the renderer they were intended for. A single process-
// global slot lets a main window steal a quick-window handoff and drops rapid
// consecutive browser clicks.
const pendingExternalUrls = new Map<number, string[]>()
const readyRenderers = new Set<number>()
let latestAvailableUpdate: UpdateAvailability | null = null

const packagedRendererPath = resolve(__dirname, '../renderer/index.html')

function samePath(left: string, right: string): boolean {
  const a = normalize(resolve(left))
  const b = normalize(resolve(right))
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

// Used both by navigation guards and IPC authorization. Only the exact local
// renderer file (or the configured Vite dev server page) is trusted.
export function isTrustedRendererUrl(value: string): boolean {
  try {
    const candidate = new URL(value)
    const devUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      const expected = new URL(devUrl)
      return candidate.origin === expected.origin && candidate.pathname === expected.pathname
    }
    return candidate.protocol === 'file:' && samePath(fileURLToPath(candidate), packagedRendererPath)
  } catch {
    return false
  }
}

export function isKnownRenderer(webContentsId: number): boolean {
  return [mainWindow, quickWindow].some(
    (win) => !!win && !win.isDestroyed() && win.webContents.id === webContentsId
  )
}

function webPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    spellcheck: false
  }
}

function loadRenderer(win: BrowserWindow, hash?: string): void {
  const rendererUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void win.loadURL(hash ? `${rendererUrl}#${hash}` : rendererUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function openSafeExternalUrl(value: string): void {
  if (!isSafeExternalUrl(value)) return
  void shell.openExternal(new URL(value).toString()).catch((err) => {
    console.error('[snag] Could not open external URL:', err)
  })
}

function hardenNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternalUrl(url)
    return { action: 'deny' }
  })

  const guard = (event: Electron.Event, url: string): void => {
    if (isTrustedRendererUrl(url)) return
    event.preventDefault()
    openSafeExternalUrl(url)
  }
  win.webContents.on('will-navigate', guard)
  win.webContents.on('will-redirect', guard)
}

function trackRenderer(win: BrowserWindow): void {
  const id = win.webContents.id
  const markNotReady = (): void => {
    readyRenderers.delete(id)
  }
  win.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) markNotReady()
  })
  win.webContents.on('render-process-gone', markNotReady)
  win.webContents.once('destroyed', () => {
    readyRenderers.delete(id)
    pendingExternalUrls.delete(id)
  })
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d0e12',
    title: 'Snag',
    webPreferences: webPreferences()
  })

  mainWindow = win
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  hardenNavigation(win)
  trackRenderer(win)
  loadRenderer(win)
  return win
}

export function ensureMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) return createMainWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  return mainWindow
}

function createQuickWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 460,
    height: 640,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d0e12',
    title: 'Snag — quick download',
    webPreferences: webPreferences()
  })

  quickWindow = win
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (quickWindow === win) quickWindow = null
  })

  hardenNavigation(win)
  trackRenderer(win)
  loadRenderer(win, 'quick')
  return win
}

export function ensureQuickWindow(): BrowserWindow {
  if (!quickWindow || quickWindow.isDestroyed()) return createQuickWindow()
  quickWindow.show()
  quickWindow.focus()
  return quickWindow
}

function flushQueuedUrls(webContentsId: number): void {
  const win = [mainWindow, quickWindow].find(
    (candidate) => candidate && !candidate.isDestroyed() && candidate.webContents.id === webContentsId
  )
  const queue = pendingExternalUrls.get(webContentsId)
  if (!win || win.isDestroyed() || !queue?.length || !readyRenderers.has(webContentsId)) return

  pendingExternalUrls.delete(webContentsId)
  for (const url of queue) win.webContents.send('externalUrl', url)
}

// Called after the renderer has registered its listeners. Deliver on the next
// event-loop turn rather than consuming a value in the invoke response; this
// survives React StrictMode's development mount/unmount cycle without losing
// the first handoff.
export function consumePendingExternalUrl(webContentsId: number): string | null {
  readyRenderers.add(webContentsId)
  setTimeout(() => {
    flushQueuedUrls(webContentsId)
    if (
      latestAvailableUpdate &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      readyRenderers.has(webContentsId) &&
      mainWindow.webContents.id === webContentsId
    ) {
      mainWindow.webContents.send('updateAvailable', latestAvailableUpdate)
    }
  }, 0)
  return null
}

// Route a validated http(s) URL to the chosen window. If its renderer is still
// loading, preserve every handoff for that exact window instead of overwriting.
export function deliverExternalUrl(url: string, handoff: BrowserHandoff): void {
  const win = handoff === 'main' ? ensureMainWindow() : ensureQuickWindow()
  const id = win.webContents.id
  if (readyRenderers.has(id)) {
    win.webContents.send('externalUrl', url)
  } else {
    const queue = pendingExternalUrls.get(id) ?? []
    queue.push(url)
    pendingExternalUrls.set(id, queue)
  }
}

// Cache automatic update availability until the full main UI is ready. This
// prevents a quick-only launch from consuming the sole notification.
export function publishUpdateAvailability(update: UpdateAvailability): void {
  latestAvailableUpdate = update.app || update.ytdlp ? update : null
  if (
    latestAvailableUpdate &&
    mainWindow &&
    !mainWindow.isDestroyed() &&
    readyRenderers.has(mainWindow.webContents.id)
  ) {
    mainWindow.webContents.send('updateAvailable', latestAvailableUpdate)
  }
}

export function clearCachedYtdlpUpdate(): void {
  if (!latestAvailableUpdate?.ytdlp) return
  latestAvailableUpdate = latestAvailableUpdate.app
    ? { ...latestAvailableUpdate, ytdlp: null }
    : null
}

export function clearCachedUpdates(): void {
  latestAvailableUpdate = null
}
