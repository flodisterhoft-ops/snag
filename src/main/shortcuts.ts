import { clipboard, globalShortcut } from 'electron'
import { GLOBAL_SHORTCUT } from '@shared/types'
import { clipboardUrl } from './links'
import { loadSettings } from './settings'
import { deliverExternalUrl, ensureMainWindow } from './windows'

// One system-wide shortcut: with a link on the clipboard it opens the picker
// for that link (quick dialog or full app, per the handoff setting) without
// touching the browser; otherwise it just brings Snag to the front.

let registered = false

function trigger(): void {
  let url: string | null = null
  try {
    url = clipboardUrl(clipboard.readText())
  } catch {
    url = null
  }
  if (url) deliverExternalUrl(url, loadSettings().browserHandoff)
  else ensureMainWindow()
}

export function applyGlobalShortcut(enabled: boolean): boolean {
  if (registered) {
    globalShortcut.unregister(GLOBAL_SHORTCUT)
    registered = false
  }
  if (!enabled) return true
  try {
    registered = globalShortcut.register(GLOBAL_SHORTCUT, trigger)
  } catch (err) {
    console.error('[snag] Could not register the global shortcut:', err)
    registered = false
  }
  if (!registered) console.warn(`[snag] ${GLOBAL_SHORTCUT} is taken by another application.`)
  return registered
}

export function isGlobalShortcutRegistered(): boolean {
  return registered
}
