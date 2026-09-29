import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { CONVERSION_FORMATS } from '../src/shared/conversion'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
import {
  ConversionManager,
  conversionArgs,
  friendlyConversionError,
  parseStreams,
  planConversion,
  publishConversion
} from '../src/main/converter'

const dir = mkdtempSync(join(tmpdir(), 'snag-converter-test-'))
const bin = process.env.SNAG_TEST_FFMPEG || resolve('build/tools/ffmpeg.exe')
const source = join(dir, 'Source ü & video.mp4')
const silent = join(dir, 'Silent.mp4')
const managers: ConversionManager[] = []
function manager(): ConversionManager { const value = new ConversionManager(() => bin); managers.push(value); return value }
function ffmpeg(args: string[]): string {
  return execFileSync(bin, ['-hide_banner', '-nostdin', ...args], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 })
}
async function idle(value: ConversionManager): Promise<void> {
  await vi.waitFor(() => expect(value.hasActiveWork()).toBe(false), { timeout: 30000, interval: 30 })
}
afterAll(async () => {
  await Promise.all(managers.map(value => value.shutdown()))
  // Only the test-owned directory created above is removed.
  rmSync(dir, { recursive: true, force: true })
})

describe('conversion output safety', () => {
  it('publishes unique files without overwriting the source or earlier results', async () => {
    const temp = join(dir, 'payload')
    const original = join(dir, 'example.mp3')
    writeFileSync(temp, 'converted')
    writeFileSync(original, 'original')
    const [a, b] = await Promise.all([
      publishConversion(temp, original, dir, 'mp3'),
      publishConversion(temp, original, dir, 'mp3')
    ])
    expect(a).not.toBe(b)
    expect(readFileSync(original, 'utf8')).toBe('original')
    expect(readFileSync(a, 'utf8')).toBe('converted')
    expect(readFileSync(b, 'utf8')).toBe('converted')
  })
  it('rejects unsupported formats and invalid batches before launching a process', () => {
    const value = manager()
    expect(() => value.enqueue({ paths: [], format: 'mp3', saveDir: '' })).toThrow()
    expect(() => value.enqueue({ paths: [dir], format: 'mp3', saveDir: '' })).toThrow()
    expect(() => value.enqueue({ paths: ['https://example.com/a.mp4'], format: 'mp3', saveDir: '' })).toThrow()
    expect(() => value.enqueue({ paths: [dir], format: 'exe' as 'mp3', saveDir: '' })).toThrow('supported')
    expect(value.getJobs()).toEqual([])
  })
})

describe('choosing between repacking and re-encoding', () => {
  const info = [
    "Input #0, matroska,webm, from 'C:\\Videos\\OBS 2026-09-29.mkv':",
    '  Duration: 00:12:04.52, start: 0.000000, bitrate: 6120 kb/s',
    '  Stream #0:0: Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 60 fps',
    '  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, stereo, fltp (default)',
    '  Stream #0:2(deu): Audio: dts (DTS), 48000 Hz, 5.1(side), fltp, 1536 kb/s',
    '  Stream #0:3: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 600x600, 90k tbn (attached pic)'
  ].join('\n')

  it('reads the first real video stream and every audio track from ffmpeg -i', () => {
    expect(parseStreams(info)).toEqual({ video: { codec: 'h264', pixFmt: 'yuv420p' }, audio: ['aac', 'dts'] })
    expect(parseStreams('  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc), 3840x2160').video)
      .toEqual({ codec: 'hevc', pixFmt: 'yuv420p10le' })
    expect(parseStreams('  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 320 kb/s')).toEqual({ video: null, audio: ['mp3'] })
  })

  it('repacks streams the target already holds and encodes the rest', () => {
    const obs = parseStreams(info)
    expect(planConversion('mp4', obs)).toEqual({ video: true, audio: [true, false] })
    expect(planConversion('mkv', obs)).toEqual({ video: true, audio: [true, true] })
    expect(planConversion('webm', obs)).toEqual({ video: false, audio: [false, false] })
    expect(planConversion('m4a', obs)).toEqual({ video: false, audio: [true] })
    expect(planConversion('mp3', obs)).toEqual({ video: false, audio: [false] })
    // Only 8-bit 4:2:0 H.264 is repacked into MP4; anything else becomes it.
    expect(planConversion('mp4', { video: { codec: 'h264', pixFmt: 'yuv444p' }, audio: [] }).video).toBe(false)
    expect(planConversion('mp4', { video: { codec: 'hevc', pixFmt: 'yuv420p10le' }, audio: [] }).video).toBe(false)
    expect(planConversion('webm', { video: { codec: 'vp9', pixFmt: 'yuv420p10le' }, audio: ['opus'] })).toEqual({ video: true, audio: [true] })
  })

  it('builds per-track codec options and skips the scaler when copying video', () => {
    const args = conversionArgs('in.mkv', 'out.mp4', 'mp4', { video: true, audio: [true, false] })
    expect(args.join(' ')).toContain('-map 0:V:0 -map 0:a? -c:v copy -c:a:0 copy -c:a:1 aac -b:a:1 192k -movflags +faststart')
    expect(args).not.toContain('-vf')
    const encoded = conversionArgs('in.mov', 'out.mp4', 'mp4')
    expect(encoded.join(' ')).toContain('-pix_fmt yuv420p -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 192k')
    expect(conversionArgs('in.mp4', 'out.mp3', 'mp3').join(' ')).toContain('-map 0:a:0 -vn -c:a libmp3lame -q:a 2')
    expect(conversionArgs('in.mp4', 'out.m4a', 'm4a', { video: false, audio: [true] }).join(' ')).toContain('-c:a copy -movflags +faststart')
  })

  it('explains FFmpeg failures in plain words', () => {
    expect(friendlyConversionError('[in#0 @ 0000] Error opening input: Invalid data found when processing input', 'mp4')).toMatch(/could not read this file/)
    expect(friendlyConversionError('Stream map \'0:a:0\' matches no streams.', 'mp3')).toBe('This file has no audio track to convert.')
    expect(friendlyConversionError('av_interleaved_write_frame(): No space left on device', 'mp4')).toMatch(/drive .* is full/)
    expect(friendlyConversionError('[libx264 @ 0x1] something odd happened', 'mp4')).toBe('FFmpeg could not convert this file: something odd happened')
  })
})

