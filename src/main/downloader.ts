import { spawn, ChildProcess, execFileSync } from 'child_process'
import { EventEmitter } from 'events'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { basename, dirname, extname, join } from 'path'
import { app } from 'electron'
import { loadSettings } from './settings'
import { locateYtdlp, ffmpegDir, locateAria2c, cleanYtdlpError, ytdlpChildEnv } from './ytdlp'
import { buildDownloadArgs, PROGRESS_PREFIX } from './args'

// Size of the finished file for the queue card ("128 MB"); the progress lines
// only ever report one stream at a time, so they undercount merged videos.
function fileSizeLabel(path: string | null): string | null {
  if (!path) return null
  try {
    const bytes = statSync(path).size
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  } catch {
    return null
  }
}
import { cookieArgs } from './cookies'
import { notifyComplete, notifyError } from './notify'
import { shareFile } from './share'
import { openWithPlayer } from './player'
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

// What a yt-dlp post-processor line means to a person watching the queue.
const PHASES: [RegExp, string][] = [
  [/^\[Merger\]/, 'Merging video and audio'],
  [/^\[ExtractAudio\]/, 'Converting audio'],
  [/^\[VideoConvertor\]/, 'Converting video'],
  [/^\[VideoRemuxer\]/, 'Repacking the file'],
  [/^\[Fixup[A-Za-z0-9]*\]/, 'Fixing up the file'],
  [/^\[(EmbedSubtitle|SubtitlesConvertor)\]/, 'Embedding subtitles'],
  [/^\[(EmbedThumbnail|ThumbnailsConvertor)\]/, 'Embedding the thumbnail'],
  [/^\[Metadata\]/, 'Writing metadata'],
  [/^\[(ModifyChapters|SponsorBlock)\]/, 'Cutting marked segments']
]

