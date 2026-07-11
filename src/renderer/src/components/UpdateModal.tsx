import { useState } from 'react'
import { useStore } from '../store'
import { Icon, Modal, Spinner } from './ui'

// Centered pop-up shown when the daily check (or a manual check) finds a newer
// Snag or yt-dlp. "Later" dismisses it until the next check finds something.
export function UpdateModal(): JSX.Element | null {
  const { updates, setUpdates, refreshTools } = useStore()
  const [ytdlpBusy, setYtdlpBusy] = useState(false)
  const [ytdlpDone, setYtdlpDone] = useState(false)
  const [ytdlpError, setYtdlpError] = useState<string | null>(null)

  const hasUpdate = !!updates && (!!updates.app || !!updates.ytdlp)

  const dismiss = (): void => {
    void window.api.dismissUpdates()
    setUpdates(null)
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

  return (
    <Modal open={hasUpdate} onClose={dismiss} title="Update available" icon="sparkle" size="sm">
      {updates?.app && (
        <div className="update-card">
          <div className="update-card-mark">
            <Icon name="download" size={22} />
          </div>
          <div className="update-card-text">
            <span className="update-card-title">Snag {updates.app.latest} is available</span>
            <span className="update-card-sub">You have version {updates.app.current}</span>
          </div>
          <button className="btn-accent" onClick={() => window.open(updates.app!.url)}>
            <Icon name="download" size={15} /> Get update
          </button>
        </div>
      )}

      {updates?.ytdlp && (
        <div className="update-card">
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
      )}

      {ytdlpError && <div className="update-error">{ytdlpError}</div>}

      {updates?.app && (
        <p className="update-note">
          Snag updates are installed manually — “Get update” opens the download page, then run
          the new installer.
        </p>
      )}

      <div className="update-actions">
        <button className="btn-ghost" onClick={dismiss}>
          Remind me later
        </button>
      </div>
    </Modal>
  )
}
