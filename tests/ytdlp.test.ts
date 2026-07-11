import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\SnagTest' } }))

import {
  cleanYtdlpError,
  preferManagedYtdlp,
  ytdlpChildEnv,
  ytdlpRuntimeArgs
} from '../src/main/ytdlp'

describe('yt-dlp JavaScript runtime', () => {
  it('uses the packaged Electron executable as Node', () => {
    expect(ytdlpRuntimeArgs('C:\\Program Files\\Snag\\Snag.exe')).toEqual([
      '--no-js-runtimes',
      '--js-runtimes',
      'node:C:\\Program Files\\Snag\\Snag.exe'
    ])
  })

  it('sets the Electron child to run as Node without mutating the source environment', () => {
    const source = { PATH: 'C:\\Windows' }
    const env = ytdlpChildEnv(source)
    expect(env).toEqual({ PATH: 'C:\\Windows', ELECTRON_RUN_AS_NODE: '1' })
    expect(source).toEqual({ PATH: 'C:\\Windows' })
  })
})

describe('yt-dlp executable precedence', () => {
  it('uses the bundle when an app upgrade ships a newer yt-dlp', () => {
    expect(preferManagedYtdlp('2026.06.01', '2026.07.04')).toBe(false)
  })

  it('keeps a newer managed update', () => {
    expect(preferManagedYtdlp('2026.08.01', '2026.07.04')).toBe(true)
  })

  it('falls back to a working version if either executable is invalid', () => {
    expect(preferManagedYtdlp(null, '2026.07.04')).toBe(false)
    expect(preferManagedYtdlp('2026.08.01', null)).toBe(true)
  })
})

describe('yt-dlp error cleanup', () => {
  it('turns noisy HTTP failures into actionable messages', () => {
    expect(
      cleanYtdlpError(
        'ERROR: [generic] video: Unable to download webpage: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)'
      )
    ).toBe('The page or video could not be found (HTTP 404).')

    expect(cleanYtdlpError('ERROR: Unable to download webpage: HTTP Error 403: Forbidden')).toContain(
      'Update yt-dlp'
    )
  })
})
