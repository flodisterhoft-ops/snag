import { ReactNode, useEffect, useState } from 'react'
import type {
  Settings,
  AudioOutputFormat,
  VideoContainer,
  BrowserHandoff
} from '@shared/types'
import { useStore } from '../store'
import { Icon, Segmented, Spinner, Toggle } from '../components/ui'
import { shortPath } from '../lib/format'

const TEMPLATE_PRESETS = [
  { value: '%(title)s', label: 'Title' },
  { value: '%(channel)s - %(title)s', label: 'Channel – Title' },
  { value: '%(upload_date>%Y-%m-%d)s - %(title)s', label: 'Date – Title' }
]

function previewName(tpl: string): string {
  return (
    tpl
      .replace(/%\(title\)s/g, 'Big Buck Bunny')
      .replace(/%\(channel\)s/g, 'Blender')
      .replace(/%\(uploader\)s/g, 'Blender')
      .replace(/%\(upload_date>[^)]*\)s/g, '2008-05-20')
      .replace(/%\(upload_date\)s/g, '20080520')
      .replace(/%\(id\)s/g, 'aqz-KE-bpKQ')
      .replace(/%\([^)]*\)s/g, 'value') + '.mp4'
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="settings-section">
      <h2 className="section-title">{title}</h2>
      <div className="section-body">{children}</div>
    </section>
  )
}

