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

export interface BuildContext {
  ffmpegLocation: string | null
  nodeRuntimePath?: string | null
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
    '--progress-template',
    PROGRESS_TEMPLATE
  ]

  if (ctx.nodeRuntimePath) {
    args.push('--no-js-runtimes', '--js-runtimes', `node:${ctx.nodeRuntimePath}`)
  }

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

  // Output template. Whole-playlist downloads go into a per-playlist subfolder.
  const namePart = `${settings.filenameTemplate}.%(ext)s`
  const outTemplate = req.downloadWholePlaylist
    ? join(req.saveDir, '%(playlist_title)s', namePart)
    : join(req.saveDir, namePart)
  args.push('-o', outTemplate)

  if (settings.embedMetadata) args.push('--embed-metadata')

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

  // merge-output-format applies only when separate video/audio streams are merged.
  // remux-video also applies to progressive (already muxed) downloads, so the
  // container shown in the UI is the extension the user actually receives.
  args.push('--merge-output-format', container)
  args.push('--remux-video', container)
}

// Exact format IDs can be incompatible with a container selected after analysis
// (for example H.264/AAC in WebM). Filter exact choices by compatible codecs and
// fall back to the best compatible streams rather than handing ffmpeg a mux that
// is guaranteed to fail. MKV accepts the codecs exposed by the supported sites.
export function buildVideoSelector(
  req: Pick<DownloadRequest, 'videoFormatId' | 'audioFormatId'>,
  container: 'mp4' | 'mkv' | 'webm'
): string {
  if (container === 'mkv') {
    if (!req.videoFormatId) return 'bv*+ba/b'
    return req.audioFormatId
      ? `${req.videoFormatId}+${req.audioFormatId}`
      : req.videoFormatId
  }

  const patterns = CONTAINER_CODEC_PATTERNS[container]
  const videoFilter = `[vcodec~='${patterns.video}']`
  const audioFilter = `[acodec~='${patterns.audio}']`
  const splitFallback = `bv*${videoFilter}+ba${audioFilter}`
  const progressiveFallback = `b${videoFilter}${audioFilter}`

  if (!req.videoFormatId) return `${splitFallback}/${progressiveFallback}`

  if (req.audioFormatId) {
    const exact = `${req.videoFormatId}${videoFilter}+${req.audioFormatId}${audioFilter}`
    return `${exact}/${splitFallback}/${progressiveFallback}`
  }

  // The selected row may be progressive (needs a compatible audio codec) or
  // video-only (acodec=none). Express both without knowing which one yt-dlp ID is.
  const exactProgressive = `${req.videoFormatId}${videoFilter}${audioFilter}`
  const exactVideoOnly = `${req.videoFormatId}${videoFilter}[acodec=none]`
  return `${exactProgressive}/${exactVideoOnly}/${splitFallback}/${progressiveFallback}`
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
