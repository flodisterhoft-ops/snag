import type { SpeedUnit } from './types'

// Byte and speed rendering shared by the main process, the renderer and the
// local API that feeds the Chrome extension, so one download reads the same
// everywhere it is shown.

// yt-dlp and aria2 print sizes with their own units ("354.21MiB", "1.2GiB").
// Back to plain bytes so Snag can render them in the unit the user picked.
const BYTE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1_000,
  kib: 1_024,
  mb: 1_000_000,
  mib: 1_048_576,
  gb: 1_000_000_000,
  gib: 1_073_741_824,
  tb: 1_000_000_000_000,
  tib: 1_099_511_627_776
}

export function parseByteString(text: string | null | undefined): number | null {
  if (!text) return null
  const match = text.trim().match(/^~?([\d.]+)\s*(B|K(?:i)?B|M(?:i)?B|G(?:i)?B|T(?:i)?B)$/i)
  if (!match) return null
  const value = Number.parseFloat(match[1])
  const multiplier = BYTE_UNITS[match[2].toLowerCase()]
  if (!Number.isFinite(value) || !multiplier) return null
  return value * multiplier
}

export function parseSpeedString(text: string | null | undefined): number | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed.endsWith('/s')) return null
  return parseByteString(trimmed.slice(0, -2))
}

// "128 MB". Kept on the 1024 step the rest of Snag has always used, so a size
// here matches the one the format picker showed before the download started.
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

function trim(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1)
}

// Renders bytes/second the way the Speed settings tab is set:
//   mb   12.4 MB/s      megabytes, what a file manager counts in
//   mbit 99.4 Mbps      megabits, what an internet plan is sold in
//   mib  11.8 MiB/s     mebibytes, yt-dlp's own units
//   both 12.4 MB/s · 99.4 Mbps
export function formatSpeedFromBytes(
  bytesPerSecond: number | null | undefined,
  unit: SpeedUnit = 'mb'
): string {
  if (bytesPerSecond == null || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return ''
  const mb = `${trim(bytesPerSecond / 1_000_000)} MB/s`
  const mbit = `${trim((bytesPerSecond * 8) / 1_000_000)} Mbps`
  const mib = `${trim(bytesPerSecond / 1_048_576)} MiB/s`
  if (unit === 'mbit') return mbit
  if (unit === 'mib') return mib
  if (unit === 'both') return `${mb} · ${mbit}`
  return mb
}

// The engine's own speed string ("11.8MiB/s") in the user's unit. Anything
// that does not parse is passed through rather than dropped.
export function formatSpeed(speed: string | null | undefined, unit: SpeedUnit = 'mb'): string {
  if (!speed) return ''
  const bytesPerSecond = parseSpeedString(speed)
  if (bytesPerSecond == null) return speed
  return formatSpeedFromBytes(bytesPerSecond, unit) || speed
}
