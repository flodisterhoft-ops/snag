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

  it('prepares and refreshes the stable Chrome extension folder on every launch', () => {
    const extension = readFileSync('src/main/extension.ts', 'utf8')
    expect(extension).toContain('export function refreshInstalledBrowserExtension(): ExtensionInstallResult')
    expect(extension).toContain('return installBrowserExtension()')
    expect(extension).not.toContain('if (!getInstalledExtensionPath()) return null')
  })

  it('uses the Windows Share verb so registered apps receive the actual file', () => {
    const ipc = readFileSync('src/main/ipc.ts', 'utf8')
    expect(ipc).toContain("$verb.DoIt()")
    expect(ipc).toContain("handleTrusted('shareFile'")
    expect(ipc).toContain("handleTrusted('deleteCompletedFiles'")
  })
})
