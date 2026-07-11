import { describe, expect, it } from 'vitest'
import { formatDownloadSpeed } from '../src/renderer/src/lib/format'

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
