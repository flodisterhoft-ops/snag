import { spawn, ChildProcess, execFile } from 'child_process'
import { EventEmitter } from 'events'
import { existsSync, readdirSync, unlinkSync } from 'fs'
import { basename, dirname, join } from 'path'
import { loadSettings } from './settings'
import { locateYtdlp, ffmpegDir, cleanYtdlpError } from './ytdlp'
import { buildDownloadArgs, PROGRESS_PREFIX } from './args'
import { notifyComplete, notifyError } from './notify'
import type { DownloadJob, DownloadRequest, ProgressUpdate } from '@shared/types'

let counter = 0
function genId(): string {
  counter += 1
  return `job_${Date.now().toString(36)}_${counter}`
}

function parsePercent(s: string | undefined): number | null {
  if (!s) return null
  const m = s.replace('%', '').trim()
  const n = Number.parseFloat(m)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null
}

const EMPTY_FIELDS = new Set(['', 'NA', 'N/A', 'Unknown', 'Unknown speed', 'Unknown ETA', 'none'])

function cleanField(s: string | undefined): string | null {
  if (s == null) return null
  const t = s.trim()
  return EMPTY_FIELDS.has(t) ? null : t
}

function buildItemLabel(idx: string | undefined, count: string | undefined): string | null {
  const i = cleanField(idx)
  const c = cleanField(count)
  if (i && c) return `Item ${i} of ${c}`
  return null
}

