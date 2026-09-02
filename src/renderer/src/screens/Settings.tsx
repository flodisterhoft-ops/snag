import { ReactNode, useCallback, useEffect, useState } from 'react'
import type {
  Settings,
  AudioOutputFormat,
  VideoContainer,
  BrowserHandoff,
  BrowserExtensionStatus,
  CookieSource,
  CookieStatus,
  GlobalShortcutStatus,
  SettingsSection,
  SponsorBlockCategory,
  ShareTarget,
  DownloadEngine,
  Player,
  Theme
} from '@shared/types'
import { SPONSORBLOCK_CATEGORIES } from '@shared/types'
import { useStore } from '../store'
import { AppIcon, Icon, IconName, Segmented, Spinner, Toggle } from '../components/ui'
import { ExtensionSetup } from '../components/ExtensionSetup'
import { relativeTime, shortPath } from '../lib/format'

const TEMPLATE_PRESETS = [
  { value: '%(title)s', label: 'Title' },
  { value: '%(channel)s - %(title)s', label: 'Channel – Title' },
  { value: '%(upload_date>%Y-%m-%d)s - %(title)s', label: 'Date – Title' }
]

// Common audio-dub languages offered as pills. Order here is only the display
// order; the saved array records the user's own preference order.
const AUDIO_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
  { code: 'ru', label: 'Russian' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'id', label: 'Indonesian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'pl', label: 'Polish' },
  { code: 'nl', label: 'Dutch' }
]

// One tab per concern, so nothing needs a long scroll.
const TABS: { id: SettingsSection; label: string; icon: IconName; desc: string }[] = [
  { id: 'general', label: 'General', icon: 'settings', desc: 'Where files go and how Snag behaves' },
  { id: 'speed', label: 'Speed', icon: 'sparkle', desc: 'Parallel downloads, connection boost, bandwidth cap' },
  { id: 'files', label: 'Files', icon: 'folder', desc: 'File names, containers, formats, and embedded extras' },
  { id: 'languages', label: 'Languages', icon: 'audio', desc: 'Audio tracks and subtitles' },
  { id: 'browser', label: 'Browser', icon: 'open', desc: 'Chrome extension and browser handoff' },
  { id: 'engine', label: 'Engine', icon: 'retry', desc: 'yt-dlp, ffmpeg, and updates' }
]

const baseCode = (code: string): string => code.toLowerCase().split('-')[0]

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

function Section({ title, children }: { title?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="settings-section">
      {title && <h2 className="section-title">{title}</h2>}
      <div className="section-body">{children}</div>
    </section>
  )
}

