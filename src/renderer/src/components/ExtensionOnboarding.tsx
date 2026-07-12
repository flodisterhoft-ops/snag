import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon, Modal, Spinner } from './ui'

export function ExtensionOnboarding(): JSX.Element | null {
  const { ready, settings, updateSettings } = useStore()
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [setupPath, setSetupPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready || !settings || settings.browserExtensionPromptDismissed) return
    let active = true
    const timer = window.setTimeout(() => {
      void window.api.getBrowserExtensionStatus().then((status) => {
        if (active && !status.detected) setOpen(true)
      })
    }, 5000)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [ready, settings])

  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => {
      void window.api.getBrowserExtensionStatus().then((status) => {
        if (status.detected) setOpen(false)
      })
    }, 2500)
    return () => window.clearInterval(timer)
  }, [open])

  const beginSetup = async (): Promise<void> => {
    setChecking(true)
    setError(null)
    try {
      const result = await window.api.openBrowserExtensionSetup()
      if (!result.ok || !result.path) setError(result.error || 'Could not prepare the extension folder.')
      else {
        setSetupPath(result.path)
        if (result.error) setError(result.error)
      }
    } catch (err) {
      setError((err as Error).message || 'Chrome could not be opened.')
    } finally {
      setChecking(false)
    }
  }

  const dismissForever = async (): Promise<void> => {
    await updateSettings({ browserExtensionPromptDismissed: true })
    setOpen(false)
  }

  if (!settings) return null

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Add Snag to Chrome" icon="download" size="sm">
      <div className="extension-onboarding">
        <p>Put the Snag download button directly on supported videos. Chrome requires one approval; future updates are automatic.</p>
        {setupPath ? (
          <div className="extension-setup-steps">
            <div><span>1</span> Turn on <strong>Developer mode</strong> in the Chrome page that opened.</div>
            <div><span>2</span> Click <strong>Load unpacked</strong>.</div>
            <div><span>3</span> Paste the folder path already copied to your clipboard, then select it.</div>
            <code title={setupPath}>{setupPath}</code>
          </div>
        ) : (
          <button className="btn-accent extension-setup-primary" onClick={() => void beginSetup()} disabled={checking}>
            {checking ? <Spinner size={15} /> : <Icon name="open" size={15} />}
            {checking ? 'Opening Chrome…' : 'Set up Chrome extension'}
          </button>
        )}
        {error && <div className="update-error">{error}</div>}
        <div className="extension-onboarding-actions">
          <button className="btn-ghost" onClick={() => setOpen(false)}>Not now</button>
          <button className="btn-ghost" onClick={() => void dismissForever()}>Don’t show again</button>
        </div>
      </div>
    </Modal>
  )
}
