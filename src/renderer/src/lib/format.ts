export function formatBytes(bytes: number | null | undefined, approx = false): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  const val = n >= 100 || i === 0 ? Math.round(n) : i >= 3 ? n.toFixed(2) : n.toFixed(1)
  return `${approx ? '~' : ''}${val} ${units[i]}`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return ''
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (x: number): string => x.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

const SPEED_UNIT_BYTES: Record<string, number> = {
  b: 1,
  kb: 1_000,
  kib: 1_024,
  mb: 1_000_000,
  mib: 1_048_576,
  gb: 1_000_000_000,
  gib: 1_073_741_824
}

export function formatDownloadSpeed(speed: string | null | undefined): string {
  if (!speed) return ''
  const match = speed.trim().match(/^([\d.]+)\s*(B|K(?:i)?B|M(?:i)?B|G(?:i)?B)\/s$/i)
  if (!match) return speed

  const value = Number.parseFloat(match[1])
  const multiplier = SPEED_UNIT_BYTES[match[2].toLowerCase()]
  if (!Number.isFinite(value) || !multiplier) return speed

  const bytesPerSecond = value * multiplier
  const megabytes = bytesPerSecond / 1_000_000
  const megabits = (bytesPerSecond * 8) / 1_000_000
  const mbLabel = megabytes >= 100 ? megabytes.toFixed(0) : megabytes.toFixed(1)
  const mbitLabel = megabits >= 100 ? megabits.toFixed(0) : megabits.toFixed(1)
  return `${mbLabel} MB/s · ${mbitLabel} Mbps`
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
