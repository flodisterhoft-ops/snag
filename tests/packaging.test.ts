import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

describe('Windows packaging', () => {
  it('ships the tray image and retains an application-icon fallback', () => {
    const builder = readFileSync('electron-builder.yml', 'utf8')
    const tray = readFileSync('src/main/tray.ts', 'utf8')

    expect(builder).toContain('- resources/tray.png')
    expect(builder).toContain('- CHANGELOG.md')
    expect(tray).toContain("import trayIconPath from '../../resources/tray.png?asset'")
    expect(tray).toContain("import appIconPath from '../../build/icon.ico?asset'")
    expect(tray).toContain('bundledTrayIcon.isEmpty()')
  })
})
