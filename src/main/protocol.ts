// Parsing/validation for snag:// deep links (kept pure so it is unit-testable).

export const PROTOCOL_SCHEME = 'snag'

// Generous cap: real video URLs are far shorter; this only guards against abuse.
const MAX_TARGET_LENGTH = 2048

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// Extract the http(s) target from a deep link like
//   snag://download?url=https%3A%2F%2Fyoutube.com%2Fwatch%3Fv%3Dabc
// Returns null for anything malformed, oversized, or non-http(s).
export function parseDeepLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length > MAX_TARGET_LENGTH * 2) return null
  if (!raw.toLowerCase().startsWith(`${PROTOCOL_SCHEME}://`)) return null

  let link: URL
  try {
    link = new URL(raw)
  } catch {
    return null
  }

  // Accept both snag://download?… (host form) and snag:///download?… (path form) —
  // browsers and the OS normalize custom schemes inconsistently.
  const action = (link.host || link.pathname.replace(/^\/+/, '')).toLowerCase()
  if (action !== 'download') return null

  const target = link.searchParams.get('url')?.trim()
  if (!target || target.length > MAX_TARGET_LENGTH) return null
  if (!isHttpUrl(target)) return null
  return new URL(target).toString()
}

// Find the first valid deep link among process arguments (cold or warm launch).
export function deepLinkFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const url = parseDeepLink(arg)
    if (url) return url
  }
  return null
}
