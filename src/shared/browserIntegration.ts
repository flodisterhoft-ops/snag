import { SETTINGS_SECTIONS, type SettingsSection } from './types'

const CHROME_EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/
const LANGUAGE_CODE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/

// Snag's extension ID is pinned by the `key` field in extension/manifest.json:
// Chrome derives the ID from that public key (first 16 bytes of its SHA-256,
// hex mapped to a–p) instead of the folder path, so every copy of the
// extension loads under this ID no matter where it lives on disk.
export const SNAG_EXTENSION_ID = 'ijgfhooengagekghikdmadojinimiedo'

// Flip to true once the extension is published (see extension/README.md).
// Snag then installs it through Chrome's external-extension registry entry
// and the Web Store page, which takes one click instead of Load unpacked.
export const CHROME_WEB_STORE_PUBLISHED = false
export const CHROME_WEB_STORE_URL = `https://chromewebstore.google.com/detail/${SNAG_EXTENSION_ID}`

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value)
}

export function isChromeExtensionOrigin(origin: string | undefined): boolean {
  return typeof origin === 'string' && CHROME_EXTENSION_ORIGIN_RE.test(origin)
}

export function isSnagExtensionOrigin(origin: string | undefined): boolean {
  return origin === `chrome-extension://${SNAG_EXTENSION_ID}`
}

// The loopback API only needs to be readable from extension service workers.
// Ordinary web pages must not even learn that Snag is running, so requests
// carrying any other Origin get no CORS grant at all (the browser then hides
// the response from the page). Non-browser clients never send an Origin.
export function allowedCorsOrigin(origin: string | undefined): string | null {
  return isChromeExtensionOrigin(origin) ? (origin as string) : null
}

export function normalizeAudioLanguages(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const normalized: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const code = item.trim().toLowerCase()
    if (!LANGUAGE_CODE_RE.test(code) || normalized.includes(code)) continue
    normalized.push(code)
    if (normalized.length === 8) break
  }
  return normalized
}
