import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { Home } from './screens/Home'
import { Queue } from './screens/Queue'
import { SettingsScreen } from './screens/Settings'
import { QuickApp } from './screens/Quick'
import { UpdateModal } from './components/UpdateModal'
import { ExtensionOnboarding } from './components/ExtensionOnboarding'
import { SandboxNotice } from './components/SandboxNotice'
import { Spinner } from './components/ui'

// The quick-download window loads the same bundle with a #quick hash.
const isQuickWindow = window.location.hash === '#quick'

// Applies the theme setting: an explicit choice stamps data-theme on <html>;
// "system" removes it so the prefers-color-scheme rules decide.
function useTheme(): void {
  const { settings } = useStore()
  const theme = settings?.theme ?? 'system'
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
  }, [theme])
}

export default function App(): JSX.Element {
  const { ready, startupError, retryStartup, view } = useStore()
  useTheme()

  if (isQuickWindow) return <QuickApp />

  return (
    <div className="app">
      <div className="app-glow" aria-hidden="true" />
      <Sidebar />
      <main className="content">
        {ready && !startupError && <SandboxNotice />}
        {!ready ? (
          <div className="boot">
            <Spinner size={22} />
            <span>Starting Snag…</span>
          </div>
        ) : startupError ? (
          <div className="boot boot-error">
            <strong>Snag could not start</strong>
            <span>{startupError}</span>
            <button className="btn-accent" onClick={() => void retryStartup()}>
              Try again
            </button>
          </div>
        ) : view === 'home' ? (
          <Home />
        ) : view === 'queue' ? (
          <Queue />
        ) : (
          <SettingsScreen />
        )}
      </main>
      <UpdateModal />
      <ExtensionOnboarding />
    </div>
  )
}
