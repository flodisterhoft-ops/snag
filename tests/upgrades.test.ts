import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\SnagTest' },
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: { readText: () => '' },
  globalShortcut: { register: () => true, unregister: () => {} },
  Notification: { isSupported: () => false },
  shell: {}
}))

import { buildDownloadArgs, sectionArgument } from '../src/main/args'
import {
  cookieArgs,
  cookieSyncWanted,
  isAllowedCookieDomain,
  sanitizeCookies,
  toNetscapeCookies
} from '../src/main/cookies'
import { pickPreview } from '../src/main/metadata'
import { clipboardUrl, isKnownVideoUrl } from '../src/main/links'
import { completionToastXml } from '../src/main/notify'
import { deepLinkActionFromArgv, jobDeepLink, parseDeepLinkAction } from '../src/main/protocol'
import { sanitizeSettings } from '../src/main/settings'
import { extractUrls } from '../src/renderer/src/lib/format'
import { formatTimecode, parseTimecode } from '../src/renderer/src/components/TrimEditor'
import type { DownloadJob, DownloadRequest, Settings } from '../src/shared/types'

const settings: Settings = sanitizeSettings({})

const request: DownloadRequest = {
  url: 'https://example.com/watch/1',
  title: 'Example',
  thumbnail: null,
  kind: 'video',
  videoFormatId: '137',
  audioFormatId: '140',
  mergeContainer: 'mp4',
  saveDir: 'C:\\Downloads',
  selectionLabel: '1080p · MP4'
}

describe('trimmed downloads', () => {
  it('passes the section to yt-dlp and names the file by its time range', () => {
    const args = buildDownloadArgs(
      { ...request, section: { start: 65.5, end: 120.25, precise: true } },
      settings,
      { ffmpegLocation: null }
    )
    expect(args.slice(args.indexOf('--download-sections'), args.indexOf('--download-sections') + 2)).toEqual([
      '--download-sections',
      '*65.500-120.250'
    ])
    expect(args).toContain('--force-keyframes-at-cuts')
    expect(args[args.indexOf('-o') + 1]).toContain('[%(section_start)d-%(section_end)d]')
  })

  it('skips re-encoding and the range suffix when not asked for', () => {
    const fast = buildDownloadArgs(
      { ...request, section: { start: 10, end: 20, precise: false } },
      settings,
      { ffmpegLocation: null }
    )
    expect(fast).not.toContain('--force-keyframes-at-cuts')
    const plain = buildDownloadArgs(request, settings, { ffmpegLocation: null })
    expect(plain).not.toContain('--download-sections')
    expect(plain[plain.indexOf('-o') + 1]).not.toContain('section_start')
    expect(sectionArgument(0, 3)).toBe('*0.000-3.000')
  })

  it('formats and parses timecodes symmetrically', () => {
    expect(formatTimecode(65.5)).toBe('1:05.500')
    expect(formatTimecode(3725.004)).toBe('1:02:05.004')
    expect(formatTimecode(59, false)).toBe('0:59')
    expect(parseTimecode('1:05.5')).toBe(65.5)
    expect(parseTimecode('0:01:30.250')).toBeCloseTo(90.25)
    expect(parseTimecode('90')).toBe(90)
    expect(parseTimecode('1:xx')).toBeNull()
    expect(parseTimecode('')).toBeNull()
  })
})

describe('SponsorBlock and cookies in yt-dlp arguments', () => {
  it('removes cut categories, marks the others as chapters, and adds cookies', () => {
    const args = buildDownloadArgs(
      request,
      { ...settings, sponsorBlock: { remove: ['sponsor', 'selfpromo'], mark: ['intro'] } },
      { ffmpegLocation: null, cookieArgs: ['--cookies', 'C:\\SnagTest\\cookies\\browser-cookies.txt'] }
    )
    expect(args.slice(args.indexOf('--sponsorblock-remove'), args.indexOf('--sponsorblock-remove') + 2)).toEqual([
      '--sponsorblock-remove',
      'sponsor,selfpromo'
    ])
    expect(args.slice(args.indexOf('--sponsorblock-mark'), args.indexOf('--sponsorblock-mark') + 3)).toEqual([
      '--sponsorblock-mark',
      'intro',
      '--embed-chapters'
    ])
    expect(args.slice(args.indexOf('--cookies'), args.indexOf('--cookies') + 2)).toEqual([
      '--cookies',
      'C:\\SnagTest\\cookies\\browser-cookies.txt'
    ])
  })

  it('never lets a category be both cut and marked', () => {
    const cleaned = sanitizeSettings({ sponsorBlock: { remove: ['sponsor'], mark: ['sponsor', 'intro', 'bogus'] } })
    expect(cleaned.sponsorBlock).toEqual({ remove: ['sponsor'], mark: ['intro'] })
  })
})

