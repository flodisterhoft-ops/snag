import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon, Modal, Spinner } from './ui'
import { formatBytes } from '../lib/format'
import type { AppUpdateProgress } from '@shared/types'

type AppPhase = 'manual' | 'starting' | 'downloading' | 'downloaded' | 'error'

// Centered pop-up shown when the launch/daily check (or a manual check) finds
// a newer Snag or yt-dlp. Installed builds download the Snag update in-app
// with a progress bar and install it silently on "Restart to update".
export function UpdateModal(): JSX.Element | null {
  const { updates, setUpdates, refreshTools } = useStore()
  const [ytdlpBusy, setYtdlpBusy] = useState(false)
  const [ytdlpDone, setYtdlpDone] = useState(false)
  const [ytdlpError, setYtdlpError] = useState<string | null>(null)

  const [appPhase, setAppPhase] = useState<AppPhase>('starting')
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null)
  const [appError, setAppError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const downloadStarted = useRef(false)

  const hasUpdate = !!updates && (!!updates.app || !!updates.ytdlp)
  const hasAppUpdate = !!updates?.app

  // Kick off the in-app download as soon as the pop-up shows the app update.
  useEffect(() => {
    if (!hasAppUpdate || downloadStarted.current) return
    downloadStarted.current = true

    const offProgress = window.api.onAppUpdateProgress((p) => {
      setAppPhase('downloading')
      setProgress(p)
    })
    const offDownloaded = window.api.onAppUpdateDownloaded(() => setAppPhase('downloaded'))
    const offError = window.api.onAppUpdateError((message) => {
      setAppPhase('error')
      setAppError(message)
    })

    void (async () => {
      try {
        if (!(await window.api.canAutoUpdate())) {
          setAppPhase('manual')
          return
        }
        const res = await window.api.downloadAppUpdate()
        if (res.downloaded) setAppPhase('downloaded')
        else if (res.ok) setAppPhase((prev) => (prev === 'starting' ? 'downloading' : prev))
        else {
          setAppPhase('error')
          setAppError(res.error ?? 'Could not start the update download.')
        }
      } catch (err) {
        setAppPhase('error')
        setAppError((err as Error).message || 'Could not start the update download.')
      }
    })()

    return () => {
      offProgress()
      offDownloaded()
      offError()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAppUpdate])

  const dismiss = (): void => {
    void window.api.dismissUpdates()
    setUpdates(null)
  }

  const restartToUpdate = async (): Promise<void> => {
    setRestarting(true)
    const ok = await window.api.installAppUpdate()
    if (!ok) {
      setRestarting(false)
      setAppPhase('error')
      setAppError('The downloaded update could not be started. Please try again.')
    }
  }

  const updateYtdlp = async (): Promise<void> => {
    setYtdlpBusy(true)
    setYtdlpError(null)
    try {
      const res = await window.api.updateYtdlp()
      if (res.ok) {
        setYtdlpDone(true)
        void refreshTools()
        if (updates && !updates.app) window.setTimeout(() => setUpdates(null), 1600)
      } else {
        setYtdlpError(res.output || 'Update failed.')
      }
    } catch (err) {
      setYtdlpError((err as Error).message || 'Update failed.')
    } finally {
      setYtdlpBusy(false)
    }
  }

  const pct = Math.round(progress?.percent ?? 0)
  const speed = progress ? `${(progress.bytesPerSecond / 1048576).toFixed(1)} MB/s` : null

  return (
    <Modal open={hasUpdate} onClose={dismiss} title="Update available" icon="sparkle" size="sm">
      {updates?.app && (
        <div className="update-card update-card-app">
          <div className="update-card-row">
            <div className="update-card-mark">
              <Icon name="download" size={22} />
            </div>
            <div className="update-card-text">
              <span className="update-card-title">Snag {updates.app.latest} is available</span>
              <span className="update-card-sub">
                {appPhase === 'downloaded'
                  ? 'Downloaded — restart to finish'
                  : appPhase === 'downloading'
                    ? `Downloading… ${pct}%${speed ? ` · ${speed}` : ''}`
                    : appPhase === 'starting'
                      ? 'Preparing download…'
                      : `You have version ${updates.app.current}`}
              </span>
            </div>
            {appPhase === 'downloaded' ? (
              <button className="btn-accent" onClick={restartToUpdate} disabled={restarting}>
                {restarting ? <Spinner size={15} /> : <Icon name="retry" size={15} />}
                {restarting ? 'Restarting…' : 'Restart to update'}
              </button>
            ) : appPhase === 'manual' || appPhase === 'error' ? (
              <button className="btn-accent" onClick={() => window.open(updates.app!.url)}>
                <Icon name="download" size={15} /> Get update
              </button>
            ) : (
              <Spinner size={16} />
            )}
          </div>

          {(appPhase === 'downloading' || appPhase === 'starting') && (
            <div className="progress update-progress">
              <div
                className={`progress-bar ${appPhase === 'starting' ? 'indeterminate' : ''}`}
                style={{ width: appPhase === 'starting' ? '100%' : `${pct}%` }}
              />
            </div>
          )}
          {progress && appPhase === 'downloading' && (
            <div className="update-progress-meta">
              {formatBytes(progress.transferred)} of {formatBytes(progress.total)}
            </div>
          )}
          {appPhase === 'error' && appError && <div className="update-error">{appError}</div>}
        </div>
      )}

      {updates?.ytdlp && (
        <div className="update-card">
          <div className="update-card-row">
            <div className="update-card-mark">
              <Icon name="retry" size={20} />
            </div>
            <div className="update-card-text">
              <span className="update-card-title">yt-dlp {updates.ytdlp.latest}</span>
              <span className="update-card-sub">
                {ytdlpDone ? 'Updated!' : `You have ${updates.ytdlp.current}`}
              </span>
            </div>
            {ytdlpDone ? (
              <span className="status-pill ok">
                <Icon name="check" size={13} /> Done
              </span>
            ) : (
              <button className="btn-outline" onClick={updateYtdlp} disabled={ytdlpBusy}>
                {ytdlpBusy ? <Spinner size={14} /> : <Icon name="retry" size={14} />}
                {ytdlpBusy ? 'Updating…' : 'Update now'}
              </button>
            )}
          </div>
          {ytdlpError && <div className="update-error">{ytdlpError}</div>}
        </div>
      )}

      {updates?.app && appPhase === 'downloaded' && (
        <p className="update-note">
          Snag will close, update itself quietly, and reopen — no installer screens.
        </p>
      )}

      <div className="update-actions">
        <button className="btn-ghost" onClick={dismiss}>
          {appPhase === 'downloading' ? 'Hide (keeps downloading)' : 'Remind me later'}
        </button>
      </div>
    </Modal>
  )
}
