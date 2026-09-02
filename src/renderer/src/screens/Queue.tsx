import { useState } from 'react'
import { useStore } from '../store'
import { JobCard } from '../components/JobCard'
import { Icon } from '../components/ui'

export function Queue(): JSX.Element {
  const { jobs, setView, clearFinished, deleteCompletedFiles, reorderJobs } = useStore()
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const hasFinished = jobs.some(
    (j) => j.status === 'completed' || j.status === 'error' || j.status === 'canceled'
  )
  const hasDownloadedFiles = jobs.some((job) => job.status === 'completed' && !!job.filepath)
  const hasActive = jobs.some((j) => j.status === 'downloading' || j.status === 'processing' || j.status === 'queued')
  const hasPaused = jobs.some((j) => j.status === 'paused')

  const deleteFiles = async (): Promise<void> => {
    if (!window.confirm('Permanently delete every completed downloaded file shown here? This cannot be undone.')) return
    const result = await deleteCompletedFiles()
    setBulkError(result.errors.length ? result.errors.join(' ') : null)
  }

  const pauseAll = (): void => {
    for (const job of jobs) {
      if (job.status === 'downloading' || job.status === 'processing' || job.status === 'queued') {
        void window.api.pauseJob(job.id)
      }
    }
  }

  const resumeAll = (): void => {
    for (const job of jobs) if (job.status === 'paused') void window.api.resumeJob(job.id)
  }

  // Drag a card onto another to move it there; the new top-to-bottom order
  // becomes the download order for everything still waiting.
  const dropOn = (targetId: string): void => {
    if (!dragId || dragId === targetId) return
    const ids = jobs.map((j) => j.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(from, 1)
    ids.splice(to, 0, dragId)
    void reorderJobs(ids)
  }

  return (
    <div className="screen queue">
      <header className="screen-head row">
        <div>
          <h1 className="screen-title">Downloads</h1>
          <p className="screen-desc">
            {jobs.length === 0 ? 'Nothing here yet.' : `${jobs.length} in your list · drag to reorder`}
          </p>
        </div>
        <div className="queue-actions">
          {hasActive && (
            <button className="btn-ghost" onClick={pauseAll}>
              <Icon name="pause" size={15} /> Pause all
            </button>
          )}
          {hasPaused && (
            <button className="btn-ghost" onClick={resumeAll}>
              <Icon name="play" size={15} /> Resume all
            </button>
          )}
          {hasFinished && (
            <button className="btn-ghost" onClick={() => void clearFinished()}>
              <Icon name="close" size={15} /> Clear list
            </button>
          )}
          {hasDownloadedFiles && (
            <button className="btn-outline danger" onClick={() => void deleteFiles()}>
              <Icon name="trash" size={15} /> Delete downloaded files
            </button>
          )}
        </div>
      </header>

      {bulkError && <div className="queue-error">{bulkError}</div>}

      {jobs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <Icon name="queue" size={30} />
          </div>
          <h3>Your queue is empty</h3>
          <p>Paste a link on the Download tab to get started.</p>
          <button className="btn-accent" onClick={() => setView('home')}>
            <Icon name="download" size={16} /> Go to Download
          </button>
        </div>
      ) : (
        <div className="job-list">
          {jobs.map((job) => (
            <div
              key={job.id}
              className={`job-drag ${dragId === job.id ? 'dragging' : ''} ${overId === job.id && dragId !== job.id ? 'drop-target' : ''}`}
              draggable
              onDragStart={(e) => {
                setDragId(job.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', job.id)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (overId !== job.id) setOverId(job.id)
              }}
              onDragLeave={() => {
                if (overId === job.id) setOverId(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                dropOn(job.id)
                setDragId(null)
                setOverId(null)
              }}
            >
              <JobCard job={job} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
