const CHROME_EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/
const LANGUAGE_CODE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/

export function isChromeExtensionOrigin(origin: string | undefined): boolean {
  return typeof origin === 'string' && CHROME_EXTENSION_ORIGIN_RE.test(origin)
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
