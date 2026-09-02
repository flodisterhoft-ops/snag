// Opens finished files in VLC when it is installed, otherwise in whatever
// Windows associates with the file. Used by the queue's Play button and by
// "Open when done".
import { shell } from 'electron'
import { execFileSync, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { Player } from '@shared/types'
import { loadSettings } from './settings'

let vlcPath: string | null | undefined

export function findVlc(): string | null {
  if (vlcPath !== undefined) return vlcPath
  const candidates = [
    process.env['PROGRAMFILES'] && join(process.env['PROGRAMFILES'], 'VideoLAN', 'VLC', 'vlc.exe'),
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'VideoLAN', 'VLC', 'vlc.exe'),
    process.env['LOCALAPPDATA'] && join(process.env['LOCALAPPDATA'], 'Programs', 'VideoLAN', 'VLC', 'vlc.exe')
  ].filter((value): value is string => !!value)
  let found = candidates.find((candidate) => existsSync(candidate)) ?? null
  if (!found && process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\VideoLAN\\VLC', '/v', 'InstallDir'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000
      })
      const m = out.match(/InstallDir\s+REG_SZ\s+(.+)/)
      if (m) {
        const candidate = join(m[1].trim(), 'vlc.exe')
        if (existsSync(candidate)) found = candidate
      }
    } catch {
      /* not installed, or no registry access */
    }
  }
  vlcPath = found
  return found
}

export function playerName(player: Player = loadSettings().player): string {
  return player === 'vlc' && findVlc() ? 'VLC' : 'Windows default player'
}

// Resolves to an empty string on success, otherwise a message for the user.
export function openWithPlayer(file: string, player: Player = loadSettings().player): Promise<string> {
  const vlc = player === 'vlc' ? findVlc() : null
  if (!vlc) return shell.openPath(file)
  return new Promise((resolve) => {
    try {
      const child = spawn(vlc, [file], { detached: true, stdio: 'ignore', windowsHide: false })
      child.once('spawn', () => {
        child.unref()
        resolve('')
      })
      child.once('error', () => void shell.openPath(file).then(resolve))
    } catch {
      void shell.openPath(file).then(resolve)
    }
  })
}
