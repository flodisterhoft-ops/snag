import { ReactNode, useEffect, useMemo, useState } from 'react'
import type {
  MediaInfo,
  Settings,
  DownloadKind,
  VideoContainer,
  AudioOutputFormat,
  AudioFormat,
  AudioLanguageGroup,
  VideoFormat
} from '@shared/types'
import { formatBytes } from '../lib/format'
import { Icon, Segmented } from './ui'
import { useStore } from '../store'
import {
  filterVideoFormatsForContainer,
  findCompatibleAudioFormat,
  formatContainerSource
} from '@shared/container'

export interface FormatSelection {
  kind: DownloadKind
  videoFormatId?: string
  audioFormatId?: string
  audioFormatIds?: string[]
  mergeContainer?: VideoContainer
  audioLanguage?: string | null
  audioOutputFormat?: AudioOutputFormat
  selectionLabel: string
  // Human-readable total size of what will be fetched, when known.
  sizeLabel?: string
  valid: boolean
}

const AUDIO_FORMATS: { value: AudioOutputFormat; label: string; hint: string }[] = [
  { value: 'mp3', label: 'MP3', hint: 'Plays everywhere' },
  { value: 'm4a', label: 'M4A', hint: 'AAC' },
  { value: 'opus', label: 'Opus', hint: 'Small files' },
  { value: 'wav', label: 'WAV', hint: 'Lossless' },
  { value: 'flac', label: 'FLAC', hint: 'Lossless' },
  { value: 'best', label: 'Original', hint: 'No re-encode' }
]

const CONTAINERS: VideoContainer[] = ['mp4', 'mkv', 'webm']

const EMPTY_AUDIO_FORMATS: AudioFormat[] = []
const EMPTY_ROWS: BestRow[] = []

const groupKey = (lang: string | null): string => lang ?? '__default__'

const baseLang = (code: string): string => code.trim().toLowerCase().split('-')[0]

// Short display code for a track language ("en-US" → "EN").
function shortLang(group: AudioLanguageGroup): string {
  return group.language ? baseLang(group.language).toUpperCase() : 'Original'
}

function resolutionTier(format: VideoFormat): string | null {
  const resolution =
    format.width && format.height
      ? Math.min(format.width, format.height)
      : format.height ?? format.width ?? 0
  if (resolution >= 4320) return '8K'
  if (resolution >= 2160) return '4K'
  return null
}

function exactResolution(format: VideoFormat): string | undefined {
  return format.width && format.height ? `${format.width}×${format.height}` : undefined
}

export function qualityTierLabel(height: number): string {
  if (height <= 0) return 'Best'
  if (height >= 4320) return '8K'
  if (height >= 2160) return '4K'
  return `${height}p`
}

export function meaningfullySmallestContainer(rows: BestRow[]): VideoContainer | null {
  const known = rows
    .filter((row) => row.totalSize != null)
    .sort((a, b) => (a.totalSize as number) - (b.totalSize as number))
  if (known.length < 2) return null
  const smallest = known[0].totalSize as number
  const next = known[1].totalSize as number
  const threshold = Math.max(10 * 1024 * 1024, next * 0.01)
  return next - smallest >= threshold ? known[0].container : null
}

export function recommendedContainer(
  rows: BestRow[],
  multipleAudio: boolean,
  preferred: VideoContainer
): VideoContainer | null {
  const has = (container: VideoContainer): boolean => rows.some((row) => row.container === container)
  if (multipleAudio && has('mkv')) return 'mkv'
  if (!multipleAudio && has('mp4')) return 'mp4'
  if (has(preferred)) return preferred
  return rows[0]?.container ?? null
}

// The user's favorite languages that this video actually carries, in the
// favorites' own ranking (e.g. English before German).
export function matchedFavoriteKeys(info: MediaInfo, settings: Settings): string[] {
  const wanted = settings.multiAudio.languages.map(baseLang).filter(Boolean)
  const matched: string[] = []
  for (const base of wanted) {
    const group = info.audioGroups.find((g) => g.language && baseLang(g.language) === base)
    if (group && !matched.includes(groupKey(group.language))) {
      matched.push(groupKey(group.language))
    }
  }
  return matched
}

