import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join, delimiter, dirname } from 'path'
import { execFileSync, spawn, type ChildProcess } from 'child_process'
import type { ToolStatus } from '@shared/types'
import { compareVersions } from './version'

const isWin = process.platform === 'win32'
const VERSION_TIMEOUT_MS = 5000
const UPDATE_TIMEOUT_MS = 120000
const ANALYZE_TIMEOUT_MS = 60000

// Modern YouTube extraction requires an external JavaScript runtime. Electron
// already ships a current Node runtime, so reuse it instead of making every
// Snag user install Deno separately. ELECTRON_RUN_AS_NODE makes the packaged
// Snag executable behave like the Node CLI when yt-dlp launches it.
export function ytdlpRuntimeArgs(runtimePath: string = process.execPath): string[] {
  return ['--no-js-runtimes', '--js-runtimes', `node:${runtimePath}`]
}

export function ytdlpChildEnv(
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' }
}

interface ExecFailure extends Error {
  stdout?: string
  stderr?: string
  timedOut?: boolean
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return
  try {
    if (isWin) {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5000,
        stdio: 'ignore'
      })
    } else {
      // Bounded spawns below create a process group on Unix so descendants are not orphaned.
      process.kill(-child.pid, 'SIGKILL')
    }
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already exited */
    }
  }
}

function execFileBounded(
  bin: string,
  args: string[],
  timeoutMs: number,
  maxBuffer: number,
  env?: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined
    let timedOut = false
    let settled = false
    let stdout = ''
    let stderr = ''
    const child = spawn(bin, args, {
      windowsHide: true,
      detached: !isWin,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const finishError = (message: string): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      const failure = new Error(message) as ExecFailure
      failure.stdout = stdout
      failure.stderr = stderr
      failure.timedOut = timedOut
      reject(failure)
    }
    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (target === 'stdout') stdout += chunk.toString('utf8')
      else stderr += chunk.toString('utf8')
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBuffer) {
        killProcessTree(child)
        finishError('yt-dlp produced more output than Snag can safely process.')
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk))
    child.on('error', (error) => finishError(error.message))
    child.on('close', (code, signal) => {
      if (settled) return
      if (timer) clearTimeout(timer)
      if (timedOut) {
        finishError('yt-dlp timed out.')
      } else if (code !== 0) {
        finishError(`yt-dlp exited with code ${code ?? signal ?? 'unknown'}.`)
      } else {
        settled = true
        resolve({ stdout, stderr })
      }
    })
    timer = setTimeout(() => {
      timedOut = true
      killProcessTree(child)
      // Reject even if the OS cannot deliver a close event after termination.
      finishError('yt-dlp timed out.')
    }, timeoutMs)
    timer.unref()
  })
}

function exeNames(base: string): string[] {
  // Only match the PE executable: .cmd/.bat shims can't be launched via
  // execFile/spawn on CVE-2024-27980-patched Node without shell:true.
  return isWin ? [`${base}.exe`, base] : [base]
}

// Scan PATH (plus a few well-known install dirs) for an executable.
function which(base: string): string | null {
  const names = exeNames(base)
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean)

  // Common WinGet / manual install locations, in case PATH is trimmed.
  if (isWin && process.env.LOCALAPPDATA) {
    dirs.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'))
  }

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

let cachedYtdlp: string | null | undefined
let cachedFfmpeg: string | null | undefined

function bundledTool(base: string): string | null {
  const name = isWin ? `${base}.exe` : base
  const candidate = join(process.resourcesPath, 'tools', name)
  return existsSync(candidate) ? candidate : null
}

function managedYtdlp(): string {
  return join(app.getPath('userData'), 'tools', isWin ? 'yt-dlp.exe' : 'yt-dlp')
}