// A settings row whose value is a set of language pills; clicking one opens a
// drawer with every language below the row. `collapseOnPick` closes it after
// one choice (default subtitle language); otherwise it stays open so several
// languages can be picked in order.
function LanguageRow({
  title,
  desc,
  selected,
  onToggle,
  open,
  setOpen,
  collapseOnPick,
  className
}: {
  title: string
  desc: string
  selected: string[]
  onToggle: (code: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  collapseOnPick: boolean
  className?: string
}): JSX.Element {
  const labelFor = (code: string): string =>
    AUDIO_LANGUAGES.find((l) => l.code === baseCode(code))?.label ?? code.toUpperCase()
  return (
    <>
      <Row title={title} desc={desc} className={`${open ? 'open' : ''} ${className ?? ''}`}>
        <div className="sub-lang-chips">
          {selected.length === 0 && (
            <button className="chip chip-sm chip-more" onClick={() => setOpen(!open)}>
              Choose…
            </button>
          )}
          {selected.map((code) => (
            <button
              key={code}
              className="chip chip-sm active"
              title="Change"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {labelFor(code)}
              <Icon name="chevron" size={13} />
            </button>
          ))}
        </div>
      </Row>
      {open && (
        <div className="lang-drawer">
          {AUDIO_LANGUAGES.map((l, i) => {
            const on = selected.some((c) => baseCode(c) === l.code)
            return (
              <button
                key={l.code}
                className={`chip chip-sm ${on ? 'active' : ''}`}
                style={{ animationDelay: `${i * 18}ms` }}
                onClick={() => {
                  onToggle(l.code)
                  if (collapseOnPick) setOpen(false)
                }}
              >
                {l.label}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

function Row({
  title,
  desc,
  children,
  stacked,
  className
}: {
  title: string
  desc?: string
  children: ReactNode
  stacked?: boolean
  className?: string
}): JSX.Element {
  return (
    <div className={`set-row ${stacked ? 'stacked' : ''} ${className ?? ''}`}>
      <div className="set-row-text">
        <span className="set-row-title">{title}</span>
        {desc && <span className="set-row-desc">{desc}</span>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  )
}

export function SettingsScreen(): JSX.Element {
  const {
    settings,
    updateSettings,
    toolStatus,
    refreshTools,
    setUpdates,
    settingsSection,
    setSettingsSection,
    shareInfo
  } = useStore()
  const [form, setForm] = useState<Settings | null>(settings)
  // Settings can change behind this screen (the Chrome panel saves audio
  // languages through the local API); mirror them so the form never goes stale.
  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])

  const [updating, setUpdating] = useState(false)
  const [updateOutput, setUpdateOutput] = useState<string | null>(null)
  // Local editable buffer so in-progress commas/spaces aren't normalized mid-keystroke.
  // The language drawers under their rows (pills slide in from the right).
  const [subDrawerOpen, setSubDrawerOpen] = useState(false)
  const [audioDrawerOpen, setAudioDrawerOpen] = useState(false)

  // Free-text fields keep a local buffer and commit on blur, so typing a space
  // or clearing the field is never normalized away mid-keystroke.
  const [ytdlpText, setYtdlpText] = useState(settings?.ytdlpPath ?? '')
  const [speedText, setSpeedText] = useState(String(settings?.speedLimit.value ?? 5))
  const [customTemplate, setCustomTemplate] = useState(
    !!settings && !TEMPLATE_PRESETS.some((p) => p.value === settings.filenameTemplate)
  )

  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)
  const [shortcut, setShortcut] = useState<GlobalShortcutStatus | null>(null)

  useEffect(() => {
    void window.api.getGlobalShortcutStatus().then(setShortcut).catch(() => {})
  }, [settings?.globalShortcutEnabled])

  if (!form || !settings) return <div className="screen" />

  const sponsorMode = (category: SponsorBlockCategory): 'keep' | 'mark' | 'cut' =>
    form.sponsorBlock.remove.includes(category)
      ? 'cut'
      : form.sponsorBlock.mark.includes(category)
        ? 'mark'
        : 'keep'
  const setSponsorMode = (category: SponsorBlockCategory, mode: 'keep' | 'mark' | 'cut'): void => {
    const remove = form.sponsorBlock.remove.filter((c) => c !== category)
    const mark = form.sponsorBlock.mark.filter((c) => c !== category)
    if (mode === 'cut') remove.push(category)
    if (mode === 'mark') mark.push(category)
    set({ sponsorBlock: { remove, mark } })
  }

  const set = (patch: Partial<Settings>): void => {
    setForm((f) => (f ? { ...f, ...patch } : f))
    updateSettings(patch)
  }

  const commitYtdlpPath = (): void => {
    const next = ytdlpText.trim() || null
    if (next !== form.ytdlpPath) set({ ytdlpPath: next })
    void refreshTools()
  }

  const commitSpeedLimit = (): void => {
    const value = Math.max(1, Math.round(Number(speedText) || form.speedLimit.value))
    setSpeedText(String(value))
    if (value !== form.speedLimit.value) set({ speedLimit: { ...form.speedLimit, value } })
  }

  const commitTemplate = (): void => {
    if (!form.filenameTemplate.trim()) set({ filenameTemplate: TEMPLATE_PRESETS[0].value })
  }

  const audioLangs = form.multiAudio.languages
  const audioBaseSet = new Set(audioLangs.map(baseCode))
  const toggleAudioLang = (code: string): void => {
    const base = baseCode(code)
    const next = audioBaseSet.has(base)
      ? audioLangs.filter((l) => baseCode(l) !== base)
      : [...audioLangs, code]
    set({ multiAudio: { ...form.multiAudio, languages: next } })
  }

  const isCustomTemplate =
    customTemplate || !TEMPLATE_PRESETS.some((p) => p.value === form.filenameTemplate)

  const setShareTarget = (id: string, patch: Partial<ShareTarget>): void => {
    set({ shareTargets: form.shareTargets.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  }

  const addShareApp = async (): Promise<void> => {
    const picked = await window.api.pickShareApp()
    if (!picked) return
    const id = `custom_${Date.now().toString(36)}`
    set({ shareTargets: [...form.shareTargets, { id, kind: 'custom', label: picked.label, path: picked.path, enabled: true }] })
  }

  const chooseFolder = async (): Promise<void> => {
    const dir = await window.api.pickFolder(form.defaultSaveDir)
    if (dir) set({ defaultSaveDir: dir })
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

  const activeTab = TABS.find((t) => t.id === settingsSection) ?? TABS[0]

  return (
    <div className="screen settings">
      <header className="screen-head">
        <h1 className="screen-title">Settings</h1>
        <p className="screen-desc">{activeTab.desc}</p>
      </header>

      <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTab.id}
            className={`settings-tab ${tab.id === activeTab.id ? 'active' : ''}`}
            onClick={() => setSettingsSection(tab.id)}
          >
            <Icon name={tab.icon} size={15} />
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab.id === 'general' && (
        <>
        <Section>
          <Row title="Default save folder" desc={form.defaultSaveDir}>
            <button className="btn-outline" onClick={chooseFolder}>
              <Icon name="folder" size={15} /> Choose folder
            </button>
          </Row>
          <Row title="Finished notifications" desc="Get a desktop toast when a download completes">
            <Toggle
              checked={form.notificationsEnabled}
              onChange={(v) => set({ notificationsEnabled: v })}
              label="Finished notifications"
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
          <Row title="Appearance" desc="Follow Windows, or pick dark or light">
            <Segmented
              size="sm"
              options={[
                { value: 'system', label: 'System' },
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' }
              ]}
              value={form.theme}
              onChange={(v) => set({ theme: v as Theme })}
            />
          </Row>
          <Row
            title="Watch the clipboard"
            desc="While Snag is open, a copied link is offered on the Download screen and video links are analyzed ahead of time"
          >
            <Toggle
              checked={form.watchClipboard}
              onChange={(v) => set({ watchClipboard: v })}
              label="Watch the clipboard"
            />
          </Row>
          <Row
            title="Global shortcut"
            desc={
              form.globalShortcutEnabled && shortcut && !shortcut.registered
                ? 'Ctrl+Shift+D is taken by another program; Snag could not claim it'
                : 'Ctrl+Shift+D anywhere: analyze the link on the clipboard, or bring Snag to the front'
            }
          >
            <Toggle
              checked={form.globalShortcutEnabled}
              onChange={(v) => set({ globalShortcutEnabled: v })}
              label="Global shortcut"
            />
          </Row>
        </Section>

        <Section title="Sharing & playback">
          <Row
            title="Share with"
            desc="The apps offered by every Share button. Switch off the ones you never use; add any program that opens a file you hand it."
            stacked
          >
            <div className="share-cards">
              {form.shareTargets.map((t) => {
                const status = shareInfo?.targets.find((x) => x.id === t.id)
                const missing = !!status && !status.installed
                const hint =
                  t.kind === 'custom'
                    ? t.path ?? ''
                    : t.kind === 'windows'
                      ? 'Phone Link, Bluetooth, Mail, WhatsApp and every other share target on this PC'
                      : 'Opens a Telegram chat with the file attached'
                return (
                  <div
                    key={t.id}
                    className={`share-card ${missing ? 'missing' : ''} ${t.enabled && !missing ? 'on' : ''}`}
                    title={missing ? `${t.label} is not installed` : hint}
                  >
                    <AppIcon kind={t.kind} icon={status?.icon} size={24} />
                    <span className="share-card-name">{t.label}</span>
                    {missing ? (
                      <span className="share-card-status">Not installed</span>
                    ) : (
                      <Toggle checked={t.enabled} onChange={(v) => setShareTarget(t.id, { enabled: v })} label={t.label} />
                    )}
                    {t.kind === 'custom' && (
                      <button
                        className="icon-btn share-card-remove"
                        title="Remove"
                        onClick={() => set({ shareTargets: form.shareTargets.filter((x) => x.id !== t.id) })}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
              <button className="share-card add" title="Any program that takes a file" onClick={() => void addShareApp()}>
                <AppIcon kind="add" size={24} />
                <span className="share-card-name">Add an app</span>
              </button>
            </div>
          </Row>
          <Row title="Ask which app every time" desc="Off: the Share buttons use the first app straight away">
            <Toggle checked={form.shareAsk} onChange={(v) => set({ shareAsk: v })} label="Ask which app every time" />
          </Row>
          <Row
            title="Player"
            desc={
              shareInfo?.vlcFound
                ? 'What the Play buttons and “Open when done” open the file with.'
                : 'VLC was not found on this PC, so files open in the Windows default player.'
            }
          >
            {shareInfo?.vlcFound ? (
              <Segmented
                size="sm"
                options={[
                  { value: 'vlc', label: 'VLC', hint: 'Plays anything, including MKV with several audio tracks.' },
                  { value: 'system', label: 'Windows player', hint: 'Whatever Windows associates with the file type.' }
                ]}
                value={form.player}
                onChange={(v) => set({ player: v as Player })}
              />
            ) : (
              <span className="status-pill neutral">Windows player</span>
            )}
          </Row>
        </Section>
        </>
      )}

      {activeTab.id === 'speed' && (
        <Section>
          <Row
            title="Download engine"
            desc={
              toolStatus?.aria2cFound
                ? 'Built-in is the right choice for YouTube and most sites. aria2 opens many connections to one file, which only helps on sites that slow each connection down (Vimeo, X, direct links).'
                : 'Built-in is the right choice for YouTube and most sites. aria2 was not found on this PC.'
            }
          >
            <Segmented
              size="sm"
              options={[
                {
                  value: 'native',
                  label: 'Built-in',
                  recommended: true,
                  hint: "yt-dlp's own downloader. Fast on YouTube, works everywhere."
                },
                { value: 'aria2', label: 'aria2', hint: 'Many connections per file. For sites that cap each connection.' }
              ]}
              value={toolStatus?.aria2cFound ? form.downloadEngine : 'native'}
              onChange={(v) => set({ downloadEngine: v as DownloadEngine })}
            />
          </Row>
          <Row title="Parallel downloads" desc="How many videos download at the same time">
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
            desc="How many pieces of one video are fetched at the same time. YouTube slows down every single connection, so Turbo or Max is what makes a fast line fast. Sites that hand out one plain file do not get faster."
          >
            <div className="boost-control">
              <span className="lanes">
                {form.concurrentFragments} {form.concurrentFragments === 1 ? 'connection' : 'connections'}
              </span>
              <Segmented
                size="sm"
                options={[
                  { value: '1', label: 'Normal', hint: '1 connection' },
                  { value: '4', label: 'Fast', hint: '4 connections' },
                  { value: '8', label: 'Turbo', hint: '8 connections' },
                  { value: '16', label: 'Max', hint: '16 connections (recommended for YouTube)' }
                ]}
                value={String(form.concurrentFragments)}
                onChange={(v) => set({ concurrentFragments: Number(v) })}
              />
            </div>
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
                    value={speedText}
                    onChange={(e) => setSpeedText(e.target.value)}
                    onBlur={commitSpeedLimit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                    aria-label="Speed limit value"
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
        </Section>
      )}

      {activeTab.id === 'files' && (
        <>
          <Section title="File names">
            <Row title="Naming pattern" desc="How finished files are named; the preview uses a sample video." stacked>
              <div className={`template-picker ${isCustomTemplate ? 'custom' : ''}`}>
                <Segmented
                  size="sm"
                  options={[
                    ...TEMPLATE_PRESETS.map((p) => ({ value: p.value, label: p.label })),
                    { value: '__custom__', label: 'Custom' }
                  ]}
                  value={isCustomTemplate ? '__custom__' : form.filenameTemplate}
                  onChange={(v) => {
                    if (v === '__custom__') {
                      setCustomTemplate(true)
                    } else {
                      setCustomTemplate(false)
                      set({ filenameTemplate: v })
                    }
                  }}
                />
                {isCustomTemplate && (
                  <input
                    className="text-input mono"
                    value={form.filenameTemplate}
                    spellCheck={false}
                    onChange={(e) => set({ filenameTemplate: e.target.value })}
                    onBlur={commitTemplate}
                    placeholder="%(title)s"
                    aria-label="Custom file name pattern"
                  />
                )}
                <div className="template-preview" title={previewName(form.filenameTemplate)}>
                  <span className="pv-label">Preview</span>
                  <code>{previewName(form.filenameTemplate)}</code>
                </div>
              </div>
            </Row>
          </Section>

          <Section title="Formats">
            <Row
              title="Preferred video container"
              desc="MP4 plays everywhere (phones, TVs, editors). MKV holds any codec and several audio tracks, so dubs need it. WebM is the open format for VP9 and AV1."
            >
              <Segmented
                size="sm"
                options={[
                  { value: 'mp4', label: 'MP4', recommended: true, hint: 'Plays everywhere. Best default.' },
                  { value: 'mkv', label: 'MKV', hint: 'Any codec, several audio tracks and subtitles in one file.' },
                  { value: 'webm', label: 'WebM', hint: 'Open format for VP9/AV1. Browsers and most players.' }
                ]}
                value={form.preferredVideoContainer}
                onChange={(v) => set({ preferredVideoContainer: v as VideoContainer })}
              />
            </Row>
            <Row
              title="Preferred audio format"
              desc="MP3 plays everywhere. M4A sounds the same at smaller size. Opus is the smallest. WAV and FLAC are lossless and large. Original keeps the source track without re-encoding."
            >
              <Segmented
                size="sm"
                options={[
                  { value: 'mp3', label: 'MP3', recommended: true, hint: 'Plays everywhere.' },
                  { value: 'm4a', label: 'M4A', hint: 'AAC. Same quality as MP3 at a smaller size; Apple-friendly.' },
                  { value: 'opus', label: 'Opus', hint: 'Smallest files; modern players only.' },
                  { value: 'wav', label: 'WAV', hint: 'Lossless, uncompressed, very large.' },
                  { value: 'flac', label: 'FLAC', hint: 'Lossless, compressed, large.' },
                  { value: 'best', label: 'Original', hint: 'Keeps the source track as is, no re-encoding.' }
                ]}
                value={form.preferredAudioFormat}
                onChange={(v) => set({ preferredAudioFormat: v as AudioOutputFormat })}
              />
            </Row>
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
          </Section>

          <Section title="SponsorBlock">
            <Row
              title="Skip community-marked segments"
              desc="SponsorBlock crowdsources where sponsors, intros, and similar parts are in YouTube videos. Cut removes a segment from the file; Mark keeps it and adds a chapter so players can skip it."
              stacked
            >
              <div className="sponsor-grid">
                {SPONSORBLOCK_CATEGORIES.map((category) => (
                  <div key={category.id} className="sponsor-row">
                    <div className="set-row-text">
                      <span className="set-row-title">{category.label}</span>
                      <span className="set-row-desc">{category.hint}</span>
                    </div>
                    <Segmented
                      size="sm"
                      options={[
                        { value: 'keep', label: 'Keep' },
                        { value: 'mark', label: 'Mark' },
                        { value: 'cut', label: 'Cut' }
                      ]}
                      value={sponsorMode(category.id)}
                      onChange={(v) => setSponsorMode(category.id, v as 'keep' | 'mark' | 'cut')}
                    />
                  </div>
                ))}
              </div>
            </Row>
          </Section>
        </>
      )}

      {activeTab.id === 'languages' && (
        <>
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
            <LanguageRow
              title="Preferred languages"
              desc="Downloaded and merged as switchable tracks whenever a video offers them, in the order you pick them."
              selected={audioLangs}
              onToggle={toggleAudioLang}
              open={audioDrawerOpen}
              setOpen={setAudioDrawerOpen}
              collapseOnPick={false}
            />
          </Section>

          <Section title="Subtitles">
            <Row title="Subtitles by default" desc="Preselect subtitle download when available">
              <Toggle
                checked={form.subtitles.enabled}
                onChange={(v) => set({ subtitles: { ...form.subtitles, enabled: v } })}
                label="Subtitles by default"
              />
            </Row>
            {form.subtitles.enabled && (
              <LanguageRow
                title="Default subtitle language"
                desc="Preselected whenever a video offers it"
                selected={form.subtitles.languages}
                onToggle={(code) => {
                  const on = form.subtitles.languages.some((c) => baseCode(c) === code)
                  const next = on
                    ? form.subtitles.languages.filter((c) => baseCode(c) !== code)
                    : [...form.subtitles.languages, code]
                  set({ subtitles: { ...form.subtitles, languages: next } })
                }}
                open={subDrawerOpen}
                setOpen={setSubDrawerOpen}
                collapseOnPick
              />
            )}
          </Section>
        </>
      )}

      {activeTab.id === 'browser' && (
        <>
          <Section title="Chrome extension">
            <Row
              title="Download button on videos"
              desc="Adds a Snag button to video players in Chrome, Edge, or Brave, with the quality picker right in the page"
              stacked
            >
              <ExtensionSetup />
            </Row>
            <ExtensionAdvanced />
          </Section>
          <SignInSection form={form} set={set} />

          <Section title="Handoff">
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
          </Section>
        </>
      )}

      {activeTab.id === 'engine' && (
        <>
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
              <button
                className="btn-outline"
                onClick={runUpdate}
                disabled={updating || !toolStatus?.ytdlpFound}
              >
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
            <Row
              title="Custom yt-dlp path"
              desc="Override the executable location (leave blank for auto)"
              stacked
            >
              <input
                className="text-input mono"
                value={ytdlpText}
                spellCheck={false}
                placeholder="auto-detected"
                onChange={(e) => setYtdlpText(e.target.value)}
                onBlur={commitYtdlpPath}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                aria-label="Custom yt-dlp path"
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
            <Row
              title="Update yt-dlp by itself"
              desc="Sites change weekly; apply yt-dlp releases quietly in the background instead of asking (waits until no download is running)"
            >
              <Toggle
                checked={form.autoUpdateYtdlp}
                onChange={(v) => set({ autoUpdateYtdlp: v })}
                label="Update yt-dlp by itself"
              />
            </Row>
            <Row title="Check now" desc={checkResult ?? 'Compare against the latest GitHub releases'}>
              <button className="btn-outline" onClick={checkUpdatesNow} disabled={checking}>
                {checking ? <Spinner size={14} /> : <Icon name="retry" size={14} />}
                {checking ? 'Checking…' : 'Check for updates'}
              </button>
            </Row>
          </Section>
        </>
      )}
    </div>
  )
}

// Folder path, manual repair, and the raw heartbeat — hidden behind a
// disclosure because the one-button setup above covers the normal case.
function ExtensionAdvanced(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<BrowserExtensionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setStatus(await window.api.getBrowserExtensionStatus())
    } catch (err) {
      setError((err as Error).message || 'Could not inspect the extension folder.')
    }
  }, [])

  useEffect(() => {
    if (!open) return
    let active = true
    const load = (): void => {
      if (active) void refresh()
    }
    load()
    const timer = window.setInterval(load, 6000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [open, refresh])

  const repair = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const res = await window.api.installBrowserExtension()
      if (!res.ok) setError(res.error ?? 'Could not copy the extension files.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const copyPath = async (): Promise<void> => {
    if (!status?.path) return
    await window.api.copyText(status.path)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const reveal = async (): Promise<void> => {
    setError((await window.api.revealBrowserExtensionFolder()) || null)
  }

  const openPage = async (): Promise<void> => {
    setError((await window.api.openBrowserExtensionsPage()) || null)
  }

  return (
    <div className="set-row stacked">
      <details className="ext-advanced" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Advanced: extension folder, manual repair, status</summary>
        <div className="ext-advanced-body">
          <div className="ext-toolbar">
            <span
              className={`status-pill ${status?.live ? 'ok' : status?.detected ? 'warm' : 'neutral'}`}
              title={status?.lastSeen ? new Date(status.lastSeen).toLocaleString() : undefined}
            >
              {status?.live
                ? 'Connected'
                : status?.lastSeen
                  ? `Last seen ${relativeTime(status.lastSeen)}`
                  : 'Not connected yet'}
            </span>
            <button className="btn-outline" onClick={() => void openPage()}>
              <Icon name="open" size={15} /> Open extensions page
            </button>
            <button className="btn-outline" onClick={() => void repair()} disabled={busy}>
              {busy ? <Spinner size={14} /> : <Icon name="retry" size={15} />}
              Repair folder
            </button>
          </div>
          {status?.path && (
            <div className="ext-path-row">
              <code title={status.path}>{status.path}</code>
              <button className="btn-mini" onClick={() => void copyPath()}>
                {copied ? 'Copied!' : 'Copy path'}
              </button>
              <button className="btn-mini ghost" onClick={() => void reveal()}>
                Show folder
              </button>
            </div>
          )}
          <span className="set-row-desc">
            Load unpacked this folder in chrome://extensions with Developer mode on. Snag rewrites
            it on every launch, so a loaded copy never goes stale. The overlay appears on large HTML5
            videos; browser-internal pages, DRM players, and sites unsupported by yt-dlp may not work.
          </span>
          {error && <span className="ext-error">{error}</span>}
        </div>
      </details>
    </div>
  )
}

// Signed-in downloads: where yt-dlp gets a logged-in session from.
function SignInSection({
  form,
  set
}: {
  form: Settings
  set: (patch: Partial<Settings>) => void
}): JSX.Element {
  const [status, setStatus] = useState<CookieStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setStatus(await window.api.getCookieStatus())
    } catch {
      /* keep the previous status */
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(timer)
  }, [refresh, form.cookieSource, form.cookiesFile])

  const chooseFile = async (): Promise<void> => {
    const file = await window.api.pickCookiesFile()
    if (file) set({ cookiesFile: file, cookieSource: 'file' })
  }

  const forget = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.forgetCookies()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const source = form.cookieSource
  const hint: Record<CookieSource, string> = {
    none: 'Downloads run without any login. Age-restricted, members-only, and private videos you can watch in your browser will fail.',
    extension:
      'The Snag extension exports your login cookies for YouTube, X, Vimeo, Twitch, Patreon, Reddit, Dailymotion, Instagram, Facebook, and TikTok to Snag every 30 minutes. They are kept in a local file only Snag reads; Forget deletes it.',
    firefox: 'yt-dlp reads Firefox\u2019s cookie store directly. Close Firefox or keep it open, both work.',
    file: 'Use a cookies.txt exported with a browser extension such as \u201cGet cookies.txt LOCALLY\u201d.'
  }

  return (
    <Section title="Signed-in downloads">
      <Row
        title="Use my browser logins"
        desc="Needed for age-restricted, members-only, private, or subscriber videos"
        stacked
      >
        <div className="signin">
          <Segmented
            size="sm"
            options={[
              { value: 'none', label: 'Off' },
              { value: 'extension', label: 'Chrome extension' },
              { value: 'firefox', label: 'Firefox' },
              { value: 'file', label: 'cookies.txt' }
            ]}
            value={source}
            onChange={(v) => set({ cookieSource: v as CookieSource })}
          />
          <span className="set-row-desc">{hint[source]}</span>
          {source === 'extension' && (
            <div className="signin-status">
              <span className={`status-pill ${status?.hasExport ? 'ok' : 'neutral'}`}>
                {status?.hasExport
                  ? `Logins exported ${status.syncedAt ? relativeTime(status.syncedAt) : ''}`.trim()
                  : 'Waiting for the extension\u2019s next check-in (about a minute)'}
              </span>
              {status?.hasExport && (
                <button className="btn-outline" onClick={() => void forget()} disabled={busy}>
                  {busy ? <Spinner size={14} /> : <Icon name="trash" size={14} />} Forget saved logins
                </button>
              )}
            </div>
          )}
          {source === 'file' && (
            <div className="signin-status">
              <code className="ext-path-box" title={form.cookiesFile ?? ''}>
                {form.cookiesFile ?? 'No file chosen yet'}
              </code>
              <button className="btn-outline" onClick={() => void chooseFile()}>
                <Icon name="folder" size={14} /> Choose cookies.txt
              </button>
            </div>
          )}
        </div>
      </Row>
    </Section>
  )
}
