import { describe, expect, it } from 'vitest'
import { formatBytes, formatDownloadSpeed } from '../src/renderer/src/lib/format'

describe('formatDownloadSpeed', () => {
  it('shows decimal megabytes and megabits for yt-dlp MiB values', () => {
    expect(formatDownloadSpeed('12.50MiB/s')).toBe('13.1 MB/s · 105 Mbps')
  })

  it('supports KiB values', () => {
    expect(formatDownloadSpeed('500KiB/s')).toBe('0.5 MB/s · 4.1 Mbps')
  })

  it('preserves an unknown speed format', () => {
    expect(formatDownloadSpeed('Unknown speed')).toBe('Unknown speed')
  })
})

describe('formatBytes', () => {
  it('shows enough precision to distinguish similar gigabyte estimates', () => {
    expect(formatBytes(1.46 * 1024 ** 3, true)).toBe('~1.46 GB')
    expect(formatBytes(1.49 * 1024 ** 3, true)).toBe('~1.49 GB')
  })
})
