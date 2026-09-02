import { describe, expect, it } from 'vitest'
import { browserForProgId, parseProgIdOutput } from '../src/main/browsers'

describe('default browser detection', () => {
  it('reads the ProgId out of reg query output', () => {
    const output = [
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
      '    ProgId    REG_SZ    ChromeHTML',
      ''
    ].join('\r\n')
    expect(parseProgIdOutput(output)).toBe('ChromeHTML')
    expect(parseProgIdOutput('ERROR: The system was unable to find the specified registry key or value.')).toBeNull()
  })

  it('maps Windows ProgIds to the browsers Snag can open', () => {
    expect(browserForProgId('ChromeHTML')?.id).toBe('chrome')
    expect(browserForProgId('ChromeHTML.7SCCDD2HD5SBK3BJPM7NF7BGKR')?.id).toBe('chrome')
    expect(browserForProgId('MSEdgeHTM')?.id).toBe('edge')
    expect(browserForProgId('BraveHTML')?.id).toBe('brave')
    expect(browserForProgId('FirefoxURL-308046B0AF4A39CB')).toBeNull()
    expect(browserForProgId(null)).toBeNull()
  })
})
