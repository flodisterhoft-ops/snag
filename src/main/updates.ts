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

interface ReleaseInfo {
  version: string
  url: string
  notes: string | null
}

export type ReleaseLookup =
  | { ok: true; release: ReleaseInfo }
  | { ok: false; error: string }

export async function latestRelease(repo: string): Promise<ReleaseLookup> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Snag-update-check' },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) {
      return { ok: false, error: `GitHub returned HTTP ${res.status} for ${repo}.` }
    }
    const data = (await res.json()) as { tag_name?: string; html_url?: string; body?: string }
    if (!data.tag_name) {
      return { ok: false, error: `GitHub returned an invalid release response for ${repo}.` }
    }
    return {
      ok: true,
      release: {
        version: data.tag_name.replace(/^v/i, ''),
        url: data.html_url ?? `https://github.com/${repo}/releases/latest`,
        notes: typeof data.body === 'string' && data.body.trim() ? data.body.trim().slice(0, 5000) : null
      }
    }
  } catch (err) {
    const detail = err instanceof Error && err.name === 'TimeoutError' ? 'request timed out' : 'network request failed'
    return { ok: false, error: `Could not check ${repo}: ${detail}.` }
  }
}

export async function checkForUpdates(): Promise<UpdateAvailability> {
  const settings = loadSettings()
  const [appLookup, ytdlpLookup, toolsResult] = await Promise.all([
    latestRelease(APP_REPO),
    latestRelease(YTDLP_REPO),
    getToolStatus(settings.ytdlpPath)
      .then((tools) => ({ ok: true as const, tools }))
      .catch(() => ({ ok: false as const }))
  ])

  const errors: string[] = []
  if (!appLookup.ok) errors.push(appLookup.error)
  if (!ytdlpLookup.ok) errors.push(ytdlpLookup.error)
  const hasInstalledYtdlpVersion = toolsResult.ok && !!toolsResult.tools.ytdlpVersion
  if (!hasInstalledYtdlpVersion) errors.push('Could not determine the installed yt-dlp version.')

  const failedChecks =
    Number(!appLookup.ok) + Number(!ytdlpLookup.ok || !hasInstalledYtdlpVersion)
  const status: UpdateAvailability['status'] =
    failedChecks === 0 ? 'success' : failedChecks === 2 ? 'error' : 'partial'
  const result: UpdateAvailability = {
    status,
    app: null,
    ytdlp: null,
    error: errors.length ? errors.join(' ') : null
  }

  const current = app.getVersion()
  const appRelease = appLookup.ok ? appLookup.release : null
  const ytdlpRelease = ytdlpLookup.ok ? ytdlpLookup.release : null
  const tools = toolsResult.ok ? toolsResult.tools : null
  if (appRelease && compareVersions(appRelease.version, current) > 0) {
    result.app = { current, latest: appRelease.version, url: appRelease.url, notes: appRelease.notes }
  }
  if (ytdlpRelease && tools?.ytdlpVersion && compareVersions(ytdlpRelease.version, tools.ytdlpVersion) > 0) {
    result.ytdlp = { current: tools.ytdlpVersion, latest: ytdlpRelease.version }
  }

  // Offline/rate-limited/partial checks remain immediately retryable.
  if (status === 'success') saveSettings({ lastUpdateCheck: Date.now() })
  return result
}

export function shouldAutoCheck(): boolean {
  const s = loadSettings()
  return s.autoCheckUpdates && Date.now() - s.lastUpdateCheck > AUTO_CHECK_INTERVAL_MS
}
