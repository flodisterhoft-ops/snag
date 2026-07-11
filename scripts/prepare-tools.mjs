import { createHash } from 'node:crypto'
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'

const projectDir = resolve(import.meta.dirname, '..')
const outputDir = join(projectDir, 'build', 'tools')
const manifestPath = join(outputDir, 'TOOLS_MANIFEST.json')
const validateOnly = process.argv.includes('--validate-manifest')
const HASH_RE = /^[a-f0-9]{64}$/

function loadManifest() {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read ${manifestPath}: ${error.message}`)
  }

  if (manifest.schemaVersion !== 1 || manifest.target !== 'win32-x64') {
    throw new Error('Tool manifest must use schemaVersion 1 and target win32-x64.')
  }
  if (!Array.isArray(manifest.tools) || manifest.tools.length !== 2) {
    throw new Error('Tool manifest must define exactly yt-dlp and ffmpeg.')
  }

  const ids = new Set()
  const outputs = new Set()
  for (const tool of manifest.tools) {
    if (!['yt-dlp', 'ffmpeg'].includes(tool.id) || ids.has(tool.id)) {
      throw new Error(`Unexpected or duplicate tool id: ${tool.id}`)
    }
    ids.add(tool.id)
    if (typeof tool.version !== 'string' || !tool.version.trim()) {
      throw new Error(`${tool.id} must have an exact version.`)
    }
    validateDownload(tool.download, `${tool.id}.download`)

    if (!Array.isArray(tool.files) || tool.files.length === 0) {
      throw new Error(`${tool.id} must define at least one output file.`)
    }
    for (const file of tool.files) {
      if (tool.download.kind === 'zip') validateArchivePath(file.path, `${tool.id}.files.path`)
      else if (file.path != null) throw new Error(`${tool.id} direct files must not set path.`)
      validateOutput(file.output, `${tool.id}.files.output`)
      validateHash(file.sha256, `${tool.id}.${file.output}.sha256`)
      if (outputs.has(file.output)) throw new Error(`Duplicate output filename: ${file.output}`)
      outputs.add(file.output)
    }
  }

  if (!ids.has('yt-dlp') || !ids.has('ffmpeg')) {
    throw new Error('Tool manifest must define yt-dlp and ffmpeg.')
  }

  if (!Array.isArray(manifest.supportFiles) || manifest.supportFiles.length === 0) {
    throw new Error('Tool manifest must define pinned support/license files.')
  }
  for (const file of manifest.supportFiles) {
    validateDownload({ kind: 'file', url: file.url, sha256: file.sha256 }, 'supportFiles')
    validateOutput(file.output, 'supportFiles.output')
    if (outputs.has(file.output)) throw new Error(`Duplicate output filename: ${file.output}`)
    outputs.add(file.output)
  }
  return manifest
}

function validateDownload(download, field) {
  if (!download || !['file', 'zip'].includes(download.kind)) {
    throw new Error(`${field}.kind must be file or zip.`)
  }
  let url
  try {
    url = new URL(download.url)
  } catch {
    throw new Error(`${field}.url is invalid.`)
  }
  if (url.protocol !== 'https:') throw new Error(`${field}.url must use HTTPS.`)
  if (/\/(latest|master)(\/|$)/i.test(url.pathname)) {
    throw new Error(`${field}.url must be immutable, not a latest/master alias.`)
  }
  validateHash(download.sha256, `${field}.sha256`)
}

function validateHash(hash, field) {
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) {
    throw new Error(`${field} must be a lowercase SHA-256 value.`)
  }
}

function validateOutput(output, field) {
  if (typeof output !== 'string' || !output || basename(output) !== output) {
    throw new Error(`${field} must be a filename inside build/tools.`)
  }
}

function validateArchivePath(path, field) {
  if (
    typeof path !== 'string' ||
    !path ||
    isAbsolute(path) ||
    path.split(/[\\/]/).includes('..')
  ) {
    throw new Error(`${field} must be a safe relative archive path.`)
  }
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function hasExpectedHash(path, expected) {
  return existsSync(path) && (await sha256(path)) === expected
}

async function downloadVerified(url, expectedHash, destination) {
  if (await hasExpectedHash(destination, expectedHash)) return destination

  mkdirSync(dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.tmp`
  rmSync(temporary, { force: true })

  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(180_000),
    headers: { 'User-Agent': 'Snag-reproducible-build' }
  })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status} ${response.statusText}): ${url}`)
  }
  if (new URL(response.url).protocol !== 'https:') {
    throw new Error(`Refusing non-HTTPS redirect for ${url}`)
  }

  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }))
    const actual = await sha256(temporary)
    if (actual !== expectedHash) {
      throw new Error(`SHA-256 mismatch for ${url}\nexpected ${expectedHash}\nactual   ${actual}`)
    }
    rmSync(destination, { force: true })
    renameSync(temporary, destination)
    return destination
  } finally {
    rmSync(temporary, { force: true })
  }
}

async function installDirect(tool) {
  if (tool.files.length !== 1) throw new Error(`${tool.id} direct download must have one output.`)
  const file = tool.files[0]
  if (tool.download.sha256 !== file.sha256) {
    throw new Error(`${tool.id} download and output hashes must match.`)
  }
  const destination = join(outputDir, file.output)
  if (await hasExpectedHash(destination, file.sha256)) {
    console.log(`Verified ${tool.id} ${tool.version}: ${destination}`)
    return
  }
  await downloadVerified(tool.download.url, tool.download.sha256, destination)
  console.log(`Downloaded ${tool.id} ${tool.version}: ${destination}`)
}

async function installArchive(tool) {
  const cacheDir = join(tmpdir(), 'snag-pinned-tools')
  const archiveName = `${tool.id}-${tool.version}-${tool.download.sha256.slice(0, 12)}.zip`
  const archive = join(cacheDir, archiveName)
  await downloadVerified(tool.download.url, tool.download.sha256, archive)

  const extractDir = mkdtempSync(join(tmpdir(), 'snag-tool-extract-'))
  try {
    const result = spawnSync('tar', ['-xf', archive, '-C', extractDir], {
      encoding: 'utf8',
      windowsHide: true
    })
    if (result.error || result.status !== 0) {
      const detail = result.error?.message || result.stderr || `exit code ${result.status}`
      throw new Error(`Could not extract ${archiveName} with tar: ${detail}`)
    }

    for (const file of tool.files) {
      const normalized = file.path.replace(/[\\/]/g, sep)
      const source = join(extractDir, normalized)
      const expectedRoot = `${extractDir}${sep}`
      if (!source.startsWith(expectedRoot) || !existsSync(source)) {
        throw new Error(`Pinned archive is missing ${file.path}`)
      }
      const actual = await sha256(source)
      if (actual !== file.sha256) {
        throw new Error(
          `SHA-256 mismatch for ${file.path}\nexpected ${file.sha256}\nactual   ${actual}`
        )
      }
      const destination = join(outputDir, file.output)
      copyFileSync(source, destination)
      console.log(`Verified ${tool.id} ${tool.version}: ${destination}`)
    }
  } finally {
    rmSync(extractDir, { recursive: true, force: true })
  }
}

const manifest = loadManifest()
console.log(`Validated pinned tool manifest: ${manifestPath}`)

if (!validateOnly) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Packaged tools are pinned for 64-bit Windows; run this step on win32-x64.')
  }
  mkdirSync(outputDir, { recursive: true })
  for (const tool of manifest.tools) {
    if (tool.download.kind === 'file') await installDirect(tool)
    else await installArchive(tool)
  }
  for (const file of manifest.supportFiles) {
    const destination = join(outputDir, file.output)
    await downloadVerified(file.url, file.sha256, destination)
    console.log(`Verified support file: ${destination}`)
  }
}
