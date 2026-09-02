import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { DownloadJob } from '../src/shared/types'

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\SnagTest' } }))
vi.mock('../src/main/notify', () => ({ notifyComplete: vi.fn(), notifyError: vi.fn() }))

import { DownloadManager, findRenamedFile, parseAria2Readout, parseRemuxDestination } from '../src/main/downloader'

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
    expect(manager.getJob('done')?.status).toBe('completed')
    expect(manager.getJob('missing')).toBeNull()
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

  it('permanently deletes a completed file and removes its queue entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snag-jobs-'))
    tempDirs.push(dir)
    const file = join(dir, 'jobs.json')
    const media = join(dir, 'download.mp4')
    writeFileSync(media, 'video')
    const completed = job('delete-me', 'completed')
    completed.filepath = media
    writeFileSync(file, JSON.stringify({ version: 1, jobs: [completed] }))

    const manager = new DownloadManager()
    manager.initializePersistence(file, false)
    expect(manager.deleteCompletedFile('delete-me')).toEqual({ ok: true })
    expect(existsSync(media)).toBe(false)
    expect(manager.getJob('delete-me')).toBeNull()
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

describe('parseAria2Readout', () => {
  it('reads percent, speed, ETA, and total size from aria2c console lines', () => {
    expect(parseAria2Readout('   [#a0872f 74MiB/354MiB(20%) CN:16 DL:97MiB ETA:2s]')).toEqual({
      progress: 20,
      speed: '97MiB/s',
      eta: '2s',
      sizeLabel: '354MiB'
    })
    // Speed and ETA vanish near the end; the last readout in a chunk wins.
    expect(parseAria2Readout('[#a0872f 74MiB/354MiB(20%) CN:16] [#a0872f 284MiB/354MiB(80%) CN:16 DL:103MiB]')).toEqual({
      progress: 80,
      speed: '103MiB/s',
      eta: null,
      sizeLabel: '354MiB'
    })
    expect(parseAria2Readout('[download] Destination: video.mp4')).toBeNull()
  })
})

describe('findRenamedFile', () => {
  it('finds the real file when the console encoding lost an en dash or a full-width character', () => {
    const files = ['Memories – Free Download.mp4', 'Will it work with vMix？.mkv', 'Other.mp4']
    expect(findRenamedFile('C:\\dl\\Memories \uFFFD Free Download.mp4', () => files)).toMatch(/Memories – Free Download\.mp4$/)
    expect(findRenamedFile('C:\\dl\\Will it work with vMix.mkv', () => files)).toMatch(/vMix？\.mkv$/)
    // Wrong extension or an ambiguous match never guesses.
    expect(findRenamedFile('C:\\dl\\Memories \uFFFD Free Download.mkv', () => files)).toBeNull()
    expect(findRenamedFile('C:\\dl\\Other.mp4', () => ['Other.mp4', 'other!.mp4'])).toBeNull()
  })
})
