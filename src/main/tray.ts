import { Tray, Menu, app, nativeImage } from 'electron'
import trayIconPath from '../../resources/tray.png?asset'
import appIconPath from '../../build/icon.ico?asset'

let tray: Tray | null = null

export function createTray(onOpen: () => void): void {
  if (tray) return
  const bundledTrayIcon = nativeImage.createFromPath(trayIconPath)
  const trayImage = bundledTrayIcon.isEmpty()
    ? nativeImage.createFromPath(appIconPath)
    : bundledTrayIcon
  if (trayImage.isEmpty()) {
    console.error('[snag] Both packaged tray icon assets are missing.')
  }
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