function killTree(proc: ChildProcess): void {
  if (!proc.pid) return
  try {
    if (process.platform === 'win32') {
      // yt-dlp spawns ffmpeg as a child; /T kills the whole tree.
      execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true })
    } else {
      proc.kill('SIGKILL')
    }
  } catch {
    try {
      proc.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
}

export class DownloadManager extends EventEmitter {
  private jobs = new Map<string, DownloadJob>()
  private order: string[] = []
  private queue: string[] = []
  private procs = new Map<string, ChildProcess>()
  private canceled = new Set<string>()
  private destinations = new Map<string, string[]>()

  enqueue(request: DownloadRequest): DownloadJob {
    const job: DownloadJob = {
      id: genId(),
      request,
      status: 'queued',
      progress: 0,
      speed: null,
      eta: null,
      sizeLabel: null,
      itemLabel: null,
      filepath: null,
      errorMessage: null,
      createdAt: Date.now(),
      completedAt: null
    }
    this.jobs.set(job.id, job)
    this.order.push(job.id)
    this.queue.push(job.id)
    this.emit('added', job)
    this.pump()
    return job
  }

  getJobs(): DownloadJob[] {
    return this.order.map((id) => this.jobs.get(id)).filter((j): j is DownloadJob => !!j)
  }

  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.status === 'queued') {
      this.queue = this.queue.filter((q) => q !== id)
      this.update(id, { status: 'canceled', speed: null, eta: null })
      return
    }
    const proc = this.procs.get(id)
    if (proc) {
      this.canceled.add(id)
      killTree(proc)
    }
  }

  retry(id: string): DownloadJob | null {
    const job = this.jobs.get(id)
    if (!job) return null
    if (job.status === 'queued' || job.status === 'downloading' || job.status === 'processing') {
      return job
    }
    this.update(id, {
      status: 'queued',
      progress: 0,
      speed: null,
      eta: null,
      sizeLabel: null,
      itemLabel: null,
      errorMessage: null,
      filepath: null,
      completedAt: null
    })
    this.queue.push(id)
    this.pump()
    return this.jobs.get(id) ?? null
  }

  removeJob(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.status === 'downloading' || job.status === 'processing') {
      this.cancel(id)
    }
    this.queue = this.queue.filter((q) => q !== id)
    this.jobs.delete(id)
    this.order = this.order.filter((o) => o !== id)
    this.destinations.delete(id)
  }

  clearCompleted(): void {
    for (const id of [...this.order]) {
      const job = this.jobs.get(id)
      if (job && (job.status === 'completed' || job.status === 'error' || job.status === 'canceled')) {
        this.jobs.delete(id)
        this.order = this.order.filter((o) => o !== id)
        this.destinations.delete(id)
      }
    }
  }

  private activeCount(): number {
    return this.procs.size
  }

  // True while anything is downloading or still waiting in the queue.
  hasActiveWork(): boolean {
    return this.procs.size > 0 || this.queue.length > 0
  }

  private pump(): void {
    const settings = loadSettings()
    const limit = Math.max(1, Math.min(4, settings.parallelDownloads))
    while (this.activeCount() < limit && this.queue.length > 0) {
      const id = this.queue.shift()
      if (!id) break
      const job = this.jobs.get(id)
      if (!job || job.status !== 'queued') continue
      this.start(job)
    }
  }

  private update(id: string, patch: Partial<DownloadJob>): void {
    const job = this.jobs.get(id)
    if (!job) return
    Object.assign(job, patch)
    const u: ProgressUpdate = {
      id,
      status: job.status,
      progress: job.progress,
      speed: job.speed,
      eta: job.eta,
      sizeLabel: job.sizeLabel,
      itemLabel: job.itemLabel,
      filepath: job.filepath,
      errorMessage: job.errorMessage
    }
    this.emit('progress', u)
  }

  private start(job: DownloadJob): void {
    const settings = loadSettings()
    const bin = locateYtdlp(settings.ytdlpPath)
    if (!bin) {
      this.update(job.id, {
        status: 'error',
        errorMessage: 'yt-dlp was not found. Set its path in Settings.'
      })
      return
    }

    const args = buildDownloadArgs(job.request, settings, { ffmpegLocation: ffmpegDir() })

    let child: ChildProcess
    try {
      child = spawn(bin, args, { windowsHide: true })
    } catch (err) {
      this.update(job.id, { status: 'error', errorMessage: (err as Error).message })
      return
    }

    this.procs.set(job.id, child)
    this.update(job.id, { status: 'downloading', progress: 0 })

    const destinations: string[] = []
    this.destinations.set(job.id, destinations)
    let finalPath: string | null = null
    let stderrBuf = ''
    let stdoutRest = ''

    const consume = (line: string): void => {
      const res = this.handleStdoutLine(job.id, line)
      if (res.destination) destinations.push(res.destination)
      if (res.finalPath) finalPath = res.finalPath
    }

    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => {
      stdoutRest += chunk
      const lines = stdoutRest.split(/\r?\n/)
      stdoutRest = lines.pop() ?? ''
      for (const line of lines) consume(line)
    })

    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (chunk: string) => {
      stderrBuf += chunk
      if (stderrBuf.length > 65536) stderrBuf = stderrBuf.slice(-65536)
    })

    child.on('error', (err) => {
      this.procs.delete(job.id)
      this.update(job.id, { status: 'error', errorMessage: err.message, speed: null, eta: null })
      this.pump()
    })

    child.on('close', (code) => {
      this.procs.delete(job.id)
      if (stdoutRest) {
        consume(stdoutRest)
        stdoutRest = ''
      }

      if (this.canceled.has(job.id)) {
        this.canceled.delete(job.id)
        this.cleanupPartials(destinations)
        this.destinations.delete(job.id)
        this.update(job.id, { status: 'canceled', speed: null, eta: null })
        this.pump()
        return
      }

      this.destinations.delete(job.id)

      if (code === 0) {
        const path = finalPath || destinations[destinations.length - 1] || null
        this.update(job.id, {
          status: 'completed',
          progress: 100,
          speed: null,
          eta: null,
          filepath: path,
          completedAt: Date.now()
        })
        notifyComplete(this.jobs.get(job.id)!, loadSettings().notificationsEnabled)
      } else {
        const msg = cleanYtdlpError(stderrBuf || 'Download failed.')
        this.update(job.id, { status: 'error', errorMessage: msg, speed: null, eta: null })
        notifyError(this.jobs.get(job.id)!, loadSettings().notificationsEnabled)
      }
      this.pump()
    })
  }

  private handleStdoutLine(
    id: string,
    rawLine: string
  ): { destination?: string; finalPath?: string } {
    const line = rawLine.trimEnd()
    if (line.startsWith(PROGRESS_PREFIX)) {
      this.parseProgress(id, line.slice(PROGRESS_PREFIX.length))
      return {}
    }

    let m: RegExpMatchArray | null
    if ((m = line.match(/^\[download\]\s+Destination:\s+(.+)$/))) {
      return { destination: m[1].trim() }
    }
    if ((m = line.match(/^\[Merger\]\s+Merging formats into\s+"(.+)"\s*$/))) {
      this.update(id, { status: 'processing', progress: 100 })
      return { finalPath: m[1].trim() }
    }
    if ((m = line.match(/^\[ExtractAudio\]\s+Destination:\s+(.+)$/))) {
      this.update(id, { status: 'processing', progress: 100 })
      return { finalPath: m[1].trim() }
    }
    if ((m = line.match(/^\[download\]\s+(.+?)\s+has already been downloaded/))) {
      return { finalPath: m[1].trim() }
    }
    if (
      /^\[(Fixup[A-Za-z0-9]*|VideoConvertor|Metadata|EmbedSubtitle|SubtitlesConvertor|ThumbnailsConvertor|EmbedThumbnail|VideoRemuxer)\]/.test(
        line
      )
    ) {
      this.update(id, { status: 'processing', progress: 100 })
    }
    return {}
  }

  private parseProgress(id: string, payload: string): void {
    const parts = payload.split('|')
    const progress = parsePercent(parts[0])
    const patch: Partial<DownloadJob> = {
      status: 'downloading',
      speed: cleanField(parts[1]),
      eta: cleanField(parts[2]),
      sizeLabel: cleanField(parts[3]),
      itemLabel: buildItemLabel(parts[4], parts[5])
    }
    if (progress != null) patch.progress = progress
    this.update(id, patch)
  }

  private cleanupPartials(destinations: string[]): void {
    const candidates = new Set<string>()
    for (const d of destinations) {
      candidates.add(d)
      candidates.add(`${d}.part`)
      candidates.add(`${d}.ytdl`)

      // Fragmented downloads can leave files such as video.webm.part-Frag12.part.
      // Only scan the destination's own directory and only accept the exact basename prefix.
      try {
        const dir = dirname(d)
        const base = basename(d)
        for (const name of readdirSync(dir)) {
          if (name.startsWith(`${base}.part-Frag`)) candidates.add(join(dir, name))
        }
      } catch {
        /* best-effort cleanup */
      }
    }
    for (const file of candidates) {
      try {
        if (existsSync(file)) unlinkSync(file)
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

export const downloadManager = new DownloadManager()
