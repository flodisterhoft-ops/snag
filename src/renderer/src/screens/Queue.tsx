import { useStore } from '../store'
import { JobCard } from '../components/JobCard'
import { Icon } from '../components/ui'
import { useState } from 'react'

export function Queue(): JSX.Element {
  const { jobs, setView, clearFinished, deleteCompletedFiles } = useStore()
  const [bulkError, setBulkError] = useState<string | null>(null)

  const hasFinished = jobs.some(
    (j) => j.status === 'completed' || j.status === 'error' || j.status === 'canceled'
  )
  const hasDownloadedFiles = jobs.some((job) => job.status === 'completed' && !!job.filepath)

  const deleteFiles = async (): Promise<void> => {
    if (!window.confirm('Permanently delete every completed downloaded file shown here? This cannot be undone.')) return
    const result = await deleteCompletedFiles()
    setBulkError(result.errors.length ? result.errors.join(' ') : null)
  }

  return (
    <div className="screen queue">
      <header className="screen-head row">
        <div>
          <h1 className="screen-title">Downloads</h1>
          <p className="screen-desc">
            {jobs.length === 0 ? 'Nothing here yet.' : `${jobs.length} in your list`}
          </p>
        </div>
        <div className="queue-actions">
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
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}
