import { describe, expect, it } from 'vitest'
import { parseAudioGroups, parseVideoFormats } from '../src/main/metadata'

describe('video format parsing', () => {
  it('labels portrait formats by their smaller dimension', () => {
    const formats = parseVideoFormats([
      {
        format_id: 'portrait-4k',
        ext: 'webm',
        width: 2160,
        height: 3840,
        fps: 60,
        vcodec: 'vp9',
        acodec: 'none'
      }
    ])

    expect(formats[0].qualityLabel).toBe('2160p60')
  })
})

describe('audio format parsing', () => {
  it('offers audio extraction when a site exposes only muxed formats', () => {
    const result = parseAudioGroups(
      [
        {
          format_id: '22',
          ext: 'mp4',
          vcodec: 'avc1.64001F',
          acodec: 'mp4a.40.2',
          height: 720
        }
      ],
      'en'
    )

    expect(result.multiLanguage).toBe(false)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].formats[0].formatId).toBe('')
    expect(result.groups[0].formats[0].qualityLabel).toContain('video')
  })

  it('keeps real audio-only formats when they are available', () => {
    const result = parseAudioGroups(
      [
        { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128 },
        { format_id: '22', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a.40.2' }
      ],
      null
    )
    expect(result.groups[0].formats[0].formatId).toBe('140')
  })
})
