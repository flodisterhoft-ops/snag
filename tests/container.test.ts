import { describe, expect, it } from 'vitest'
import {
  filterVideoFormatsForContainer,
  findCompatibleAudioFormat,
  formatContainerSource,
  isVideoFormatCompatible
} from '../src/shared/container'
import type { AudioFormat, VideoFormat } from '../src/shared/types'

const video = (
  formatId: string,
  ext: string,
  height: number,
  vcodec: string,
  options: Partial<VideoFormat> = {}
): VideoFormat => ({
  formatId,
  ext,
  height,
  width: Math.round((height * 16) / 9),
  fps: 30,
  vcodec,
  acodec: 'none',
  tbr: null,
  vbr: null,
  filesize: null,
  filesizeIsApprox: false,
  formatNote: '',
  dynamicRange: 'SDR',
  isProgressive: false,
  qualityLabel: `${height}p`,
  ...options
})

const audio = (formatId: string, ext: string, acodec: string, abr: number): AudioFormat => ({
  formatId,
  ext,
  acodec,
  abr,
  asr: null,
  audioChannels: 2,
  language: null,
  languageLabel: 'Original audio',
  formatNote: '',
  filesize: null,
  filesizeIsApprox: false,
  qualityLabel: `${abr} kbps`
})

describe('container compatibility', () => {
  it('accepts friendly codec labels used by the format picker', () => {
    expect(isVideoFormatCompatible('mp4', 'H.264', 'AAC', true)).toBe(true)
    expect(isVideoFormatCompatible('webm', 'VP9', 'Opus', true)).toBe(true)
    expect(isVideoFormatCompatible('mkv', 'H.264', 'AAC', true)).toBe(true)
  })

  it('rejects codec combinations that ffmpeg cannot mux', () => {
    expect(isVideoFormatCompatible('webm', 'H.264', 'AAC', true)).toBe(false)
    expect(isVideoFormatCompatible('mp4', 'VP9', 'Opus', true)).toBe(false)
  })

  it('checks only the video codec for video-only streams', () => {
    expect(isVideoFormatCompatible('mp4', 'H.264', 'none', false)).toBe(true)
    expect(isVideoFormatCompatible('webm', 'H.264', 'none', false)).toBe(false)
  })

  it('shows native MP4 and WebM rows for the selected output container', () => {
    const formats = [
      video('mp4-4k', 'mp4', 2160, 'AV1'),
      video('webm-4k', 'webm', 2160, 'VP9'),
      video('mp4-1080', 'mp4', 1080, 'H.264'),
      video('webm-1080', 'webm', 1080, 'VP9')
    ]
    const audios = [audio('aac', 'm4a', 'AAC', 128), audio('opus', 'webm', 'Opus', 160)]

    expect(filterVideoFormatsForContainer('mp4', formats, audios).map((f) => f.formatId)).toEqual([
      'mp4-4k',
      'mp4-1080'
    ])
    expect(filterVideoFormatsForContainer('webm', formats, audios).map((f) => f.formatId)).toEqual([
      'webm-4k',
      'webm-1080'
    ])
    expect(filterVideoFormatsForContainer('mkv', formats, audios).map((f) => f.formatId)).toEqual([
      'mp4-4k',
      'webm-4k',
      'mp4-1080',
      'webm-1080'
    ])
  })

  it('keeps a remux-compatible 4K tier when no native source exists for it', () => {
    const formats = [
      video('webm-av1-4k', 'webm', 2160, 'AV1'),
      video('mp4-1080', 'mp4', 1080, 'H.264')
    ]
    const audios = [audio('aac', 'm4a', 'AAC', 128)]

    expect(filterVideoFormatsForContainer('mp4', formats, audios).map((f) => f.formatId)).toEqual([
      'webm-av1-4k',
      'mp4-1080'
    ])
    expect(formatContainerSource('mp4', 'webm')).toBe('WEBM\u2192MP4')
  })

  it('requires compatible audio for split streams but keeps compatible progressive rows', () => {
    const split = video('split-mp4', 'mp4', 2160, 'AV1')
    const progressive = video('muxed-mp4', 'mp4', 1080, 'H.264', {
      acodec: 'AAC',
      isProgressive: true
    })
    const opusOnly = [audio('opus', 'webm', 'Opus', 160)]

    expect(filterVideoFormatsForContainer('mp4', [split, progressive], opusOnly)).toEqual([
      progressive
    ])
    // The AV1 source can be remuxed to WebM and Opus supplies its audio.
    expect(filterVideoFormatsForContainer('webm', [split, progressive], opusOnly)).toEqual([split])
  })

  it('prefers native audio before a higher bitrate remux source', () => {
    const audios = [audio('webm-aac', 'webm', 'AAC', 256), audio('m4a-aac', 'm4a', 'AAC', 128)]
    expect(findCompatibleAudioFormat('mp4', audios)?.formatId).toBe('m4a-aac')
  })
})
