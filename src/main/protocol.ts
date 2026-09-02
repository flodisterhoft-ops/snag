// Parsing/validation for snag:// deep links (kept pure so it is unit-testable).

export const PROTOCOL_SCHEME = 'snag'

// Generous cap: real video URLs are far shorter; this only guards against abuse.
const MAX_TARGET_LENGTH = 2048

const JOB_ID_RE = /^job_[a-z0-9_]+$/i

// Everything a snag:// link can ask for. Downloads come from browsers and the
// extension; job actions come from the buttons on Snag's own Windows toasts.
export type DeepLink =
  | { kind: 'download'; url: string }
  | { kind: 'job'; id: string; action: 'open' | 'reveal' }

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// URL schemes allowed to leave the trusted renderer and open in the user's
// browser. In particular, never pass file:, javascript:, data:, or snag: to
// shell.openExternal.
export function isSafeExternalUrl(value: string): boolean {
  return isHttpUrl(value)
}

// Parse any supported deep link:
//   snag://download?url=https%3A%2F%2Fyoutube.com%2Fwatch%3Fv%3Dabc
//   snag://job?id=job_abc&action=open
// Returns null for anything malformed, oversized, or unknown.
export function parseDeepLinkAction(raw: unknown): DeepLink | null {
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

  if (action === 'download') {
    const target = link.searchParams.get('url')?.trim()
    if (!target || target.length > MAX_TARGET_LENGTH) return null
    if (!isHttpUrl(target)) return null
    return { kind: 'download', url: new URL(target).toString() }
  }

  if (action === 'job') {
    const id = link.searchParams.get('id')?.trim() ?? ''
    const verb = link.searchParams.get('action')?.trim().toLowerCase()
    if (!JOB_ID_RE.test(id) || id.length > 64) return null
    if (verb !== 'open' && verb !== 'reveal') return null
    return { kind: 'job', id, action: verb }
  }

  return null
}

// Extract the http(s) target from a download deep link; null for anything else.
export function parseDeepLink(raw: unknown): string | null {
  const link = parseDeepLinkAction(raw)
  return link?.kind === 'download' ? link.url : null
}

function unquote(arg: string): string {
  const trimmed = arg.trim()
  return trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1)
    : trimmed
}

// Find the first valid deep link among process arguments (cold or warm launch).
export function deepLinkActionFromArgv(argv: readonly string[]): DeepLink | null {
  for (const arg of argv) {
    const link = parseDeepLinkAction(unquote(arg))
    if (link) return link
  }
  return null
}

export function deepLinkFromArgv(argv: readonly string[]): string | null {
  const link = deepLinkActionFromArgv(argv)
  return link?.kind === 'download' ? link.url : null
}

export function jobDeepLink(id: string, action: 'open' | 'reveal'): string {
  return `${PROTOCOL_SCHEME}://job?id=${encodeURIComponent(id)}&action=${action}`
}
