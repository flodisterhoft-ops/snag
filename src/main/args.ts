import { join } from 'path'
import type { DownloadRequest, Settings } from '@shared/types'
import { CONTAINER_CODEC_PATTERNS } from '@shared/container'

export const PROGRESS_PREFIX = 'SNAGPROG|'

// Emitted once per progress tick on stdout. Fields are pipe-separated and never
// contain a pipe themselves (percent/speed/eta/size strings + playlist counters).
// The size is the byte count as "<n>B": fragmented downloads only know an
// estimated total while they run, so the stream's exact size stands in.
export const PROGRESS_TEMPLATE =
  `download:${PROGRESS_PREFIX}` +
  '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|' +
  '%(progress.total_bytes,info.filesize&{}B|)s|%(info.playlist_index)s|%(info.n_entries)s'

// Snag reads file names from yt-dlp's console lines. The yt-dlp.exe build
// ignores PYTHONIOENCODING, prints in the Windows code page and drops what
// that cannot hold ("｜" vanishes, "–" turns into a stray byte), so the path
// Snag stored missed the real file. --encoding makes the output UTF-8.
export const OUTPUT_ENCODING_ARGS = ['--encoding', 'utf-8'] as const

// YouTube stopped serving dubbed audio tracks to yt-dlp's default player
// clients (2026.01, android_vr fallback). The embedded web client still
// returns every language track; "default" keeps the normal fallback chain
// for videos that disallow embedding. Ignored by non-YouTube extractors.
const YOUTUBE_CLIENTS = 'youtube:player_client=web_embedded,default'
export const YOUTUBE_CLIENT_ARGS = ['--extractor-args', YOUTUBE_CLIENTS] as const

// Analysis first tries the default clients alone: about a third faster than
// the set above and, with current yt-dlp, the same formats and dubbed tracks
// (measured 2026-09: the embedded client only added the legacy 360p stream
// and DRC audio variants). The wider set stays the fallback and is always
// used for the download itself, so every analyzed format ID exists there.
export const YOUTUBE_FAST_CLIENT_ARGS = ['--extractor-args', 'youtube:player_client=default'] as const

