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
    const content = readFileSync('extension/content.js', 'utf8')
    expect(extension).toContain('export function refreshInstalledBrowserExtension(): ExtensionInstallResult')
    expect(extension).toContain('return installBrowserExtension()')
    expect(extension).not.toContain('if (!getInstalledExtensionPath()) return null')
    // The path handed to Chrome must be the physical folder even when a
    // packaged parent app redirects this process's AppData.
    expect(extension).toContain('toPhysicalPath(')
    expect(extension).toContain('refreshSandboxedCopies()')
    expect(content).toContain('const analysisByUrl = new Map()')
    expect(content).toContain('prefetchAnalysis(video)')
    expect(content).toContain('requestAnalysis(pageUrl)')
    expect(content).toContain("video.closest('ytd-video-preview')")
    expect(content).toContain('https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}')
    expect(content).toContain("el('strong', null, 'Opened in Snag')")
    expect(content).not.toContain('void start()\n          return')
    expect(readFileSync('extension/background.js', 'utf8')).toContain("apiFetch(port, '/health'")
    expect(content).toContain('Set your preferred audio language in Settings.')
    expect(content).toContain("type: 'snag:open-settings', section: 'languages'")
    // The panel is pinned where it opened and the button dodges player controls.
    expect(content).toContain('function clampPanel(host)')
    expect(content).not.toContain('if (panel) panel.reposition()')
    expect(content).toContain('document.elementsFromPoint(')
    expect(content).toContain('function pageMeta(video)')
    expect(content).toContain('state.groups.filter((g) => favorites.includes(langBase(g.language)))')

    const windows = readFileSync('src/main/windows.ts', 'utf8')
    const preload = readFileSync('src/preload/index.ts', 'utf8')
    expect(windows).toContain("win.webContents.send('openSettings', section)")
    expect(preload).toContain("ipcRenderer.on('openSettings', listener)")
  })

  it('opens the extensions page in Chrome, Edge, or Brave and relaunches outside a sandbox', () => {
    const ipc = readFileSync('src/main/ipc.ts', 'utf8')
    const browsers = readFileSync('src/main/browsers.ts', 'utf8')
    expect(browsers).toContain("scheme: 'chrome'")
    expect(browsers).toContain("scheme: 'edge'")
    expect(browsers).toContain("scheme: 'brave'")
    expect(ipc).toContain("handleTrusted('beginExtensionSetup'")
    expect(ipc).toContain("handleTrusted('getDefaultBrowser'")
    expect(ipc).toContain("handleTrusted('openBrowserExtensionsPage'")
    expect(ipc).toContain("handleTrusted('revealBrowserExtensionFolder'")
    expect(ipc).toContain("handleTrusted('relaunchOutsideSandbox'")
    expect(ipc).toContain('BrowserWindow.fromWebContents(e.sender)')
    const index = readFileSync('src/main/index.ts', 'utf8')
    expect(index).toContain('importSandboxedUserData(app.getPath(')
    expect(index).toContain('applyGlobalShortcut(loadSettings().globalShortcutEnabled)')
    expect(index).toContain('startClipboardWatcher()')
    expect(index).toContain("globalShortcut.unregisterAll()")
  })

  it('ships the extension cookie export behind the cookies permission', () => {
    const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8')) as { permissions: string[]; version: string }
    expect(manifest.permissions).toContain('cookies')
    const background = readFileSync('extension/background.js', 'utf8')
    expect(background).toContain("apiFetch(port, '/cookies'")
    expect(background).toContain('data.cookieSyncWanted === true')
    const html = readFileSync('src/renderer/index.html', 'utf8')
    expect(html).toContain("media-src 'self' https: http: blob:")
  })

  it('opens Telegram with the file and retains the Windows Share fallback', () => {
    const ipc = readFileSync('src/main/ipc.ts', 'utf8')
    expect(ipc).toContain("$verb.DoIt()")
    expect(ipc).toContain("spawn(telegram, ['--', telegramTarget]")
    expect(ipc).toContain("`${basename(target, extname(target))}.webm`")
    expect(ipc).toContain('linkSync(target, shareTarget)')
    expect(ipc).toContain('cleanupTelegramMediaPath(job.filepath)')
    expect(ipc).toContain('recentTelegramShares')
    expect(ipc).toContain('return openWindowsShareSheet(target)')
    expect(ipc).toContain("handleTrusted('shareFile'")
    expect(ipc).toContain("handleTrusted('deleteCompletedFiles'")
  })
})
