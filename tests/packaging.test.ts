import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

describe('Windows packaging', () => {
  it('analyzes YouTube with the fast client set first and keeps the wide set for downloads', () => {
    const metadata = readFileSync('src/main/metadata.ts', 'utf8')
    const args = readFileSync('src/main/args.ts', 'utf8')
    expect(args).toContain("export const YOUTUBE_FAST_CLIENT_ARGS = ['--extractor-args', 'youtube:player_client=default']")
    expect(metadata).toContain('...YOUTUBE_FAST_CLIENT_ARGS, url]')
    expect(metadata).toContain('return runYtdlpJson([...base, ...YOUTUBE_CLIENT_ARGS, url], ytdlpOverride)')
    // Downloads still request the wider set, so analyzed format IDs always exist.
    expect(args).toContain('...YOUTUBE_CLIENT_ARGS,')
    expect(args).toContain("'--progress-template',")
  })

  it('pins and ships aria2 next to yt-dlp and ffmpeg', () => {
    const manifest = JSON.parse(readFileSync('build/tools/TOOLS_MANIFEST.json', 'utf8')) as {
      tools: { id: string; files: { output: string; sha256: string }[] }[]
    }
    const aria2 = manifest.tools.find((t) => t.id === 'aria2')
    expect(aria2?.files.map((f) => f.output)).toEqual(['aria2c.exe', 'aria2-COPYING.txt'])
    const builder = readFileSync('electron-builder.yml', 'utf8')
    expect(builder).toContain('- aria2c.exe')
    expect(builder).toContain('- aria2-COPYING.txt')
    expect(readFileSync('build/tools/THIRD_PARTY_TOOLS.txt', 'utf8')).toContain('aria2 1.37.0')
  })

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
    expect(content).toContain("renderLoading('Starting Snag…')")
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

  it('answers every local API request through sendJson (1.8.5 shipped a self-calling reply helper)', () => {
    const api = readFileSync('src/main/localApi.ts', 'utf8')
    expect(api).toContain('const reply = (status: number, payload: unknown): void => sendJson(res, status, payload, origin)')
    expect(api).not.toMatch(/=>\s*reply\(/)
  })

  it('opens Telegram with the file and retains the Windows Share fallback', () => {
    const share = readFileSync('src/main/share.ts', 'utf8')
    const ipc = readFileSync('src/main/ipc.ts', 'utf8')
    const downloader = readFileSync('src/main/downloader.ts', 'utf8')
    expect(share).toContain('$verb.DoIt()')
    // Windows PowerShell 5.1 rejects Split-Path -LiteralPath together with -Parent, which
    // made every Share panel request fail with 'could not open the Share panel'.
    expect(share).not.toMatch(/\(Split-Path /)
    expect(share).toContain('[System.IO.Path]::GetDirectoryName($target)')
    expect(share).toContain('[System.IO.Path]::GetFileName($target)')
    expect(share).toContain("join(process.env['APPDATA'], 'Telegram Desktop', 'Telegram.exe')")
    expect(share).toContain("spawn(telegram, ['--', telegramTarget]")
    expect(share).toContain("`${basename(target, extname(target))}.webm`")
    expect(share).toContain('linkSync(target, shareTarget)')
    expect(share).toContain('recentTelegramShares')
    expect(share).toContain('return openWindowsShareSheet(target)')
    expect(ipc).toContain('cleanupTelegramMediaPath(job.filepath)')
    expect(ipc).toContain("handleTrusted('shareFile'")
    expect(ipc).toContain("handleTrusted('deleteCompletedFiles'")
    // "Share when done" reuses the same path once a download finishes.
    expect(downloader).toContain('job.request.shareWhenDone')
    expect(downloader).toContain('void shareFile(path, job.request.shareTarget)')
  })
})
