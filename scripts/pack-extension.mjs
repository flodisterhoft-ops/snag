// Builds the zip that the Chrome Web Store developer dashboard accepts.
//
//   node scripts/pack-extension.mjs        -> dist/snag-chrome-extension-<version>.zip
//
// The bundled config.js placeholder is shipped as-is: a store-installed copy
// pairs with the running Snag app automatically over the loopback API (the
// manifest `key` pins the extension ID that Snag trusts), so no per-install
// token is needed. README.md is left out of the package.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const projectDir = resolve(import.meta.dirname, '..')
const source = join(projectDir, 'extension')
const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'))
const appVersion = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')).version
const outputDir = join(projectDir, 'dist')
const output = join(outputDir, `snag-chrome-extension-${manifest.version}.zip`)

const FILES = ['manifest.json', 'background.js', 'config.js', 'content.js', 'content.css']
const ICONS = ['icon16.png', 'icon48.png', 'icon128.png']

if (!manifest.key) throw new Error('extension/manifest.json must keep its `key` so the store ID stays pinned.')

// The extension version tracks the app version, so chrome://extensions and the
// store zip name both say which Snag release the copy on disk came from.
if (manifest.version !== appVersion) {
  throw new Error(
    `extension/manifest.json is version ${manifest.version} but the app is ${appVersion}; bump the manifest to match.`
  )
}

const staging = mkdtempSync(join(tmpdir(), 'snag-extension-pack-'))
try {
  mkdirSync(join(staging, 'icons'))
  for (const file of FILES) copyFileSync(join(source, file), join(staging, file))
  for (const icon of ICONS) copyFileSync(join(source, 'icons', icon), join(staging, 'icons', icon))

  mkdirSync(outputDir, { recursive: true })
  rmSync(output, { force: true })
  // Windows ships bsdtar, which writes zip archives when told to (-a).
  const systemTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  const result = spawnSync(existsSync(systemTar) ? systemTar : 'tar', ['-a', '-c', '-f', output, '-C', staging, '.'], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.error || result.status !== 0) {
    throw new Error(`Could not create ${output}: ${result.error?.message || result.stderr || `exit ${result.status}`}`)
  }
  console.log(`Packed extension ${manifest.version} (app ${appVersion}): ${output}`)
  console.log('Upload it at https://chrome.google.com/webstore/devconsole, then set CHROME_WEB_STORE_PUBLISHED')
  console.log('to true in src/shared/browserIntegration.ts so Snag installs it with one click.')
} finally {
  rmSync(staging, { recursive: true, force: true })
}
