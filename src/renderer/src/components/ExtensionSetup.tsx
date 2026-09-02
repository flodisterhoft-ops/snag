import { useEffect, useState } from 'react'
import type { BrowserExtensionStatus, BrowserInfo, ExtensionSetupResult } from '@shared/types'
import { useStore } from '../store'
import { Icon, Spinner } from './ui'
import { SandboxWarning } from './SandboxNotice'
import { relativeTime } from '../lib/format'

// The one-button extension install. Snag does everything it can by itself
// (folder, clipboard, opening the browser) and then walks the user through
// the two clicks Chrome insists on, watching for the extension's first
// heartbeat so the screen confirms success without any further input.

type Stage = 'idle' | 'working' | 'guided' | 'connected'

export function ExtensionSetup({
  compact,
  onConnected
}: {
  compact?: boolean
  onConnected?: () => void
}): JSX.Element {
  const { storage } = useStore()
  const [browser, setBrowser] = useState<BrowserInfo | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [result, setResult] = useState<ExtensionSetupResult | null>(null)
  const [status, setStatus] = useState<BrowserExtensionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [reopened, setReopened] = useState(false)

  useEffect(() => {
    void window.api
      .getDefaultBrowser()
      .then(setBrowser)
      .catch(() => setBrowser(null))
  }, [])

  // Poll the heartbeat: quickly while the user is in the browser, slowly
  // otherwise. The first live heartbeat flips the screen to "connected".
  useEffect(() => {
    let active = true
    const load = (): void => {
      void window.api
        .getBrowserExtensionStatus()
        .then((next) => {
          if (!active) return
          setStatus(next)
          if (next.live) setStage('connected')
        })
        .catch(() => {})
    }
    load()
    const timer = window.setInterval(load, stage === 'guided' ? 2000 : 6000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [stage])

  useEffect(() => {
    if (stage === 'connected') onConnected?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  const start = async (): Promise<void> => {
    setStage('working')
    setError(null)
    setReopened(false)
    try {
      const res = await window.api.beginExtensionSetup()
      setResult(res)
      if (!res.ok) {
        setError(res.error ?? 'Could not prepare the extension.')
        setStage('idle')
        return
      }
      if (res.error) setError(res.error)
      setStage('guided')
    } catch (err) {
      setError((err as Error).message || 'Could not prepare the extension.')
      setStage('idle')
    }
  }

  const copyPath = async (): Promise<void> => {
    if (!result?.path) return
    await window.api.copyText(result.path)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const reopen = async (): Promise<void> => {
    const message = await window.api.openBrowserExtensionsPage()
    setError(message || null)
    setReopened(!message)
  }

  const browserName = result?.browser?.name ?? browser?.name ?? 'Chrome'

  if (stage === 'connected') {
    return (
      <div className={`ext-setup ${compact ? 'compact' : ''}`}>
        <div className="ext-setup-done">
          <span className="ext-setup-check">
            <Icon name="check" size={20} />
          </span>
          <div>
            <strong>Snag is connected to your browser</strong>
            <span>
              The download button appears on videos. Snag keeps the extension up to date by itself
              {status?.lastSeen ? ` · last heartbeat ${relativeTime(status.lastSeen)}` : ''}.
            </span>
          </div>
        </div>
        {!compact && (
          <button className="btn-ghost ext-setup-again" onClick={() => setStage('idle')}>
            <Icon name="open" size={14} /> Set up in another browser
          </button>
        )}
      </div>
    )
  }

  if (stage === 'idle' || stage === 'working') {
    return (
      <div className={`ext-setup ${compact ? 'compact' : ''}`}>
        {storage?.redirected && <SandboxWarning compact={compact} />}
        <button
          className="btn-accent ext-setup-primary"
          onClick={() => void start()}
          disabled={stage === 'working'}
        >
          {stage === 'working' ? <Spinner size={16} /> : <Icon name="download" size={17} />}
          {stage === 'working' ? 'Preparing…' : `Install in ${browserName}`}
        </button>
        <span className="ext-setup-hint">
          Takes about 30 seconds. {browserName} asks for one approval; after that Snag updates the
          extension by itself.
          {status?.lastSeen ? ` Last connected ${relativeTime(status.lastSeen)}.` : ''}
        </span>
        {error && <span className="ext-error">{error}</span>}
      </div>
    )
  }

  // Guided stage: what Snag already did, then the user's two remaining clicks.
  const opened = !!result?.browser
  const store = result?.mode === 'store'
  return (
    <div className={`ext-setup ${compact ? 'compact' : ''}`}>
      {result?.redirected && <SandboxWarning compact={compact} />}
      <ol className="ext-checklist">
        <li className="done">
          <span className="ext-step-mark">
            <Icon name="check" size={13} />
          </span>
          <div>
            <strong>{store ? 'Registered with Chrome' : 'Extension prepared'}</strong>
            <span>{store ? 'Chrome downloads it from the Web Store by itself.' : 'Folder path copied to your clipboard.'}</span>
          </div>
        </li>
        <li className={opened ? 'done' : 'failed'}>
          <span className="ext-step-mark">
            <Icon name={opened ? 'check' : 'alert'} size={13} />
          </span>
          <div>
            <strong>{opened ? `${browserName} opened` : 'Browser not found'}</strong>
            <span>
              {opened
                ? store
                  ? 'Showing the Chrome Web Store page.'
                  : 'Showing the extensions page.'
                : 'Open chrome://extensions in your browser.'}
            </span>
          </div>
        </li>
        {store ? (
          <li className="todo">
            <span className="ext-step-mark">3</span>
            <div>
              <strong>Click Add to Chrome</strong>
              <span>Or accept the “Enable extension” prompt Chrome shows on its next start.</span>
            </div>
          </li>
        ) : (
          <>
            <li className="todo">
              <span className="ext-step-mark">3</span>
              <div>
                <strong>Turn on Developer mode</strong>
                <span>The switch in the top-right corner of the extensions page.</span>
              </div>
            </li>
            <li className="todo">
              <span className="ext-step-mark">4</span>
              <div>
                <strong>Click Load unpacked, paste the path, confirm</strong>
                <span>Ctrl+V in the folder field pastes it. That is all — Snag does the rest.</span>
                {result?.path && (
                  <code className="ext-path-box" title={result.path}>
                    {result.path}
                  </code>
                )}
              </div>
            </li>
          </>
        )}
        <li className="waiting">
          <span className="ext-step-mark">
            <Spinner size={13} />
          </span>
          <div>
            <strong>Waiting for {browserName} to connect…</strong>
            <span>This screen updates by itself as soon as the extension is loaded.</span>
          </div>
        </li>
      </ol>
      <div className="ext-setup-actions">
        {!store && (
          <button className="btn-mini" onClick={() => void copyPath()}>
            {copied ? 'Copied!' : 'Copy path again'}
          </button>
        )}
        <button className="btn-mini ghost" onClick={() => void reopen()}>
          {reopened ? 'Opened' : store ? 'Open Web Store page' : 'Open extensions page again'}
        </button>
        <button className="btn-mini ghost" onClick={() => setStage('idle')}>
          Start over
        </button>
      </div>
      {error && <span className="ext-error">{error}</span>}
    </div>
  )
}
