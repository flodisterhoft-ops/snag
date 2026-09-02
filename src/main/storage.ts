import { app } from 'electron'
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { StorageStatus } from '@shared/types'

// Windows gives every MSIX-packaged app — and every process such an app
// starts, e.g. Snag launched from a terminal embedded in an AI assistant — a
// private view of AppData and of the per-user registry. Inside that view
// Snag still believes it writes to %APPDATA%\snag, but the files really land
// in %LOCALAPPDATA%\Packages\<package>\LocalCache\Roaming\snag and the
// snag:// handler lands in the package's private registry hive. Chrome and
// the rest of Windows only ever see the real locations, so the extension
// folder Snag shows "does not exist" and snag:// links never open the app.
//
// Reads are merged, so a redirected process cannot notice by looking at its
// own paths. The probe below writes a nonce through the redirected view and
// looks for it at the physical LocalCache locations, which are readable from
// anywhere.

const PROBE_FILE = '.snag-storage-probe'

// Files worth carrying over from a sandboxed run so a normal restart keeps
// the user's settings, queue history, and pairing token.
const MIGRATED_FILES = ['settings.json', 'jobs.json', 'local-api-token', join('tools', 'yt-dlp.exe')]

export interface SandboxedCopy {
  packageFamily: string
  path: string
  modifiedAt: number
}

export function packagesDir(localAppData = process.env['LOCALAPPDATA']): string | null {
  if (process.platform !== 'win32' || !localAppData) return null
  const dir = join(localAppData, 'Packages')
  return existsSync(dir) ? dir : null
}

// Every packaged app's private copy of the userData folder, newest first.
export function sandboxedCopies(
  logicalUserData: string,
  packages: string | null = packagesDir()
): SandboxedCopy[] {
  if (!packages) return []
  const appDir = basename(logicalUserData)
  let families: string[]
  try {
    families = readdirSync(packages)
  } catch {
    return []
  }
  const copies: SandboxedCopy[] = []
  for (const packageFamily of families) {
    const path = join(packages, packageFamily, 'LocalCache', 'Roaming', appDir)
    try {
      const stat = statSync(path)
      if (stat.isDirectory()) copies.push({ packageFamily, path, modifiedAt: stat.mtimeMs })
    } catch {
      /* not this package */
    }
  }
  return copies.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export function writeStorageProbe(logicalUserData: string): string {
  const nonce = randomBytes(16).toString('hex')
  mkdirSync(logicalUserData, { recursive: true })
  writeFileSync(join(logicalUserData, PROBE_FILE), nonce, 'utf8')
  return nonce
}

export function findStorageProbe(nonce: string, copies: SandboxedCopy[]): SandboxedCopy | null {
  for (const copy of copies) {
    try {
      if (readFileSync(join(copy.path, PROBE_FILE), 'utf8').trim() === nonce) return copy
    } catch {
      /* no probe in this copy */
    }
  }
  return null
}

export function detectStorageRedirection(
  logicalUserData: string,
  packages: string | null = packagesDir()
): StorageStatus {
  const status: StorageStatus = {
    redirected: false,
    logicalPath: logicalUserData,
    physicalPath: logicalUserData,
    packageFamily: null
  }
  if (!packages) return status
  let nonce: string
  try {
    nonce = writeStorageProbe(logicalUserData)
  } catch {
    return status
  }
  try {
    const hit = findStorageProbe(nonce, sandboxedCopies(logicalUserData, packages))
    if (hit) {
      status.redirected = true
      status.physicalPath = hit.path
      status.packageFamily = hit.packageFamily
    }
  } finally {
    rmSync(join(logicalUserData, PROBE_FILE), { force: true })
  }
  return status
}

// Translate a path under the logical userData folder to where it really is.
export function toPhysicalPath(status: StorageStatus, target: string): string {
  if (!status.redirected) return target
  const rel = relative(resolve(status.logicalPath), resolve(target))
  if (rel === '') return status.physicalPath
  if (isAbsolute(rel) || rel.split(sep).includes('..')) return target
  return join(status.physicalPath, rel)
}

// Bring the files a sandboxed run produced into the real userData folder.
// Only fills gaps: a normal install that already has its own data wins.
export function importSandboxedUserData(
  logicalUserData: string,
  packages: string | null = packagesDir()
): string[] {
  const imported: string[] = []
  const copies = sandboxedCopies(logicalUserData, packages)
  if (copies.length === 0) return imported
  for (const file of MIGRATED_FILES) {
    const destination = join(logicalUserData, file)
    if (existsSync(destination)) continue
    const source = copies.map((copy) => join(copy.path, file)).find((candidate) => existsSync(candidate))
    if (!source) continue
    try {
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(source, destination)
      imported.push(file)
    } catch (err) {
      console.error(`[snag] Could not import ${file} from a sandboxed run:`, err)
    }
  }
  return imported
}

let cached: StorageStatus | null = null

// Probe once per process; the answer cannot change while Snag runs.
export function getStorageStatus(): StorageStatus {
  if (cached) return cached
  const logical = app.getPath('userData')
  // Development aid: SNAG_SIMULATE_SANDBOX=<folder> renders the redirected
  // state without a packaged parent app. Ignored in packaged builds.
  const simulated = !app.isPackaged && process.env['SNAG_SIMULATE_SANDBOX']?.trim()
  cached = simulated
    ? { redirected: true, logicalPath: logical, physicalPath: simulated, packageFamily: 'Simulated.Sandbox_dev' }
    : detectStorageRedirection(logical)
  return cached
}

export function resetStorageStatusForTests(): void {
  cached = null
}

// Start a fresh Snag through explorer.exe — the desktop shell carries no
// package identity, so the new process gets the real AppData and registry —
// then let this one quit. Downloads in flight are canceled like any quit.
export function relaunchOutsideSandbox(): boolean {
  if (process.platform !== 'win32') return false
  if (process.defaultApp) {
    console.warn('[snag] Relaunching outside the sandbox is only available in packaged builds.')
    return false
  }
  const executable = process.env['PORTABLE_EXECUTABLE_FILE']?.trim() || process.execPath
  const explorer = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'explorer.exe')
  app.once('will-quit', () => {
    try {
      const child = spawn(explorer, [executable], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
    } catch (err) {
      console.error('[snag] Could not relaunch outside the sandbox:', err)
    }
  })
  app.releaseSingleInstanceLock()
  app.quit()
  return true
}
