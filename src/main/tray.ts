import { Tray, Menu, app, nativeImage } from 'electron'
import trayIconPath from '../../resources/tray.png?asset'

let tray: Tray | null = null

export function createTray(onOpen: () => void): void {
  if (tray) return
  tray = new Tray(nativeImage.createFromPath(trayIconPath))
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
