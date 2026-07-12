import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Array<(value: any) => void>>()
  return {
    listeners,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    send: vi.fn(),
    on: vi.fn((event: string, listener: (value: any) => void) => {
      const current = listeners.get(event) ?? []
      current.push(listener)
      listeners.set(event, current)
    })
  }
})

vi.mock('fs', () => ({ appendFileSync: vi.fn(), mkdirSync: vi.fn() }))
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '1.7.0',
    getPath: () => 'C:\\SnagTest'
  },
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.send } }]
  }
}))
vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: mocks.on,
    checkForUpdates: mocks.checkForUpdates,
    downloadUpdate: mocks.downloadUpdate,
    quitAndInstall: mocks.quitAndInstall
  }
}))

async function loadUpdater(): Promise<typeof import('../src/main/appUpdater')> {
  vi.resetModules()
  mocks.listeners.clear()
  return import('../src/main/appUpdater')
}

beforeEach(() => {
  mocks.checkForUpdates.mockReset()
  mocks.downloadUpdate.mockReset()
  mocks.quitAndInstall.mockReset()
  mocks.send.mockReset()
  mocks.on.mockClear()
  delete process.env['PORTABLE_EXECUTABLE_FILE']
})

describe('app updater state recovery', () => {
  it('marks a cached installer ready even when no downloaded event reaches the renderer', async () => {
    mocks.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.7.1' } })
    mocks.downloadUpdate.mockResolvedValue(['cached-installer.exe'])
    const updater = await loadUpdater()

    await expect(updater.downloadAppUpdate()).resolves.toEqual({ ok: true, downloaded: true })
    expect(mocks.send).toHaveBeenCalledWith('appUpdateDownloaded', '1.7.1')
    expect(updater.installAppUpdate()).toBe(true)
    expect(mocks.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('rechecks the release version instead of reusing a stale downloaded target', async () => {
    mocks.checkForUpdates
      .mockResolvedValueOnce({ updateInfo: { version: '1.7.1' } })
      .mockResolvedValueOnce({ updateInfo: { version: '1.7.2' } })
    mocks.downloadUpdate.mockResolvedValue(['installer.exe'])
    const updater = await loadUpdater()

    await updater.downloadAppUpdate()
    await expect(updater.downloadAppUpdate()).resolves.toEqual({ ok: true, downloaded: true })

    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(mocks.downloadUpdate).toHaveBeenCalledTimes(2)
    expect(mocks.send).toHaveBeenLastCalledWith('appUpdateDownloaded', '1.7.2')
  })
})
