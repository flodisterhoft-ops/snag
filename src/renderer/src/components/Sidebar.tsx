import { useState } from 'react'
import { useStore, View } from '../store'
import { Icon } from './ui'
import { AboutDialog } from './AboutDialog'

const NAV: { view: View; icon: 'download' | 'queue' | 'settings'; label: string }[] = [
  { view: 'home', icon: 'download', label: 'Download' },
  { view: 'queue', icon: 'queue', label: 'Queue' },
  { view: 'settings', icon: 'settings', label: 'Settings' }
]

export function Sidebar(): JSX.Element {
  const { view, setView, activeCount, toolStatus, appVersion } = useStore()
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Icon name="download" size={20} />
        </div>
        <div className="brand-text">
          <span className="brand-name">SNAG</span>
          <span className="brand-sub">video grabber</span>
        </div>
      </div>

      <nav className="nav">
        {NAV.map((n) => (
          <button
            key={n.view}
            className={`nav-item ${view === n.view ? 'active' : ''}`}
            onClick={() => setView(n.view)}
          >
            <Icon name={n.icon} size={18} />
            <span>{n.label}</span>
            {n.view === 'queue' && activeCount > 0 && (
              <span className="nav-badge">{activeCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className={`tool-chip ${toolStatus?.ytdlpFound ? 'ok' : 'bad'}`}>
          <span className="tool-dot" />
          <div className="tool-lines">
            <span className="tool-title">
              {toolStatus?.ytdlpFound ? 'yt-dlp ready' : 'yt-dlp missing'}
            </span>
            <span className="tool-ver">
              {toolStatus?.ytdlpVersion
                ? `v${toolStatus.ytdlpVersion}`
                : toolStatus?.ytdlpFound
                  ? ''
                  : 'set path in settings'}
            </span>
          </div>
        </div>

        <button className="about-btn" onClick={() => setAboutOpen(true)} title="About Snag">
          <Icon name="info" size={15} />
          <span className="about-btn-label">About</span>
          <span className="about-btn-ver">v{appVersion ?? '—'}</span>
        </button>
      </div>

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </aside>
  )
}
