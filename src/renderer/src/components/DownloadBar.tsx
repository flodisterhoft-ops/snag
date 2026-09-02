import { useState } from 'react'
import { Icon, SharePicker, Spinner } from './ui'
import { shortPath } from '../lib/format'
import { useStore } from '../store'

// Where the file goes, a one-line summary of what will be fetched, one large
// Download button, and (when the caller supports it) a small Share button that
// downloads and then hands the file to a share app.
export function DownloadBar({
  saveDir,
  onChangeFolder,
  onDownload,
  onShare,
  disabled,
  busy,
  label,
  sub
}: {
  saveDir: string
  onChangeFolder: () => void
  onDownload: () => void
  // Download, then share with the given target (undefined = first enabled).
  onShare?: (targetId?: string) => void
  disabled: boolean
  busy: boolean
  label: string
  sub?: string | null
}): JSX.Element {
  const { shareInfo, settings, updateSettings } = useStore()
  const [pick, setPick] = useState(false)
  const addAppAndShare = async (): Promise<void> => {
    setPick(false)
    const picked = await window.api.pickShareApp()
    if (!picked || !settings || !onShare) return
    const id = `custom_${Date.now().toString(36)}`
    await updateSettings({
      shareTargets: [...settings.shareTargets, { id, kind: 'custom', label: picked.label, path: picked.path, enabled: true }]
    })
    onShare(id)
  }
  const targets = shareInfo?.targets.filter((t) => t.enabled && t.installed) ?? []
  const shareTitle =
    shareInfo?.ask && targets.length > 1
      ? 'Download, then share…'
      : `Download, then share with ${targets[0]?.label ?? 'the Windows share panel'}`

  return (
    <div className="dl-stack">
      <button className="dl-folder" onClick={onChangeFolder} title={`Save to ${saveDir}`}>
        <Icon name="folder" size={16} />
        <span className="dl-folder-path">{shortPath(saveDir, 34)}</span>
        <span className="dl-folder-change">Change</span>
      </button>
      {sub && <div className="dl-summary">{sub}</div>}
      <div className="dl-actions">
        <button className="btn-accent dl-go" onClick={onDownload} disabled={disabled}>
          {busy ? <Spinner size={18} /> : <Icon name="download" size={18} />}
          {label}
        </button>
        {onShare && (
          <span className="share-wrap">
            <button
              className="btn-accent dl-share"
              title={shareTitle}
              aria-label={shareTitle}
              disabled={disabled}
              onClick={() => {
                if (shareInfo?.ask && targets.length > 1) setPick((v) => !v)
                else onShare(targets[0]?.id)
              }}
            >
              <Icon name="share" size={17} />
            </button>
            {pick && (
              <SharePicker
                targets={targets}
                direction="up"
                onPick={(id) => {
                  setPick(false)
                  onShare(id)
                }}
                onAdd={() => void addAppAndShare()}
                onClose={() => setPick(false)}
              />
            )}
          </span>
        )}
      </div>
    </div>
  )
}
