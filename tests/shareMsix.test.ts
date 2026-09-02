import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\SnagTest', getFileIcon: async () => ({ isEmpty: () => true, toDataURL: () => '' }) }
}))

import { msixAppIcon, msixExecutionAlias, msixPackageRoot, pickLogoFile } from '../src/main/share'

// A tiny PNG (1x1) is enough: the icon is passed through as a data URL.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

describe('Store (MSIX) share apps', () => {
  let base: string
  let root: string
  let localAppData: string | undefined

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'snag-msix-'))
    root = join(base, 'WindowsApps', 'Vendor.App_1.0.0.0_x64__abc123')
    mkdirSync(join(root, 'Assets'), { recursive: true })
    writeFileSync(
      join(root, 'AppxManifest.xml'),
      `<?xml version="1.0"?><Package><Applications><Application Id="App" Executable="bin\\App.exe">
        <uap:VisualElements DisplayName="App" Square150x150Logo="Assets/Square150x150Logo.png" Square44x44Logo="Assets/Square44x44Logo.png" BackgroundColor="transparent"/>
        <Extensions><uap5:Extension Category="windows.appExecutionAlias"><uap5:AppExecutionAlias><uap5:ExecutionAlias Alias="app.exe"/></uap5:AppExecutionAlias></uap5:Extension></Extensions>
      </Application></Applications></Package>`
    )
    for (const name of [
      'Square44x44Logo.targetsize-32.png',
      'Square44x44Logo.targetsize-64.png',
      'Square44x44Logo.targetsize-64_altform-unplated.png',
      'Square44x44Logo.targetsize-64_altform-lightunplated.png',
      'Square44x44LogoOther.png'
    ]) {
      writeFileSync(join(root, 'Assets', name), PNG)
    }
    localAppData = process.env['LOCALAPPDATA']
    process.env['LOCALAPPDATA'] = join(base, 'Local')
    mkdirSync(join(base, 'Local', 'Microsoft', 'WindowsApps'), { recursive: true })
    writeFileSync(join(base, 'Local', 'Microsoft', 'WindowsApps', 'app.exe'), '')
  })

  afterAll(() => {
    process.env['LOCALAPPDATA'] = localAppData
    rmSync(base, { recursive: true, force: true })
  })

  it('recognises package roots under WindowsApps only', () => {
    expect(msixPackageRoot('C:\\Program Files\\WindowsApps\\Vendor.App_1.0_x64__abc\\bin\\App.exe')).toBe(
      'C:\\Program Files\\WindowsApps\\Vendor.App_1.0_x64__abc'
    )
    expect(msixPackageRoot('C:\\Program Files\\Telegram Desktop\\Telegram.exe')).toBeNull()
  })

  it('prefers the largest unplated logo variant', () => {
    const names = [
      'Square44x44Logo.targetsize-32.png',
      'Square44x44Logo.targetsize-64.png',
      'Square44x44Logo.targetsize-64_altform-unplated.png',
      'Square44x44Logo.targetsize-64_altform-lightunplated.png',
      'Square44x44Logo.targetsize-256_contrast-white.png',
      'Square44x44LogoOther.png'
    ]
    expect(pickLogoFile(names, 'Square44x44Logo')).toBe('Square44x44Logo.targetsize-64_altform-unplated.png')
    expect(pickLogoFile(['Square44x44Logo.scale-100.png', 'Square44x44Logo.scale-200.png'], 'Square44x44Logo')).toBe(
      'Square44x44Logo.scale-200.png'
    )
    expect(pickLogoFile(['Square44x44Logo.png'], 'Square44x44Logo')).toBe('Square44x44Logo.png')
    expect(pickLogoFile(['Wide310x150Logo.png'], 'Square44x44Logo')).toBeNull()
  })

  it('reads the logo from the package as a PNG data URL', () => {
    const icon = msixAppIcon(join(root, 'bin', 'App.exe'))
    expect(icon).toBe('data:image/png;base64,' + PNG.toString('base64'))
    expect(msixAppIcon('C:\\Program Files\\Telegram Desktop\\Telegram.exe')).toBeNull()
  })

  it('launches through the execution alias when Windows provides one', () => {
    expect(msixExecutionAlias(join(root, 'bin', 'App.exe'))).toBe(
      join(base, 'Local', 'Microsoft', 'WindowsApps', 'app.exe')
    )
    expect(msixExecutionAlias('C:\\Program Files\\Telegram Desktop\\Telegram.exe')).toBeNull()
  })
})
