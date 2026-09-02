import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DownloadSection, MediaInfo } from '@shared/types'
import { Icon, Toggle } from './ui'

// In-app trimming: play a small preview of the video, drag the in and out
// handles (or type exact times), and download only that section.

export function formatTimecode(seconds: number, withMillis = true): string {
  const total = Math.max(0, seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total - Math.floor(total)) * 1000)
  const pad = (v: number, n = 2): string => v.toString().padStart(n, '0')
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
  return withMillis ? `${base}.${pad(ms, 3)}` : base
}

// Accepts "90", "1:30", "1:30.25", "0:01:30.250".
export function parseTimecode(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const parts = trimmed.split(':')
  if (parts.length > 3 || parts.some((p) => p === '' || !/^\d+(\.\d+)?$/.test(p))) return null
  let seconds = 0
  for (const part of parts) seconds = seconds * 60 + Number(part)
  return Number.isFinite(seconds) ? seconds : null
}

const MIN_SECTION = 0.1

export function TrimEditor({
  info,
  section,
  onChange
}: {
  info: MediaInfo
  section: DownloadSection | null
  onChange: (section: DownloadSection | null) => void
}): JSX.Element {
  const duration = info.durationSeconds ?? 0
  const enabled = section !== null
  const start = section?.start ?? 0
  const end = section?.end ?? duration
  const precise = section?.precise ?? true

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [mediaDuration, setMediaDuration] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [startText, setStartText] = useState(formatTimecode(start))
  const [endText, setEndText] = useState(formatTimecode(end))
  const [muted, setMuted] = useState(!info.previewHasAudio)
  const stopAtEnd = useRef<number | null>(null)

  const total = duration || mediaDuration
  const canPreview = !!info.previewUrl && !previewFailed

  const commit = useCallback(
    (next: Partial<DownloadSection>): void => {
      if (!enabled) return
      const merged = { start, end, precise, ...next }
      const clampedStart = Math.max(0, Math.min(merged.start, total > 0 ? total - MIN_SECTION : merged.start))
      const clampedEnd = Math.max(clampedStart + MIN_SECTION, total > 0 ? Math.min(merged.end, total) : merged.end)
      onChange({ start: clampedStart, end: clampedEnd, precise: merged.precise })
    },
    [enabled, start, end, precise, total, onChange]
  )

  useEffect(() => {
    setStartText(formatTimecode(start))
  }, [start])
  useEffect(() => {
    setEndText(formatTimecode(end))
  }, [end])

  // Stop playback at the out point when playing the selection.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTime = (): void => {
      setPlayhead(video.currentTime)
      if (stopAtEnd.current != null && video.currentTime >= stopAtEnd.current) {
        video.pause()
        stopAtEnd.current = null
      }
    }
    const onMeta = (): void => setMediaDuration(Number.isFinite(video.duration) ? video.duration : 0)
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    const onError = (): void => setPreviewFailed(true)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('error', onError)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('error', onError)
    }
  }, [enabled, canPreview])

  const seek = (time: number): void => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(time, total || time))
    setPlayhead(video.currentTime)
  }

  const togglePlay = (): void => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      stopAtEnd.current = null
      void video.play().catch(() => setPreviewFailed(true))
    } else video.pause()
  }

  const playSelection = (): void => {
    const video = videoRef.current
    if (!video) return
    stopAtEnd.current = end
    video.currentTime = start
    void video.play().catch(() => setPreviewFailed(true))
  }

  // Dragging a handle: convert pointer x to a time on the track.
  const dragging = useRef<'start' | 'end' | 'seek' | null>(null)
  const timeFromPointer = (clientX: number): number => {
    const track = trackRef.current
    if (!track || total <= 0) return 0
    const rect = track.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return fraction * total
  }
  const onPointerDown = (which: 'start' | 'end' | 'seek') => (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = which
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    applyPointer(e.clientX)
  }
  const applyPointer = (clientX: number): void => {
    const time = timeFromPointer(clientX)
    if (dragging.current === 'start') {
      commit({ start: Math.min(time, end - MIN_SECTION) })
      seek(Math.min(time, end - MIN_SECTION))
    } else if (dragging.current === 'end') {
      commit({ end: Math.max(time, start + MIN_SECTION) })
      seek(Math.max(time, start + MIN_SECTION))
    } else if (dragging.current === 'seek') {
      seek(time)
    }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (dragging.current) applyPointer(e.clientX)
  }
  const onPointerUp = (): void => {
    dragging.current = null
  }

  const nudge = (which: 'start' | 'end', delta: number): void => {
    if (which === 'start') commit({ start: start + delta })
    else commit({ end: end + delta })
    seek(which === 'start' ? start + delta : end + delta)
  }

  const onHandleKey = (which: 'start' | 'end') => (e: React.KeyboardEvent): void => {
    const step = e.shiftKey ? 0.04 : e.altKey ? 10 : 1
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      nudge(which, -step)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      nudge(which, step)
    }
  }

  const commitText = (which: 'start' | 'end'): void => {
    const parsed = parseTimecode(which === 'start' ? startText : endText)
    if (parsed == null) {
      if (which === 'start') setStartText(formatTimecode(start))
      else setEndText(formatTimecode(end))
      return
    }
    commit(which === 'start' ? { start: parsed } : { end: parsed })
  }

  const pct = (time: number): string => (total > 0 ? `${(Math.max(0, Math.min(time, total)) / total) * 100}%` : '0%')
  const length = useMemo(() => Math.max(0, end - start), [start, end])

  return (
    <div className="trim fade-up">
      <label className="option-row bare trim-head">
        <div className="option-main">
          <span className="option-title">
            <Icon name="scissors" size={15} /> Download only a section
          </span>
          <span className="option-sub">
            {enabled
              ? `${formatTimecode(start)} → ${formatTimecode(end)} · ${formatTimecode(length, false)} long`
              : 'Pick in and out points in a preview player, then download just that part'}
          </span>
        </div>
        <Toggle
          checked={enabled}
          onChange={(v) => onChange(v ? { start: 0, end: total > 0 ? total : 60, precise: true } : null)}
          label="Download only a section"
        />
      </label>

      {enabled && (
        <div className="trim-body">
          {canPreview ? (
            <div className="trim-player">
              <video
                ref={videoRef}
                src={info.previewUrl ?? undefined}
                poster={info.thumbnail ?? undefined}
                preload="metadata"
                playsInline
                muted={muted}
                onClick={togglePlay}
              />
              <div className="trim-player-bar">
                <button className="icon-btn" title={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
                  <Icon name={playing ? 'pause' : 'play'} size={16} />
                </button>
                <button className="btn-mini ghost" onClick={playSelection}>
                  Play selection
                </button>
                <span className="trim-time num">{formatTimecode(playhead)}</span>
                <span className="trim-time dim">/ {formatTimecode(total, false)}</span>
                {info.previewHasAudio && (
                  <button className="btn-mini ghost" onClick={() => setMuted((m) => !m)}>
                    {muted ? 'Unmute' : 'Mute'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="trim-noplayer">
              <Icon name="video" size={16} />
              <span>
                {info.previewUrl
                  ? 'The preview stream could not be played. Set the times below; the download still works.'
                  : 'No in-app preview for this site. Set the times below; the download still works.'}
              </span>
            </div>
          )}

          <div
            className="trim-track"
            ref={trackRef}
            onPointerDown={onPointerDown('seek')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div className="trim-range" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
            {canPreview && <div className="trim-playhead" style={{ left: pct(playhead) }} />}
            <button
              className="trim-handle start"
              style={{ left: pct(start) }}
              title="In point (arrow keys: 1 s, Shift: one frame, Alt: 10 s)"
              aria-label="Start of section"
              onPointerDown={onPointerDown('start')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onKeyDown={onHandleKey('start')}
            />
            <button
              className="trim-handle end"
              style={{ left: pct(end) }}
              title="Out point (arrow keys: 1 s, Shift: one frame, Alt: 10 s)"
              aria-label="End of section"
              onPointerDown={onPointerDown('end')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onKeyDown={onHandleKey('end')}
            />
          </div>

          <div className="trim-points">
            <div className="trim-point">
              <span className="control-label">Start</span>
              <input
                className="text-input mono"
                value={startText}
                spellCheck={false}
                onChange={(e) => setStartText(e.target.value)}
                onBlur={() => commitText('start')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                aria-label="Section start"
              />
              <div className="trim-nudge">
                <button className="btn-mini ghost" onClick={() => nudge('start', -1)} title="1 second earlier">−1s</button>
                <button className="btn-mini ghost" onClick={() => nudge('start', -0.04)} title="One frame earlier">−f</button>
                <button className="btn-mini ghost" onClick={() => nudge('start', 0.04)} title="One frame later">+f</button>
                <button className="btn-mini ghost" onClick={() => nudge('start', 1)} title="1 second later">+1s</button>
                {canPreview && (
                  <button className="btn-mini" onClick={() => commit({ start: Math.min(playhead, end - MIN_SECTION) })}>
                    Set to playhead
                  </button>
                )}
              </div>
            </div>
            <div className="trim-point">
              <span className="control-label">End</span>
              <input
                className="text-input mono"
                value={endText}
                spellCheck={false}
                onChange={(e) => setEndText(e.target.value)}
                onBlur={() => commitText('end')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                aria-label="Section end"
              />
              <div className="trim-nudge">
                <button className="btn-mini ghost" onClick={() => nudge('end', -1)} title="1 second earlier">−1s</button>
                <button className="btn-mini ghost" onClick={() => nudge('end', -0.04)} title="One frame earlier">−f</button>
                <button className="btn-mini ghost" onClick={() => nudge('end', 0.04)} title="One frame later">+f</button>
                <button className="btn-mini ghost" onClick={() => nudge('end', 1)} title="1 second later">+1s</button>
                {canPreview && (
                  <button className="btn-mini" onClick={() => commit({ end: Math.max(playhead, start + MIN_SECTION) })}>
                    Set to playhead
                  </button>
                )}
              </div>
            </div>
          </div>

          <label className="inline-toggle trim-precise">
            <Toggle checked={precise} onChange={(v) => commit({ precise: v })} label="Precise cuts" />
            <span>
              Precise cuts — re-encodes a moment around each cut so the file starts and ends exactly
              here. Off is faster but snaps to keyframes (up to a few seconds off).
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
