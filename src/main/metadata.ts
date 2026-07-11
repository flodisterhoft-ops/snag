import { execFile } from 'child_process'
import { promisify } from 'util'
import { languageLabel } from '@shared/languages'
import { locateYtdlp, runYtdlpJson, cleanYtdlpError } from './ytdlp'
import type {
  MediaInfo,
  VideoFormat,
  AudioFormat,
  AudioLanguageGroup,
  SubtitleLang,
  PlaylistInfo
} from '@shared/types'

const execFileP = promisify(execFile)

interface RawFormat {
  format_id: string
  ext?: string
  height?: number | null
  width?: number | null
  fps?: number | null
  vcodec?: string
  acodec?: string
  tbr?: number | null
  vbr?: number | null
  abr?: number | null
  asr?: number | null
  audio_channels?: number | null
  language?: string | null
  format_note?: string
  dynamic_range?: string | null
  filesize?: number | null
  filesize_approx?: number | null
  resolution?: string | null
}

interface RawInfo {
  id: string
  title?: string
  fulltitle?: string
  channel?: string | null
  uploader?: string | null
  duration?: number | null
  duration_string?: string | null
  thumbnail?: string | null
  extractor_key?: string
  extractor?: string
  is_live?: boolean
  language?: string | null
  webpage_url?: string
  original_url?: string
  formats?: RawFormat[]
  subtitles?: Record<string, unknown>
  automatic_captions?: Record<string, unknown>
}

function codecFamily(codec: string | undefined): string {
  if (!codec || codec === 'none') return ''
  return codec.split('.')[0].toLowerCase()
}

function friendlyVcodec(codec: string): string {
  const fam = codecFamily(codec)
  if (fam.startsWith('avc') || fam === 'h264') return 'H.264'
  if (fam.startsWith('hev') || fam === 'h265') return 'H.265'
  if (fam.startsWith('av01') || fam === 'av1') return 'AV1'
  if (fam.startsWith('vp9') || fam === 'vp09') return 'VP9'
  if (fam.startsWith('vp8')) return 'VP8'
  return codec === 'none' ? '' : codec
}

function friendlyAcodec(codec: string): string {
  const fam = codecFamily(codec)
  if (fam.startsWith('mp4a') || fam === 'aac') return 'AAC'
  if (fam === 'opus') return 'Opus'
  if (fam === 'vorbis') return 'Vorbis'
  if (fam.startsWith('mp3')) return 'MP3'
  if (fam.startsWith('ec-3') || fam.startsWith('ac-3')) return 'AC-3'
  return codec === 'none' ? '' : codec
}

function pickSize(f: RawFormat): { size: number | null; approx: boolean } {
  if (typeof f.filesize === 'number') return { size: f.filesize, approx: false }
  if (typeof f.filesize_approx === 'number') return { size: f.filesize_approx, approx: true }
  return { size: null, approx: false }
}

function qualityLabel(f: RawFormat): string {
  if (f.height) {
    const fps = f.fps && f.fps >= 50 ? Math.round(f.fps).toString() : ''
    return `${f.height}p${fps}`
  }
  if (f.format_note) return f.format_note
  if (f.resolution) return f.resolution
  return f.format_id
}

function parseVideoFormats(formats: RawFormat[]): VideoFormat[] {
  const videos = formats.filter((f) => f.vcodec && f.vcodec !== 'none')
  const mapped: VideoFormat[] = videos.map((f) => {
    const { size, approx } = pickSize(f)
    return {
      formatId: f.format_id,
      ext: f.ext || '',
      height: f.height ?? null,
      width: f.width ?? null,
      fps: f.fps ?? null,
      vcodec: friendlyVcodec(f.vcodec || ''),
      acodec: f.acodec && f.acodec !== 'none' ? friendlyAcodec(f.acodec) : 'none',
      tbr: f.tbr ?? null,
      vbr: f.vbr ?? null,
      filesize: size,
      filesizeIsApprox: approx,
      formatNote: f.format_note || '',
      dynamicRange: f.dynamic_range ?? null,
      isProgressive: !!(f.acodec && f.acodec !== 'none'),
      qualityLabel: qualityLabel(f)
    }
  })

  // Collapse near-duplicate rows: keep the best (highest bitrate / size) per
  // (height, fps, ext, codec-family) so the table stays readable.
  const best = new Map<string, VideoFormat>()
  for (const v of mapped) {
    // v.vcodec is already the friendly, distinct label (H.264/H.265/AV1/VP9); dynamic
    // range must stay in the key so HDR and SDR variants remain separate options.
    const key = `${v.height ?? 0}|${v.fps ?? 0}|${v.ext}|${v.vcodec}|${v.dynamicRange ?? ''}|${v.isProgressive}`
    const prev = best.get(key)
    if (!prev || (v.tbr ?? 0) > (prev.tbr ?? 0)) best.set(key, v)
  }

  return [...best.values()].sort((a, b) => {
    if ((b.height ?? 0) !== (a.height ?? 0)) return (b.height ?? 0) - (a.height ?? 0)
    if ((b.fps ?? 0) !== (a.fps ?? 0)) return (b.fps ?? 0) - (a.fps ?? 0)
    return (b.tbr ?? 0) - (a.tbr ?? 0)
  })
}

