import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Modal } from './ui'
import { ExtensionSetup } from './ExtensionSetup'

// First-launch prompt: one button installs the Chrome extension. It only
// appears while no extension has ever reported in, and "Not now" silences it
// for the rest of this launch regardless of later settings changes.
export function ExtensionOnboarding(): JSX.Element | null {
  const { ready, settings, updateSettings } = useStore()
  const [open, setOpen] = useState(false)
  const [snoozed, setSnoozed] = useState(false)
  const promptDismissed = settings?.browserExtensionPromptDismissed ?? true

  useEffect(() => {
    if (!ready || promptDismissed || snoozed) return
    let active = true
    const timer = window.setTimeout(() => {
      void window.api.getBrowserExtensionStatus().then((status) => {
        if (active && !status.detected) setOpen(true)
      })
    }, 4000)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [ready, promptDismissed, snoozed])

  const snooze = (): void => {
    setSnoozed(true)
    setOpen(false)
  }

  const finish = (): void => {
    setSnoozed(true)
    window.setTimeout(() => setOpen(false), 1800)
  }

  const dismissForever = async (): Promise<void> => {
    await updateSettings({ browserExtensionPromptDismissed: true })
    setOpen(false)
  }

  if (!settings) return null

  return (
    <Modal open={open} onClose={snooze} title="Add Snag to your browser" icon="download" size="sm">
      <div className="extension-onboarding">
        <p>
          Get a download button right on videos, with the quality picker in the page. One click
          here, one approval in the browser.
        </p>
        <ExtensionSetup compact onConnected={finish} />
        <div className="extension-onboarding-actions">
          <button className="btn-ghost" onClick={snooze}>
            Not now
          </button>
          <button className="btn-ghost" onClick={() => void dismissForever()}>
            Don’t show again
          </button>
        </div>
      </div>
    </Modal>
  )
}
