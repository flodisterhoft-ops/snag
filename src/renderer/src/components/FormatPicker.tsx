import { useEffect, useMemo, useState } from 'react'
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
import { Icon, Segmented, Toggle } from './ui'
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
  valid: boolean
}

const AUDIO_FORMATS: { value: AudioOutputFormat; label: string; hint: string }[] = [
  { value: 'mp3', label: 'MP3', hint: 'universal' },
  { value: 'm4a', label: 'M4A', hint: 'aac' },
  { value: 'opus', label: 'Opus', hint: 'efficient' },
  { value: 'wav', label: 'WAV', hint: 'lossless' },
  { value: 'flac', label: 'FLAC', hint: 'lossless' },
  { value: 'best', label: 'Original', hint: 'no re-encode' }
]

const CONTAINERS: VideoContainer[] = ['mp4', 'mkv', 'webm']

const EMPTY_AUDIO_FORMATS: AudioFormat[] = []

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

// Which language groups a fresh analysis should preselect: every configured
// language that the video actually carries, else just the default track.
export function initialLanguageKeys(info: MediaInfo, settings: Settings): string[] {
  const defaultGroup = info.audioGroups.find((g) => g.isDefault) ?? info.audioGroups[0]
  const defaultKeys = defaultGroup ? [groupKey(defaultGroup.language)] : []
  if (!settings.multiAudio.enabled || !info.hasMultipleAudioLanguages) return defaultKeys

  const wanted = settings.multiAudio.languages.map(baseLang).filter(Boolean)
  const matched: string[] = []
  for (const base of wanted) {
    const group = info.audioGroups.find((g) => g.language && baseLang(g.language) === base)
    if (group && !matched.includes(groupKey(group.language))) {
      matched.push(groupKey(group.language))
    }
  }
  return matched.length > 0 ? matched : defaultKeys
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
  selectedGroups: AudioLanguageGroup[]
): BestRow | null {
  const primaryFormats = selectedGroups[0]?.formats ?? EMPTY_AUDIO_FORMATS
  const candidates = filterVideoFormatsForContainer(container, info.videoFormats, primaryFormats)
  if (candidates.length === 0) return null

  const maxHeight = Math.max(...candidates.map((f) => f.height ?? 0))
  let pool = candidates.filter((f) => (f.height ?? 0) === maxHeight)
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

export function FormatPicker({
  info,
  settings,
  onChange
}: {
  info: MediaInfo
  settings: Settings
  onChange: (s: FormatSelection) => void
}): JSX.Element {
  const { updateSettings } = useStore()
  const hasVideo = info.videoFormats.length > 0
  const hasAudio = info.audioGroups.length > 0

  const [kind, setKind] = useState<DownloadKind>('video')
  const [bestMode, setBestMode] = useState<boolean>(settings.bestQualityMode)
  const [videoId, setVideoId] = useState<string>('')
  const [container, setContainer] = useState<VideoContainer>('mp4')
  // Video: multi-select track languages. Audio-only: single dropdown language.
  const [langKeys, setLangKeys] = useState<string[]>([])
  const [audioLangKey, setAudioLangKey] = useState<string>('__default__')
  const [audioFmt, setAudioFmt] = useState<AudioOutputFormat>('mp3')

  // Establish sensible defaults whenever a new media is analyzed.
  useEffect(() => {
    const restoreAudio = settings.rememberLastChoices && settings.lastKind === 'audio'
    const initialKind: DownloadKind = restoreAudio
      ? hasAudio
        ? 'audio'
        : 'video'
      : hasVideo
        ? 'video'
        : 'audio'
    setKind(initialKind)
    setVideoId(info.videoFormats[0]?.formatId ?? '')
    setContainer(settings.preferredVideoContainer)
    const initialKeys = initialLanguageKeys(info, settings)
    setLangKeys(initialKeys)
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

  // Groups selected for video downloads, in the video's own track order.
  const selectedGroups = useMemo(
    () => info.audioGroups.filter((g) => langKeys.includes(groupKey(g.language))),
    [info.audioGroups, langKeys]
  )

  const audioKindGroup =
    info.audioGroups.find((g) => groupKey(g.language) === audioLangKey) ??
    info.audioGroups[0] ??
    null

  // One best row per achievable container, cheapest first — this is the
  // "give me the top quality, let me pick the smallest file" view.
  const bestRows = useMemo(() => {
    const rows = CONTAINERS.map((c) => bestRowFor(c, info, selectedGroups)).filter(
      (r): r is BestRow => !!r
    )
    rows.sort(
      (a, b) =>
        (a.totalSize ?? Number.POSITIVE_INFINITY) - (b.totalSize ?? Number.POSITIVE_INFINITY)
    )
    return rows
  }, [info, selectedGroups])

  const smallestBestKey = bestRows[0]?.container

  // Entering best mode (or analyzing new media while it is on) preselects the
  // smallest file that still has the highest quality.
  useEffect(() => {
    if (kind !== 'video' || !bestMode) return
    const preferred = bestRows[0]
    if (preferred) {
      setContainer(preferred.container)
      setVideoId(preferred.video.formatId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.id, bestMode, kind])

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
      // Keep the video's own track order so the default language stays primary.
      const next = [...prev, key]
      return info.audioGroups
        .map((g) => groupKey(g.language))
        .filter((k) => next.includes(k))
    })
  }

  const selection = useMemo<FormatSelection>(() => {
    if (kind === 'audio') {
      const label =
        (audioFmt === 'best' ? 'Original' : audioFmt.toUpperCase()) +
        (info.hasMultipleAudioLanguages && audioKindGroup
          ? ` · ${audioKindGroup.languageLabel}`
          : '')
      return {
        kind: 'audio',
        audioFormatId: audioKindGroup?.formats[0]?.formatId,
        audioLanguage: audioKindGroup?.language ?? null,
        audioOutputFormat: audioFmt,
        selectionLabel: label,
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

    return {
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

  const kindOptions = [
    {
      value: 'video' as const,
      label: (
        <span className="kind-tab">
          <Icon name="video" size={16} /> Video
        </span>
      )
    },
    {
      value: 'audio' as const,
      label: (
        <span className="kind-tab">
          <Icon name="audio" size={16} /> Audio
        </span>
      )
    }
  ]

  return (
    <div className="picker fade-up">
      <div className="picker-head">
        <Segmented options={kindOptions} value={kind} onChange={setKind} />
        {kind === 'video' && hasVideo && (
          <label className="best-toggle" title="One row per format — highest quality only">
            <span>Best quality</span>
            <Toggle checked={bestMode} onChange={toggleBestMode} label="Best quality" />
          </label>
        )}
      </div>

      {kind === 'video' ? (
        <div className="video-panel">
          {info.hasMultipleAudioLanguages && (
            <div className="lang-chips-row">
              <div className="control-label">Audio tracks</div>
              <div className="sub-lang-chips">
                {info.audioGroups.map((g) => {
                  const key = groupKey(g.language)
                  const compatible = !!findCompatibleAudioFormat(container, g.formats)
                  return (
                    <button
                      key={key}
                      className={`chip chip-sm ${langKeys.includes(key) ? 'active' : ''}`}
                      disabled={!compatible}
                      title={
                        compatible
                          ? undefined
                          : `Not available for ${container.toUpperCase()}`
                      }
                      onClick={() => toggleLang(key)}
                    >
                      {g.languageLabel}
                      {g.isDefault ? ' ★' : ''}
                    </button>
                  )
                })}
              </div>
              {selectedGroups.length >= 2 && (
                <span className="lang-chips-note">
                  <Icon name="sparkle" size={13} /> All selected languages are embedded as
                  switchable audio tracks.
                </span>
              )}
            </div>
          )}

          {bestMode ? (
            bestRows.length > 0 ? (
              <div className="best-list" role="radiogroup" aria-label="Best quality per format">
                {bestRows.map((row) => {
                  const active = row.container === container
                  return (
                    <button
                      key={row.container}
                      role="radio"
                      aria-checked={active}
                      className={`best-row ${active ? 'selected' : ''}`}
                      title={exactResolution(row.video)}
                      onClick={() => selectBestRow(row)}
                    >
                      <span className="ft-radio" />
                      <span className="best-container">{row.container.toUpperCase()}</span>
                      <span className="best-detail">
                        <span className="best-quality">
                          {row.video.qualityLabel}
                          {resolutionTier(row.video) && (
                            <span className="tag tag-4k">{resolutionTier(row.video)}</span>
                          )}
                          {row.video.dynamicRange && row.video.dynamicRange !== 'SDR' && (
                            <span className="tag tag-hdr">{row.video.dynamicRange}</span>
                          )}
                        </span>
                        <span className="best-codec">
                          {row.video.vcodec || '—'}
                          {row.audioTracks.length >= 2 && ` · ${row.audioTracks.length} audio tracks`}
                        </span>
                      </span>
                      <span className="best-size">
                        <strong>{formatBytes(row.totalSize, row.sizeIsApprox)}</strong>
                        {row.container === smallestBestKey && bestRows.length > 1 && (
                          <span className="tag tag-smallest">smallest</span>
                        )}
                      </span>
                    </button>
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
          )}
        </div>
      ) : (
        <div className="audio-panel">
          {info.hasMultipleAudioLanguages && audioKindGroup && (
            <label className="lang-select">
              <span>Audio language</span>
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
          <div className="control-label">Output format</div>
          <div className="fmt-chips">
            {AUDIO_FORMATS.map((f) => (
              <button
                key={f.value}
                className={`chip ${audioFmt === f.value ? 'active' : ''}`}
                onClick={() => setAudioFmt(f.value)}
              >
                <span className="chip-label">{f.label}</span>
                <span className="chip-hint">{f.hint}</span>
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
  )
}
