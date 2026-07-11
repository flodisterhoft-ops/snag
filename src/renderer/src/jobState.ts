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
          status: update.status,
          progress: update.progress,
          speed: update.speed,
          eta: update.eta,
          sizeLabel: update.sizeLabel,
          itemLabel: update.itemLabel ?? job.itemLabel,
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

export function removeFinishedJobs(jobs: DownloadJob[]): DownloadJob[] {
  return jobs.filter(
    (job) => job.status !== 'completed' && job.status !== 'error' && job.status !== 'canceled'
  )
}
