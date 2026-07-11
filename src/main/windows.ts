import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import type { BrowserHandoff } from '@shared/types'

let mainWindow: BrowserWindow | null = null
let quickWindow: BrowserWindow | null = null

// A deep-link URL waiting for a renderer that hasn't mounted yet. The renderer
// pulls it via consumePendingExternalUrl() once its listeners are registered;
// after that pull we can push follow-up URLs as 'externalUrl' events.
let pendingExternalUrl: string | null = null
const readyRenderers = new Set<number>()

function webPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false,
    contextIsolation: true,
    nodeIntegration: false,
    spellcheck: false
  }
}

function loadRenderer(win: BrowserWindow, hash?: string): void {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    win.loadURL(hash ? `${rendererUrl}#${hash}` : rendererUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function trackRenderer(win: BrowserWindow): void {
  const id = win.webContents.id
  win.webContents.once('destroyed', () => readyRenderers.delete(id))
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

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // Open external links in the user's browser, never in-app.
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  trackRenderer(win)
  loadRenderer(win)
  mainWindow = win
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

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (quickWindow === win) quickWindow = null
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  trackRenderer(win)
  loadRenderer(win, 'quick')
  quickWindow = win
  return win
}

export function ensureQuickWindow(): BrowserWindow {
  if (!quickWindow || quickWindow.isDestroyed()) return createQuickWindow()
  quickWindow.show()
  quickWindow.focus()
  return quickWindow
}

// Called by the renderer once it has mounted and registered its listeners.
// Marks that renderer as reachable via push events and hands over any URL
// that arrived before it was ready.
export function consumePendingExternalUrl(webContentsId: number): string | null {
  readyRenderers.add(webContentsId)
  const url = pendingExternalUrl
  pendingExternalUrl = null
  return url
}

// Route a validated http(s) URL to the window the user prefers. Creates the
// window if needed; queues the URL if that window's renderer isn't ready yet.
export function deliverExternalUrl(url: string, handoff: BrowserHandoff): void {
  const win = handoff === 'main' ? ensureMainWindow() : ensureQuickWindow()
  if (readyRenderers.has(win.webContents.id)) {
    win.webContents.send('externalUrl', url)
  } else {
    pendingExternalUrl = url
  }
}
