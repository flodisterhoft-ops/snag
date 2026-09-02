// Hands a finished file to one of the user's share targets: Telegram Desktop
// (its composer opens with the file attached), the Windows Share panel (Phone
// Link, Bluetooth, Mail, WhatsApp, and every other share target on the
// machine), or any executable the user added in Settings. Used by the Share
// buttons in the queue, the Download page, and the Chrome panel, and by
// "share when done".
import { app } from 'electron'
import { basename as baseName } from 'path'
import type { Settings, ShareInfo, ShareTarget } from '@shared/types'
import { loadSettings } from './settings'
import { findVlc, playerName } from './player'
import { execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, linkSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { basename, extname, join } from 'path'

const SHARE_SCRIPT = `
$target = $env:SNAG_SHARE_FILE
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { exit 2 }
$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace([System.IO.Path]::GetDirectoryName($target))
if (-not $folder) { exit 2 }
$item = $folder.ParseName([System.IO.Path]::GetFileName($target))
if (-not $item) { exit 2 }
$verb = $item.Verbs() | Where-Object { $_.Name.Replace('&', '') -eq 'Share' } | Select-Object -First 1
if (-not $verb) { exit 3 }
$verb.DoIt()
`

// Windows PowerShell 5.1 (the powershell.exe the script runs in) cannot combine
// Split-Path -LiteralPath with -Parent, so the script uses .NET's path helpers.
// Exit codes: 2 = the file is gone, 3 = the file type has no Share entry.
function shareSheetError(error: { code?: number | string | null } | null): string {
  if (!error) return ''
  if (error.code === 2) return 'The file is no longer where it was saved.'
  if (error.code === 3) return 'Windows has no Share entry for this file type.'
  return 'Windows could not open the Share panel for this file.'
}

function openWindowsShareSheet(target: string): Promise<string> {
  if (process.platform !== 'win32') return Promise.resolve('File sharing is currently supported on Windows.')
  const encoded = Buffer.from(SHARE_SCRIPT, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 10000, env: { ...process.env, SNAG_SHARE_FILE: target } },
      (error) => resolve(shareSheetError(error))
    )
  })
}

function findTelegramExecutable(): string | null {
  const candidates = [
    process.env['APPDATA'] && join(process.env['APPDATA'], 'Telegram Desktop', 'Telegram.exe'),
    process.env['LOCALAPPDATA'] && join(process.env['LOCALAPPDATA'], 'Telegram Desktop', 'Telegram.exe'),
    process.env['LOCALAPPDATA'] &&
      join(process.env['LOCALAPPDATA'], 'Programs', 'Telegram Desktop', 'Telegram.exe'),
    process.env['PROGRAMFILES'] && join(process.env['PROGRAMFILES'], 'Telegram Desktop', 'Telegram.exe'),
    process.env['PROGRAMFILES(X86)'] &&
      join(process.env['PROGRAMFILES(X86)'], 'Telegram Desktop', 'Telegram.exe')
  ].filter((value): value is string => !!value)

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

const telegramShareAliases = new Map<string, string>()

// Drops the temporary .webm alias created for an MKV once its job is removed.
export function cleanupTelegramMediaPath(target: string): void {
  const alias = telegramShareAliases.get(target)
  if (!alias) return
  telegramShareAliases.delete(target)
  try {
    if (existsSync(alias)) unlinkSync(alias)
  } catch {
    // A running Telegram process may still have the alias open. The existing
    // expiry timer will make another best-effort cleanup attempt.
  }
}

function prepareTelegramMediaPath(target: string): string {
  if (extname(target).toLowerCase() !== '.mkv') return target

  try {
    const source = statSync(target)
    const key = createHash('sha256')
      .update(`${target}\0${source.size}\0${source.mtimeMs}`)
      .digest('hex')
      .slice(0, 16)
    const shareDir = join(app.getPath('temp'), 'Snag Telegram Shares', key)
    const shareTarget = join(shareDir, `${basename(target, extname(target))}.webm`)
    mkdirSync(shareDir, { recursive: true })
    if (!existsSync(shareTarget)) linkSync(target, shareTarget)
    telegramShareAliases.set(target, shareTarget)

    // Telegram reads the alias when its composer opens. Keep it available for
    // delayed sends, but do not let temporary hard links retain files forever.
    const cleanup = setTimeout(() => {
      try {
        if (existsSync(shareTarget)) unlinkSync(shareTarget)
      } catch {
        // The OS temp cleaner or a later share may already have removed it.
      } finally {
        if (telegramShareAliases.get(target) === shareTarget) {
          telegramShareAliases.delete(target)
        }
      }
    }, 6 * 60 * 60 * 1000)
    cleanup.unref()

    return shareTarget
  } catch {
    // Cross-volume and non-NTFS locations may not support hard links. Sending
    // the original MKV as a document is safer than copying a very large file.
    return target
  }
}

const recentTelegramShares = new Map<string, number>()

function shareWithTelegram(target: string): Promise<string> {
  const telegram = findTelegramExecutable()
  if (!telegram) return openWindowsShareSheet(target)
  const now = Date.now()
  if (now - (recentTelegramShares.get(target) ?? 0) < 2000) return Promise.resolve('')
  recentTelegramShares.set(target, now)
  const telegramTarget = prepareTelegramMediaPath(target)

  return new Promise((resolve) => {
    const child = spawn(telegram, ['--', telegramTarget], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    child.once('spawn', () => {
      child.unref()
      resolve('')
    })
    child.once('error', () => {
      void openWindowsShareSheet(target).then(resolve)
    })
  })
}

function launchCustomApp(executable: string, target: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const child = spawn(executable, [target], { detached: true, stdio: 'ignore', windowsHide: false })
      child.once('spawn', () => {
        child.unref()
        resolve('')
      })
      child.once('error', () => resolve(`Could not start ${baseName(executable)}.`))
    } catch {
      resolve(`Could not start ${baseName(executable)}.`)
    }
  })
}