describe.skipIf(!existsSync(bin))('real FFmpeg conversions', () => {
  beforeAll(() => {
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', '-c:v', 'libx264', '-c:a', 'aac', source])
    ffmpeg(['-i', source, '-an', '-c:v', 'copy', silent])
  })
  it('converts and decodes every offered format and preserves source bytes', async () => {
    const originalHash = createHash('sha256').update(readFileSync(source)).digest('hex')
    const value = manager()
    for (const format of CONVERSION_FORMATS) value.enqueue({ paths: [source], format: format.id, saveDir: dir })
    await idle(value)
    for (const job of value.getJobs()) {
      expect(job, job.error || job.format).toMatchObject({ status: 'completed', progress: 100 })
      expect(job.output).toBeTruthy()
      const kind = CONVERSION_FORMATS.find(format => format.id === job.format)!.kind
      ffmpeg(['-v', 'error', '-xerror', '-i', job.output!, '-map', kind === 'audio' ? '0:a:0' : '0:V:0', '-f', 'null', '-'])
    }
    expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(originalHash)
    expect(readdirSync(dir).filter(name => name.startsWith('.snag-convert-'))).toEqual([])
  }, 60000)
  it('repacks an H.264 MKV with two audio tracks into MP4 without re-encoding and keeps both tracks', async () => {
    const mkv = join(dir, 'Recording two languages.mkv')
    ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-t', '2', '-map', '0', '-map', '1', '-map', '2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=deu', mkv
    ])
    const value = manager()
    value.enqueue({ paths: [mkv], format: 'mp4', saveDir: dir })
    value.enqueue({ paths: [mkv], format: 'm4a', saveDir: dir })
    value.enqueue({ paths: [mkv], format: 'mp3', saveDir: dir })
    await idle(value)
    const [mp4, m4a, mp3] = value.getJobs()
    expect(mp4).toMatchObject({ status: 'completed', method: 'copy' })
    expect(m4a).toMatchObject({ status: 'completed', method: 'copy' })
    expect(mp3).toMatchObject({ status: 'completed', method: 'encode' })
    expect(mp4.outputSize).toBeGreaterThan(0)
    let out = ''
    try {
      ffmpeg(['-i', mp4.output!])
    } catch (error) {
      out = String((error as { stderr?: string }).stderr)
    }
    const streams = parseStreams(out)
    expect(streams).toEqual({ video: { codec: 'h264', pixFmt: 'yuv420p' }, audio: ['aac', 'aac'] })
    expect(out).toMatch(/\(deu\): Audio/)
  })

  it('reports missing audio and continues processing the next queued file', async () => {
    const value = manager()
    value.enqueue({ paths: [silent, source], format: 'mp3', saveDir: dir })
    await idle(value)
    expect(value.getJobs()[0]).toMatchObject({ status: 'error', output: null })
    expect(value.getJobs()[0].error).toContain('no audio track')
    expect(value.getJobs()[1].status).toBe('completed')
  })
  it('supports silent video and reports corrupt input without leaving partial files', async () => {
    const bad = join(dir, 'bad.mp4')
    writeFileSync(bad, 'not a video')
    const value = manager()
    value.enqueue({ paths: [bad, silent], format: 'mp4', saveDir: dir })
    await idle(value)
    expect(value.getJobs().map(job => job.status)).toEqual(['error', 'completed'])
    expect(readdirSync(dir).filter(name => name.startsWith('.snag-convert-'))).toEqual([])
  })
  it('rejects video output from audio-only input with a clear error', async () => {
    const audio = join(dir, 'only-audio.wav')
    ffmpeg(['-i', source, '-vn', audio])
    const value = manager()
    value.enqueue({ paths: [audio], format: 'mp4', saveDir: dir })
    await idle(value)
    expect(value.getJobs()[0]).toMatchObject({ status: 'error', output: null })
    expect(value.getJobs()[0].error).toContain('no video track')
  })
  it('cancels running and queued jobs, cleans partial files, and can accept new work', async () => {
    const value = manager()
    const [a, b] = value.enqueue({ paths: [source, silent], format: 'webm', saveDir: dir })
    value.cancel(b.id)
    value.cancel(a.id)
    await idle(value)
    expect(value.getJobs().map(job => job.status)).toEqual(['cancelled', 'cancelled'])
    expect(readdirSync(dir).filter(name => name.startsWith('.snag-convert-'))).toEqual([])
    value.enqueue({ paths: [source], format: 'mp3', saveDir: dir })
    await idle(value)
    expect(value.getJobs()[2].status).toBe('completed')
  })
  it('waits for process termination during shutdown and rejects new work', async () => {
    const value = manager()
    value.enqueue({ paths: [source], format: 'webm', saveDir: dir })
    await value.shutdown()
    expect(value.hasActiveWork()).toBe(false)
    expect(value.getJobs()[0].status).toBe('cancelled')
    expect(() => value.enqueue({ paths: [source], format: 'mp3', saveDir: dir })).toThrow('closing')
  })
})