// Which language groups a fresh analysis should preselect: all matched
// favorites when multi-audio is on, the top favorite otherwise, else the
// video's default track.
export function initialLanguageKeys(info: MediaInfo, settings: Settings): string[] {
  const defaultGroup =
    info.audioGroups.find((g) => g.language && baseLang(g.language) === 'en') ??
    info.audioGroups.find((g) => g.isDefault) ??
    info.audioGroups[0]
  const defaultKeys = defaultGroup ? [groupKey(defaultGroup.language)] : []
  if (!info.hasMultipleAudioLanguages) return defaultKeys

  const matched = matchedFavoriteKeys(info, settings)
  if (matched.length === 0) return defaultKeys
  return settings.multiAudio.enabled ? matched : [matched[0]]
}

interface BestRow {
  container: VideoContainer
  video: VideoFormat
  audioTracks: AudioFormat[]
  totalSize: number | null
  sizeIsApprox: boolean
}

// The single row shown per container in best mode: highest resolution, then
// highest fps, then the smallest file among those equals.
function bestRowFor(
  container: VideoContainer,
  info: MediaInfo,
  selectedGroups: AudioLanguageGroup[],
  targetHeight?: number
): BestRow | null {
  const primaryFormats = selectedGroups[0]?.formats ?? EMPTY_AUDIO_FORMATS
  const candidates = filterVideoFormatsForContainer(container, info.videoFormats, primaryFormats).filter(
    (format) => !info.hasMultipleAudioLanguages || !format.isProgressive
  )
  if (candidates.length === 0) return null

  const maxHeight = targetHeight ?? Math.max(...candidates.map((f) => f.height ?? 0))
  let pool = candidates.filter((f) => (f.height ?? 0) === maxHeight)
  if (pool.length === 0) return null
  const maxFps = Math.max(...pool.map((f) => f.fps ?? 0))
  pool = pool.filter((f) => (f.fps ?? 0) === maxFps)
  const video = [...pool].sort((a, b) => {
    const sizeA = a.filesize ?? Number.POSITIVE_INFINITY
    const sizeB = b.filesize ?? Number.POSITIVE_INFINITY
    if (sizeA !== sizeB) return sizeA - sizeB
    return (b.tbr ?? 0) - (a.tbr ?? 0)
  })[0]

  const audioTracks = video.isProgressive
    ? []
    : selectedGroups
        .map((g) => findCompatibleAudioFormat(container, g.formats))
        .filter((f): f is AudioFormat => !!f)
  if (!video.isProgressive && audioTracks.length === 0) return null

  let totalSize: number | null = video.filesize
  let sizeIsApprox = video.filesizeIsApprox
  for (const track of audioTracks) {
    if (totalSize != null && track.filesize != null) totalSize += track.filesize
    else sizeIsApprox = true
    if (track.filesizeIsApprox) sizeIsApprox = true
  }

  return { container, video, audioTracks, totalSize, sizeIsApprox }
}

