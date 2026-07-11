import type { DownloadJob } from '@shared/types'
import { Icon } from './ui'
import { formatDownloadSpeed, shortPath } from '../lib/format'
import { useStore } from '../store'

const STATUS_LABEL: Record<DownloadJob['status'], string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  processing: 'Processing',
  completed: 'Completed',
  error: 'Failed',
  canceled: 'Canceled'
}

export function JobCard({ job }: { job: DownloadJob }): JSX.Element {
  const { removeJob } = useStore()
  const { status } = job
  const isActive = status === 'downloading' || status === 'processing'
  const pct = Math.round(job.progress)

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
          <span className={`job-status ${status}`}>
            {status === 'completed' && <Icon name="check" size={13} />}
            {status === 'error' && <Icon name="alert" size={13} />}
            {STATUS_LABEL[status]}
          </span>
        </div>

        <div className="job-selection">{job.request.selectionLabel}</div>

        {(isActive || status === 'queued') && (
          <div className="progress">
            <div
              className={`progress-bar ${status === 'processing' ? 'indeterminate' : ''}`}
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
          {status === 'processing' && <span className="job-pct">Merging & finishing…</span>}
          {status === 'queued' && <span className="dim">Waiting in queue…</span>}
          {status === 'completed' && job.filepath && (
            <span className="dim" title={job.filepath}>
              {shortPath(job.filepath, 48)}
            </span>
          )}
          {status === 'error' && <span className="job-error">{job.errorMessage}</span>}
          {status === 'canceled' && <span className="dim">Download canceled</span>}
        </div>
      </div>

      <div className="job-actions">
        {(isActive || status === 'queued') && (
          <button className="icon-btn danger" title="Cancel" onClick={() => window.api.cancel(job.id)}>
            <Icon name="close" size={16} />
          </button>
        )}
        {status === 'completed' && (
          <>
            <button
              className="icon-btn"
              title="Open file"
              onClick={() => job.filepath && window.api.openPath(job.filepath)}
            >
              <Icon name="open" size={16} />
            </button>
            <button
              className="icon-btn"
              title="Show in folder"
              onClick={() => job.filepath && window.api.showInFolder(job.filepath)}
            >
              <Icon name="folder" size={16} />
            </button>
            <button
              className="icon-btn"
              title="Remove from list"
              onClick={() => void removeJob(job.id)}
            >
              <Icon name="trash" size={16} />
            </button>
          </>
        )}
        {(status === 'error' || status === 'canceled') && (
          <>
            <button className="icon-btn" title="Retry" onClick={() => window.api.retry(job.id)}>
              <Icon name="retry" size={16} />
            </button>
            <button
              className="icon-btn"
              title="Remove from list"
              onClick={() => void removeJob(job.id)}
            >
              <Icon name="trash" size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
