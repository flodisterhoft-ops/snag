import { useState } from 'react'
import { useStore } from '../store'
import { Icon, Spinner } from './ui'

// Shown when Windows is redirecting this Snag process's files into a packaged
// parent app's private folder (see src/main/storage.ts). Everything inside
// Snag still works, but Chrome cannot see the extension folder at its usual
// path and the snag:// link registration never reaches the real registry.

export function useRestartOutsideSandbox(): { restart: () => Promise<void>; restarting: boolean } {
  const { activeCount } = useStore()
  const [restarting, setRestarting] = useState(false)

  const restart = async (): Promise<void> => {
    if (restarting) return
    if (
      activeCount > 0 &&
      !window.confirm(
        `Restarting cancels ${activeCount} active download${activeCount > 1 ? 's' : ''}. Restart now?`
      )
    ) {
      return
    }
    setRestarting(true)
    const started = await window.api.relaunchOutsideSandbox()
    if (!started) setRestarting(false)
  }

  return { restart, restarting }
}

export function SandboxWarning({ compact }: { compact?: boolean }): JSX.Element {
  const { restart, restarting } = useRestartOutsideSandbox()
  return (
    <div className={`sandbox-warning ${compact ? 'compact' : ''}`} role="status">
      <Icon name="alert" size={16} />
      <div className="sandbox-warning-text">
        <strong>Snag was started inside another app’s sandbox.</strong>
        <span>
          Windows is keeping this session’s files in a private folder. Chrome can still load the
          extension from the folder shown here, but <code>snag://</code> links and automatic
          extension updates only work after Snag is restarted from the Start menu or desktop.
        </span>
      </div>
      <button className="btn-outline" onClick={() => void restart()} disabled={restarting}>
        {restarting ? <Spinner size={14} /> : <Icon name="retry" size={14} />}
        {restarting ? 'Restarting…' : 'Restart Snag normally'}
      </button>
    </div>
  )
}

// Slim bar across the top of the main window; dismissible for this session.
export function SandboxNotice(): JSX.Element | null {
  const { storage, openSettings } = useStore()
  const { restart, restarting } = useRestartOutsideSandbox()
  const [hidden, setHidden] = useState(false)

  if (!storage?.redirected || hidden) return null

  return (
    <div className="sandbox-notice" role="status">
      <Icon name="alert" size={15} />
      <span className="sandbox-notice-text">
        Snag was started inside another app’s sandbox, so browser links and the Chrome extension
        folder are not where Windows expects them.
      </span>
      <button className="btn-mini" onClick={() => void restart()} disabled={restarting}>
        {restarting ? 'Restarting…' : 'Restart normally'}
      </button>
      <button className="btn-mini ghost" onClick={() => openSettings('browser')}>
        Details
      </button>
      <button className="icon-btn" title="Hide for now" onClick={() => setHidden(true)}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
