import { describe, expect, it } from 'vitest'
import { formatBytes, formatDownloadSpeed, relativeTime } from '../src/renderer/src/lib/format'

describe('formatDownloadSpeed', () => {
  it('shows decimal megabytes for yt-dlp MiB values by default', () => {
    expect(formatDownloadSpeed('12.50MiB/s')).toBe('13.1 MB/s')
  })

  it('supports KiB values', () => {
    expect(formatDownloadSpeed('500KiB/s')).toBe('0.5 MB/s')
  })

  it('renders every unit the Speed settings tab offers', () => {
    expect(formatDownloadSpeed('12.50MiB/s', 'mb')).toBe('13.1 MB/s')
    expect(formatDownloadSpeed('12.50MiB/s', 'mbit')).toBe('105 Mbps')
    expect(formatDownloadSpeed('12.50MiB/s', 'mib')).toBe('12.5 MiB/s')
    expect(formatDownloadSpeed('12.50MiB/s', 'both')).toBe('13.1 MB/s · 105 Mbps')
  })

  it('preserves an unknown speed format', () => {
    expect(formatDownloadSpeed('Unknown speed')).toBe('Unknown speed')
    expect(formatDownloadSpeed('Unknown speed', 'mbit')).toBe('Unknown speed')
  })

  it('has nothing to show without a speed', () => {
    expect(formatDownloadSpeed(null)).toBe('')
    expect(formatDownloadSpeed('0B/s')).toBe('0B/s')
  })
})

describe('formatBytes', () => {
  it('shows enough precision to distinguish similar gigabyte estimates', () => {
    expect(formatBytes(1.46 * 1024 ** 3, true)).toBe('~1.46 GB')
    expect(formatBytes(1.49 * 1024 ** 3, true)).toBe('~1.49 GB')
  })
})

describe('relativeTime', () => {
  it('rounds to the most readable unit', () => {
    const now = 1_000_000_000_000
    expect(relativeTime(now - 10_000, now)).toBe('just now')
    expect(relativeTime(now - 3 * 60_000, now)).toBe('3 min ago')
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('2 h ago')
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe('yesterday')
    expect(relativeTime(now - 5 * 86_400_000, now)).toBe('5 days ago')
    expect(relativeTime(now + 60_000, now)).toBe('just now')
  })
})
