import type { DownloadJob } from '@shared/types'
import { Icon, SharePicker } from './ui'
import { formatDownloadSpeed } from '../lib/format'
import { useStore } from '../store'
import { useState } from 'react'

const STATUS_LABEL: Record<DownloadJob['status'], string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  processing: 'Processing',
  completed: 'Completed',
  error: 'Failed',
  canceled: 'Canceled',
  paused: 'Paused'
}

export function JobCard({ job }: { job: DownloadJob }): JSX.Element {
  const { removeJob, deleteJobFile, shareInfo, settings, updateSettings } = useStore()

  // "Add an app…" inside the share menu: pick a program, register it, share.
  const addAppAndShare = async (): Promise<void> => {
    setPickShare(false)
    const picked = await window.api.pickShareApp()
    if (!picked || !settings) return
    const id = `custom_${Date.now().toString(36)}`
    await updateSettings({
      shareTargets: [...settings.shareTargets, { id, kind: 'custom', label: picked.label, path: picked.path, enabled: true }]
    })
    void shareDownloadedFile(id)
  }
  const shareTargets = shareInfo?.targets.filter((t) => t.enabled && t.installed) ?? []
  const [pickShare, setPickShare] = useState(false)
  const { status } = job
  const isActive = status === 'downloading' || status === 'processing'
  const pct = Math.round(job.progress)
  const [actionError, setActionError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)

  const openDownloadedPath = async (showInFolder: boolean): Promise<void> => {
    if (!job.filepath) return
    setActionError(null)
    try {
      const error = showInFolder
        ? await window.api.showInFolder(job.filepath)
        : await window.api.openPath(job.filepath)
      if (error) setActionError(error)
    } catch (err) {
      setActionError((err as Error).message || 'Windows could not open this file.')
    }
  }

  const playDownloadedFile = async (): Promise<void> => {
    setActionError(null)
    try {
      const error = await window.api.playFile(job.id)
      if (error) setActionError(error)
    } catch (err) {
      setActionError((err as Error).message || 'Could not start the player.')
    }
  }

  const shareDownloadedFile = async (targetId?: string): Promise<void> => {
    if (sharing) return
    setActionError(null)
    setSharing(true)
    try {
      const error = await window.api.shareFile(job.id, targetId)
      if (error) setActionError(error)
    } catch (err) {
      setActionError((err as Error).message || 'Windows could not share this file.')
    } finally {
      setTimeout(() => setSharing(false), 2000)
    }
  }

  const deleteDownloadedFile = async (): Promise<void> => {
    if (!window.confirm(`Permanently delete “${job.request.title}” from disk? This cannot be undone.`)) return
    setActionError(null)
    const result = await deleteJobFile(job.id)
    if (!result.ok) setActionError(result.error || 'Windows could not delete this file.')
  }

  const extras: string[] = []
  if (job.request.section) extras.push('trimmed')
  if (job.request.openWhenDone) extras.push('opens when done')
  if (job.request.shareWhenDone) extras.push('shares when done')

  return (
    <div className={`job-card ${status}`}>
      <div className="job-thumb">
        {job.request.thumbnail ? (
          <img src={job.request.thumbnail} alt="" referrerPolicy="no-referrer" />
        ) : (
          <div className="job-thumb-fallback">
            <Icon name={job.request.kind === 'audio' ? 'audio' : 'video'} size={20} />
          </div>
        )}
        <span className="job-kind">
          <Icon name={job.request.kind === 'audio' ? 'audio' : 'video'} size={12} />
        </span>
      </div>

      <div className="job-body">
        <div className="job-top">
          <span className="job-title" title={job.request.title}>
            {job.request.title}
          </span>
        </div>

        <div className="job-selection">
          {job.request.selectionLabel}
          {extras.length > 0 && <span className="job-extras"> · {extras.join(' · ')}</span>}
        </div>

        {(isActive || status === 'queued' || status === 'paused') && (
          <div className="progress">
            <div
              className={`progress-bar ${status === 'processing' ? 'indeterminate' : ''} ${status === 'paused' ? 'paused' : ''}`}
              style={{ width: status === 'processing' ? '100%' : `${pct}%` }}
            />
          </div>
        )}

        <div className="job-meta">
          {status === 'downloading' && (
            <>
              <span className="job-pct">{pct}%</span>
              {job.speed && <span>{formatDownloadSpeed(job.speed)}</span>}
              {job.eta && <span>ETA {job.eta}</span>}
              {job.sizeLabel && <span className="dim">{job.sizeLabel}</span>}
              {job.itemLabel && <span className="dim">{job.itemLabel}</span>}
            </>
          )}
          {status === 'processing' && <span className="job-pct">{job.phase || 'Finishing'}…</span>}
          {status === 'queued' && <span className="dim">Waiting in queue…</span>}
          {status === 'paused' && (
            <span className="dim">
              Paused at {pct}% — resume continues where it stopped
            </span>
          )}
          {status === 'error' && <span className="job-error">{job.errorMessage}</span>}
          {status === 'canceled' && <span className="dim">Download canceled</span>}
          {actionError && <span className="job-error">{actionError}</span>}
        </div>
      </div>

      <div className="job-actions">
        <span className={`job-status ${status}`}>
          {status === 'completed' && <Icon name="check" size={13} />}
          {status === 'error' && <Icon name="alert" size={13} />}
          {status === 'paused' && <Icon name="pause" size={13} />}
          {STATUS_LABEL[status]}
        </span>
        <div className="job-buttons">
        {(isActive || status === 'queued') && (
          <>
            <button className="icon-btn" title="Pause" onClick={() => void window.api.pauseJob(job.id)}>
              <Icon name="pause" size={16} />
            </button>
            <button className="icon-btn danger" title="Cancel" onClick={() => window.api.cancel(job.id)}>
              <Icon name="close" size={16} />
            </button>
          </>
        )}
        {status === 'paused' && (
          <>
            <button className="icon-btn" title="Resume" onClick={() => void window.api.resumeJob(job.id)}>
              <Icon name="play" size={16} />
            </button>
            <button className="icon-btn danger" title="Cancel" onClick={() => window.api.cancel(job.id)}>
              <Icon name="close" size={16} />
            </button>
          </>
        )}
        {status === 'completed' && (
          <>
            <button
              className="icon-btn accent"
              title={`Play in ${shareInfo?.player ?? 'the default player'}`}
              onClick={() => void playDownloadedFile()}
            >
              <Icon name="play" size={16} />
            </button>
            <span className="share-wrap">
              <button
                className="icon-btn"
                title={
                  shareInfo?.ask && shareTargets.length > 1
                    ? 'Share…'
                    : `Share with ${shareTargets[0]?.label ?? 'the Windows share panel'}`
                }
                disabled={sharing}
                onClick={() =>
                  shareInfo?.ask && shareTargets.length > 1
                    ? setPickShare((v) => !v)
                    : void shareDownloadedFile(shareTargets[0]?.id)
                }
              >
                <Icon name="share" size={16} />
              </button>
              {pickShare && (
                <SharePicker
                  targets={shareTargets}
                  onPick={(id) => {
                    setPickShare(false)
                    void shareDownloadedFile(id)
                  }}
                  onAdd={() => void addAppAndShare()}
                  onClose={() => setPickShare(false)}
                />
              )}
            </span>
            <button
              className="icon-btn"
              title={job.filepath ? `Show in folder\n${job.filepath}` : 'Show in folder'}
              onClick={() => void openDownloadedPath(true)}
            >
              <Icon name="folder" size={16} />
            </button>
            <button className="icon-btn danger" title="Delete file from disk" onClick={() => void deleteDownloadedFile()}>
              <Icon name="trash" size={16} />
            </button>
            <button className="icon-btn" title="Remove from list only" onClick={() => void removeJob(job.id)}>
              <Icon name="close" size={16} />
            </button>
          </>
        )}
        {(status === 'error' || status === 'canceled') && (
          <>
            <button className="icon-btn" title="Retry" onClick={() => window.api.retry(job.id)}>
              <Icon name="retry" size={16} />
            </button>
            <button className="icon-btn" title="Remove from list" onClick={() => void removeJob(job.id)}>
              <Icon name="trash" size={16} />
            </button>
          </>
        )}
        </div>
      </div>
    </div>
  )
}
