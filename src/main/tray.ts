import { Tray, Menu, app, nativeImage } from 'electron'
import trayIconPath from '../../resources/tray.png?asset'
import appIconPath from '../../build/icon.ico?asset'

let tray: Tray | null = null
let idleImage: Electron.NativeImage | null = null

export function createTray(onOpen: () => void): void {
  if (tray) return
  const bundledTrayIcon = nativeImage.createFromPath(trayIconPath)
  const trayImage = bundledTrayIcon.isEmpty()
    ? nativeImage.createFromPath(appIconPath)
    : bundledTrayIcon
  if (trayImage.isEmpty()) {
    console.error('[snag] Both packaged tray icon assets are missing.')
  }
  idleImage = trayImage
  tray = new Tray(trayImage)
  tray.setToolTip('Snag')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Snag', click: onOpen },
      { type: 'separator' },
      { label: 'Quit Snag', click: () => app.quit() }
    ])
  )
  tray.on('click', onOpen)
}

export function setTrayActiveCount(count: number): void {
  tray?.setToolTip(count > 0 ? `Snag — ${count} active download${count > 1 ? 's' : ''}` : 'Snag')
}

// Swap in the "downloads running" variant (a dot over the icon); null restores
// the plain icon.
export function setTrayImage(image: Electron.NativeImage | null): void {
  if (!tray) return
  tray.setImage(image ?? idleImage ?? nativeImage.createEmpty())
}
