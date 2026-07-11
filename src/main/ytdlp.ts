import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join, delimiter, dirname } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ToolStatus } from '@shared/types'

const execFileP = promisify(execFile)
const isWin = process.platform === 'win32'

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

export function locateYtdlp(override?: string | null): string | null {
  if (override && existsSync(override)) return override
  if (cachedYtdlp === undefined) {
    const managed = managedYtdlp()
    cachedYtdlp =
      (existsSync(managed) ? managed : null) || bundledTool('yt-dlp') || which('yt-dlp')
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
    const { stdout } = await execFileP(bin, ['--version'], { windowsHide: true, timeout: 5000 })
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
    const { stdout, stderr } = await execFileP(bin, ['-U'], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8
    })
    return { ok: true, output: (stdout + stderr).trim() }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
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
    const { stdout } = await execFileP(bin, args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 128 // metadata JSON can be large
    })
    return JSON.parse(stdout)
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
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
  if (/Requested format is not available/i.test(msg))
    return 'The selected format is no longer available. Try analyzing the link again.'
  if (/ffmpeg/i.test(msg) && /not found|not installed/i.test(msg))
    return 'ffmpeg is required for this download but was not found.'
  // Keep it to a single, reasonably short line.
  if (msg.length > 300) msg = msg.slice(0, 297) + '…'
  return msg || 'Download failed.'
}
