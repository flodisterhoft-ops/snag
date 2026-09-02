import { join } from 'path'
import type { DownloadRequest, Settings } from '@shared/types'
import { CONTAINER_CODEC_PATTERNS } from '@shared/container'

export const PROGRESS_PREFIX = 'SNAGPROG|'

// Emitted once per progress tick on stdout. Fields are pipe-separated and never
// contain a pipe themselves (percent/speed/eta/size strings + playlist counters).
export const PROGRESS_TEMPLATE =
  `download:${PROGRESS_PREFIX}` +
  '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|' +
  '%(progress._total_bytes_str)s|%(info.playlist_index)s|%(info.n_entries)s'

// YouTube stopped serving dubbed audio tracks to yt-dlp's default player
// clients (2026.01, android_vr fallback). The embedded web client still
// returns every language track; "default" keeps the normal fallback chain
// for videos that disallow embedding. Ignored by non-YouTube extractors.
export const YOUTUBE_CLIENT_ARGS = [
  '--extractor-args',
  'youtube:player_client=web_embedded,default'
] as const

// Analysis first tries the default clients alone: about a third faster than
// the set above and, with current yt-dlp, the same formats and dubbed tracks
// (measured 2026-09: the embedded client only added the legacy 360p stream
// and DRC audio variants). The wider set stays the fallback and is always
// used for the download itself, so every analyzed format ID exists there.
export const YOUTUBE_FAST_CLIENT_ARGS = ['--extractor-args', 'youtube:player_client=default'] as const

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
  const args: string[] = [
    '--newline',
    '--no-color',
    '--ignore-config',
    '--no-warnings',
    ...YOUTUBE_CLIENT_ARGS,
    '--progress-template',
    PROGRESS_TEMPLATE
  ]

  if (ctx.nodeRuntimePath) {
    args.push('--no-js-runtimes', '--js-runtimes', `node:${ctx.nodeRuntimePath}`)
  }
  if (ctx.cookieArgs && ctx.cookieArgs.length > 0) args.push(...ctx.cookieArgs)

  if (req.downloadWholePlaylist) args.push('--yes-playlist')
  else args.push('--no-playlist')

  if (ctx.ffmpegLocation) {
    args.push('--ffmpeg-location', ctx.ffmpegLocation)
  }

  if (settings.speedLimit.enabled && settings.speedLimit.value > 0) {
    args.push('--limit-rate', `${settings.speedLimit.value}${settings.speedLimit.unit}`)
  }

  // Parallel per-download connections; big speedup on fast lines since hosts
  // throttle per connection. --limit-rate still caps the combined total.
  const frags = Math.max(1, Math.min(16, Math.round(settings.concurrentFragments || 1)))
  if (frags > 1) {
    args.push('--concurrent-fragments', String(frags))
  }

  // aria2 engine: plain http(s) files go through aria2c with the same
  // connection count. DASH fragments stay with yt-dlp's own downloader (it
  // already runs them in parallel and reports progress), as do HLS streams.
  // yt-dlp forwards --limit-rate, headers, and cookies to aria2c itself; the
  // progress bar is fed from aria2c's console readout (see downloader.ts).
  if (settings.downloadEngine === 'aria2' && ctx.aria2cPath) {
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
