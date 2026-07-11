import { useState } from 'react'
import { useStore } from '../store'
import { Icon, Spinner } from './ui'

// Bottom-right prompt shown when the daily check (or a manual check) finds a
// newer Snag or yt-dlp. "Later" dismisses it until the next check.
export function UpdateBanner(): JSX.Element | null {
  const { updates, setUpdates, refreshTools } = useStore()
  const [ytdlpBusy, setYtdlpBusy] = useState(false)
  const [ytdlpDone, setYtdlpDone] = useState(false)
  const [ytdlpError, setYtdlpError] = useState<string | null>(null)

  if (!updates || (!updates.app && !updates.ytdlp)) return null

  const updateYtdlp = async (): Promise<void> => {
    setYtdlpBusy(true)
    setYtdlpError(null)
    const res = await window.api.updateYtdlp()
    setYtdlpBusy(false)
    if (res.ok) {
      setYtdlpDone(true)
      void refreshTools()
      // If the app itself is also outdated, keep the banner for that part.
      if (!updates.app) {
        window.setTimeout(() => setUpdates(null), 2000)
      }
    } else {
      setYtdlpError(res.output || 'Update failed.')
    }
  }

  return (
    <div className="update-banner fade-up">
      <div className="update-banner-head">
        <Icon name="sparkle" size={15} />
        <strong>Updates available</strong>
        <button className="icon-btn" title="Later" onClick={() => setUpdates(null)}>
          <Icon name="close" size={14} />
        </button>
      </div>

      {updates.app && (
        <div className="update-row">
          <div className="update-row-text">
            <span className="update-row-title">Snag {updates.app.latest}</span>
            <span className="update-row-sub">You have {updates.app.current}</span>
          </div>
          <button className="btn-accent btn-sm" onClick={() => window.open(updates.app!.url)}>
            <Icon name="download" size={14} /> Get update
          </button>
        </div>
      )}

      {updates.ytdlp && (
        <div className="update-row">
          <div className="update-row-text">
            <span className="update-row-title">yt-dlp {updates.ytdlp.latest}</span>
            <span className="update-row-sub">
              {ytdlpDone ? 'Updated!' : `You have ${updates.ytdlp.current}`}
            </span>
          </div>
          {!ytdlpDone && (
            <button className="btn-outline btn-sm" onClick={updateYtdlp} disabled={ytdlpBusy}>
              {ytdlpBusy ? <Spinner size={13} /> : <Icon name="retry" size={13} />}
              {ytdlpBusy ? 'Updating…' : 'Update now'}
            </button>
          )}
          {ytdlpDone && (
            <span className="status-pill ok">
              <Icon name="check" size={12} /> Done
            </span>
          )}
        </div>
      )}
      {ytdlpError && <div className="update-error">{ytdlpError}</div>}

      <button className="update-later" onClick={() => setUpdates(null)}>
        Remind me later
      </button>
    </div>
  )
}
