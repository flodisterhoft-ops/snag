import { spawn, type ChildProcess } from 'child_process'
import { constants, existsSync, mkdtempSync, rmSync, statSync } from 'fs'
import { copyFile, link, unlink } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { CONVERSION_FORMATS, type ConversionFormat, type ConversionJob, type ConversionRequest } from '../shared/conversion'
import { locateFfmpeg } from './ytdlp'

// What `ffmpeg -i` reports about a source: the first real video stream (cover
// art excluded) and the codec of every audio stream, in order.
export interface SourceStreams {
  video: { codec: string; pixFmt: string } | null
  audio: string[]
}

// Per stream: true copies it untouched, false encodes it. `audio` has one
// entry per source audio track for video formats, one for audio formats.
export interface ConversionPlan {
  video: boolean
  audio: boolean[]
}

// "  Stream #0:1(eng): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, ..."
// "  Stream #0:0[0x1](und): Video: h264 (High), yuv420p(tv, bt709), 1920x1080 ..."
export function parseStreams(ffmpegInfo: string): SourceStreams {
  const streams: SourceStreams = { video: null, audio: [] }
  for (const line of ffmpegInfo.split(/\r?\n/)) {
    const m = /^\s*Stream #\d+:\d+.*?: (Video|Audio): ([a-z0-9_]+)(.*)$/i.exec(line)
    if (!m) continue
    if (m[1] === 'Audio') streams.audio.push(m[2].toLowerCase())
    else if (!streams.video && !m[3].includes('(attached pic)')) {
      streams.video = { codec: m[2].toLowerCase(), pixFmt: (/^[^,]*, ([a-z0-9]+)/i.exec(m[3])?.[1] ?? '').toLowerCase() }
    }
  }
  return streams
}

// Streams that already are what a format promises are copied: instant and
// without quality loss (an OBS recording's MKV to MP4, AAC audio to M4A).
// H.264 is copied only as 8-bit 4:2:0, the profile every player handles.
const H264_EVERYWHERE = (v: NonNullable<SourceStreams['video']>): boolean =>
  v.codec === 'h264' && /^yuvj?420p$/.test(v.pixFmt)
const VIDEO_COPY: Record<'mp4' | 'mkv' | 'mov' | 'webm', (v: NonNullable<SourceStreams['video']>) => boolean> = {
  mp4: H264_EVERYWHERE,
  mkv: H264_EVERYWHERE,
  mov: H264_EVERYWHERE,
  webm: (v) => ['vp8', 'vp9', 'av1'].includes(v.codec)
}
const AUDIO_COPY: Record<ConversionFormat, readonly string[] | 'any'> = {
  mp3: ['mp3'],
  m4a: ['aac', 'alac'],
  wav: ['pcm_s16le'],
  flac: ['flac'],
  ogg: ['vorbis'],
  opus: ['opus'],
  mp4: ['aac', 'mp3'],
  mov: ['aac', 'mp3', 'alac'],
  mkv: 'any',
  webm: ['opus', 'vorbis']
}
const AUDIO_ENCODE: Record<ConversionFormat, { codec: string; options: [string, string][] }> = {
  mp3: { codec: 'libmp3lame', options: [['-q', '2']] },
  m4a: { codec: 'aac', options: [['-b', '192k']] },
  wav: { codec: 'pcm_s16le', options: [] },
  flac: { codec: 'flac', options: [] },
  ogg: { codec: 'libvorbis', options: [['-q', '5']] },
  opus: { codec: 'libopus', options: [['-b', '160k']] },
  mp4: { codec: 'aac', options: [['-b', '192k']] },
  mov: { codec: 'aac', options: [['-b', '192k']] },
  mkv: { codec: 'aac', options: [['-b', '192k']] },
  webm: { codec: 'libopus', options: [['-b', '160k']] }
}

const isAudioFormat = (format: ConversionFormat): boolean =>
  CONVERSION_FORMATS.find((f) => f.id === format)?.kind === 'audio'

export function planConversion(format: ConversionFormat, streams: SourceStreams): ConversionPlan {
  const audioOk = (codec: string): boolean => {
    const allowed = AUDIO_COPY[format]
    return allowed === 'any' || allowed.includes(codec)
  }
  if (isAudioFormat(format)) return { video: false, audio: [!!streams.audio[0] && audioOk(streams.audio[0])] }
  return {
    video: !!streams.video && VIDEO_COPY[format as keyof typeof VIDEO_COPY](streams.video),
    audio: streams.audio.map(audioOk)
  }
}

// `spec` names the output stream(s): 'a' for all audio, 'a:1' for the second.
function audioCodecArgs(format: ConversionFormat, copy: boolean, spec: string): string[] {
  if (copy) return [`-c:${spec}`, 'copy']
  const { codec, options } = AUDIO_ENCODE[format]
  return [`-c:${spec}`, codec, ...options.flatMap(([flag, value]) => [`${flag}:${spec}`, value])]
}

