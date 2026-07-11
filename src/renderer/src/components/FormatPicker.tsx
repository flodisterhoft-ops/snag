import { useEffect, useMemo, useState } from 'react'
import type {
  MediaInfo,
  Settings,
  DownloadKind,
  VideoContainer,
  AudioOutputFormat
} from '@shared/types'
import { formatBytes } from '../lib/format'
import { Icon, Segmented } from './ui'

export interface FormatSelection {
  kind: DownloadKind
  videoFormatId?: string
  audioFormatId?: string
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

const groupKey = (lang: string | null): string => lang ?? '__default__'

export function FormatPicker({
  info,
  settings,
  onChange
}: {
  info: MediaInfo
  settings: Settings
  onChange: (s: FormatSelection) => void
}): JSX.Element {
  const hasVideo = info.videoFormats.length > 0
  const hasAudio = info.audioGroups.length > 0

  const [kind, setKind] = useState<DownloadKind>('video')
  const [videoId, setVideoId] = useState<string>('')
  const [container, setContainer] = useState<VideoContainer>('mp4')
  const [langKey, setLangKey] = useState<string>('__default__')
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
    const def = info.audioGroups.find((g) => g.isDefault) ?? info.audioGroups[0]
    setLangKey(def ? groupKey(def.language) : '__default__')
    setAudioFmt(settings.preferredAudioFormat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.id])

  const selectedGroup =
    info.audioGroups.find((g) => groupKey(g.language) === langKey) ?? info.audioGroups[0] ?? null
  const selectedVideo = info.videoFormats.find((f) => f.formatId === videoId) ?? null

  const selection = useMemo<FormatSelection>(() => {
    if (kind === 'audio') {
      const label =
        (audioFmt === 'best' ? 'Original' : audioFmt.toUpperCase()) +
        (info.hasMultipleAudioLanguages && selectedGroup ? ` · ${selectedGroup.languageLabel}` : '')
      return {
        kind: 'audio',
        audioFormatId: selectedGroup?.formats[0]?.formatId,
        audioLanguage: selectedGroup?.language ?? null,
        audioOutputFormat: audioFmt,
        selectionLabel: label,
        valid: hasAudio
      }
    }
    let mergeAudioId: string | undefined
    if (!selectedVideo?.isProgressive && selectedGroup) {
      // For an mp4 container, prefer AAC/M4A audio so the merge stays mp4-compatible
      // (Opus/WebM audio would force yt-dlp to fall back to .mkv).
      const compatible =
        container === 'mp4'
          ? selectedGroup.formats.find((f) => f.ext === 'm4a' || f.acodec === 'AAC')
          : undefined
      mergeAudioId = (compatible ?? selectedGroup.formats[0])?.formatId
    }
    const label =
      (selectedVideo?.qualityLabel ?? 'Best') +
      ` · ${container.toUpperCase()}` +
      (info.hasMultipleAudioLanguages && selectedGroup ? ` · ${selectedGroup.languageLabel}` : '')
    return {
      kind: 'video',
      videoFormatId: selectedVideo?.formatId,
      audioFormatId: mergeAudioId,
      mergeContainer: container,
      audioLanguage: selectedGroup?.language ?? null,
      selectionLabel: label,
      valid: !!selectedVideo
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, videoId, container, langKey, audioFmt, info.id])

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
        {info.hasMultipleAudioLanguages && selectedGroup && (
          <label className="lang-select">
            <span>Audio language</span>
            <div className="select-wrap">
              <select value={langKey} onChange={(e) => setLangKey(e.target.value)}>
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
      </div>

      {kind === 'video' ? (
        <div className="video-panel">
          <div className="panel-controls">
            <div className="control-label">Container</div>
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
          </div>

          {hasVideo ? (
            <div className="format-table" role="radiogroup" aria-label="Video quality">
              <div className="ft-head">
                <span>Quality</span>
                <span>Codec</span>
                <span>Source</span>
                <span className="ft-right">Size</span>
              </div>
              <div className="ft-body">
                {info.videoFormats.map((f) => (
                  <button
                    key={f.formatId}
                    role="radio"
                    aria-checked={f.formatId === videoId}
                    className={`ft-row ${f.formatId === videoId ? 'selected' : ''}`}
                    onClick={() => setVideoId(f.formatId)}
                  >
                    <span className="ft-quality">
                      <span className="ft-radio" />
                      {f.qualityLabel}
                      {f.dynamicRange && f.dynamicRange !== 'SDR' && (
                        <span className="tag tag-hdr">{f.dynamicRange}</span>
                      )}
                      {f.isProgressive && <span className="tag">with audio</span>}
                    </span>
                    <span className="ft-codec">{f.vcodec || '—'}</span>
                    <span className="ft-ext">{f.ext.toUpperCase()}</span>
                    <span className="ft-right ft-size">
                      {formatBytes(f.filesize, f.filesizeIsApprox)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-note">No video streams found for this link.</div>
          )}
        </div>
      ) : (
        <div className="audio-panel">
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
            {selectedGroup?.formats[0]?.qualityLabel
              ? `Best available source: ${selectedGroup.formats[0].qualityLabel}`
              : 'Best available quality will be used.'}
          </div>
        </div>
      )}
    </div>
  )
}
