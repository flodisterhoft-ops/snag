import { useStore } from '../store'
import { JobCard } from '../components/JobCard'
import { Icon } from '../components/ui'

export function Queue(): JSX.Element {
  const { jobs, setView, clearFinished } = useStore()

  const hasFinished = jobs.some(
    (j) => j.status === 'completed' || j.status === 'error' || j.status === 'canceled'
  )

  return (
    <div className="screen queue">
      <header className="screen-head row">
        <div>
          <h1 className="screen-title">Downloads</h1>
          <p className="screen-desc">
            {jobs.length === 0 ? 'Nothing here yet.' : `${jobs.length} in your list`}
          </p>
        </div>
        {hasFinished && (
          <button className="btn-ghost" onClick={() => void clearFinished()}>
            <Icon name="trash" size={15} /> Clear finished
          </button>
        )}
      </header>

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
