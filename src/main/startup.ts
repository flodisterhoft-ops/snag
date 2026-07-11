import { app } from 'electron'

// Marks a login-item launch: Snag starts in the tray with no window, ready to
// serve the quick popup instantly.
export const TRAY_START_FLAG = '--tray-start'

// Registers (or removes) Snag as a Windows login item. Portable builds run
// from a temporary extraction dir, so register the stable launcher the user
// actually double-clicked instead of process.execPath.
export function applyLaunchAtLogin(enabled: boolean): void {
  // In dev the "app" is electron.exe; registering that would autostart a bare
  // Electron shell at login. Only packaged builds manage the login item.
  if (process.defaultApp || process.platform !== 'win32') return

  const executable = process.env['PORTABLE_EXECUTABLE_FILE']?.trim() || process.execPath
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: executable,
      args: [TRAY_START_FLAG]
    })
  } catch (err) {
    console.error('[snag] Could not update the login item:', err)
  }
}