function parseAudioGroups(
  formats: RawFormat[],
  primaryLanguage: string | null
): { groups: AudioLanguageGroup[]; multiLanguage: boolean } {
  const audios = formats.filter(
    (f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')
  )

  const mapped: AudioFormat[] = audios.map((f) => {
    const { size, approx } = pickSize(f)
    const abr = f.abr ?? f.tbr ?? null
    const bitrate = abr ? `${Math.round(abr)} kbps` : f.format_note || ''
    const channels = f.audio_channels === 1 ? 'mono' : f.audio_channels ? 'stereo' : ''
    return {
      formatId: f.format_id,
      ext: f.ext || '',
      acodec: friendlyAcodec(f.acodec || ''),
      abr,
      asr: f.asr ?? null,
      audioChannels: f.audio_channels ?? null,
      language: f.language ?? null,
      languageLabel: languageLabel(f.language),
      formatNote: f.format_note || '',
      filesize: size,
      filesizeIsApprox: approx,
      qualityLabel: [bitrate, channels].filter(Boolean).join(' · ')
    }
  })

  const byLang = new Map<string, AudioFormat[]>()
  for (const a of mapped) {
    const key = a.language ?? '__default__'
    if (!byLang.has(key)) byLang.set(key, [])
    byLang.get(key)!.push(a)
  }

  const distinctLangs = [...byLang.keys()].filter((k) => k !== '__default__')
  const multiLanguage = distinctLangs.length > 1

  const groups: AudioLanguageGroup[] = [...byLang.entries()].map(([key, list]) => {
    const language = key === '__default__' ? null : key
    list.sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0))
    return {
      language,
      languageLabel: language ? languageLabel(language) : 'Original audio',
      isDefault: false,
      formats: list
    }
  })

  // Mark the default group (matches the video's primary language, else the first).
  let defaultIdx = groups.findIndex((g) => g.language && g.language === primaryLanguage)
  if (defaultIdx < 0) defaultIdx = 0
  if (groups[defaultIdx]) groups[defaultIdx].isDefault = true

  // Sort so the default language is first, then alphabetical.
  groups.sort((a, b) => {
    if (a.isDefault) return -1
    if (b.isDefault) return 1
    return a.languageLabel.localeCompare(b.languageLabel)
  })

  return { groups, multiLanguage }
}

function parseSubtitles(info: RawInfo): SubtitleLang[] {
  const manual = Object.keys(info.subtitles || {})
  const auto = Object.keys(info.automatic_captions || {})
  const result: SubtitleLang[] = []
  const seen = new Set<string>()

  for (const code of manual) {
    if (seen.has(code)) continue
    seen.add(code)
    result.push({ code, label: languageLabel(code), isAuto: false })
  }

  // Add auto captions only for the video's own language to avoid a giant list
  // of machine-translated variants.
  const primary = info.language
  if (primary && auto.includes(primary) && !seen.has(primary)) {
    seen.add(primary)
    result.push({ code: primary, label: `${languageLabel(primary)} (auto)`, isAuto: true })
  }

  result.sort((a, b) => a.label.localeCompare(b.label))
  return result
}

const PLAYLIST_RE = /[?&]list=([^&]+)/i

async function getPlaylistInfo(
  url: string,
  ytdlpOverride?: string | null
): Promise<PlaylistInfo | null> {
  const m = url.match(PLAYLIST_RE)
  if (!m) return null
  const listId = m[1]
  // Skip auto-generated mixes/radios and the personal "watch later"/"liked" lists.
  if (/^(RD|UL|LL|WL)/i.test(listId)) return null

  const bin = locateYtdlp(ytdlpOverride)
  if (!bin) return null
  try {
    const { stdout } = await execFileP(
      bin,
      ['--flat-playlist', '-J', '--no-warnings', '--ignore-config', url],
      { windowsHide: true, timeout: 25000, maxBuffer: 1024 * 1024 * 64 }
    )
    const data = JSON.parse(stdout) as {
      _type?: string
      title?: string
      playlist_count?: number
      entries?: unknown[]
    }
    if (data._type !== 'playlist') return null
    const count = data.playlist_count ?? (Array.isArray(data.entries) ? data.entries.length : 0)
    if (!count || count < 2) return null
    return { title: data.title ?? null, count }
  } catch {
    return null
  }
}

export async function analyze(
  url: string,
  ytdlpOverride?: string | null
): Promise<MediaInfo> {
  const trimmed = url.trim()
  if (!trimmed) throw new Error('Please paste a link first.')

  const raw = (await runYtdlpJson(
    ['-J', '--no-playlist', '--no-warnings', '--ignore-config', trimmed],
    ytdlpOverride
  )) as RawInfo

  const formats = raw.formats || []
  const videoFormats = parseVideoFormats(formats)
  const { groups, multiLanguage } = parseAudioGroups(formats, raw.language ?? null)
  const subtitleLanguages = parseSubtitles(raw)
  const playlist = await getPlaylistInfo(trimmed, ytdlpOverride)

  return {
    url: raw.webpage_url || raw.original_url || trimmed,
    id: raw.id,
    title: raw.title || raw.fulltitle || 'Untitled',
    channel: raw.channel ?? null,
    uploader: raw.uploader ?? null,
    durationSeconds: raw.duration ?? null,
    durationString: raw.duration_string ?? null,
    thumbnail: raw.thumbnail ?? null,
    extractor: raw.extractor_key || raw.extractor || 'unknown',
    isLive: !!raw.is_live,
    videoFormats,
    audioGroups: groups,
    hasMultipleAudioLanguages: multiLanguage,
    subtitleLanguages,
    playlist
  }
}

export { cleanYtdlpError }