// Without a plan every stream is encoded, which works for any readable source.
export function conversionArgs(
  source: string,
  output: string,
  format: ConversionFormat,
  plan?: ConversionPlan
): string[] {
  const args = ['-hide_banner', '-nostdin', '-n', '-protocol_whitelist', 'file,pipe', '-i', source]
  if (isAudioFormat(format)) {
    args.push('-map', '0:a:0', '-vn', ...audioCodecArgs(format, !!plan?.audio[0], 'a'))
    if (format === 'm4a') args.push('-movflags', '+faststart')
  } else {
    // Every audio track: a multi-language download keeps its dubs.
    args.push('-map', '0:V:0', '-map', '0:a?')
    if (plan?.video) {
      args.push('-c:v', 'copy')
    } else {
      args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p')
      if (format === 'webm') args.push('-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '5')
      else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23')
    }
    if (plan && plan.audio.length > 0) plan.audio.forEach((copy, i) => args.push(...audioCodecArgs(format, copy, `a:${i}`)))
    else args.push(...audioCodecArgs(format, false, 'a'))
    if (format === 'mp4' || format === 'mov') args.push('-movflags', '+faststart')
  }
  return [...args, '-sn', '-dn', '-progress', 'pipe:1', '-nostats', output]
}

// FFmpeg's own wording, turned into something a person can act on.
export function friendlyConversionError(stderr: string, format: ConversionFormat): string {
  if (/matches no streams|does not contain any stream/i.test(stderr)) {
    return `This file has no ${isAudioFormat(format) ? 'audio track' : 'video track'} to convert.`
  }
  if (/Invalid data found when processing input|moov atom not found|could not find codec parameters|EBML header parsing failed/i.test(stderr)) {
    return 'Snag could not read this file. It may be damaged, still being written, or not a video or audio file.'
  }
  if (/No such file or directory/i.test(stderr)) return 'The file is no longer there.'
  if (/Permission denied/i.test(stderr)) return 'Windows did not let Snag read or write this file. Close any program that has it open and retry.'
  if (/No space left on device/i.test(stderr)) return 'The drive you are saving to is full.'
  const last = stderr
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]*\]\s*/, '').trim())
    .filter(Boolean)
    .pop()
  return last ? `FFmpeg could not convert this file: ${last.slice(0, 200)}` : 'FFmpeg could not convert this file.'
}

