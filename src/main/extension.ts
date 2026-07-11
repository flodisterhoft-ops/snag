import { app } from 'electron'
import { cpSync, existsSync } from 'fs'
import { join } from 'path'
import type { ExtensionInstallResult } from '@shared/types'

// The extension ships inside the app (extraResources in the packaged build,
// the repo folder in dev). Chrome must load it from a path that survives app
// updates and doesn't point into the install directory, so "installing" means
// copying it into userData and letting the user run Load unpacked on that copy.

function bundledExtensionDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'extension')
    : join(app.getAppPath(), 'extension')
}

function installDir(): string {
  return join(app.getPath('userData'), 'browser-extension')
}

export function getInstalledExtensionPath(): string | null {
  const dir = installDir()
  return existsSync(join(dir, 'manifest.json')) ? dir : null
}

export function installBrowserExtension(): ExtensionInstallResult {
  const src = bundledExtensionDir()
  if (!existsSync(join(src, 'manifest.json'))) {
    return { ok: false, error: 'The bundled extension files were not found.' }
  }
  try {
    const dest = installDir()
    cpSync(src, dest, { recursive: true })
    return { ok: true, path: dest }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
