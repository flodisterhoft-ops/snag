import type { SpeedUnit } from '@shared/types'
import { formatSpeed } from '@shared/format'

export { formatBytes } from '@shared/format'

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return ''
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (x: number): string => x.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

// The unit comes from Settings; unparseable engine output is shown as-is.
export function formatDownloadSpeed(
  speed: string | null | undefined,
  unit: SpeedUnit = 'mb'
): string {
  return formatSpeed(speed, unit)
}

// A short, safe display path (keeps the last two segments).
export function shortPath(p: string | null | undefined, max = 42): string {
  if (!p) return ''
  if (p.length <= max) return p
  const parts = p.split(/[\\/]/)
  if (parts.length <= 2) return '…' + p.slice(-max)
  return `…${p.includes('\\') ? '\\' : '/'}${parts.slice(-2).join(p.includes('\\') ? '\\' : '/')}`
}

const YT_URL_RE =
  /^(https?:\/\/)?([\w-]+\.)+[\w-]+(:\d+)?(\/[^\s]*)?$/i

export function looksLikeUrl(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 2048 || /\s/.test(t)) return false
  return YT_URL_RE.test(t)
}

// "just now", "3 min ago", "2 h ago", "5 days ago" for status lines.
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

// Every http(s) link in a blob of text (one per line, comma- or space-separated).
export function extractUrls(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>,]+/gi)) {
    const candidate = match[0].replace(/[.)\]]+$/, '')
    try {
      const normalized = new URL(candidate).toString()
      if (!found.includes(normalized)) found.push(normalized)
    } catch {
      /* not a URL after all */
    }
  }
  return found
}