describe('browser cookie export', () => {
  it('keeps only supported sites and writes the Netscape format yt-dlp reads', () => {
    const cookies = sanitizeCookies([
      { domain: '.youtube.com', path: '/', name: 'SID', value: 'abc', secure: true, httpOnly: true, hostOnly: false, expirationDate: 1800000000.5 },
      { domain: 'accounts.google.com', path: '/', name: 'X', value: 'y', secure: false, httpOnly: false, hostOnly: true },
      { domain: '.evil.com', path: '/', name: 'steal', value: 'me' },
      { domain: '.youtube.com', path: '/', name: 'bad name', value: 'x' },
      { domain: '.youtube.com', path: '/', name: 'nl', value: 'line\nbreak' }
    ])
    expect(cookies.map((c) => c.name)).toEqual(['SID', 'X'])
    const text = toNetscapeCookies(cookies)
    expect(text.startsWith('# Netscape HTTP Cookie File')).toBe(true)
    expect(text).toContain('#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1800000000\tSID\tabc')
    expect(text).toContain('accounts.google.com\tFALSE\t/\tFALSE\t0\tX\ty')
    expect(isAllowedCookieDomain('.www.youtube.com')).toBe(true)
    expect(isAllowedCookieDomain('notyoutube.com')).toBe(false)
  })

  it('builds the right yt-dlp arguments per sign-in source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snag-cookies-'))
    try {
      expect(cookieArgs({ ...settings, cookieSource: 'none' }, dir)).toEqual([])
      expect(cookieArgs({ ...settings, cookieSource: 'firefox' }, dir)).toEqual(['--cookies-from-browser', 'firefox'])
      expect(cookieArgs({ ...settings, cookieSource: 'extension' }, dir)).toEqual([])
      expect(cookieSyncWanted({ ...settings, cookieSource: 'extension' }, Date.now(), dir)).toBe(true)
      const file = join(dir, 'exported.txt')
      writeFileSync(file, '# cookies')
      expect(cookieArgs({ ...settings, cookieSource: 'file', cookiesFile: file }, dir)).toEqual(['--cookies', file])
      expect(cookieArgs({ ...settings, cookieSource: 'file', cookiesFile: join(dir, 'missing.txt') }, dir)).toEqual([])
      expect(readFileSync(file, 'utf8')).toBe('# cookies')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('preview stream for the trim editor', () => {
  it('prefers a small muxed MP4, then a silent MP4, and ignores manifests', () => {
    const preview = pickPreview([
      { format_id: 'hls', ext: 'mp4', height: 360, vcodec: 'avc1', acodec: 'mp4a', url: 'https://x/hls.m3u8', protocol: 'm3u8_native' },
      { format_id: '18', ext: 'mp4', height: 360, vcodec: 'avc1', acodec: 'mp4a', url: 'https://x/18', protocol: 'https' },
      { format_id: '22', ext: 'mp4', height: 720, vcodec: 'avc1', acodec: 'mp4a', url: 'https://x/22', protocol: 'https' },
      { format_id: '137', ext: 'mp4', height: 1080, vcodec: 'avc1', acodec: 'none', url: 'https://x/137', protocol: 'https' }
    ])
    expect(preview).toEqual({ url: 'https://x/18', hasAudio: true })
    expect(
      pickPreview([
        { format_id: '134', ext: 'mp4', height: 360, vcodec: 'avc1', acodec: 'none', url: 'https://x/134', protocol: 'https' },
        { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', url: 'https://x/140', protocol: 'https' }
      ])
    ).toEqual({ url: 'https://x/134', hasAudio: false })
    expect(pickPreview([{ format_id: 'x', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', url: 'https://x/m.mpd', protocol: 'http_dash_segments' }])).toEqual({ url: null, hasAudio: false })
  })
})

describe('clipboard watch and batch paste', () => {
  it('recognizes a single copied link and well-known video hosts', () => {
    expect(clipboardUrl('  https://youtu.be/abc  ')).toBe('https://youtu.be/abc')
    expect(clipboardUrl('hello world')).toBeNull()
    expect(clipboardUrl('https://a.com/1 https://b.com/2')).toBeNull()
    expect(isKnownVideoUrl('https://www.youtube.com/watch?v=1')).toBe(true)
    expect(isKnownVideoUrl('https://docs.google.com/x')).toBe(false)
  })

  it('pulls every link out of pasted text', () => {
    expect(extractUrls('https://a.com/1\nhttps://b.com/2, https://a.com/1 (https://c.com/3).')).toEqual([
      'https://a.com/1',
      'https://b.com/2',
      'https://c.com/3'
    ])
    expect(extractUrls('no links here')).toEqual([])
  })
})

describe('toast buttons and job deep links', () => {
  const job: DownloadJob = {
    id: 'job_abc_1',
    request: { ...request, title: 'Tom & Jerry' },
    status: 'completed',
    progress: 100,
    speed: null,
    eta: null,
    sizeLabel: null,
    itemLabel: null,
    filepath: 'C:\\Downloads\\Tom & Jerry.mp4',
    errorMessage: null,
    createdAt: 1,
    completedAt: 2
  }

  it('round-trips the Open and Show in folder actions through snag:// links', () => {
    expect(parseDeepLinkAction(jobDeepLink('job_abc_1', 'open'))).toEqual({ kind: 'job', id: 'job_abc_1', action: 'open' })
    expect(parseDeepLinkAction('snag://job?id=job_abc_1&action=reveal')).toEqual({ kind: 'job', id: 'job_abc_1', action: 'reveal' })
    expect(parseDeepLinkAction('snag://job?id=..%5C..&action=open')).toBeNull()
    expect(parseDeepLinkAction('snag://job?id=job_abc_1&action=delete')).toBeNull()
    expect(deepLinkActionFromArgv(['Snag.exe', '"snag://job?id=job_abc_1&action=open"'])).toEqual({
      kind: 'job',
      id: 'job_abc_1',
      action: 'open'
    })
    expect(parseDeepLinkAction('snag://download?url=https%3A%2F%2Fexample.com%2Fv')).toEqual({
      kind: 'download',
      url: 'https://example.com/v'
    })
  })

  it('escapes the toast XML and wires both buttons to protocol activation', () => {
    const xml = completionToastXml(job)
    expect(xml).toContain('activationType="protocol"')
    expect(xml).toContain('arguments="snag://job?id=job_abc_1&amp;action=open"')
    expect(xml).toContain('arguments="snag://job?id=job_abc_1&amp;action=reveal"')
    expect(xml).toContain('Tom &amp; Jerry')
    expect(xml).not.toContain('Tom & Jerry')
  })
})
