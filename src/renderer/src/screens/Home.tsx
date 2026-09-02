import { useCallback, useEffect, useRef, useState } from 'react'
import type { DownloadKind, DownloadRequest, DownloadSection, MediaInfo } from '@shared/types'
import { useStore } from '../store'
import { CheckRow, Icon, Segmented, Spinner, Toggle } from '../components/ui'
import { MediaCard } from '../components/MediaCard'
import { FormatPicker, FormatSelection } from '../components/FormatPicker'
import { TrimEditor, formatTimecode } from '../components/TrimEditor'
import { DownloadBar } from '../components/DownloadBar'
import { extractUrls, looksLikeUrl } from '../lib/format'

export function Home(): JSX.Element {
  const { settings, updateSettings, setView, handoff, clearHandoffUrl } = useStore()

  const [url, setUrl] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [selection, setSelection] = useState<FormatSelection | null>(null)
  const [section, setSection] = useState<DownloadSection | null>(null)
  const [saveDir, setSaveDir] = useState('')
  const [wholePlaylist, setWholePlaylist] = useState(false)
  const [openWhenDone, setOpenWhenDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [clip, setClip] = useState<string | null>(null)
  const [dismissedClip, setDismissedClip] = useState<string | null>(null)
  // Several links pasted at once: queue them all with the defaults.
  const [batch, setBatch] = useState<string[] | null>(null)
  const [batchKind, setBatchKind] = useState<DownloadKind>('video')
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const analyzeSequence = useRef(0)
  const saveDirOverridden = useRef(false)
  const urlRef = useRef(url)
  urlRef.current = url

  const [subsEnabled, setSubsEnabled] = useState(false)
  const [subLangs, setSubLangs] = useState<string[]>([])
  const [subEmbed, setSubEmbed] = useState(true)

  useEffect(() => () => {
    analyzeSequence.current += 1
  }, [])

  // Follow the default folder from Settings until the user picks one here.
  useEffect(() => {
    if (settings && !saveDirOverridden.current) setSaveDir(settings.defaultSaveDir)
  }, [settings])

  useEffect(() => {
    if (settings) setOpenWhenDone(settings.openWhenDone)
  }, [settings?.openWhenDone, settings])

  // A link handed off from the browser (snag://) starts analyzing immediately.
  // Keyed on the handoff seq, not the URL, so repeated clicks on the same link
  // each re-fire instead of collapsing on string equality.
  useEffect(() => {
    if (!handoff) return
    clearHandoffUrl()
    void runAnalyze(handoff.url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff?.seq])

  const checkClipboard = useCallback(async () => {
    try {
      const text = (await window.api.readClipboard()).trim()
      if (looksLikeUrl(text) && text !== url.trim() && text !== dismissedClip) setClip(text)
      else setClip(null)
    } catch {
      /* ignore */
    }
  }, [url, dismissedClip])

  useEffect(() => {
    checkClipboard()
    const onFocus = (): void => {
      checkClipboard()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [checkClipboard])

  // Links copied anywhere while Snag is open (main-process clipboard watch).
  useEffect(() => {
    return window.api.onClipboardUrl((copied) => {
      if (copied !== urlRef.current.trim()) {
        setDismissedClip(null)
        setClip(copied)
      }
    })
  }, [])

  const runAnalyze = async (target?: string): Promise<void> => {
    const u = (target ?? url).trim()
    if (!u) return
    const many = extractUrls(u)
    if (many.length >= 2) {
      startBatch(many)
      return
    }
    const requestId = ++analyzeSequence.current
    setBatch(null)
    setUrl(u)
    setClip(null)
    setAnalyzing(true)
    setError(null)
    setInfo(null)
    setSelection(null)
    setSection(null)
    setWholePlaylist(false)
    try {
      const res = await window.api.analyze(u)
      if (requestId !== analyzeSequence.current) return
      if (res.ok && res.info) {
        setInfo(res.info)
        if (settings) {
          const avail = res.info.subtitleLanguages.map((s) => s.code)
          const preset = settings.subtitles.languages.filter((c) => avail.includes(c))
          setSubsEnabled(settings.subtitles.enabled && avail.length > 0)
          setSubLangs(preset.length ? preset : avail.slice(0, 1))
          setSubEmbed(settings.subtitles.embed)
        }
      } else {
        setError(res.error ?? 'Could not read this link.')
      }
    } catch (err) {
      if (requestId === analyzeSequence.current) {
        setError((err as Error).message || 'Could not read this link.')
      }
    } finally {
      if (requestId === analyzeSequence.current) setAnalyzing(false)
    }
  }

  const startBatch = (urls: string[]): void => {
    analyzeSequence.current += 1
    setAnalyzing(false)
    setInfo(null)
    setSelection(null)
    setSection(null)
    setError(null)
    setClip(null)
    setUrl('')
    setBatch([...new Set(urls)])
  }

  const pasteInput = async (): Promise<void> => {
    const t = (await window.api.readClipboard()).trim()
    if (!t) return
    const many = extractUrls(t)
    if (many.length >= 2) {
      startBatch(many)
      return
    }
    setUrl(t)
    setClip(null)
  }

  const changeFolder = async (): Promise<void> => {
    const dir = await window.api.pickFolder(saveDir)
    if (dir) {
      saveDirOverridden.current = true
      setSaveDir(dir)
    }
  }

  const toggleSubLang = (code: string): void => {
    setSubLangs((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    )
  }

  const rememberOpenWhenDone = (value: boolean): void => {
    setOpenWhenDone(value)
    if (settings && settings.openWhenDone !== value) {
      void updateSettings({ openWhenDone: value }).catch(() => {})
    }
  }

  // `share` = hand the finished file to that share target (id, or undefined
  // for the first enabled one); null = plain download.
  const startDownload = async (share: string | undefined | null = null): Promise<void> => {
    if (!info || !selection || !selection.valid || !saveDir || submitting) return
    const autoGenerated =
      subsEnabled &&
      subLangs.some((c) => info.subtitleLanguages.find((s) => s.code === c)?.isAuto)

    const request: DownloadRequest = {
      url: info.url,
      title: info.title,
      thumbnail: info.thumbnail,
      kind: selection.kind,
      videoFormatId: selection.videoFormatId,
      audioFormatId: selection.audioFormatId,
      audioFormatIds: selection.audioFormatIds,
      mergeContainer: selection.mergeContainer,
      audioLanguage: selection.audioLanguage,
      audioOutputFormat: selection.audioOutputFormat,
      downloadWholePlaylist: wholePlaylist,
      section: section && !wholePlaylist ? section : undefined,
      openWhenDone: openWhenDone || undefined,
      shareWhenDone: share !== null ? true : undefined,
      shareTarget: share !== null ? share : undefined,
      saveDir,
      subtitles:
        subsEnabled && subLangs.length
          ? { enabled: true, languages: subLangs, embed: subEmbed, autoGenerated }
          : undefined,
      selectionLabel: selection.selectionLabel + (section && !wholePlaylist ? ' · trimmed' : '')
    }
    setSubmitting(true)
    setError(null)
    try {
      await window.api.enqueue(request)
      if (settings?.rememberLastChoices && settings.lastKind !== selection.kind) {
        // Keep the renderer's settings snapshot in sync with the value persisted
        // by the main process so the very next analysis restores this choice.
        try {
          await updateSettings({ lastKind: selection.kind })
        } catch (err) {
          console.error('Could not refresh the last format choice:', err)
        }
      }
      setInfo(null)
      setUrl('')
      setSelection(null)
      setSection(null)
      setError(null)
      setView('queue')
    } catch (err) {
      setError((err as Error).message || 'Could not add this download. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const startBatchDownload = async (): Promise<void> => {
    if (!batch || batch.length === 0 || !settings || !saveDir || batchSubmitting) return
    setBatchSubmitting(true)
    setError(null)
    const container = settings.preferredVideoContainer
    const audioFormat = settings.preferredAudioFormat
    try {
      for (const link of batch) {
        await window.api.enqueue({
          url: link,
          // The finished file names the job once yt-dlp knows the title.
          title: link,
          thumbnail: null,
          kind: batchKind,
          mergeContainer: batchKind === 'video' ? container : undefined,
          audioOutputFormat: batchKind === 'audio' ? audioFormat : undefined,
          openWhenDone: openWhenDone || undefined,
          saveDir,
          selectionLabel:
            batchKind === 'video'
              ? `Best · ${container.toUpperCase()}`
              : audioFormat === 'best'
                ? 'Original audio'
                : audioFormat.toUpperCase()
        })
      }
      setBatch(null)
      setView('queue')
    } catch (err) {
      setError((err as Error).message || 'Could not add these downloads. Please try again.')
    } finally {
      setBatchSubmitting(false)
    }
  }

  const canDownload = !!info && !!selection?.valid && !!saveDir && !analyzing && !submitting

  const toggleSection = (): void => {
    if (!info) return
    if (section) {
      setSection(null)
      return
    }
    const total = info.durationSeconds && info.durationSeconds > 0 ? info.durationSeconds : 60
    setSection({ start: 0, end: total, precise: true })
  }

  const downloadSub = selection
    ? [selection.selectionLabel, selection.sizeLabel].filter(Boolean).join(' · ')
    : null

  return (
    <div className="screen home">
      <header className="screen-head">
        <h1 className="screen-title">Grab a video</h1>
        <p className="screen-desc">
          Paste a link from YouTube, Vimeo, TikTok, X, and 1000+ other sites — or several links at
          once.
        </p>
      </header>

      <div className="url-bar">
        <span className="url-icon">
          <Icon name="link" size={18} />
        </span>
        <input
          className="url-input"
          placeholder="https://…"
          value={url}
          spellCheck={false}
          autoFocus
          onChange={(e) => setUrl(e.target.value)}
          onPaste={(e) => {
            // A multi-line paste into a single-line field would glue the links
            // together; intercept it and start a batch instead.
            const text = e.clipboardData.getData('text')
            const many = extractUrls(text)
            if (many.length >= 2) {
              e.preventDefault()
              startBatch(many)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !analyzing) void runAnalyze()
          }}
        />
        <button className="btn-ghost paste-btn" onClick={pasteInput} title="Paste from clipboard">
          <Icon name="paste" size={16} /> Paste
        </button>
        <button className="btn-accent analyze-btn" onClick={() => runAnalyze()} disabled={analyzing || !url.trim()}>
          {analyzing ? <Spinner size={16} /> : <Icon name="sparkle" size={16} />}
          {analyzing ? 'Reading…' : 'Analyze'}
        </button>
      </div>

      {clip && !batch && (
        <div className="clip-suggest fade-up">
          <Icon name="paste" size={15} />
          <span className="clip-text">Detected a link on your clipboard</span>
          <code className="clip-url">{clip}</code>
          <button className="btn-mini" onClick={() => runAnalyze(clip)}>
            Use it
          </button>
          <button
            className="btn-mini ghost"
            onClick={() => {
              setDismissedClip(clip)
              setClip(null)
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="error-box fade-up">
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}

      {batch && (
        <div className="batch fade-up">
          <div className="batch-head">
            <div>
              <span className="option-title">
                <Icon name="queue" size={15} /> {batch.length} links ready to queue
              </span>
              <span className="option-sub">
                Each is downloaded in the best quality with your defaults; titles appear as the
                files are named.
              </span>
            </div>
            <Segmented
              size="sm"
              options={[
                { value: 'video', label: 'Video' },
                { value: 'audio', label: 'Audio' }
              ]}
              value={batchKind}
              onChange={setBatchKind}
            />
          </div>
          <ul className="batch-list">
            {batch.map((link) => (
              <li key={link}>
                <code>{link}</code>
                <button
                  className="icon-btn"
                  title="Remove from this batch"
                  onClick={() => setBatch((prev) => (prev ? prev.filter((l) => l !== link) : prev))}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
          <DownloadBar
            saveDir={saveDir}
            onChangeFolder={() => void changeFolder()}
            onDownload={() => void startBatchDownload()}
            disabled={batch.length === 0 || batchSubmitting}
            busy={batchSubmitting}
            label={batchSubmitting ? 'Adding…' : `Download all ${batch.length}`}
            sub={
              batchKind === 'video'
                ? `Best · ${settings?.preferredVideoContainer.toUpperCase() ?? 'MP4'}`
                : 'Audio only'
            }
          />
          <button className="btn-ghost batch-cancel" onClick={() => setBatch(null)}>
            Cancel
          </button>
        </div>
      )}

      {analyzing && !info && (
        <div className="analyzing-skeleton fade-up">
          <div className="skel-thumb shimmer" />
          <div className="skel-lines">
            <div className="skel-line shimmer" style={{ width: '70%' }} />
            <div className="skel-line shimmer" style={{ width: '40%' }} />
            <div className="skel-line shimmer" style={{ width: '90%', height: 44 }} />
          </div>
        </div>
      )}

      {info && (
        <div className="result-card fade-up">
          <MediaCard info={info} />

          <div className="result-section">
            {settings && (
              <FormatPicker info={info} settings={settings} onChange={setSelection}>
                <div className="opts">
                  {!info.isLive && !wholePlaylist && (
                    <CheckRow
                      checked={!!section}
                      icon="scissors"
                      label="Trim"
                      hint={
                        section
                          ? `${formatTimecode(section.start, false)} – ${formatTimecode(section.end, false)}`
                          : 'Only a part of the video'
                      }
                      onChange={toggleSection}
                    />
                  )}
                  {info.subtitleLanguages.length > 0 && (
                    <CheckRow
                      checked={subsEnabled}
                      icon="subtitle"
                      label="Subtitles"
                      hint={
                        subsEnabled && subLangs.length
                          ? subLangs.map((c) => c.toUpperCase()).join(', ')
                          : `${info.subtitleLanguages.length} language${info.subtitleLanguages.length > 1 ? 's' : ''}`
                      }
                      onChange={() => setSubsEnabled((v) => !v)}
                    />
                  )}
                  {subsEnabled && info.subtitleLanguages.length > 0 && (
                    <div className="opt-detail fade-up">
                      <div className="sub-lang-chips">
                        {info.subtitleLanguages.map((s) => (
                          <button
                            key={s.code}
                            className={`chip chip-sm ${subLangs.includes(s.code) ? 'active' : ''}`}
                            onClick={() => toggleSubLang(s.code)}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                      {selection?.kind === 'video' && (
                        <label className="inline-toggle">
                          <Toggle
                            checked={subEmbed}
                            onChange={setSubEmbed}
                            label="Embed subtitles into video file"
                          />
                          <span>Embed into the video file</span>
                        </label>
                      )}
                    </div>
                  )}
                  {info.playlist && (
                    <CheckRow
                      checked={wholePlaylist}
                      icon="queue"
                      label="Whole playlist"
                      hint={`${info.playlist.count} videos → “${info.playlist.title ?? 'playlist'}” folder`}
                      onChange={() => {
                        const next = !wholePlaylist
                        setWholePlaylist(next)
                        if (next) setSection(null)
                      }}
                    />
                  )}
                  <CheckRow
                    checked={openWhenDone}
                    icon="open"
                    label="Open when done"
                    hint="Launch the finished file"
                    onChange={() => rememberOpenWhenDone(!openWhenDone)}
                  />
                </div>

                <DownloadBar
                  saveDir={saveDir}
                  onChangeFolder={() => void changeFolder()}
                  onDownload={() => void startDownload()}
                  onShare={(targetId) => void startDownload(targetId)}
                  disabled={!canDownload}
                  busy={submitting}
                  label={
                    submitting ? 'Adding…' : section && !wholePlaylist ? 'Download section' : 'Download'
                  }
                  sub={downloadSub}
                />
              </FormatPicker>
            )}
          </div>

          {section && !wholePlaylist && !info.isLive && (
            <div className="result-section">
              <TrimEditor info={info} section={section} onChange={setSection} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
