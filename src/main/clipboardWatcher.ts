import { BrowserWindow, clipboard } from 'electron'
import { analyzeCached } from './metadata'
import { cookieArgs } from './cookies'
import { clipboardUrl, isKnownVideoUrl } from './links'
import { loadSettings } from './settings'
import { hasVisibleWindow } from './windows'

// While a Snag window is open, a link copied anywhere on the system is offered
// on the Download screen right away, and for well-known video sites the
// analysis starts in the background so "Use it" is instant. Only the text is
// inspected for a URL; nothing is stored or sent anywhere.

const POLL_MS = 1500

let lastText: string | null = null
let timer: NodeJS.Timeout | null = null

function tick(): void {
  if (!loadSettings().watchClipboard || !hasVisibleWindow()) return
  let text: string
  try {
    text = clipboard.readText()
  } catch {
    return
  }
  if (text === lastText) return
  lastText = text
  const url = clipboardUrl(text)
  if (!url) return
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('clipboardUrl', url)
  }
  if (isKnownVideoUrl(url)) {
    const settings = loadSettings()
    void analyzeCached(url, settings.ytdlpPath, cookieArgs(settings)).catch(() => {
      /* the user sees the error if they choose the link */
    })
  }
}

export function startClipboardWatcher(): void {
  if (timer) return
  // Whatever is on the clipboard at startup is already handled by the
  // Download screen's focus check; only react to new copies from here on.
  try {
    lastText = clipboard.readText()
  } catch {
    lastText = null
  }
  timer = setInterval(tick, POLL_MS)
  timer.unref()
}

export function stopClipboardWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
}
