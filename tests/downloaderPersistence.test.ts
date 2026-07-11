import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { DownloadJob } from '../src/shared/types'

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\SnagTest' } }))
vi.mock('../src/main/notify', () => ({ notifyComplete: vi.fn(), notifyError: vi.fn() }))

import { DownloadManager, parseRemuxDestination } from '../src/main/downloader'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function job(id: string, status: DownloadJob['status']): DownloadJob {
  return {
    id,
    request: {
      url: `https://example.com/${id}`,
      title: id,
      thumbnail: null,
      kind: 'video',
      saveDir: 'C:\\Downloads',
      selectionLabel: 'Video'
    },
    status,
    progress: status === 'completed' ? 100 : 40,
    speed: status === 'downloading' ? '10MiB/s' : null,
    eta: status === 'downloading' ? '00:10' : null,
    sizeLabel: null,
    itemLabel: null,
    filepath: status === 'completed' ? 'C:\\Downloads\\done.mp4' : null,
    errorMessage: null,
    createdAt: 1,
    completedAt: status === 'completed' ? 2 : null
  }
}

describe('download queue persistence', () => {
  it('restores history, requeues waiting jobs, and marks interrupted work retryable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snag-jobs-'))
    tempDirs.push(dir)
    const file = join(dir, 'jobs.json')
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        jobs: [job('done', 'completed'), job('waiting', 'queued'), job('interrupted', 'downloading')]
      })
    )

    const manager = new DownloadManager()
    manager.initializePersistence(file, false)

    const restored = manager.getJobs()
    expect(restored.map((item) => item.id)).toEqual(['done', 'waiting', 'interrupted'])
    expect(restored.find((item) => item.id === 'done')?.status).toBe('completed')
    expect(restored.find((item) => item.id === 'waiting')?.status).toBe('queued')
    expect(restored.find((item) => item.id === 'interrupted')).toMatchObject({
      status: 'error',
      speed: null,
      eta: null
    })
    expect(restored.find((item) => item.id === 'interrupted')?.errorMessage).toContain('Retry')
    expect(manager.hasActiveWork()).toBe(true)

    const saved = JSON.parse(readFileSync(file, 'utf8')) as { jobs: DownloadJob[] }
    expect(saved.jobs.find((item) => item.id === 'interrupted')?.status).toBe('error')
  })

  it('recovers from the atomic-write backup when the primary JSON is corrupt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snag-jobs-'))
    tempDirs.push(dir)
    const file = join(dir, 'jobs.json')
    writeFileSync(file, '{not valid json')
    writeFileSync(`${file}.bak`, JSON.stringify({ version: 1, jobs: [job('recovered', 'completed')] }))

    const manager = new DownloadManager()
    manager.initializePersistence(file, false)

    expect(manager.getJobs().map((item) => item.id)).toEqual(['recovered'])
  })
})

describe('download output parsing', () => {
  it('tracks the new filepath created by progressive remuxing', () => {
    expect(
      parseRemuxDestination(
        '[VideoRemuxer] Remuxing video from webm to mp4; Destination: "C:\\Downloads\\clip.mp4"'
      )
    ).toBe('C:\\Downloads\\clip.mp4')
    expect(parseRemuxDestination('[download] Destination: C:\\Downloads\\clip.webm')).toBeNull()
  })
})