export function isYouTubeUrl(url: string): boolean {
  try {
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}

// A video pick without audio is a muxed (progressive) stream.
function isProgressivePick(req: DownloadRequest): boolean {
  return req.kind === 'video' && !!req.videoFormatId && !req.audioFormatId && !req.audioFormatIds?.length
}

export interface BuildContext {
  ffmpegLocation: string | null
  // aria2c executable; only used when the aria2 engine is selected.
  aria2cPath?: string | null
  nodeRuntimePath?: string | null
  // --cookies / --cookies-from-browser for signed-in downloads.
  cookieArgs?: string[]
}

// yt-dlp --download-sections wants "*START-END"; seconds with millisecond
// precision keep the trim editor's exact choice.
export function sectionArgument(start: number, end: number): string {
  const fmt = (v: number): string => Math.max(0, v).toFixed(3)
  return `*${fmt(start)}-${fmt(end)}`
}

// Pure: turns a request + settings into the full yt-dlp argument vector
// (everything after the executable name, URL included as the final arg).
export function buildDownloadArgs(
  req: DownloadRequest,
  settings: Settings,
  ctx: BuildContext
): string[] {
  const youtube = isYouTubeUrl(req.url)
  // YouTube hands out every stream as one file, which the built-in engine
  // fetches as consecutive 10 MiB requests over a single connection, so
  // Connection boost never applied there. formats=dashy turns those requests
  // into fragments fetched N at a time (measured 2026-09 on a gigabit line:
  // a 4K stream went from 51 to 104 MB/s). yt-dlp leaves formats without an
  // exact size out of dashy results, and YouTube's one progressive stream
  // (format 18) has none, so a progressive pick keeps the plain request.
  const chunkedYoutube = youtube && !isProgressivePick(req)
  const args: string[] = [
    '--newline',
    '--no-color',
    '--ignore-config',
    '--no-warnings',
    ...OUTPUT_ENCODING_ARGS,
    '--extractor-args',
    chunkedYoutube ? `${YOUTUBE_CLIENTS};formats=dashy` : YOUTUBE_CLIENTS,
    '--progress-template',
    PROGRESS_TEMPLATE
  ]
  // yt-dlp skips a fragment that keeps failing, which is harmless for a few
  // seconds of HLS but leaves a hole inside a YouTube file. Fail instead;
  // Retry starts over with fresh links.
  if (chunkedYoutube) args.push('--abort-on-unavailable-fragments')

  if (ctx.nodeRuntimePath) {
    args.push('--no-js-runtimes', '--js-runtimes', `node:${ctx.nodeRuntimePath}`)
  }
  if (ctx.cookieArgs && ctx.cookieArgs.length > 0) args.push(...ctx.cookieArgs)

  if (req.downloadWholePlaylist) args.push('--yes-playlist')
  else args.push('--no-playlist')

  if (ctx.ffmpegLocation) {
    args.push('--ffmpeg-location', ctx.ffmpegLocation)
  }

  const limited = settings.speedLimit.enabled && settings.speedLimit.value > 0
  if (limited) {
    args.push('--limit-rate', `${settings.speedLimit.value}${settings.speedLimit.unit}`)
  }

  // Parallel per-download connections; big speedup on fast lines since hosts
  // throttle per connection. yt-dlp applies --limit-rate to each fragment
  // request on its own (4 fragments under a 5M cap ran at 12 MB/s), so a
  // capped download fetches one fragment at a time.
  const frags = Math.max(1, Math.min(16, Math.round(settings.concurrentFragments || 1)))
  if (frags > 1 && !limited) {
    args.push('--concurrent-fragments', String(frags))
  }

  // aria2 engine: plain http(s) files go through aria2c with the same
  // connection count. DASH fragments stay with yt-dlp's own downloader (it
  // already runs them in parallel and reports progress), as do HLS streams.
  // YouTube never goes to aria2c: it throttles aria2c's long range requests
  // to under 1 MB/s per connection (3 MB/s with 4, 12 MB/s with 16).
  // yt-dlp forwards --limit-rate as aria2c's overall cap, plus headers and
  // cookies; the progress bar is fed from aria2c's console readout (see downloader.ts).
  if (settings.downloadEngine === 'aria2' && ctx.aria2cPath && !youtube) {
    args.push('--downloader', `http:${ctx.aria2cPath}`)
    args.push('--downloader-args', `aria2c:-x${frags} -s${frags} -k1M --enable-color=false`)
  }

  // Output template. Whole-playlist downloads go into a per-playlist subfolder.
  // A trimmed download carries its time range so two cuts of one video coexist.
  const section = req.section && req.section.end > req.section.start ? req.section : null
  const namePart = `${settings.filenameTemplate}${section ? ' [%(section_start)d-%(section_end)d]' : ''}.%(ext)s`
  const outTemplate = req.downloadWholePlaylist
    ? join(req.saveDir, '%(playlist_title)s', namePart)
    : join(req.saveDir, namePart)
  args.push('-o', outTemplate)

  if (settings.embedMetadata) args.push('--embed-metadata')

  if (section) {
    args.push('--download-sections', sectionArgument(section.start, section.end))
    if (section.precise) args.push('--force-keyframes-at-cuts')
  }

  // SponsorBlock: cut categories are removed from the file, marked ones become
  // chapters. Both need ffmpeg, which every download already has.
  const { remove, mark } = settings.sponsorBlock
  if (remove.length > 0) args.push('--sponsorblock-remove', remove.join(','))
  if (mark.length > 0) args.push('--sponsorblock-mark', mark.join(','), '--embed-chapters')

  if (req.kind === 'audio') {
    buildAudioArgs(req, settings, args)
  } else {
    buildVideoArgs(req, settings, args)
  }

  buildSubtitleArgs(req, args)

  args.push(req.url)
  return args
}

function buildVideoArgs(req: DownloadRequest, settings: Settings, args: string[]): void {
  const container = req.mergeContainer || settings.preferredVideoContainer
  const selector = buildVideoSelector(req, container)
  args.push('-f', selector)
  if (hasMultipleAudioTracks(req)) {
    args.push('--audio-multistreams')
    // The metadata post-processor writes per-stream language tags; without it
    // players label the dubbed track "und" (undefined) instead of its language.
    if (!settings.embedMetadata) args.push('--embed-metadata')
  }

  // merge-output-format applies only when separate video/audio streams are merged.
  // remux-video also applies to progressive (already muxed) downloads, so the
  // container shown in the UI is the extension the user actually receives.
  args.push('--merge-output-format', container)
  args.push('--remux-video', container)
}

function hasMultipleAudioTracks(
  req: Pick<DownloadRequest, 'audioFormatIds'>
): req is { audioFormatIds: string[] } {
  return !!req.audioFormatIds && req.audioFormatIds.length >= 2
}

// Exact format IDs can be incompatible with a container selected after analysis
// (for example H.264/AAC in WebM). Filter exact choices by compatible codecs and
// fall back to the best compatible streams rather than handing ffmpeg a mux that
// is guaranteed to fail. MKV accepts the codecs exposed by the supported sites.
export function buildVideoSelector(
  req: Pick<DownloadRequest, 'videoFormatId' | 'audioFormatId' | 'audioFormatIds'>,
  container: 'mp4' | 'mkv' | 'webm'
): string {
  const multiAudioIds = hasMultipleAudioTracks(req) ? req.audioFormatIds : null

  if (container === 'mkv') {
    if (!req.videoFormatId) return 'bv*+ba/b'
    if (multiAudioIds) return `${req.videoFormatId}+${multiAudioIds.join('+')}`
    return req.audioFormatId
      ? `${req.videoFormatId}+${req.audioFormatId}`
      : req.videoFormatId
  }

  const patterns = CONTAINER_CODEC_PATTERNS[container]
  const videoFilter = `[vcodec~='${patterns.video}']`
  const audioFilter = `[acodec~='${patterns.audio}']`
  const splitFallback = `bv*${videoFilter}+ba${audioFilter}`
  const progressiveFallback = `b${videoFilter}${audioFilter}`
  // Sites like X/Twitter report no codecs at all, so every guarded selection
  // would fail. End the chain with the best generic pick; --remux-video still
  // normalizes the container whenever the streams allow it.
  const lastResort = 'bv*+ba/b'

  if (!req.videoFormatId) return `${splitFallback}/${progressiveFallback}/${lastResort}`

  if (multiAudioIds) {
    // Guarded first (an ID that cannot be muxed into the container falls
    // through to the single-audio selection instead of MKV), then the plain
    // IDs for unknown-codec sources where the guards cannot match.
    const tracks = multiAudioIds.map((id) => `${id}${audioFilter}`).join('+')
    const exactMulti = `${req.videoFormatId}${videoFilter}+${tracks}`
    const plainMulti = `${req.videoFormatId}+${multiAudioIds.join('+')}`
    const primary = `${req.videoFormatId}${videoFilter}+${multiAudioIds[0]}${audioFilter}`
    return `${exactMulti}/${plainMulti}/${primary}/${splitFallback}/${progressiveFallback}/${lastResort}`
  }

  if (req.audioFormatId) {
    const exact = `${req.videoFormatId}${videoFilter}+${req.audioFormatId}${audioFilter}`
    const plain = `${req.videoFormatId}+${req.audioFormatId}`
    return `${exact}/${plain}/${splitFallback}/${progressiveFallback}/${lastResort}`
  }

  // The selected row may be progressive (needs a compatible audio codec) or
  // video-only (acodec=none). Express both without knowing which one yt-dlp ID is.
  const exactProgressive = `${req.videoFormatId}${videoFilter}${audioFilter}`
  const exactVideoOnly = `${req.videoFormatId}${videoFilter}[acodec=none]`
  return `${exactProgressive}/${exactVideoOnly}/${req.videoFormatId}/${splitFallback}/${progressiveFallback}/${lastResort}`
}

function buildAudioArgs(req: DownloadRequest, settings: Settings, args: string[]): void {
  const selector = req.audioFormatId || 'bestaudio/best'
  args.push('-f', selector)
  args.push('--extract-audio')
  const fmt = req.audioOutputFormat || settings.preferredAudioFormat
  args.push('--audio-format', fmt)
  args.push('--audio-quality', '0') // best VBR for lossy; ignored for lossless
  if (settings.embedThumbnail) args.push('--embed-thumbnail')
}

function buildSubtitleArgs(req: DownloadRequest, args: string[]): void {
  const subs = req.subtitles
  if (!subs || !subs.enabled || subs.languages.length === 0) return
  args.push('--write-subs')
  if (subs.autoGenerated) args.push('--write-auto-subs')
  args.push('--sub-langs', subs.languages.join(','))
  args.push('--convert-subs', 'srt')
  if (subs.embed && req.kind === 'video') args.push('--embed-subs')
}
