import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  getToolStatus: vi.fn()
}))

vi.mock('electron', () => ({ app: { getVersion: () => '1.2.2' } }))
vi.mock('../src/main/settings', () => ({
  loadSettings: () => ({ ytdlpPath: null, autoCheckUpdates: true, lastUpdateCheck: 0 }),
  saveSettings: mocks.saveSettings
}))
vi.mock('../src/main/ytdlp', () => ({ getToolStatus: mocks.getToolStatus }))

import { compareVersions } from '../src/main/version'
import { checkForUpdates } from '../src/main/updates'

function release(version: string): Response {
  return new Response(
    JSON.stringify({
      tag_name: `v${version}`,
      html_url: `https://example.com/${version}`,
      body: `Changes in ${version}`
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

beforeEach(() => {
  mocks.saveSettings.mockReset()
  mocks.getToolStatus.mockReset()
  mocks.getToolStatus.mockResolvedValue({ ytdlpVersion: '2026.07.04' })
  vi.unstubAllGlobals()
})

describe('compareVersions', () => {
  it('compares app-style semver', () => {
    expect(compareVersions('1.2.0', '1.1.0')).toBe(1)
    expect(compareVersions('1.1.0', '1.2.0')).toBe(-1)
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
  })

  it('ignores a leading v', () => {
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0)
    expect(compareVersions('v1.3.0', 'v1.2.9')).toBe(1)
  })

  it('compares yt-dlp date versions with zero-padded parts', () => {
    expect(compareVersions('2026.07.04', '2026.07.04')).toBe(0)
    expect(compareVersions('2026.07.10', '2026.07.04')).toBe(1)
    expect(compareVersions('2026.07.04', '2026.12.30')).toBe(-1)
    expect(compareVersions('2027.01.01', '2026.12.30')).toBe(1)
  })

  it('treats missing segments as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBe(1)
  })
})

describe('checkForUpdates', () => {
  it('records the timestamp only after a fully successful check', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(release('1.2.2'))
      .mockResolvedValueOnce(release('2026.07.04'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await checkForUpdates()
    expect(result).toEqual({ status: 'success', app: null, ytdlp: null, error: null })
    expect(mocks.saveSettings).toHaveBeenCalledOnce()
  })

  it('reports network failure as unknown instead of up to date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const result = await checkForUpdates()
    expect(result.status).toBe('error')
    expect(result.error).toContain('network request failed')
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it('does not treat GitHub HTTP errors as up to date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })))

    const result = await checkForUpdates()
    expect(result.status).toBe('error')
    expect(result.error).toContain('HTTP 403')
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it('preserves a known app result when the yt-dlp lookup fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(release('1.3.0'))
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await checkForUpdates()
    expect(result.status).toBe('partial')
    expect(result.app?.latest).toBe('1.3.0')
    expect(result.app?.notes).toBe('Changes in 1.3.0')
    expect(result.ytdlp).toBeNull()
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it('reports an unknown installed yt-dlp version as partial', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(release('1.2.2')).mockResolvedValueOnce(release('2026.07.04'))
    )
    mocks.getToolStatus.mockResolvedValue({ ytdlpVersion: null })

    const result = await checkForUpdates()
    expect(result.status).toBe('partial')
    expect(result.error).toContain('installed yt-dlp version')
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })
})
