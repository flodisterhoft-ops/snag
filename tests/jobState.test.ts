import { describe, expect, it } from 'vitest'
import type { DownloadJob } from '../src/shared/types'
import {
  applyProgressUpdate,
  removeFinishedJobs,
  removeJobById
} from '../src/renderer/src/jobState'

function job(id: string, status: DownloadJob['status']): DownloadJob {
  return {
    id,
    request: {
      url: 'https://example.com',
      title: id,
      thumbnail: null,
      kind: 'video',
      saveDir: 'C:\\Downloads',
      selectionLabel: 'Video'
    },
    status,
    progress: 0,
    speed: null,
    eta: null,
    sizeLabel: null,
    itemLabel: null,
    filepath: null,
    errorMessage: null,
    createdAt: 1,
    completedAt: null
  }
}

describe('renderer job state', () => {
  it('removes a single job after the main process confirms removal', () => {
    expect(removeJobById([job('a', 'completed'), job('b', 'queued')], 'a').map((j) => j.id)).toEqual([
      'b'
    ])
  })

  it('clears every finished terminal state and keeps active work', () => {
    const jobs = [
      job('done', 'completed'),
      job('failed', 'error'),
      job('stopped', 'canceled'),
      job('active', 'downloading'),
      job('waiting', 'queued')
    ]
    expect(removeFinishedJobs(jobs).map((j) => j.id)).toEqual(['active', 'waiting'])
  })

  it('applies progress without losing existing optional fields', () => {
    const current = job('active', 'downloading')
    current.itemLabel = 'Item 1 of 2'
    const [updated] = applyProgressUpdate(
      [current],
      {
        id: 'active',
        status: 'downloading',
        progress: 50,
        speed: '10MiB/s',
        eta: '00:05',
        sizeLabel: '100MiB'
      },
      10
    )
    expect(updated.progress).toBe(50)
    expect(updated.itemLabel).toBe('Item 1 of 2')
  })
})