export function shareTargetsWithStatus(settings: Settings = loadSettings()): (ShareTarget & { installed: boolean })[] {
  return settings.shareTargets.map((t) => ({
    ...t,
    installed:
      t.kind === 'windows'
        ? process.platform === 'win32'
        : t.kind === 'telegram'
          ? !!findTelegramExecutable()
          : !!t.path && existsSync(t.path)
  }))
}

// Custom apps show their own file icon (PNG data URL), fetched once per path.
const iconCache = new Map<string, string | null>()
async function appIcon(path: string): Promise<string | null> {
  const cached = iconCache.get(path)
  if (cached !== undefined) return cached
  let icon: string | null = null
  try {
    const image = await app.getFileIcon(path, { size: 'large' })
    icon = image.isEmpty() ? null : image.toDataURL()
  } catch {
    icon = null
  }
  iconCache.set(path, icon)
  return icon
}

export async function shareTargetsWithIcons(settings: Settings = loadSettings()): Promise<ShareInfo['targets']> {
  return Promise.all(
    shareTargetsWithStatus(settings).map(async (t) => ({
      ...t,
      icon: t.kind === 'custom' && t.path && t.installed ? await appIcon(t.path) : null
    }))
  )
}

export async function shareInfo(settings: Settings = loadSettings()): Promise<ShareInfo> {
  return {
    targets: await shareTargetsWithIcons(settings),
    ask: settings.shareAsk,
    player: playerName(settings.player),
    vlcFound: !!findVlc()
  }
}

// The target a Share action means: the requested id when it is usable,
// otherwise the first enabled installed one, otherwise the Windows panel.
export function resolveShareTarget(targetId?: string | null, settings: Settings = loadSettings()): ShareTarget {
  const usable = shareTargetsWithStatus(settings).filter((t) => t.enabled && t.installed)
  const wanted = targetId ? usable.find((t) => t.id === targetId) : undefined
  return wanted ?? usable[0] ?? { id: 'windows', kind: 'windows', label: 'Windows share panel', path: null, enabled: true }
}

// Resolves to an empty string on success, otherwise a message for the user.
export function shareFile(target: string, targetId?: string | null): Promise<string> {
  if (process.platform !== 'win32') return openWindowsShareSheet(target)
  const chosen = resolveShareTarget(targetId)
  if (chosen.kind === 'telegram') return shareWithTelegram(target)
  if (chosen.kind === 'custom' && chosen.path) return launchCustomApp(chosen.path, target)
  return openWindowsShareSheet(target)
}
