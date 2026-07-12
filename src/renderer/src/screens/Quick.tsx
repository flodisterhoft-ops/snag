import { useEffect, useRef, useState } from 'react'
import type { DownloadRequest, MediaInfo } from '@shared/types'
import { useStore } from '../store'
import { Icon, Spinner } from '../components/ui'
import { MediaCard } from '../components/MediaCard'
import { FormatPicker, FormatSelection } from '../components/FormatPicker'
import { shortPath } from '../lib/format'

// Compact browser-handoff dialog: analyze the handed-off link, confirm format
// and folder, download, close. Playlists and subtitles stay in the full app.
export function QuickApp(): JSX.Element {
  const { ready, startupError, settings, updateSettings, handoff, clearHandoffUrl } = useStore()

  const [url, setUrl] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [selection, setSelection] = useState<FormatSelection | null>(null)
  const [saveDir, setSaveDir] = useState('')
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const analysisRequest = useRef(0)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (settings && !saveDir) setSaveDir(settings.defaultSaveDir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  // Keyed on the handoff seq, not the URL, so repeated clicks on the same link
  // each re-fire instead of collapsing on string equality.
  useEffect(() => {
    if (!handoff) return
    clearHandoffUrl()
    void runAnalyze(handoff.url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff?.seq])

  useEffect(() => {
    return () => {
      analysisRequest.current += 1
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current)
    }
  }, [])

  // "Closing" the popup only hides the warm window. Reset to the waiting state
  // so the next handoff never flashes the previous video.
  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'hidden') return
      analysisRequest.current += 1
      if (closeTimer.current != null) {
        window.clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
      setUrl('')
      setAnalyzing(false)
      setError(null)
      setInfo(null)
      setSelection(null)
      setDone(false)
      setSubmitting(false)
      submittingRef.current = false
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  const runAnalyze = async (target: string): Promise<void> => {
    const requestId = ++analysisRequest.current
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setUrl(target)
    setAnalyzing(true)
    setError(null)
    setInfo(null)
    setSelection(null)
    setDone(false)
    try {
      const res = await window.api.analyze(target)
      if (requestId !== analysisRequest.current) return
      if (res.ok && res.info) setInfo(res.info)
      else setError(res.error ?? 'Could not read this link.')
    } catch (err) {
      if (requestId === analysisRequest.current) {
        setError((err as Error).message || 'Could not read this link.')
      }
    } finally {
      if (requestId === analysisRequest.current) setAnalyzing(false)
    }
  }

  const changeFolder = async (): Promise<void> => {
    const dir = await window.api.pickFolder(saveDir)
    if (dir) setSaveDir(dir)
  }

  const openFullApp = async (): Promise<void> => {
    await window.api.openInMainWindow(url)
    window.close()
  }

  const startDownload = async (): Promise<void> => {
    if (!info || !selection || !selection.valid || !saveDir || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setError(null)
    const request: DownloadRequest = {
      url: info.url,
      title: info.title,
      thumbnail: info.thumbnail,
      kind: selection.kind,
      videoFormatId: selection.videoFormatId,
      audioFormatId: selection.audioFormatId,
      mergeContainer: selection.mergeContainer,
      audioLanguage: selection.audioLanguage,
      audioOutputFormat: selection.audioOutputFormat,
      saveDir,
      selectionLabel: selection.selectionLabel
    }
    try {
      await window.api.enqueue(request)
      if (settings?.rememberLastChoices && settings.lastKind !== selection.kind) {
        try {
          await updateSettings({ lastKind: selection.kind })
        } catch (err) {
          console.error('Could not remember the selected download type:', err)
        }
      }
      setDone(true)
      closeTimer.current = window.setTimeout(() => window.close(), 2400)
    } catch (err) {
      setError((err as Error).message || 'Could not add this download. Please try again.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const openSnagAfterDownload = async (): Promise<void> => {
    await window.api.openInMainWindow('')
    window.close()
  }

  const canDownload = !!info && !!selection?.valid && !!saveDir && !analyzing && !submitting

  return (
    <div className="quick-app">
      <header className="quick-head">
        <span className="quick-brand">
          <Icon name="download" size={15} /> Snag
        </span>
        <div className="quick-head-actions">
          {url && !done && (
            <button className="btn-mini ghost" onClick={openFullApp} title="Open in the full app">
              <Icon name="open" size={13} /> Full app
            </button>
          )}
          <button className="icon-btn" title="Close" onClick={() => window.close()}>
            <Icon name="close" size={15} />
          </button>
        </div>
      </header>

      <div className="quick-body">
        {!ready ? (
          <div className="quick-center">
            <Spinner size={20} />
            <span>Starting Snag…</span>
          </div>
        ) : startupError ? (
          <div className="quick-center">
            <Icon name="alert" size={20} />
            <span>{startupError}</span>
          </div>
        ) : done ? (
          <div className="quick-center quick-done fade-up">
            <span className="quick-done-icon">
              <Icon name="check" size={26} />
            </span>
            <strong>Added to your downloads</strong>
            <span className="quick-done-sub">Snag keeps downloading in the background.</span>
            <div className="quick-done-actions">
              <button className="btn-outline" onClick={() => void openSnagAfterDownload()}>
                Open Snag
              </button>
              <button className="btn-accent" onClick={() => window.close()}>
                Close
              </button>
            </div>
          </div>
        ) : analyzing ? (
          <div className="analyzing-skeleton fade-up">
            <div className="skel-thumb shimmer" />
            <div className="skel-lines">
              <div className="skel-line shimmer" style={{ width: '70%' }} />
              <div className="skel-line shimmer" style={{ width: '40%' }} />
              <div className="skel-line shimmer" style={{ width: '90%', height: 44 }} />
            </div>
          </div>
        ) : error ? (
          <div className="quick-center quick-error">
            <Icon name="alert" size={20} />
            <span>{error}</span>
            <div className="quick-done-actions">
              <button className="btn-outline" onClick={() => runAnalyze(url)} disabled={!url}>
                <Icon name="retry" size={14} /> Try again
              </button>
              <button className="btn-outline" onClick={openFullApp} disabled={!url}>
                Open full app
              </button>
            </div>
          </div>
        ) : info ? (
          <>
            <MediaCard info={info} />
            {settings && <FormatPicker info={info} settings={settings} onChange={setSelection} />}
            {info.playlist && (
              <div className="quick-note">
                <Icon name="queue" size={14} />
                <span>
                  Playlist detected — this downloads the single video. Use the full app for the
                  whole playlist.
                </span>
              </div>
            )}
            <div className="save-row">
              <button className="folder-pick" onClick={changeFolder}>
                <Icon name="folder" size={16} />
                <div className="folder-info">
                  <span className="folder-label">Save to</span>
                  <span className="folder-path" title={saveDir}>
                    {shortPath(saveDir, 34)}
                  </span>
                </div>
                <span className="folder-change">Change</span>
              </button>
              <button className="btn-accent btn-download" onClick={startDownload} disabled={!canDownload}>
                {submitting ? <Spinner size={17} /> : <Icon name="download" size={17} />}
                <span className="btn-download-label">
                  {submitting ? 'Adding…' : 'Download'}
                  {selection?.selectionLabel && (
                    <span className="btn-download-sub">{selection.selectionLabel}</span>
                  )}
                </span>
              </button>
            </div>
          </>
        ) : (
          <div className="quick-center">
            <Spinner size={20} />
            <span>Waiting for the link…</span>
          </div>
        )}
      </div>
    </div>
  )
}
