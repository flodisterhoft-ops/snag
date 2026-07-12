import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  isChromeExtensionOrigin,
  normalizeAudioLanguages
} from '../src/shared/browserIntegration'

describe('browser integration', () => {
  it('only accepts Chromium extension origins for automatic pairing', () => {
    expect(isChromeExtensionOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(true)
    expect(isChromeExtensionOrigin('https://example.com')).toBe(false)
    expect(isChromeExtensionOrigin('chrome-extension://not-an-extension-id')).toBe(false)
    expect(isChromeExtensionOrigin(undefined)).toBe(false)
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
    // Video/Audio segment, and a download button that collapses into progress.
    expect(content).toContain("'qrow'")
    expect(content).toContain("'fchip'")
    expect(content).toContain("'seg-ind'")
    expect(content).toContain("el('button', 'go')")
    expect(content).toContain("el('div', 'track')")
    expect(content).toContain("el('div', 'fill')")
    expect(content).toContain('stage-progress')
    expect(content).toContain('snag:cancel')
    expect(content).toContain("el('button', 'cancel', 'Cancel')")
    expect(content).not.toContain("'Added to Snag'")
    expect(content).not.toContain("el('div', 'save')")
    // Old card-grid and the in-panel audio-language picker are gone.
    expect(content).not.toContain('quality-stack')
    expect(content).not.toContain('Audio tracks')
  })
})