// Exclusive publication protects originals and existing exports, including races
// with other apps writing to the chosen folder while FFmpeg is running.
export async function publishConversion(temp: string, source: string, dir: string, format: ConversionFormat): Promise<string> {
  const stem = basename(source, extname(source))
  for (let n = 1; n < 10000; n++) {
    const output = join(dir, `${stem} - converted${n === 1 ? '' : ` (${n})`}.${format}`)
    try {
      // Same-volume hard links publish instantly, without copying large videos.
      // Removable drives may not support them; copy asynchronously in that case.
      try { await link(temp, output) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error
        await copyFile(temp, output, constants.COPYFILE_EXCL)
      }
      return output
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('Too many converted files with the same name. Choose another folder.')
}

export class ConversionManager {
  onIdle: () => void = () => {}
  private jobs: ConversionJob[] = []
  private child: ChildProcess | null = null
  private running: Promise<void> | null = null
  private stopping = false
  private cancelled = new Set<string>()
  constructor(private locate = locateFfmpeg) {}

  getJobs(): ConversionJob[] { return this.jobs.map(job => ({ ...job })) }
  hasActiveWork(): boolean { return !!this.running || this.jobs.some(j => j.status === 'queued') }
  enqueue(request: ConversionRequest): ConversionJob[] {
    if (this.stopping) throw new Error('Snag is closing.')
    if (!request || !Array.isArray(request.paths) || !request.paths.length || request.paths.length > 50)
      throw new Error('Choose between 1 and 50 files at a time.')
    if (!CONVERSION_FORMATS.some(f => f.id === request.format)) throw new Error('Choose a supported output format.')
    if (typeof request.saveDir !== 'string' || (request.saveDir && (!isAbsolute(request.saveDir) || !existsSync(request.saveDir) || !statSync(request.saveDir).isDirectory())))
      throw new Error('Choose an existing output folder.')
    if (!this.locate()) throw new Error('FFmpeg was not found. Check Engine in Settings.')
    const paths = [...new Set(request.paths)]
    for (const path of paths) {
      if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Choose local video or audio files, not folders.')
      if (!existsSync(path)) throw new Error(`${basename(path)} is no longer there.`)
      if (!statSync(path).isFile()) throw new Error('Choose local video or audio files, not folders.')
    }
    if (this.jobs.filter(j => j.status === 'queued' || j.status === 'converting').length + paths.length > 100)
      throw new Error('The conversion queue is full. Wait for some files to finish.')
    const added: ConversionJob[] = paths.map(source => ({
      id: randomUUID(), source: resolve(source), format: request.format,
      saveDir: request.saveDir || dirname(source), status: 'queued', progress: null, output: null, error: null,
      method: null, outputSize: null
    }))
    this.jobs.push(...added)
    this.pump()
    return added.map(j => ({ ...j }))
  }
  cancel(id: string): void {
    const job = this.jobs.find(j => j.id === id)
    if (!job || !['queued', 'converting'].includes(job.status)) return
    this.cancelled.add(id)
    if (job.status === 'queued') { job.status = 'cancelled'; this.cancelled.delete(id) }
    else this.child?.kill('SIGKILL')
  }
  clearFinished(): void { this.jobs = this.jobs.filter(j => ['queued', 'converting'].includes(j.status)) }
  async shutdown(): Promise<void> {
    this.stopping = true
    for (const job of this.jobs) this.cancel(job.id)
    await this.running
  }
  private pump(): void {
    if (this.running || this.stopping) return
    const job = this.jobs.find(j => j.status === 'queued')
    if (!job) return
    this.running = this.run(job).finally(() => {
      this.running = null
      this.pump()
      if (!this.hasActiveWork()) this.onIdle()
    })
  }
  // `ffmpeg -i` alone lists the streams (and fails for want of an output).
  private probe(bin: string, source: string): Promise<string> {
    return new Promise((accept) => {
      let info = ''
      const child = spawn(bin, ['-hide_banner', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', source], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      })
      this.child = child
      const timer = setTimeout(() => child.kill('SIGKILL'), 20000)
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => { if (info.length < 200000) info += chunk })
      child.on('error', () => { clearTimeout(timer); accept(info) })
      child.on('close', () => { clearTimeout(timer); this.child = null; accept(info) })
    })
  }

  // Rejects with a message for people; `stderr` keeps FFmpeg's own words.
  private ffmpeg(bin: string, job: ConversionJob, args: string[]): Promise<void> {
    return new Promise<void>((accept, reject) => {
      let stderr = '', stdout = '', duration = 0, spawnError: Error | null = null
      const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      this.child = child
      child.stderr?.setEncoding('utf8')
      child.stdout?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-16000)
        if (!duration) {
          const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
          if (match) duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
        }
      })
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk
        const lines = stdout.split(/\r?\n/)
        stdout = lines.pop() || ''
        for (const line of lines) {
          const match = /^out_time_us=(\d+)$/.exec(line)
          if (match && duration > 0) job.progress = Math.min(99, Number(match[1]) / 1000000 / duration * 100)
        }
      })
      child.on('error', error => { spawnError = error })
      child.on('close', code => {
        this.child = null
        if (this.cancelled.has(job.id)) reject(new Error('Conversion cancelled.'))
        else if (spawnError) reject(spawnError)
        else if (code === 0) accept()
        else reject(Object.assign(new Error(friendlyConversionError(stderr, job.format)), { stderr }))
      })
    })
  }

  private async run(job: ConversionJob): Promise<void> {
    let tempDir: string | null = null
    job.status = 'converting'
    try {
      const bin = this.locate()
      if (!bin) throw new Error('FFmpeg was not found. Check Engine in Settings.')
      const info = await this.probe(bin, job.source)
      if (this.cancelled.has(job.id)) throw new Error('Conversion cancelled.')
      const streams = parseStreams(info)
      const audioOut = isAudioFormat(job.format)
      if (!streams.video && streams.audio.length === 0) throw new Error(friendlyConversionError(info, job.format))
      if (audioOut ? streams.audio.length === 0 : !streams.video) {
        throw new Error(friendlyConversionError('matches no streams', job.format))
      }
      const plan = planConversion(job.format, streams)
      job.method = (audioOut ? plan.audio[0] : plan.video) ? 'copy' : 'encode'
      tempDir = mkdtempSync(join(job.saveDir, '.snag-convert-'))
      const temp = join(tempDir, `output.${job.format}`)
      try {
        await this.ffmpeg(bin, job, conversionArgs(job.source, temp, job.format, plan))
      } catch (error) {
        // A copied stream the container turned down after all: encode it.
        const stderr = (error as { stderr?: string }).stderr
        const copied = plan.video || plan.audio.some(Boolean)
        if (!copied || stderr === undefined || /No space left|Permission denied|No such file/i.test(stderr)) throw error
        rmSync(temp, { force: true })
        job.method = 'encode'
        job.progress = null
        await this.ffmpeg(bin, job, conversionArgs(job.source, temp, job.format))
      }
      if (!existsSync(temp) || !statSync(temp).size) throw new Error('FFmpeg produced an empty file.')
      if (this.cancelled.has(job.id)) throw new Error('Conversion cancelled.')
      const output = await publishConversion(temp, job.source, job.saveDir, job.format)
      if (this.cancelled.has(job.id)) {
        await unlink(output)
        throw new Error('Conversion cancelled.')
      }
      job.output = output
      job.outputSize = statSync(output).size
      job.progress = 100
      job.status = 'completed'
    } catch (error) {
      job.status = this.cancelled.has(job.id) ? 'cancelled' : 'error'
      job.error = job.status === 'error' ? (error as Error).message : null
    } finally {
      this.cancelled.delete(job.id)
      if (tempDir) {
        try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* Never remove anything outside our private staging folder. */ }
      }
    }
  }
}

export const conversionManager = new ConversionManager()
