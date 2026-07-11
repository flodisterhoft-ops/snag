import { describe, expect, it } from 'vitest'
import {
  meaningfullySmallestContainer,
  qualityTierLabel,
  recommendedContainer
} from '../src/renderer/src/components/FormatPicker'

const row = (container: 'mp4' | 'mkv' | 'webm', gigabytes: number) =>
  ({ container, totalSize: gigabytes * 1024 ** 3 }) as never

describe('quality and container recommendations', () => {
  it('uses familiar quality labels', () => {
    expect(qualityTierLabel(2160)).toBe('4K')
    expect(qualityTierLabel(1440)).toBe('1440p')
    expect(qualityTierLabel(1080)).toBe('1080p')
  })

  it('does not claim a rounded-size tie is meaningfully smaller', () => {
    expect(meaningfullySmallestContainer([row('mkv', 1.46), row('mp4', 1.47), row('webm', 1.47)])).toBeNull()
  })

  it('does label a genuinely smaller file', () => {
    expect(meaningfullySmallestContainer([row('webm', 1.2), row('mp4', 1.5), row('mkv', 1.5)])).toBe('webm')
  })

  it('recommends MP4 normally and MKV for multiple audio tracks', () => {
    const rows = [row('mp4', 1.5), row('mkv', 1.5), row('webm', 1.5)]
    expect(recommendedContainer(rows, false, 'webm')).toBe('mp4')
    expect(recommendedContainer(rows, true, 'mp4')).toBe('mkv')
  })
})
