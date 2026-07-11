import { Notification, shell } from 'electron'
import type { DownloadJob } from '@shared/types'

export function notifyComplete(job: DownloadJob, enabled: boolean): void {
  if (!enabled) return
  if (!Notification.isSupported()) return

  const n = new Notification({
    title: 'Download complete',
    body: job.request.title,
    silent: false
  })

  n.on('click', () => {
    if (job.filepath) shell.showItemInFolder(job.filepath)
  })

  n.show()
}

export function notifyError(job: DownloadJob, enabled: boolean): void {
  if (!enabled) return
  if (!Notification.isSupported()) return

  const n = new Notification({
    title: 'Download failed',
    body: `${job.request.title}\n${job.errorMessage ?? ''}`.trim(),
    silent: false
  })
  n.show()
}