function Row({
  title,
  desc,
  children,
  stacked
}: {
  title: string
  desc?: string
  children: ReactNode
  stacked?: boolean
}): JSX.Element {
  return (
    <div className={`set-row ${stacked ? 'stacked' : ''}`}>
      <div className="set-row-text">
        <span className="set-row-title">{title}</span>
        {desc && <span className="set-row-desc">{desc}</span>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  )
}

export function SettingsScreen(): JSX.Element {
  const { settings, updateSettings, toolStatus, refreshTools, setUpdates } = useStore()
  const [form, setForm] = useState<Settings | null>(settings)
  const [updating, setUpdating] = useState(false)
  const [updateOutput, setUpdateOutput] = useState<string | null>(null)
  // Local editable buffers so in-progress commas/spaces aren't normalized mid-keystroke.
  const [subLangText, setSubLangText] = useState(settings?.subtitles.languages.join(', ') ?? '')
  const [audioLangText, setAudioLangText] = useState(
    settings?.multiAudio.languages.join(', ') ?? ''
  )

  const [extPath, setExtPath] = useState<string | null>(null)
  const [extError, setExtError] = useState<string | null>(null)
  const [extCopied, setExtCopied] = useState(false)

  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)

  useEffect(() => {
    void window.api
      .getBrowserExtensionPath()
      .then(setExtPath)
      .catch((err) => setExtError((err as Error).message || 'Could not inspect the extension folder.'))
  }, [])

  if (!form || !settings) return <div className="screen" />

  const set = (patch: Partial<Settings>): void => {
    setForm((f) => (f ? { ...f, ...patch } : f))
    updateSettings(patch)
  }

  const isCustomTemplate = !TEMPLATE_PRESETS.some((p) => p.value === form.filenameTemplate)
  const maximumSpeedActive =
    form.parallelDownloads === 1 &&
    form.concurrentFragments === 8 &&
    !form.speedLimit.enabled

  const chooseFolder = async (): Promise<void> => {
    const dir = await window.api.pickFolder(form.defaultSaveDir)
    if (dir) set({ defaultSaveDir: dir })
  }

  const installExtension = async (): Promise<void> => {
    setExtError(null)
    try {
      const res = await window.api.installBrowserExtension()
      if (res.ok && res.path) setExtPath(res.path)
      else setExtError(res.error ?? 'Could not copy the extension files.')
    } catch (err) {
      setExtError((err as Error).message || 'Could not copy the extension files.')
    }
  }

  const copyExtPath = async (): Promise<void> => {
    if (!extPath) return
    try {
      await navigator.clipboard.writeText(extPath)
      setExtCopied(true)
      window.setTimeout(() => setExtCopied(false), 1600)
    } catch (err) {
      setExtError((err as Error).message || 'Could not copy the extension path.')
    }
  }

  const checkUpdatesNow = async (): Promise<void> => {
    setChecking(true)
    setCheckResult(null)
    try {
      const res = await window.api.checkForUpdates()
      if (res.app || res.ytdlp) {
        setUpdates(res)
        setCheckResult(
          res.status === 'success'
            ? 'Update found — see the panel in the corner.'
            : `Update found, but another check could not finish. ${res.error ?? ''}`.trim()
        )
      } else if (res.status === 'success') {
        setCheckResult('Everything is up to date.')
      } else {
        setCheckResult(res.error ?? 'Could not complete the update check. Please try again.')
      }
    } catch (err) {
      setCheckResult((err as Error).message || 'Could not check for updates. Please try again.')
    } finally {
      setChecking(false)
    }
  }

  const runUpdate = async (): Promise<void> => {
    setUpdating(true)
    setUpdateOutput(null)
    try {
      const res = await window.api.updateYtdlp()
      setUpdateOutput(res.output || (res.ok ? 'Up to date.' : 'Update failed.'))
      await refreshTools()
    } catch (err) {
      setUpdateOutput((err as Error).message || 'Update failed.')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="screen settings">
      <header className="screen-head">
        <h1 className="screen-title">Settings</h1>
        <p className="screen-desc">Defaults and behavior for every download.</p>
      </header>

      <Section title="Downloads">
        <Row
          title="Maximum speed"
          desc="Focus on one video with up to 8 parallel fragments when the site supports them"
        >
          <button
            className={maximumSpeedActive ? 'btn-accent' : 'btn-outline'}
            onClick={() =>
              set({
                parallelDownloads: 1,
                concurrentFragments: 8,
                speedLimit: { ...form.speedLimit, enabled: false }
              })
            }
          >
            <Icon name={maximumSpeedActive ? 'check' : 'sparkle'} size={15} />
            {maximumSpeedActive ? 'Active' : 'Use preset'}
          </button>
        </Row>
        <Row title="Default save folder" desc={form.defaultSaveDir} stacked>
          <button className="btn-outline" onClick={chooseFolder}>
            <Icon name="folder" size={15} /> Choose folder
          </button>
        </Row>
        <Row title="Parallel downloads" desc="How many downloads run at once">
          <Segmented
            size="sm"
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
              { value: '4', label: '4' }
            ]}
            value={String(form.parallelDownloads)}
            onChange={(v) => set({ parallelDownloads: Number(v) })}
          />
        </Row>
        <Row
          title="Connection boost"
          desc="Parallel fragments for DASH/HLS downloads — other streams may not get faster"
        >
          <Segmented
            size="sm"
            options={[
              { value: '1', label: 'Normal' },
              { value: '4', label: 'Fast' },
              { value: '8', label: 'Turbo' },
              { value: '16', label: 'Max' }
            ]}
            value={String(form.concurrentFragments)}
            onChange={(v) => set({ concurrentFragments: Number(v) })}
          />
        </Row>
        <Row title="Speed limit" desc="Cap total bandwidth so downloads don't hog your connection">
          <div className="speed-control">
            <Toggle
              checked={form.speedLimit.enabled}
              onChange={(v) => set({ speedLimit: { ...form.speedLimit, enabled: v } })}
              label="Speed limit"
            />
            {form.speedLimit.enabled && (
              <>
                <input
                  className="num-input"
                  type="number"
                  min={1}
                  value={form.speedLimit.value}
                  onChange={(e) =>
                    set({
                      speedLimit: { ...form.speedLimit, value: Math.max(1, Number(e.target.value) || 1) }
                    })
                  }
                />
                <Segmented
                  size="sm"
                  options={[
                    { value: 'K', label: 'KB/s' },
                    { value: 'M', label: 'MB/s' }
                  ]}
                  value={form.speedLimit.unit}
                  onChange={(v) => set({ speedLimit: { ...form.speedLimit, unit: v as 'K' | 'M' } })}
                />
              </>
            )}
          </div>
        </Row>
        <Row title="Finished notifications" desc="Get a desktop toast when a download completes">
          <Toggle
            checked={form.notificationsEnabled}
            onChange={(v) => set({ notificationsEnabled: v })}
            label="Finished notifications"
          />
        </Row>
      </Section>

      <Section title="File names">
        <Row title="Naming pattern" stacked>
          <div className="template-picker">
            <Segmented
              size="sm"
              options={[
                ...TEMPLATE_PRESETS.map((p) => ({ value: p.value, label: p.label })),
                { value: '__custom__', label: 'Custom' }
              ]}
              value={isCustomTemplate ? '__custom__' : form.filenameTemplate}
              onChange={(v) => {
                if (v !== '__custom__') set({ filenameTemplate: v })
                else if (!isCustomTemplate) set({ filenameTemplate: form.filenameTemplate + ' ' })
              }}
            />
            {isCustomTemplate && (
              <input
                className="text-input mono"
                value={form.filenameTemplate}
                spellCheck={false}
                onChange={(e) => set({ filenameTemplate: e.target.value })}
                placeholder="%(title)s"
              />
            )}
            <div className="template-preview">
              <span className="pv-label">Preview</span>
              <code>{previewName(form.filenameTemplate)}</code>
            </div>
          </div>
        </Row>
      </Section>

      <Section title="Format defaults">
        <Row title="Preferred video container">
          <Segmented
            size="sm"
            options={[
              { value: 'mp4', label: 'MP4' },
              { value: 'mkv', label: 'MKV' },
              { value: 'webm', label: 'WebM' }
            ]}
            value={form.preferredVideoContainer}
            onChange={(v) => set({ preferredVideoContainer: v as VideoContainer })}
          />
        </Row>
        <Row title="Preferred audio format">
          <div className="select-wrap">
            <select
              value={form.preferredAudioFormat}
              onChange={(e) => set({ preferredAudioFormat: e.target.value as AudioOutputFormat })}
            >
              <option value="mp3">MP3</option>
              <option value="m4a">M4A (AAC)</option>
              <option value="opus">Opus</option>
              <option value="wav">WAV</option>
              <option value="flac">FLAC</option>
              <option value="best">Original</option>
            </select>
            <Icon name="chevron" size={16} />
          </div>
        </Row>
      </Section>

      <Section title="Audio languages">
        <Row
          title="Download all my languages"
          desc="When a video offers multiple audio languages (like YouTube dubs), include every language below as a switchable track in the file"
        >
          <Toggle
            checked={form.multiAudio.enabled}
            onChange={(v) => set({ multiAudio: { ...form.multiAudio, enabled: v } })}
            label="Download all my languages"
          />
        </Row>
        <Row
          title="Favorite languages"
          desc="Shown first in the picker, in this order. Use language codes such as en, de."
          stacked
        >
            <input
              className="text-input mono"
              value={audioLangText}
              spellCheck={false}
              onChange={(e) => setAudioLangText(e.target.value)}
              onBlur={() =>
                set({
                  multiAudio: {
                    ...form.multiAudio,
                    languages: audioLangText
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  }
                })
              }
              placeholder="en, de"
            />
        </Row>
      </Section>

      <Section title="Extras">
        <Row title="Embed cover art in audio" desc="Add the thumbnail as album art (MP3/M4A)">
          <Toggle
            checked={form.embedThumbnail}
            onChange={(v) => set({ embedThumbnail: v })}
            label="Embed cover art in audio"
          />
        </Row>
        <Row title="Embed metadata" desc="Write title, artist, and date into the file">
          <Toggle
            checked={form.embedMetadata}
            onChange={(v) => set({ embedMetadata: v })}
            label="Embed metadata"
          />
        </Row>
        <Row title="Subtitles by default" desc="Preselect subtitle download when available">
          <Toggle
            checked={form.subtitles.enabled}
            onChange={(v) => set({ subtitles: { ...form.subtitles, enabled: v } })}
            label="Subtitles by default"
          />
        </Row>
        {form.subtitles.enabled && (
          <Row title="Default subtitle languages" desc="Comma-separated codes, e.g. en, es" stacked>
            <input
              className="text-input mono"
              value={subLangText}
              spellCheck={false}
              onChange={(e) => setSubLangText(e.target.value)}
              onBlur={() =>
                set({
                  subtitles: {
                    ...form.subtitles,
                    languages: subLangText
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  }
                })
              }
              placeholder="en, es"
            />
          </Row>
        )}
      </Section>

      <Section title="Browser integration">
        <Row title="Handoff from the browser" desc="What a click on the Snag button in Chrome opens">
          <Segmented
            size="sm"
            options={[
              { value: 'quick', label: 'Quick dialog' },
              { value: 'main', label: 'Full app' }
            ]}
            value={form.browserHandoff}
            onChange={(v) => set({ browserHandoff: v as BrowserHandoff })}
          />
        </Row>
        <Row
          title="Keep running in background"
          desc="Stay in the tray when all windows close so downloads keep going"
        >
          <Toggle
            checked={form.runInBackground}
            onChange={(v) => set({ runInBackground: v })}
            label="Keep running in background"
          />
        </Row>
        <Row
          title="Start with Windows"
          desc="Snag waits in the tray after login, so the quick popup opens instantly"
        >
          <Toggle
            checked={form.launchAtLogin}
            onChange={(v) => set({ launchAtLogin: v })}
            label="Start with Windows"
          />
        </Row>
        <Row
          title="Chrome extension"
          desc="Adds a translucent button and an in-video picker; Chrome requires one manual setup"
          stacked
        >
          <div className="ext-install">
            <button className="btn-outline" onClick={installExtension}>
              <Icon name="download" size={15} />
              {extPath ? 'Refresh extension folder' : 'Prepare extension folder'}
            </button>
            {extError && <span className="ext-error">{extError}</span>}
            {extPath && (
              <div className="ext-steps fade-up">
                <div className="ext-path-row">
                  <code title={extPath}>{shortPath(extPath, 52)}</code>
                  <button className="btn-mini" onClick={copyExtPath}>
                    {extCopied ? 'Copied!' : 'Copy path'}
                  </button>
                </div>
                <ol>
                  <li>
                    Open <code>chrome://extensions</code> in Chrome
                  </li>
                  <li>
                    Turn on <strong>Developer mode</strong> (top-right corner)
                  </li>
                  <li>
                    First installation: click <strong>Load unpacked</strong> and pick the folder
                    above. After a Snag update, click <strong>Reload</strong> on its extension card;
                    it reconnects to Snag automatically
                  </li>
                  <li>
                    Keep Snag running in the tray so the in-video picker opens instantly
                  </li>
                  <li>Reload any video tabs that were already open</li>
                </ol>
                <span className="set-row-desc">
                  The overlay appears on large HTML5 videos. Browser-internal pages, DRM players,
                  and sites unsupported by yt-dlp may not work.
                </span>
              </div>
            )}
          </div>
        </Row>
      </Section>

      <Section title="Engine">
        <Row
          title="yt-dlp"
          desc={
            toolStatus?.ytdlpFound
              ? `${toolStatus.ytdlpVersion ? 'v' + toolStatus.ytdlpVersion : 'found'} · ${shortPath(
                  toolStatus.ytdlpPath,
                  44
                )}`
              : 'Not found on your system'
          }
        >
          <button className="btn-outline" onClick={runUpdate} disabled={updating || !toolStatus?.ytdlpFound}>
            {updating ? <Spinner size={14} /> : <Icon name="retry" size={14} />}
            {updating ? 'Updating…' : 'Update'}
          </button>
        </Row>
        {updateOutput && <pre className="update-output">{updateOutput}</pre>}
        <Row
          title="ffmpeg"
          desc={
            toolStatus?.ffmpegFound
              ? shortPath(toolStatus.ffmpegPath, 50)
              : 'Not found — needed for merging & audio conversion'
          }
        >
          <span className={`status-pill ${toolStatus?.ffmpegFound ? 'ok' : 'bad'}`}>
            {toolStatus?.ffmpegFound ? 'Ready' : 'Missing'}
          </span>
        </Row>
        <Row title="Custom yt-dlp path" desc="Override the executable location (leave blank for auto)" stacked>
          <input
            className="text-input mono"
            value={form.ytdlpPath ?? ''}
            spellCheck={false}
            placeholder="auto-detected"
            onChange={(e) => set({ ytdlpPath: e.target.value.trim() || null })}
            onBlur={() => refreshTools()}
          />
        </Row>
      </Section>

      <Section title="Updates">
        <Row
          title="Check for updates automatically"
          desc="Look for new Snag and yt-dlp releases about once a day"
        >
          <Toggle
            checked={form.autoCheckUpdates}
            onChange={(v) => set({ autoCheckUpdates: v })}
            label="Check for updates automatically"
          />
        </Row>
        <Row title="Check now" desc={checkResult ?? 'Compare against the latest GitHub releases'}>
          <button className="btn-outline" onClick={checkUpdatesNow} disabled={checking}>
            {checking ? <Spinner size={14} /> : <Icon name="retry" size={14} />}
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
        </Row>
      </Section>
    </div>
  )
}
