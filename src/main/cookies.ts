import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { CookieStatus, Settings } from '@shared/types'

// Signed-in downloads. yt-dlp can read Firefox's cookie jar directly, but
// Chromium browsers on Windows encrypt cookies so that only the browser can
// decrypt them, so Snag's own extension exports the relevant cookies over the
// paired loopback API instead. They are stored as a Netscape cookies.txt in
// userData (the format yt-dlp expects), only for the sites listed below, and
// only while the user keeps "Use my browser logins" enabled.

export const COOKIE_DOMAINS: readonly string[] = [
  'youtube.com',
  'google.com',
  'x.com',
  'twitter.com',
  'vimeo.com',
  'twitch.tv',
  'patreon.com',
  'reddit.com',
  'dailymotion.com',
  'instagram.com',
  'facebook.com',
  'tiktok.com'
]

export const COOKIE_SYNC_INTERVAL_MS = 30 * 60 * 1000
const MAX_COOKIES = 3000
const MAX_VALUE_LENGTH = 8192

export interface BrowserCookie {
  domain: string
  path: string
  name: string
  value: string
  secure: boolean
  httpOnly: boolean
  hostOnly: boolean
  expirationDate: number | null
}

export function cookiesFilePath(userData = app.getPath('userData')): string {
  return join(userData, 'cookies', 'browser-cookies.txt')
}

export function isAllowedCookieDomain(domain: string): boolean {
  const host = domain.replace(/^\./, '').toLowerCase()
  return COOKIE_DOMAINS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

const SAFE_TOKEN = /^[^\s;]*$/

// Whitelist every field of the untrusted payload the extension sends.
export function sanitizeCookies(raw: unknown): BrowserCookie[] {
  if (!Array.isArray(raw)) return []
  const cookies: BrowserCookie[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    if (typeof c.domain !== 'string' || typeof c.name !== 'string' || typeof c.value !== 'string') continue
    if (!isAllowedCookieDomain(c.domain)) continue
    if (!SAFE_TOKEN.test(c.name) || !c.name || c.value.length > MAX_VALUE_LENGTH || /[\t\r\n]/.test(c.value)) continue
    const path = typeof c.path === 'string' && c.path.startsWith('/') && SAFE_TOKEN.test(c.path) ? c.path : '/'
    const expiration =
      typeof c.expirationDate === 'number' && Number.isFinite(c.expirationDate) && c.expirationDate > 0
        ? Math.floor(c.expirationDate)
        : null
    cookies.push({
      domain: c.domain.toLowerCase(),
      path,
      name: c.name,
      value: c.value,
      secure: c.secure === true,
      httpOnly: c.httpOnly === true,
      hostOnly: c.hostOnly === true,
      expirationDate: expiration
    })
    if (cookies.length >= MAX_COOKIES) break
  }
  return cookies
}

// Netscape cookie file format, as read by yt-dlp's --cookies.
export function toNetscapeCookies(cookies: BrowserCookie[]): string {
  const lines = [
    '# Netscape HTTP Cookie File',
    '# Exported by Snag from the browser extension. Do not share this file.',
    ''
  ]
  for (const c of cookies) {
    const domain = c.hostOnly ? c.domain.replace(/^\./, '') : c.domain.startsWith('.') ? c.domain : `.${c.domain}`
    const includeSubdomains = c.hostOnly ? 'FALSE' : 'TRUE'
    const name = c.httpOnly ? c.name : c.name
    lines.push(
      [
        c.httpOnly ? `#HttpOnly_${domain}` : domain,
        includeSubdomains,
        c.path,
        c.secure ? 'TRUE' : 'FALSE',
        String(c.expirationDate ?? 0),
        name,
        c.value
      ].join('\t')
    )
  }
  return lines.join('\n') + '\n'
}

export function saveBrowserCookies(raw: unknown, userData = app.getPath('userData')): number {
  const cookies = sanitizeCookies(raw)
  const file = cookiesFilePath(userData)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, toNetscapeCookies(cookies), { encoding: 'utf8', mode: 0o600 })
  return cookies.length
}

export function forgetCookies(userData = app.getPath('userData')): void {
  rmSync(cookiesFilePath(userData), { force: true })
}

// yt-dlp arguments for the configured sign-in source; empty when nothing usable exists yet.
export function cookieArgs(settings: Settings, userData = app.getPath('userData')): string[] {
  switch (settings.cookieSource) {
    case 'extension': {
      const file = cookiesFilePath(userData)
      return existsSync(file) ? ['--cookies', file] : []
    }
    case 'file':
      return settings.cookiesFile && existsSync(settings.cookiesFile) ? ['--cookies', settings.cookiesFile] : []
    case 'firefox':
      return ['--cookies-from-browser', 'firefox']
    default:
      return []
  }
}

// Whether the extension should send a fresh export on its next heartbeat.
export function cookieSyncWanted(settings: Settings, now = Date.now(), userData = app.getPath('userData')): boolean {
  if (settings.cookieSource !== 'extension') return false
  if (!existsSync(cookiesFilePath(userData))) return true
  return now - settings.cookiesSyncedAt > COOKIE_SYNC_INTERVAL_MS
}

export function cookieStatus(settings: Settings, userData = app.getPath('userData')): CookieStatus {
  const file = cookiesFilePath(userData)
  let size = 0
  try {
    size = statSync(file).size
  } catch {
    /* no export yet */
  }
  return {
    source: settings.cookieSource,
    syncedAt: settings.cookiesSyncedAt,
    hasExport: size > 0,
    cookiesFile: settings.cookiesFile
  }
}
