import { Notification, shell } from 'electron'
import { dirname } from 'path'
import { jobDeepLink } from './protocol'
import type { DownloadJob } from '@shared/types'

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '&':
        return '&amp;'
      case "'":
        return '&apos;'
      default:
        return '&quot;'
    }
  })
}

// Windows toasts can carry buttons that launch a protocol URL. Electron has no
// per-button callback on Windows, so the buttons hand a snag://job link back
// to the app, which validates the job id before opening anything.
export function completionToastXml(job: DownloadJob): string {
  const open = escapeXml(jobDeepLink(job.id, 'open'))
  const reveal = escapeXml(jobDeepLink(job.id, 'reveal'))
  const folder = job.filepath ? escapeXml(dirname(job.filepath)) : ''
  return (
    `<toast launch="${reveal}" activationType="protocol" duration="short">` +
    '<visual><binding template="ToastGeneric">' +
    '<text>Download complete</text>' +
    `<text>${escapeXml(job.request.title)}</text>` +
    (folder ? `<text placement="attribution">${folder}</text>` : '') +
    '</binding></visual>' +
    '<actions>' +
    `<action content="Open" arguments="${open}" activationType="protocol"/>` +
    `<action content="Show in folder" arguments="${reveal}" activationType="protocol"/>` +
    '</actions>' +
    '</toast>'
  )
}

export function notifyComplete(job: DownloadJob, enabled: boolean): void {
  if (!enabled) return
  if (!Notification.isSupported()) return

  const useToastButtons = process.platform === 'win32' && !!job.filepath
  const n = new Notification({
    title: 'Download complete',
    body: job.request.title,
    silent: false,
    ...(useToastButtons ? { toastXml: completionToastXml(job) } : {})
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

export function notifyInfo(title: string, body: string, enabled: boolean): void {
  if (!enabled) return
  if (!Notification.isSupported()) return
  new Notification({ title, body, silent: true }).show()
}
