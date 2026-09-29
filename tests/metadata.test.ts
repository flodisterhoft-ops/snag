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

  it("keeps YouTube's sized stream over its size-less HLS copy of the same quality", () => {
    const base = { ext: 'mp4', width: 1920, height: 1080, fps: 25, vcodec: 'avc1.640028', acodec: 'none' }
    const formats = parseVideoFormats([
      { ...base, format_id: '270', tbr: 4688 },
      { ...base, format_id: '137', tbr: 3038, filesize: 80911999 },
      { ...base, format_id: '399', vcodec: 'av01.0.08M.08', tbr: 1142, filesize: 30415996 }
    ])
    expect(formats.map((f) => f.formatId)).toEqual(['137', '399'])
    // Without any size, the higher bitrate still wins as before.
    const unsized = parseVideoFormats([
      { ...base, format_id: 'hls-low', tbr: 2000 },
      { ...base, format_id: 'hls-high', tbr: 5000 }
    ])
    expect(unsized.map((f) => f.formatId)).toEqual(['hls-high'])
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
