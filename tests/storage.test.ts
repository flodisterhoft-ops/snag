import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\SnagTest',
    once: vi.fn(),
    releaseSingleInstanceLock: vi.fn(),
    quit: vi.fn()
  }
}))

import {
  detectStorageRedirection,
  findStorageProbe,
  importSandboxedUserData,
  sandboxedCopies,
  toPhysicalPath,
  writeStorageProbe
} from '../src/main/storage'
import type { StorageStatus } from '../src/shared/types'

const tempDirs: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'snag-storage-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// Builds %LOCALAPPDATA%\Packages\<family>\LocalCache\Roaming\<app> like MSIX does.
function sandbox(packages: string, family: string, app: string, ageSeconds: number): string {
  const dir = join(packages, family, 'LocalCache', 'Roaming', app)
  mkdirSync(dir, { recursive: true })
  const when = new Date(Date.now() - ageSeconds * 1000)
  utimesSync(dir, when, when)
  return dir
}

describe('sandboxed userData copies', () => {
  it('lists only packages holding a copy of this app, newest first', () => {
    const packages = scratch()
    const logical = join(scratch(), 'snag')
    const old = sandbox(packages, 'Vendor.OldApp_abc', 'snag', 3600)
    const fresh = sandbox(packages, 'Vendor.NewApp_def', 'snag', 60)
    sandbox(packages, 'Vendor.Other_ghi', 'other-app', 10)
    mkdirSync(join(packages, 'Vendor.Empty_jkl'))

    expect(sandboxedCopies(logical, packages).map((copy) => copy.path)).toEqual([fresh, old])
    expect(sandboxedCopies(logical, packages)[0].packageFamily).toBe('Vendor.NewApp_def')
    expect(sandboxedCopies(logical, null)).toEqual([])
    expect(sandboxedCopies(logical, join(packages, 'missing'))).toEqual([])
  })
})

describe('storage redirection probe', () => {
  it('reports a normal install as not redirected and cleans up its probe', () => {
    const packages = scratch()
    const logical = join(scratch(), 'snag')
    sandbox(packages, 'Vendor.App_abc', 'snag', 60)

    const status = detectStorageRedirection(logical, packages)
    expect(status).toEqual({
      redirected: false,
      logicalPath: logical,
      physicalPath: logical,
      packageFamily: null
    })
    expect(existsSync(join(logical, '.snag-storage-probe'))).toBe(false)
  })

  it('recognizes its own nonce inside a package LocalCache copy', () => {
    const packages = scratch()
    const logical = join(scratch(), 'snag')
    const stale = sandbox(packages, 'Vendor.Stale_abc', 'snag', 600)
    writeFileSync(join(stale, '.snag-storage-probe'), 'an-old-nonce', 'utf8')
    const live = sandbox(packages, 'Vendor.Live_def', 'snag', 5)

    // Simulate Windows redirecting the write into the package's private folder.
    const nonce = writeStorageProbe(logical)
    writeFileSync(join(live, '.snag-storage-probe'), nonce, 'utf8')

    const hit = findStorageProbe(nonce, sandboxedCopies(logical, packages))
    expect(hit?.packageFamily).toBe('Vendor.Live_def')
    expect(hit?.path).toBe(live)
    expect(findStorageProbe('something-else', sandboxedCopies(logical, packages))).toBeNull()
  })
})

describe('toPhysicalPath', () => {
  const status: StorageStatus = {
    redirected: true,
    logicalPath: 'C:\\Users\\me\\AppData\\Roaming\\snag',
    physicalPath: 'C:\\Users\\me\\AppData\\Local\\Packages\\Vendor.App_abc\\LocalCache\\Roaming\\snag',
    packageFamily: 'Vendor.App_abc'
  }

  it('maps folders under the logical userData to the real location', () => {
    expect(toPhysicalPath(status, join(status.logicalPath, 'browser-extension'))).toBe(
      join(status.physicalPath, 'browser-extension')
    )
    expect(toPhysicalPath(status, status.logicalPath)).toBe(status.physicalPath)
  })

  it('leaves unrelated paths and non-redirected installs alone', () => {
    expect(toPhysicalPath(status, 'C:\\Users\\me\\Downloads')).toBe('C:\\Users\\me\\Downloads')
    expect(toPhysicalPath(status, join(status.logicalPath, '..', 'other'))).toBe(
      join(status.logicalPath, '..', 'other')
    )
    const plain: StorageStatus = { ...status, redirected: false, physicalPath: status.logicalPath }
    expect(toPhysicalPath(plain, join(plain.logicalPath, 'browser-extension'))).toBe(
      join(plain.logicalPath, 'browser-extension')
    )
  })
})

describe('importSandboxedUserData', () => {
  it('fills missing files from the newest sandboxed run without overwriting', () => {
    const packages = scratch()
    const logical = join(scratch(), 'snag')
    mkdirSync(logical, { recursive: true })
    writeFileSync(join(logical, 'settings.json'), '{"mine":true}', 'utf8')

    const older = sandbox(packages, 'Vendor.Older_abc', 'snag', 3600)
    writeFileSync(join(older, 'local-api-token'), 'older-token', 'utf8')
    writeFileSync(join(older, 'jobs.json'), '{"jobs":["older"]}', 'utf8')
    const newer = sandbox(packages, 'Vendor.Newer_def', 'snag', 60)
    writeFileSync(join(newer, 'settings.json'), '{"theirs":true}', 'utf8')
    writeFileSync(join(newer, 'jobs.json'), '{"jobs":["newer"]}', 'utf8')
    mkdirSync(join(newer, 'tools'))
    writeFileSync(join(newer, 'tools', 'yt-dlp.exe'), 'binary', 'utf8')

    const imported = importSandboxedUserData(logical, packages)
    expect(imported.sort()).toEqual(['jobs.json', 'local-api-token', join('tools', 'yt-dlp.exe')].sort())
    expect(readFileSync(join(logical, 'settings.json'), 'utf8')).toBe('{"mine":true}')
    expect(readFileSync(join(logical, 'jobs.json'), 'utf8')).toBe('{"jobs":["newer"]}')
    expect(readFileSync(join(logical, 'local-api-token'), 'utf8')).toBe('older-token')
    expect(readFileSync(join(logical, 'tools', 'yt-dlp.exe'), 'utf8')).toBe('binary')
  })

  it('does nothing when no packaged app holds a copy', () => {
    const packages = scratch()
    const logical = join(scratch(), 'snag')
    expect(importSandboxedUserData(logical, packages)).toEqual([])
    expect(existsSync(logical)).toBe(false)
  })
})
