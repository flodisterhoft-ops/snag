const CHROME_EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/
const LANGUAGE_CODE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/

// Snag's extension ID is pinned by the `key` field in extension/manifest.json:
// Chrome derives the ID from that public key (first 16 bytes of its SHA-256,
// hex mapped to a–p) instead of the folder path, so every copy of the
// extension loads under this ID no matter where it lives on disk.
export const SNAG_EXTENSION_ID = 'ijgfhooengagekghikdmadojinimiedo'

export function isChromeExtensionOrigin(origin: string | undefined): boolean {
  return typeof origin === 'string' && CHROME_EXTENSION_ORIGIN_RE.test(origin)
}

export function isSnagExtensionOrigin(origin: string | undefined): boolean {
  return origin === `chrome-extension://${SNAG_EXTENSION_ID}`
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
