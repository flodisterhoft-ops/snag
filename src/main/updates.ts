import { app } from 'electron'
import { loadSettings, saveSettings } from './settings'
import { getToolStatus } from './ytdlp'
import { compareVersions } from './version'
import type { UpdateAvailability } from '@shared/types'

// Releases are checked straight against GitHub — no update server needed.
export const APP_REPO = 'flodisterhoft-ops/snag'
const YTDLP_REPO = 'yt-dlp/yt-dlp'

// "About once a day": long enough to be polite to the API, short enough that
// an always-running tray app still notices new releases promptly.
const AUTO_CHECK_INTERVAL_MS = 20 * 60 * 60 * 1000

async function latestRelease(repo: string): Promise<{ version: string; url: string } | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Snag-update-check' },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return null
    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    if (!data.tag_name) return null
    return {
      version: data.tag_name.replace(/^v/i, ''),
      url: data.html_url ?? `https://github.com/${repo}/releases/latest`
    }
  } catch {
    // Offline, rate-limited, or no releases yet — all fine, just report nothing.
    return null
  }
}

export async function checkForUpdates(): Promise<UpdateAvailability> {
  const settings = loadSettings()
  const [appRelease, ytdlpRelease, tools] = await Promise.all([
    latestRelease(APP_REPO),
    latestRelease(YTDLP_REPO),
    getToolStatus(settings.ytdlpPath)
  ])

  const result: UpdateAvailability = { app: null, ytdlp: null }

  const current = app.getVersion()
  if (appRelease && compareVersions(appRelease.version, current) > 0) {
    result.app = { current, latest: appRelease.version, url: appRelease.url }
  }
  if (ytdlpRelease && tools.ytdlpVersion && compareVersions(ytdlpRelease.version, tools.ytdlpVersion) > 0) {
    result.ytdlp = { current: tools.ytdlpVersion, latest: ytdlpRelease.version }
  }

  saveSettings({ lastUpdateCheck: Date.now() })
  return result
}

export function shouldAutoCheck(): boolean {
  const s = loadSettings()
  return s.autoCheckUpdates && Date.now() - s.lastUpdateCheck > AUTO_CHECK_INTERVAL_MS
}