function readVersionSync(bin: string): string | null {
  try {
    const stdout = execFileSync(bin, ['--version'], {
      windowsHide: true,
      timeout: VERSION_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

function bundledYtdlpVersion(): string | null {
  try {
    const manifest = JSON.parse(
      readFileSync(join(process.resourcesPath, 'tools', 'TOOLS_MANIFEST.json'), 'utf8')
    ) as { tools?: { id?: string; version?: string }[] }
    const version = manifest.tools?.find((tool) => tool.id === 'yt-dlp')?.version
    return typeof version === 'string' && version.trim() ? version.trim() : null
  } catch {
    return null
  }
}

export function preferManagedYtdlp(
  managedVersion: string | null,
  bundledVersion: string | null
): boolean {
  if (!managedVersion) return false
  if (!bundledVersion) return true
  return compareVersions(managedVersion, bundledVersion) >= 0
}

export function locateYtdlp(override?: string | null): string | null {
  if (override && existsSync(override)) return override
  if (cachedYtdlp === undefined) {
    const managed = managedYtdlp()
    const bundled = bundledTool('yt-dlp')
    const hasManaged = existsSync(managed)

    // An updateable per-user copy may be newer than the bundled build, but must
    // not permanently shadow a newer executable delivered by a Snag upgrade.
    if (hasManaged && bundled) {
      const bundledVersion = bundledYtdlpVersion() || readVersionSync(bundled)
      cachedYtdlp = preferManagedYtdlp(readVersionSync(managed), bundledVersion)
        ? managed
        : bundled
    } else {
      cachedYtdlp = (hasManaged ? managed : null) || bundled || which('yt-dlp')
    }
  }
  return cachedYtdlp
}

export function locateFfmpeg(): string | null {
  if (cachedFfmpeg === undefined) cachedFfmpeg = bundledTool('ffmpeg') || which('ffmpeg')
  return cachedFfmpeg
}

// Directory passed to yt-dlp's --ffmpeg-location so it always finds ffmpeg,
// even if the packaged app's PATH differs from the shell's.
export function ffmpegDir(): string | null {
  const p = locateFfmpeg()
  return p ? dirname(p) : null
}

export function resetToolCache(): void {
  cachedYtdlp = undefined
  cachedFfmpeg = undefined
}

export async function getYtdlpVersion(override?: string | null): Promise<string | null> {
  const bin = locateYtdlp(override)
  if (!bin) return null
  try {
    const { stdout } = await execFileBounded(bin, ['--version'], VERSION_TIMEOUT_MS, 1024 * 1024)
    return stdout.trim() || null
  } catch {
    return null
  }
}

export async function getToolStatus(override?: string | null): Promise<ToolStatus> {
  const ytdlpPath = locateYtdlp(override)
  const ffmpegPath = locateFfmpeg()
  const ytdlpVersion = await getYtdlpVersion(override)
  return {
    ytdlpFound: !!ytdlpPath,
    ytdlpPath,
    ytdlpVersion,
    ffmpegFound: !!ffmpegPath,
    ffmpegPath
  }
}

export async function updateYtdlp(
  override?: string | null
): Promise<{ ok: boolean; output: string }> {
  let bin = locateYtdlp(override)
  if (!bin) return { ok: false, output: 'yt-dlp executable not found.' }

  // Keep packaged/system tools immutable. Snag maintains an updateable per-user copy.
  if (!override) {
    const managed = managedYtdlp()
    if (bin !== managed) {
      try {
        mkdirSync(dirname(managed), { recursive: true })
        copyFileSync(bin, managed)
        bin = managed
        cachedYtdlp = managed
      } catch (err) {
        return {
          ok: false,
          output: `Could not prepare yt-dlp for updating: ${(err as Error).message}`
        }
      }
    }
  }
  try {
    const { stdout, stderr } = await execFileBounded(
      bin,
      ['-U'],
      UPDATE_TIMEOUT_MS,
      1024 * 1024 * 8
    )
    return { ok: true, output: (stdout + stderr).trim() }
  } catch (err) {
    const e = err as ExecFailure
    // Re-evaluate the managed copy after a failed self-update in case yt-dlp
    // exited while replacing its executable.
    if (!override) cachedYtdlp = undefined
    if (e.timedOut) {
      return {
        ok: false,
        output: 'The yt-dlp update timed out after 2 minutes. Check your connection and try again.'
      }
    }
    return { ok: false, output: (e.stdout || '') + (e.stderr || e.message || 'Update failed.') }
  }
}

// Run yt-dlp with -J and return parsed JSON. Throws with a cleaned message on failure.
export async function runYtdlpJson(
  args: string[],
  override?: string | null
): Promise<unknown> {
  const bin = locateYtdlp(override)
  if (!bin) {
    throw new Error(
      'yt-dlp was not found. Install it (e.g. "winget install yt-dlp") or set its path in Settings.'
    )
  }
  try {
    const { stdout } = await execFileBounded(
      bin,
      [...ytdlpRuntimeArgs(), ...args],
      ANALYZE_TIMEOUT_MS,
      1024 * 1024 * 128, // metadata JSON can be large
      ytdlpChildEnv()
    )
    return JSON.parse(stdout)
  } catch (err) {
    const e = err as ExecFailure
    if (e.timedOut) {
      throw new Error('Analysis timed out after 60 seconds. Check your connection and try again.')
    }
    throw new Error(cleanYtdlpError(e.stderr || e.message || 'Unknown error'))
  }
}

// Turn yt-dlp's noisy stderr into a short, human-readable message.
export function cleanYtdlpError(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const errLine =
    lines.find((l) => /^ERROR:/i.test(l)) || lines[lines.length - 1] || stderr.trim()
  let msg = errLine.replace(/^ERROR:\s*/i, '').trim()

  if (/Unsupported URL/i.test(msg)) return 'This link is not supported.'
  if (/is not a valid URL/i.test(msg) || /Invalid URL/i.test(msg))
    return 'That does not look like a valid link.'
  if (/Private video/i.test(msg)) return 'This video is private.'
  if (/members-only|join this channel/i.test(msg)) return 'This is a members-only video.'
  if (/Sign in to confirm your age|age-restricted|age restricted/i.test(msg))
    return 'This video is age-restricted and cannot be downloaded without sign-in.'
  if (/not available in your country|geo|blocked it in your country/i.test(msg))
    return 'This video is not available in your region.'
  if (/Video unavailable/i.test(msg)) return 'This video is unavailable.'
  if (/HTTP Error 404|404:\s*Not Found/i.test(msg))
    return 'The page or video could not be found (HTTP 404).'
  if (/HTTP Error 403|403:\s*Forbidden/i.test(msg))
    return 'The site refused access (HTTP 403). Update yt-dlp, then try again.'
  if (
    /Unable to download webpage/i.test(msg) &&
    /timed out|temporary failure|name resolution/i.test(msg)
  )
    return 'The site could not be reached. Check your connection and try again.'
  if (/Requested format is not available/i.test(msg))
    return 'The selected format is no longer available. Try analyzing the link again.'
  if (/ffmpeg/i.test(msg) && /not found|not installed/i.test(msg))
    return 'ffmpeg is required for this download but was not found.'
  // Keep it to a single, reasonably short line.
  if (msg.length > 300) msg = msg.slice(0, 297) + '…'
  return msg || 'Download failed.'
}
