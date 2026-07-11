import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { Home } from './screens/Home'
import { Queue } from './screens/Queue'
import { SettingsScreen } from './screens/Settings'
import { QuickApp } from './screens/Quick'
import { UpdateModal } from './components/UpdateModal'
import { Spinner } from './components/ui'

// The quick-download window loads the same bundle with a #quick hash.
const isQuickWindow = window.location.hash === '#quick'

export default function App(): JSX.Element {
  const { ready, startupError, retryStartup, view } = useStore()

  if (isQuickWindow) return <QuickApp />

  return (
    <div className="app">
      <div className="app-glow" aria-hidden="true" />
      <Sidebar />
      <main className="content">
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
    </div>
  )
}
