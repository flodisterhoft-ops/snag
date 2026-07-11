import { spawn, ChildProcess, execFileSync } from 'child_process'
import { EventEmitter } from 'events'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { basename, dirname, join } from 'path'
import { app } from 'electron'
import { loadSettings } from './settings'
import { locateYtdlp, ffmpegDir, cleanYtdlpError, ytdlpChildEnv } from './ytdlp'
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

export function parseRemuxDestination(line: string): string | null {
  const match = line.match(/^\[(?:VideoRemuxer|VideoConvertor)\].*?Destination:\s+(.+)$/)
  if (!match) return null
  const path = match[1].trim()
  return path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path
}

function killTree(proc: ChildProcess): void {
  if (!proc.pid) return
  try {
    if (process.platform === 'win32') {
      // yt-dlp spawns ffmpeg as a child; /T kills the whole tree.
      execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5000,
        stdio: 'ignore'
      })
    } else {
      // Downloads are spawned in their own process group below. Killing the
      // group also terminates yt-dlp's ffmpeg children.
      process.kill(-proc.pid, 'SIGKILL')
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
  private persistenceFile: string | null = null
  private persistTimer: NodeJS.Timeout | null = null
  private initialized = false
  private shuttingDown = false

  // Call once after Electron is ready. A path override keeps persistence
  // independently testable without relying on Electron's userData directory.
  initializePersistence(
    file = join(app.getPath('userData'), 'jobs.json'),
    startQueued = true
  ): void {
    if (this.initialized) return
    this.initialized = true
    this.persistenceFile = file
    this.restoreJobs()
    this.flushPersistence()
    if (startQueued) this.pump()
  }

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
    this.schedulePersistence()
    this.pump()
    return job
  }

  getJobs(): DownloadJob[] {
    return this.order.map((id) => this.jobs.get(id)).filter((j): j is DownloadJob => !!j)
  }

  getJob(id: string): DownloadJob | null {
    return this.jobs.get(id) ?? null
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
    this.schedulePersistence()
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
    this.schedulePersistence()
  }

  private activeCount(): number {
    return this.procs.size
  }

  // True while anything is downloading or still waiting in the queue.
  hasActiveWork(): boolean {
    return this.procs.size > 0 || this.queue.length > 0
  }

  // Re-read the concurrency setting and start any newly available queue slots.
  reschedule(): void {
    this.pump()
  }

  cancelAll(): void {
    for (const id of [...this.order]) {
      const job = this.jobs.get(id)
      if (job && (job.status === 'queued' || job.status === 'downloading' || job.status === 'processing')) {
        this.cancel(id)
      }
    }
  }

  // Synchronous tree termination is deliberate: app.quit must not leave yt-dlp
  // or ffmpeg running after Electron exits.
  shutdown(): void {
    if (this.shuttingDown) return
    this.shuttingDown = true
    this.queue = []
    for (const [id, proc] of this.procs) {
      this.canceled.add(id)
      killTree(proc)
      this.cleanupPartials(this.destinations.get(id) ?? [])
      this.destinations.delete(id)
      this.update(id, { status: 'canceled', speed: null, eta: null })
    }
    for (const id of this.order) {
      const job = this.jobs.get(id)
      if (job?.status === 'queued') {
        this.update(id, { status: 'canceled', speed: null, eta: null })
      }
    }
    this.flushPersistence()
  }

  private pump(): void {
    if (this.shuttingDown) return
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
    this.schedulePersistence()
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

    const args = buildDownloadArgs(job.request, settings, {
      ffmpegLocation: ffmpegDir(),
      nodeRuntimePath: process.execPath
    })

    let child: ChildProcess
    try {
      child = spawn(bin, args, {
        windowsHide: true,
        // A separate Unix process group lets cancellation kill ffmpeg children too.
        detached: process.platform !== 'win32',
        env: ytdlpChildEnv()
      })
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
      if (res.finalPath) {
        finalPath = res.finalPath
        if (!destinations.includes(res.finalPath)) destinations.push(res.finalPath)
      }
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
    const remuxDestination = parseRemuxDestination(line)
    if (remuxDestination) {
      this.update(id, { status: 'processing', progress: 100 })
      return { finalPath: remuxDestination }
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

  private restoreJobs(): void {
    if (!this.persistenceFile) return
    const candidates = [this.persistenceFile, `${this.persistenceFile}.bak`]
    let rawJobs: unknown[] | null = null
    for (const file of candidates) {
      try {
        if (!existsSync(file)) continue
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
        const jobs = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === 'object' && Array.isArray((parsed as { jobs?: unknown }).jobs)
            ? (parsed as { jobs: unknown[] }).jobs
            : null
        if (jobs) {
          rawJobs = jobs
          break
        }
      } catch {
        // Try the backup if the primary was interrupted or corrupted.
      }
    }
    if (!rawJobs) return

    const statuses = new Set([
      'queued',
      'downloading',
      'processing',
      'completed',
      'error',
      'canceled'
    ])
    for (const raw of rawJobs) {
      if (!raw || typeof raw !== 'object') continue
      const job = raw as DownloadJob
      if (
        typeof job.id !== 'string' ||
        !job.request ||
        typeof job.request !== 'object' ||
        typeof job.request.url !== 'string' ||
        typeof job.request.title !== 'string' ||
        (job.request.kind !== 'video' && job.request.kind !== 'audio') ||
        typeof job.request.saveDir !== 'string' ||
        typeof job.request.selectionLabel !== 'string' ||
        !statuses.has(job.status) ||
        this.jobs.has(job.id)
      ) {
        continue
      }

      job.progress = Number.isFinite(job.progress)
        ? Math.max(0, Math.min(100, job.progress))
        : 0
      job.speed = typeof job.speed === 'string' ? job.speed : null
      job.eta = typeof job.eta === 'string' ? job.eta : null
      job.sizeLabel = typeof job.sizeLabel === 'string' ? job.sizeLabel : null
      job.itemLabel = typeof job.itemLabel === 'string' ? job.itemLabel : null
      job.filepath = typeof job.filepath === 'string' ? job.filepath : null
      job.errorMessage = typeof job.errorMessage === 'string' ? job.errorMessage : null
      job.createdAt = Number.isFinite(job.createdAt) ? job.createdAt : Date.now()
      job.completedAt = Number.isFinite(job.completedAt) ? job.completedAt : null

      if (job.status === 'downloading' || job.status === 'processing') {
        job.status = 'error'
        job.errorMessage = 'Snag closed before this download finished. Retry to download it again.'
        job.speed = null
        job.eta = null
        job.completedAt = Date.now()
      } else if (job.status === 'queued') {
        job.progress = 0
        job.speed = null
        job.eta = null
        this.queue.push(job.id)
      }
      this.jobs.set(job.id, job)
      this.order.push(job.id)
    }
  }

  private schedulePersistence(): void {
    if (!this.persistenceFile || this.shuttingDown) return
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => this.flushPersistence(), 300)
    this.persistTimer.unref()
  }

  private flushPersistence(): void {
    if (!this.persistenceFile) return
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }

    const file = this.persistenceFile
    const temp = `${file}.tmp`
    const backup = `${file}.bak`
    try {
      mkdirSync(dirname(file), { recursive: true })
      const jobs = this.order
        .map((id) => this.jobs.get(id))
        .filter((job): job is DownloadJob => !!job)
      writeFileSync(temp, JSON.stringify({ version: 1, jobs }), 'utf8')

      // Two atomic renames plus a recoverable backup avoid partially written JSON.
      if (existsSync(backup)) unlinkSync(backup)
      if (existsSync(file)) renameSync(file, backup)
      renameSync(temp, file)
      if (existsSync(backup)) unlinkSync(backup)
    } catch {
      // Best effort. If replacing the primary failed, the backup remains readable.
      try {
        if (existsSync(temp)) unlinkSync(temp)
      } catch {
        /* ignore */
      }
    }
  }
}

export const downloadManager = new DownloadManager()