// `children` render in the side column next to the quality table (options,
// folder, Download button), under the audio-track chips when a video has dubs.
export function FormatPicker({
  info,
  settings,
  onChange,
  children
}: {
  info: MediaInfo
  settings: Settings
  onChange: (s: FormatSelection) => void
  children?: ReactNode
}): JSX.Element {
  const { updateSettings } = useStore()
  const hasVideo = info.videoFormats.length > 0
  const hasAudio = info.audioGroups.length > 0

  const [kind, setKind] = useState<DownloadKind>('video')
  const [bestMode, setBestMode] = useState<boolean>(settings.bestQualityMode)
  const [selectedHeight, setSelectedHeight] = useState<number>(0)
  const [videoId, setVideoId] = useState<string>('')
  const [container, setContainer] = useState<VideoContainer>('mp4')
  // Video: multi-select track languages. Audio-only: single dropdown language.
  const [langKeys, setLangKeys] = useState<string[]>([])
  const [moreLangsOpen, setMoreLangsOpen] = useState(false)
  const [audioLangKey, setAudioLangKey] = useState<string>('__default__')
  const [audioFmt, setAudioFmt] = useState<AudioOutputFormat>('mp3')

  // Establish sensible defaults whenever a new media is analyzed. The picker
  // always opens on the Video tab — grabbing the video is the main flow.
  useEffect(() => {
    const initialKind: DownloadKind = hasVideo ? 'video' : 'audio'
    setKind(initialKind)
    setVideoId(info.videoFormats[0]?.formatId ?? '')
    setContainer(settings.preferredVideoContainer)
    setSelectedHeight(Math.max(...info.videoFormats.map((format) => format.height ?? 0), 0))
    const initialKeys = initialLanguageKeys(info, settings)
    setLangKeys(initialKeys)
    setMoreLangsOpen(false)
    setAudioLangKey(initialKeys[0] ?? '__default__')
    setAudioFmt(settings.preferredAudioFormat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.id])

  const toggleBestMode = (value: boolean): void => {
    setBestMode(value)
    void updateSettings({ bestQualityMode: value }).catch((err) => {
      console.error('Could not remember the best-quality switch:', err)
    })
  }

  // Groups selected for video downloads, in the user's chosen ranking.
  const selectedGroups = useMemo(
    () =>
      langKeys
        .map((key) => info.audioGroups.find((g) => groupKey(g.language) === key))
        .filter((g): g is AudioLanguageGroup => !!g),
    [info.audioGroups, langKeys]
  )

  const saveFavoriteLanguages = (): void => {
    const languages = selectedGroups
      .map((group) => (group.language ? baseLang(group.language) : ''))
      .filter(Boolean)
    if (languages.length === 0) return
    void updateSettings({
      multiAudio: { enabled: languages.length >= 2, languages }
    }).catch((err) => console.error('Could not remember favorite audio languages:', err))
  }

  // Favorite languages first (in the user's ranked order, e.g. English before
  // German); every other language collapses behind the "More" pill.
  const { rankedGroups, hiddenGroups } = useMemo(() => {
    const favoriteKeys = matchedFavoriteKeys(info, settings)
    const ranked = favoriteKeys
      .map((key) => info.audioGroups.find((g) => groupKey(g.language) === key))
      .filter((g): g is AudioLanguageGroup => !!g)
    if (ranked.length === 0) {
      const def =
        info.audioGroups.find((g) => g.language && baseLang(g.language) === 'en') ??
        info.audioGroups.find((g) => g.isDefault) ??
        info.audioGroups[0]
      if (def) ranked.push(def)
    }
    const hidden = info.audioGroups.filter((g) => !ranked.includes(g))
    return { rankedGroups: ranked, hiddenGroups: hidden }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.id, settings.multiAudio.languages])

  const audioKindGroup =
    info.audioGroups.find((g) => groupKey(g.language) === audioLangKey) ??
    info.audioGroups[0] ??
    null

  const qualityHeights = useMemo(
    () => {
      const measured = [...new Set(info.videoFormats.map((format) => format.height ?? 0).filter((height) => height > 0))]
      const available = measured.length > 0 ? measured : info.videoFormats.length > 0 ? [0] : []
      return available
        .sort((a, b) => b - a)
        .filter((height) =>
          CONTAINERS.some((candidate) => !!bestRowFor(candidate, info, selectedGroups, height))
        )
    },
    [info, selectedGroups]
  )
  const activeHeight = qualityHeights.includes(selectedHeight)
    ? selectedHeight
    : (qualityHeights[0] ?? 0)

  // One best row per achievable container, for every quality tier.
  const rowsByHeight = useMemo(() => {
    const map = new Map<number, BestRow[]>()
    for (const height of qualityHeights) {
      map.set(
        height,
        CONTAINERS.map((c) => bestRowFor(c, info, selectedGroups, height)).filter(
          (r): r is BestRow => !!r
        )
      )
    }
    return map
  }, [info, selectedGroups, qualityHeights])
  const bestRows = rowsByHeight.get(activeHeight) ?? EMPTY_ROWS

  const recommendedBestKey = recommendedContainer(
    bestRows,
    selectedGroups.length >= 2,
    settings.preferredVideoContainer
  )

  // Entering best mode (or analyzing new media while it is on) preselects the
  // smallest file that still has the highest quality.
  useEffect(() => {
    if (kind !== 'video' || !bestMode) return
    if (bestRows.some((row) => row.container === container && row.video.formatId === videoId)) return
    const preferred = bestRows.find((row) => row.container === recommendedBestKey) ?? bestRows[0]
    if (preferred) {
      setContainer(preferred.container)
      setVideoId(preferred.video.formatId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.id, bestMode, kind, activeHeight, recommendedBestKey, container, videoId, bestRows])

  const selectBestRow = (row: BestRow): void => {
    setContainer(row.container)
    setVideoId(row.video.formatId)
  }

  const selectedAudioFormats = selectedGroups[0]?.formats ?? EMPTY_AUDIO_FORMATS
  const selectableVideos = useMemo(
    () => filterVideoFormatsForContainer(container, info.videoFormats, selectedAudioFormats),
    [container, info.videoFormats, selectedAudioFormats]
  )
  const selectedVideo = selectableVideos.find((f) => f.formatId === videoId) ?? null
  const bestVideo = selectableVideos[0] ?? null

  // Container changes can make the current exact format impossible to remux.
  // Select the best compatible row instead of silently downloading another ID.
  useEffect(() => {
    if (!selectableVideos.some((f) => f.formatId === videoId)) {
      setVideoId(selectableVideos[0]?.formatId ?? '')
    }
  }, [selectableVideos, videoId])

  // Languages that cannot be muxed into the chosen container drop out of the
  // selection rather than silently changing the output container.
  useEffect(() => {
    if (kind !== 'video') return
    setLangKeys((prev) => {
      const stillValid = prev.filter((key) => {
        const group = info.audioGroups.find((g) => groupKey(g.language) === key)
        return !!group && !!findCompatibleAudioFormat(container, group.formats)
      })
      if (stillValid.length === prev.length) return prev
      if (stillValid.length > 0) return stillValid
      const fallback = info.audioGroups.find((g) =>
        findCompatibleAudioFormat(container, g.formats)
      )
      return fallback ? [groupKey(fallback.language)] : prev
    })
  }, [container, kind, info.audioGroups])

  const toggleLang = (key: string): void => {
    setLangKeys((prev) => {
      if (prev.includes(key)) {
        return prev.length > 1 ? prev.filter((k) => k !== key) : prev
      }
      // Preserve the user's click order; it becomes both the visible ranking
      // and the stream order embedded in the downloaded file.
      return [...prev, key]
    })
  }

  const selection = useMemo<FormatSelection>(() => {
    if (kind === 'audio') {
      const label =
        (audioFmt === 'best' ? 'Original' : audioFmt.toUpperCase()) +
        (info.hasMultipleAudioLanguages && audioKindGroup
          ? ` · ${audioKindGroup.languageLabel}`
          : '')
      const source = audioKindGroup?.formats[0]
      return {
        kind: 'audio',
        audioFormatId: source?.formatId,
        audioLanguage: audioKindGroup?.language ?? null,
        audioOutputFormat: audioFmt,
        selectionLabel: label,
        sizeLabel:
          audioFmt === 'best' && source?.filesize
            ? formatBytes(source.filesize, source.filesizeIsApprox)
            : undefined,
        valid: hasAudio
      }
    }

    const audioTracks = selectedVideo?.isProgressive
      ? []
      : selectedGroups
          .map((g) => findCompatibleAudioFormat(container, g.formats))
          .filter((f): f is AudioFormat => !!f)
    const multi = audioTracks.length >= 2

    const langSuffix = info.hasMultipleAudioLanguages
      ? multi
        ? ` · ${selectedGroups.map(shortLang).join('+')} audio`
        : selectedGroups[0]
          ? ` · ${selectedGroups[0].languageLabel}`
          : ''
      : ''
    const label = (selectedVideo?.qualityLabel ?? 'Best') + ` · ${container.toUpperCase()}` + langSuffix

    let totalSize: number | null = selectedVideo?.filesize ?? null
    let sizeIsApprox = selectedVideo?.filesizeIsApprox ?? false
    for (const track of audioTracks) {
      if (totalSize != null && track.filesize != null) totalSize += track.filesize
      else sizeIsApprox = true
      if (track.filesizeIsApprox) sizeIsApprox = true
    }

    return {
      sizeLabel: totalSize != null ? formatBytes(totalSize, sizeIsApprox) : undefined,
      kind: 'video',
      videoFormatId: selectedVideo?.formatId,
      audioFormatId: audioTracks[0]?.formatId,
      audioFormatIds: multi ? audioTracks.map((f) => f.formatId) : undefined,
      mergeContainer: container,
      audioLanguage: selectedGroups[0]?.language ?? null,
      selectionLabel: label,
      valid: !!selectedVideo && (selectedVideo.isProgressive || audioTracks.length > 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, videoId, container, langKeys, audioLangKey, audioFmt, info.id, selectedVideo])

  useEffect(() => {
    onChange(selection)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])

  const renderLangPill = (g: AudioLanguageGroup): JSX.Element => {
    const key = groupKey(g.language)
    const compatible = !!findCompatibleAudioFormat(container, g.formats)
    return (
      <button
        key={key}
        className={`chip chip-sm ${langKeys.includes(key) ? 'active' : ''}`}
        disabled={!compatible}
        title={compatible ? undefined : `Not available for ${container.toUpperCase()}`}
        onClick={() => toggleLang(key)}
      >
        {g.languageLabel}
        {g.isDefault ? ' ★' : ''}
      </button>
    )
  }

  const kindOptions = [
    {
      value: 'video' as const,
      label: (
        <span className="kind-tab">
          <Icon name="video" size={15} /> Video
        </span>
      )
    },
    {
      value: 'audio' as const,
      label: (
        <span className="kind-tab">
          <Icon name="audio" size={15} /> Audio
        </span>
      )
    }
  ]

  // Small print next to a tier name: the exact rendition when the tier hides
  // it (4K → 2160p60), otherwise just a high frame rate.
  const tierDetail = (height: number, video: VideoFormat): string => {
    const fps = video.fps && video.fps >= 50 ? Math.round(video.fps) : null
    if (height >= 2160) return `${height}p${fps ?? ''}`
    return fps ? `${fps} fps` : ''
  }

  return (
    <div className="picker">
      <div className="picker-main">
        <div className="picker-head">
          <Segmented size="sm" options={kindOptions} value={kind} onChange={setKind} />
          {kind === 'video' && hasVideo && (
            <button
              className="btn-mini ghost picker-mode"
              title={
                bestMode
                  ? 'Show every stream with codec and source details'
                  : 'Back to the simple quality table'
              }
              onClick={() => toggleBestMode(!bestMode)}
            >
              {bestMode ? 'All formats' : 'Simple table'}
            </button>
          )}
        </div>

        {kind === 'video' ? (
          bestMode ? (
            bestRows.length > 0 ? (
              <div className="qtable" role="grid" aria-label="Quality and file type">
                <div className="qt-head" role="row">
                  <span>Quality</span>
                  {CONTAINERS.map((c) => (
                    <span key={c}>{c.toUpperCase()}</span>
                  ))}
                </div>
                {qualityHeights.map((height) => {
                  const rows = rowsByHeight.get(height) ?? EMPTY_ROWS
                  if (rows.length === 0) return null
                  const active = height === activeHeight
                  const shown = rows.find((row) => row.container === container) ?? rows[0]
                  const recommended = recommendedContainer(
                    rows,
                    selectedGroups.length >= 2,
                    settings.preferredVideoContainer
                  )
                  const smallest = meaningfullySmallestContainer(rows)
                  const detail = tierDetail(height, shown.video)
                  const hdr = shown.video.dynamicRange && shown.video.dynamicRange !== 'SDR'
                  return (
                    <div key={height} className={`qt-row ${active ? 'on' : ''}`} role="row">
                      <span className="qt-name" title={exactResolution(shown.video)}>
                        <strong>{qualityTierLabel(height)}</strong>
                        {detail && <em>{detail}</em>}
                        {hdr && <span className="tag tag-hdr">{shown.video.dynamicRange}</span>}
                      </span>
                      {CONTAINERS.map((c) => {
                        const row = rows.find((r) => r.container === c)
                        if (!row) {
                          return (
                            <span key={c} className="qt-cell empty" aria-hidden="true">
                              —
                            </span>
                          )
                        }
                        const selected = active && c === container
                        return (
                          <button
                            key={c}
                            role="gridcell"
                            aria-selected={selected}
                            className={`qt-cell ${selected ? 'on' : ''}`}
                            title={
                              c === recommended
                                ? selectedGroups.length >= 2
                                  ? 'Recommended for several audio tracks'
                                  : 'Plays everywhere'
                                : c === smallest
                                  ? 'Smallest file'
                                  : `${qualityTierLabel(height)} as ${c.toUpperCase()}`
                            }
                            onClick={() => {
                              setSelectedHeight(height)
                              selectBestRow(row)
                            }}
                          >
                            <span className="qt-radio" />
                            {formatBytes(row.totalSize, row.sizeIsApprox)}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="empty-note">No downloadable video streams found for this link.</div>
            )
          ) : (
            <>
              <div className="panel-controls">
                <div className="control-label">Output container</div>
                <Segmented
                  size="sm"
                  options={[
                    { value: 'mp4' as const, label: 'MP4' },
                    { value: 'mkv' as const, label: 'MKV' },
                    { value: 'webm' as const, label: 'WebM' }
                  ]}
                  value={container}
                  onChange={setContainer}
                />
                {bestVideo && (
                  <span className="format-best" title={exactResolution(bestVideo)}>
                    Best detected:{' '}
                    <strong>{resolutionTier(bestVideo) ?? bestVideo.qualityLabel}</strong>
                    {resolutionTier(bestVideo) && ` · ${bestVideo.qualityLabel}`}
                  </span>
                )}
              </div>

              {selectableVideos.length > 0 ? (
                <div className="format-table" role="radiogroup" aria-label="Video quality">
                  <div className="ft-head">
                    <span>Quality</span>
                    <span>Codec</span>
                    <span>Source</span>
                    <span className="ft-right">Size</span>
                  </div>
                  <div className="ft-body">
                    {selectableVideos.map((f) => (
                      <button
                        key={f.formatId}
                        role="radio"
                        aria-checked={f.formatId === videoId}
                        className={`ft-row ${f.formatId === videoId ? 'selected' : ''}`}
                        title={exactResolution(f)}
                        onClick={() => setVideoId(f.formatId)}
                      >
                        <span className="ft-quality">
                          <span className="ft-radio" />
                          {f.qualityLabel}
                          {resolutionTier(f) && <span className="tag tag-4k">{resolutionTier(f)}</span>}
                          {f.dynamicRange && f.dynamicRange !== 'SDR' && (
                            <span className="tag tag-hdr">{f.dynamicRange}</span>
                          )}
                          {f.isProgressive && <span className="tag">with audio</span>}
                        </span>
                        <span className="ft-codec">{f.vcodec || '—'}</span>
                        <span className="ft-ext">{formatContainerSource(container, f.ext)}</span>
                        <span className="ft-right ft-size">
                          {formatBytes(f.filesize, f.filesizeIsApprox)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="empty-note">
                  {hasVideo
                    ? `No complete streams can be remuxed to ${container.toUpperCase()} without re-encoding. Try MKV.`
                    : 'No video streams found for this link.'}
                </div>
              )}
            </>
            )
        ) : (
          <div className="audio-panel">
            {info.hasMultipleAudioLanguages && audioKindGroup && (
              <label className="lang-select">
                <span>Language</span>
                <div className="select-wrap">
                  <select value={audioLangKey} onChange={(e) => setAudioLangKey(e.target.value)}>
                    {info.audioGroups.map((g) => (
                      <option key={groupKey(g.language)} value={groupKey(g.language)}>
                        {g.languageLabel}
                        {g.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                  <Icon name="chevron" size={16} />
                </div>
              </label>
            )}
            <div className="fmt-chips">
              {AUDIO_FORMATS.map((f) => (
                <button
                  key={f.value}
                  className={`chip chip-sm ${audioFmt === f.value ? 'active' : ''}`}
                  title={f.hint}
                  onClick={() => setAudioFmt(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="audio-quality-note">
              <Icon name="sparkle" size={14} />
              {audioKindGroup?.formats[0]?.qualityLabel
                ? `Best available source: ${audioKindGroup.formats[0].qualityLabel}`
                : 'Best available quality will be used.'}
            </div>
          </div>
        )}
      </div>

      <aside className="picker-side">
        {kind === 'video' && info.hasMultipleAudioLanguages && (
          <div className="lang-chips-row">
            <div className="control-label">Audio tracks</div>
            <div className="sub-lang-chips">
              {rankedGroups.map((g) => renderLangPill(g))}
              {hiddenGroups.length > 0 && (
                <button
                  className="chip chip-sm chip-more"
                  aria-expanded={moreLangsOpen}
                  onClick={() => {
                    if (moreLangsOpen) saveFavoriteLanguages()
                    setMoreLangsOpen((v) => !v)
                  }}
                >
                  {moreLangsOpen ? 'Hide ▴' : `More (${hiddenGroups.length}) ▾`}
                </button>
              )}
            </div>
            {hiddenGroups.length > 0 && (
              <div className={`lang-more ${moreLangsOpen ? 'open' : ''}`}>
                <div className="sub-lang-chips">
                  {hiddenGroups.map((g) => renderLangPill(g))}
                </div>
              </div>
            )}
            {selectedGroups.length >= 2 && (
              <span className="lang-chips-note">
                <Icon name="sparkle" size={13} /> All selected languages are embedded as
                switchable audio tracks.
              </span>
            )}
          </div>
        )}
        {children}
      </aside>
    </div>
  )
}
