import { useState } from 'react'
import { useStore } from '../store'
import { Icon, Modal, Spinner } from './ui'

const REPO_URL = 'https://github.com/flodisterhoft-ops/snag'
const COFFEE_URL = 'https://www.buymeacoffee.com/flodisterhoft'

export function AboutDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element {
  const { appVersion, toolStatus, setUpdates } = useStore()
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)

  const checkNow = async (): Promise<void> => {
    setChecking(true)
    setCheckResult(null)
    try {
      const res = await window.api.checkForUpdates()
      if (res.app || res.ytdlp) {
        // Hand off to the update pop-up so the user gets the prominent prompt.
        setUpdates(res)
        onClose()
      } else if (res.status === 'success') {
        setCheckResult("You're on the latest version.")
      } else {
        setCheckResult(res.error ?? 'Could not check for updates. Please try again.')
      }
    } catch (err) {
      setCheckResult((err as Error).message || 'Could not check for updates.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="About Snag" icon="info" size="sm">
      <div className="about">
        <div className="about-hero">
          <div className="about-mark">
            <Icon name="download" size={26} />
          </div>
          <div>
            <div className="about-name">Snag</div>
            <div className="about-version">Version {appVersion ?? '—'}</div>
          </div>
        </div>

        <p className="about-tagline">
          A fast, beautiful video &amp; audio downloader for Windows, powered by yt-dlp.
        </p>

        <div className="about-facts">
          <div className="about-fact">
            <span>yt-dlp</span>
            <strong>
              {toolStatus?.ytdlpFound
                ? toolStatus.ytdlpVersion
                  ? `v${toolStatus.ytdlpVersion}`
                  : 'ready'
                : 'not found'}
            </strong>
          </div>
          <div className="about-fact">
            <span>ffmpeg</span>
            <strong>{toolStatus?.ffmpegFound ? 'ready' : 'not found'}</strong>
          </div>
        </div>

        <button className="btn-accent about-check" onClick={checkNow} disabled={checking}>
          {checking ? <Spinner size={15} /> : <Icon name="retry" size={15} />}
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        {checkResult && <div className="about-check-result">{checkResult}</div>}

        <div className="about-links">
          <button className="about-link" onClick={() => window.open(REPO_URL)}>
            <Icon name="github" size={16} /> GitHub
          </button>
          <button className="about-link coffee" onClick={() => window.open(COFFEE_URL)}>
            <Icon name="heart" size={16} /> Buy me a coffee
          </button>
        </div>

        <div className="about-foot">
          MIT-licensed · yt-dlp &amp; ffmpeg bundled · made with care
        </div>
      </div>
    </Modal>
  )
}
