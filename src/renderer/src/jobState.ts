import type { DownloadJob, ProgressUpdate } from '@shared/types'

export function applyProgressUpdate(
  jobs: DownloadJob[],
  update: ProgressUpdate,
  now = Date.now()
): DownloadJob[] {
  return jobs.map((job) =>
    job.id === update.id
      ? {
          ...job,
          request:
            update.title && update.title !== job.request.title
              ? { ...job.request, title: update.title }
              : job.request,
          status: update.status,
          progress: update.progress,
          speed: update.speed,
          eta: update.eta,
          sizeLabel: update.sizeLabel,
          itemLabel: update.itemLabel ?? job.itemLabel,
          // null clears the phase (back to downloading); undefined keeps it.
          phase: update.phase !== undefined ? update.phase : job.phase,
          filepath: update.filepath ?? job.filepath,
          errorMessage: update.errorMessage ?? job.errorMessage,
          completedAt: update.status === 'completed' ? now : job.completedAt
        }
      : job
  )
}

export function removeJobById(jobs: DownloadJob[], id: string): DownloadJob[] {
  return jobs.filter((job) => job.id !== id)
}

// Put the jobs in the order the user dragged them into (top to bottom).
export function reorderJobs(jobs: DownloadJob[], ids: string[]): DownloadJob[] {
  const byId = new Map(jobs.map((job) => [job.id, job]))
  const ordered = ids.map((id) => byId.get(id)).filter((job): job is DownloadJob => !!job)
  const rest = jobs.filter((job) => !ids.includes(job.id))
  return [...ordered, ...rest]
}

export function removeFinishedJobs(jobs: DownloadJob[]): DownloadJob[] {
  return jobs.filter(
    (job) => job.status !== 'completed' && job.status !== 'error' && job.status !== 'canceled'
  )
}
