import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  allowedCorsOrigin,
  isChromeExtensionOrigin,
  isSnagExtensionOrigin,
  normalizeAudioLanguages,
  SNAG_EXTENSION_ID
} from '../src/shared/browserIntegration'

describe('browser integration', () => {
  it('only accepts Chromium extension origins for automatic pairing', () => {
    expect(isChromeExtensionOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(true)
    expect(isChromeExtensionOrigin('https://example.com')).toBe(false)
    expect(isChromeExtensionOrigin('chrome-extension://not-an-extension-id')).toBe(false)
    expect(isChromeExtensionOrigin(undefined)).toBe(false)
  })

  it('only pairs with the Snag extension, whose ID the manifest key pins', () => {
    expect(isSnagExtensionOrigin(`chrome-extension://${SNAG_EXTENSION_ID}`)).toBe(true)
    expect(isSnagExtensionOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(false)
    expect(isSnagExtensionOrigin(undefined)).toBe(false)

    // Chrome derives an unpacked extension's ID from the manifest `key`:
    // first 16 bytes of the SHA-256 of the DER public key, hex mapped a–p.
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'extension', 'manifest.json'), 'utf8')
    ) as { key?: string }
    expect(typeof manifest.key).toBe('string')
    const derived = createHash('sha256')
      .update(Buffer.from(manifest.key as string, 'base64'))
      .digest('hex')
      .slice(0, 32)
      .replace(/./g, (c) => 'abcdefghijklmnop'[parseInt(c, 16)])
    expect(derived).toBe(SNAG_EXTENSION_ID)
  })

  it('grants CORS only to extension origins so web pages cannot probe the local API', () => {
    expect(allowedCorsOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
    )
    expect(allowedCorsOrigin('https://example.com')).toBeNull()
    expect(allowedCorsOrigin('null')).toBeNull()
    expect(allowedCorsOrigin(undefined)).toBeNull()
  })

  it('normalizes, deduplicates, validates, and caps favorite languages', () => {
    expect(normalizeAudioLanguages([' EN ', 'de', 'en', '../bad', 7, 'pt-BR'])).toEqual([
      'en',
      'de',
      'pt-br'
    ])
    expect(normalizeAudioLanguages(['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'ja'])).toHaveLength(8)
  })

  it('keeps both extension scripts syntax-valid and wires pairing and favorites', () => {
    const root = join(process.cwd(), 'extension')
    const background = readFileSync(join(root, 'background.js'), 'utf8')
    const content = readFileSync(join(root, 'content.js'), 'utf8')
    expect(() => new Function(background)).not.toThrow()
    expect(() => new Function(content)).not.toThrow()
    expect(background).toContain('/pair`')
    expect(background).toContain('snag:set-audio-favorites')
    expect(background).toContain('snag:job')
    expect(background).toContain('snag:cancel')
    expect(background).toContain('/cancel`')
    expect(background).toContain('snag-check-app-version')
    expect(background).toContain('chrome.runtime.reload()')
    expect(background).toContain('/extension/heartbeat')
    expect(content).toContain("setAttribute('role', 'dialog')")
    expect(content).toContain('prefers-reduced-motion')
    // Redesigned panel: one quality radio list, inline format chips, a sliding
    // Video/Audio segment, and a download button. Progress lives in a corner
    // toast the thumbnail flies into; a missing app is started via snag://open.
    expect(content).toContain("'qrow'")
    expect(content).toContain("'fchip'")
    expect(content).toContain("'seg-ind'")
    expect(content).toContain("el('button', 'go')")
    expect(content).toContain("el('div', 'track')")
    expect(content).toContain("el('div', 'fill')")
    expect(content).toContain('function trackDownload(')
    expect(content).toContain('function flyToCorner(')
    expect(content).toContain("location.href = 'snag://open'")
    expect(content).toContain('snag:cancel')
    expect(content).not.toContain('stage-progress')
    // Thumbnail hover buttons and placement that respects fixed headers and
    // whole control clusters.
    expect(content).toContain("'snag-thumb-btn'")
    expect(content).toContain('function fixedTopInset(')
    expect(content).toContain('function clearOffset(')
    expect(content).not.toContain("'Added to Snag'")
    expect(content).not.toContain("el('div', 'save')")
    // Old card-grid and the in-panel audio-language picker are gone.
    expect(content).not.toContain('quality-stack')
    expect(content).not.toContain('Audio tracks')
  })
})
