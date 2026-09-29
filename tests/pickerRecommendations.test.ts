import { describe, expect, it } from 'vitest'
import {
  containerCellHint,
  meaningfullySmallestContainer,
  pickContainerVideo,
  qualityTierLabel,
  recommendedContainer
} from '../src/renderer/src/components/FormatPicker'
import type { VideoFormat } from '../src/shared/types'

const stream = (formatId: string, vcodec: string, megabytes: number) =>
  ({ formatId, vcodec, filesize: megabytes * 1024 ** 2, tbr: megabytes }) as VideoFormat

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

  it('keeps MP4 on H.264 when the site has it and lets other containers take the smallest file', () => {
    // YouTube 1080p60: H.264 (299) is twice the size of AV1 (399).
    const p1080 = [stream('399', 'AV1', 119), stream('299', 'H.264', 246)]
    expect(pickContainerVideo('mp4', p1080).formatId).toBe('299')
    expect(pickContainerVideo('mkv', p1080).formatId).toBe('399')
    // 4K has no H.264 on YouTube, so MP4 falls back to the smallest stream.
    expect(pickContainerVideo('mp4', [stream('401', 'AV1', 679), stream('701', 'AV1', 900)]).formatId).toBe('401')
  })

  it('only promises "plays everywhere" for H.264', () => {
    expect(containerCellHint({ vcodec: 'H.264' }, 'recommended', '')).toBe('Plays everywhere · H.264')
    expect(containerCellHint({ vcodec: 'AV1' }, 'recommended', '')).toMatch(/^AV1: plays on recent phones .* cannot open it$/)
    // X's direct MP4s report no codec and are H.264 in practice.
    expect(containerCellHint({ vcodec: '' }, 'recommended', '')).toBe('Plays everywhere')
    expect(containerCellHint({ vcodec: 'VP9' }, 'smallest', '')).toBe('Smallest file · VP9')
    expect(containerCellHint({ vcodec: 'AV1' }, null, '4K as MKV')).toBe('4K as MKV · AV1')
  })
})