// aria2c's console readout, one per second while it downloads a plain file:
//   [#a0872f 74MiB/354MiB(20%) CN:16 DL:97MiB ETA:2s]
// yt-dlp does not relay external-downloader progress, so this is the only
// progress signal the aria2 engine gives us.
const ARIA2_READOUT_RE =
  /\[#[0-9a-z]+ ([\d.]+)([KMGT]?i?B)\/([\d.]+)([KMGT]?i?B)\((\d+)%\)(?: CN:\d+)?(?: DL:([\d.]+[KMGT]?i?B))?(?: ETA:([\dhms]+))?\]/

export function parseAria2Readout(
  line: string
): { progress: number; speed: string | null; eta: string | null; sizeLabel: string | null } | null {
  let m: RegExpExecArray | null = null
  let last: RegExpExecArray | null = null
  const re = new RegExp(ARIA2_READOUT_RE.source, 'g')
  while ((m = re.exec(line))) last = m
  if (!last) return null
  return {
    progress: Math.max(0, Math.min(100, Number(last[5]))),
    speed: last[6] ? `${last[6]}/s` : null,
    eta: last[7] ?? null,
    sizeLabel: `${last[3]}${last[4]}`
  }
}

// Letters and digits only, with compatibility characters folded ("？" → "?"
// → dropped), so a name that lost an en dash or a full-width character to
// the console encoding still matches the file on disk.
export function fileNameSkeleton(name: string): string {
  return name.normalize('NFKC').replace(/[^0-9a-z]/gi, '').toLowerCase()
}

// A completed job whose file is gone: look for the one file in the same
// folder with the same extension and letters. Null unless exactly one matches.
export function findRenamedFile(
  path: string,
  list: (dir: string) => string[] = (dir) => readdirSync(dir)
): string | null {
  const dir = dirname(path)
  const base = basename(path)
  const ext = extname(base).toLowerCase()
  const want = fileNameSkeleton(base)
  if (!want) return null
  let names: string[]
  try {
    names = list(dir)
  } catch {
    return null
  }
  const matches = names.filter((n) => extname(n).toLowerCase() === ext && fileNameSkeleton(n) === want)
  return matches.length === 1 ? join(dir, matches[0]) : null
}

export function postProcessingPhase(line: string): string | null {
  for (const [re, label] of PHASES) if (re.test(line)) return label
  return null
}

export class DownloadManager extends EventEmitter {
  private jobs = new Map<string, DownloadJob>()
  private order: string[] = []
  private queue: string[] = []
  private procs = new Map<string, ChildProcess>()
  private canceled = new Set<string>()
  // Pause requests in flight: the process is being killed but partial files
  // stay on disk so yt-dlp can continue them on resume.
  private paused = new Set<string>()
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
    this.healFilePaths()
    this.flushPersistence()
    if (startQueued) this.pump()
  }

  // Jobs finished before yt-dlp printed UTF-8 can point at names with lost
  // characters; point them at the real file once.
  private healFilePaths(): void {
    for (const job of this.jobs.values()) {
      if (job.status !== 'completed' || !job.filepath || existsSync(job.filepath)) continue
      const healed = findRenamedFile(job.filepath)
      if (healed) job.filepath = healed
    }
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
    if (job.status === 'queued' || job.status === 'paused') {
      this.queue = this.queue.filter((q) => q !== id)
      this.cleanupPartials(this.destinations.get(id) ?? [])
      this.destinations.delete(id)
      this.update(id, { status: 'canceled', speed: null, eta: null })
      return
    }
    const proc = this.procs.get(id)
    if (proc) {
      this.canceled.add(id)
      killTree(proc)
    }
  }

  // Stop now, keep the partial files; resume() continues where it left off.
  pause(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.status === 'queued') {
      this.queue = this.queue.filter((q) => q !== id)
      this.update(id, { status: 'paused', speed: null, eta: null })
      return
    }
    if (job.status !== 'downloading' && job.status !== 'processing') return
    const proc = this.procs.get(id)
    if (proc) {
      this.paused.add(id)
      killTree(proc)
    }
  }

  resume(id: string): void {
    const job = this.jobs.get(id)
    if (!job || job.status !== 'paused') return
    this.update(id, { status: 'queued', speed: null, eta: null, errorMessage: null })
    this.queue.push(id)
    this.pump()
  }

  // `displayed` is the renderer's list, top to bottom (newest first by
  // default). Queued jobs start in that order; the stored order is reversed so
  // a reload shows the same list.
  reorderJobs(displayed: string[]): void {
    const known = displayed.filter((id, index) => this.jobs.has(id) && displayed.indexOf(id) === index)
    if (known.length === 0) return
    const rest = this.order.filter((id) => !known.includes(id))
    this.order = [...rest, ...[...known].reverse()]
    const queued = known.filter((id) => this.jobs.get(id)?.status === 'queued')
    const missing = this.queue.filter((id) => !queued.includes(id))
    this.queue = [...queued, ...missing]
    this.schedulePersistence()
    this.emit('reordered', this.getJobs())
  }

  retry(id: string): DownloadJob | null {
    const job = this.jobs.get(id)
    if (!job) return null
    if (job.status === 'queued' || job.status === 'downloading' || job.status === 'processing') {
      return job
    }
    if (job.status === 'paused') {
      this.resume(id)
      return this.jobs.get(id) ?? null
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
    if (job.status === 'downloading' || job.status === 'processing' || job.status === 'paused') {
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

  deleteCompletedFile(id: string): { ok: boolean; error?: string } {
    const job = this.jobs.get(id)
    if (!job || job.status !== 'completed') return { ok: false, error: 'Only completed downloads can be deleted.' }
    if (!job.filepath) return { ok: false, error: 'This download has no saved file path.' }
    try {
      if (existsSync(job.filepath)) unlinkSync(job.filepath)
      this.removeJob(id)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message || 'Windows could not delete the file.' }
    }
  }

  deleteAllCompletedFiles(): { deletedIds: string[]; errors: string[] } {
    const deletedIds: string[] = []
    const errors: string[] = []
    for (const id of [...this.order]) {
      const job = this.jobs.get(id)
      if (!job || job.status !== 'completed' || !job.filepath) continue
      const result = this.deleteCompletedFile(id)
      if (result.ok) deletedIds.push(id)
      else errors.push(`${job.request.title}: ${result.error}`)
    }
    return { deletedIds, errors }
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
      phase: job.phase ?? null,
      filepath: job.filepath,
      errorMessage: job.errorMessage,
      title: job.request.title
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
      aria2cPath: settings.downloadEngine === 'aria2' ? locateAria2c() : null,
      nodeRuntimePath: process.execPath,
      cookieArgs: cookieArgs(settings)
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
      // aria2c redraws its readout with bare carriage returns.
      const lines = stdoutRest.split(/\r\n|\n|\r/)
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

      if (this.paused.has(job.id)) {
        this.paused.delete(job.id)
        // Partial files stay; the destination list is kept so a later cancel
        // can still clean them up.
        this.update(job.id, { status: 'paused', speed: null, eta: null })
        this.pump()
        return
      }

      this.destinations.delete(job.id)

      if (code === 0) {
        const path = finalPath || destinations[destinations.length - 1] || null
        // Batch downloads were queued by URL only; the finished file names them.
        const request =
          path && job.request.title === job.request.url
            ? { ...job.request, title: basename(path, extname(path)) }
            : job.request
        this.update(job.id, {
          request,
          status: 'completed',
          progress: 100,
          speed: null,
          eta: null,
          sizeLabel: fileSizeLabel(path) ?? job.sizeLabel,
          filepath: path,
          completedAt: Date.now()
        })
        notifyComplete(this.jobs.get(job.id)!, loadSettings().notificationsEnabled)
        if (job.request.openWhenDone && path && existsSync(path)) {
          void openWithPlayer(path).catch(() => {
            /* the file is still there; the user can open it from the queue */
          })
        }
        if (job.request.shareWhenDone && path && existsSync(path)) {
          // Errors surface nowhere useful here; the queue's Share button retries.
          void shareFile(path, job.request.shareTarget).catch(() => {})
        }
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
    const aria2 = parseAria2Readout(line)
    if (aria2) {
      this.update(id, { status: 'downloading', phase: null, ...aria2 })
      return {}
    }

    let m: RegExpMatchArray | null
    if ((m = line.match(/^\[download\]\s+Destination:\s+(.+)$/))) {
      return { destination: m[1].trim() }
    }
    if ((m = line.match(/^\[Merger\]\s+Merging formats into\s+"(.+)"\s*$/))) {
      this.update(id, { status: 'processing', progress: 100, phase: 'Merging video and audio' })
      return { finalPath: m[1].trim() }
    }
    if ((m = line.match(/^\[ExtractAudio\]\s+Destination:\s+(.+)$/))) {
      this.update(id, { status: 'processing', progress: 100, phase: 'Converting audio' })
      return { finalPath: m[1].trim() }
    }
    const remuxDestination = parseRemuxDestination(line)
    if (remuxDestination) {
      this.update(id, { status: 'processing', progress: 100, phase: 'Repacking the file' })
      return { finalPath: remuxDestination }
    }
    if ((m = line.match(/^\[download\]\s+(.+?)\s+has already been downloaded/))) {
      return { finalPath: m[1].trim() }
    }
    const phase = postProcessingPhase(line)
    if (phase) this.update(id, { status: 'processing', progress: 100, phase })
    return {}
  }

  private parseProgress(id: string, payload: string): void {
    const parts = payload.split('|')
    const progress = parsePercent(parts[0])
    const patch: Partial<DownloadJob> = {
      status: 'downloading',
      phase: null,
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
      // aria2c keeps its resume state next to the partial file.
      candidates.add(`${d}.aria2`)
      candidates.add(`${d}.part.aria2`)

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
      'canceled',
      'paused'
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
      job.phase = typeof job.phase === 'string' ? job.phase : null
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
