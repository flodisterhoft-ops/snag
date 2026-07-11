import { describe, expect, it } from 'vitest'
import { parseDeepLink, deepLinkFromArgv, isHttpUrl } from '../src/main/protocol'

const target = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
const link = `snag://download?url=${encodeURIComponent(target)}`

describe('parseDeepLink', () => {
  it('extracts the target from a valid deep link', () => {
    expect(parseDeepLink(link)).toBe(target)
  })

  it('accepts the path form snag:///download', () => {
    expect(parseDeepLink(`snag:///download?url=${encodeURIComponent(target)}`)).toBe(target)
  })

  it('is case-insensitive about the scheme and action', () => {
    expect(parseDeepLink(`SNAG://Download?url=${encodeURIComponent(target)}`)).toBe(target)
  })

  it('preserves query parameters of the target URL', () => {
    const t = 'https://example.com/watch?v=abc&list=xyz&t=42'
    expect(parseDeepLink(`snag://download?url=${encodeURIComponent(t)}`)).toBe(t)
  })

  it('rejects unknown actions', () => {
    expect(parseDeepLink(`snag://settings?url=${encodeURIComponent(target)}`)).toBeNull()
  })

  it('rejects non-http(s) targets', () => {
    for (const bad of ['file:///C:/x', 'javascript:alert(1)', 'snag://download', 'ftp://x/y']) {
      expect(parseDeepLink(`snag://download?url=${encodeURIComponent(bad)}`)).toBeNull()
    }
  })

  it('rejects missing, empty, and oversized targets', () => {
    expect(parseDeepLink('snag://download')).toBeNull()
    expect(parseDeepLink('snag://download?url=')).toBeNull()
    const huge = 'https://example.com/?q=' + 'a'.repeat(3000)
    expect(parseDeepLink(`snag://download?url=${encodeURIComponent(huge)}`)).toBeNull()
  })

  it('rejects non-strings and other schemes', () => {
    expect(parseDeepLink(undefined)).toBeNull()
    expect(parseDeepLink(42)).toBeNull()
    expect(parseDeepLink('https://example.com')).toBeNull()
  })
})

describe('deepLinkFromArgv', () => {
  it('finds the deep link among unrelated arguments', () => {
    const argv = ['C:\\app\\Snag.exe', '--allow-file-access', link]
    expect(deepLinkFromArgv(argv)).toBe(target)
  })

  it('returns null when no argument is a valid deep link', () => {
    expect(deepLinkFromArgv(['C:\\app\\Snag.exe', 'https://example.com'])).toBeNull()
  })
})

describe('isHttpUrl', () => {
  it('accepts http and https only', () => {
    expect(isHttpUrl('http://a.b/c')).toBe(true)
    expect(isHttpUrl('https://a.b/c')).toBe(true)
    expect(isHttpUrl('file:///x')).toBe(false)
    expect(isHttpUrl('not a url')).toBe(false)
  })
})
