// Small bitmaps the main process cannot draw itself: the numbered overlay for
// Snag's taskbar button and the tray icon with an "active" dot. Both return
// PNG data URLs; main turns them into NativeImages (see src/main/taskbar.ts).

const ACCENT = '#c6f24d'
const INK = '#17200a'

function badge(count: number): string | null {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2)
  ctx.fillStyle = ACCENT
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.stroke()
  const label = count > 9 ? '9+' : String(Math.max(1, Math.round(count)))
  ctx.fillStyle = INK
  ctx.font = `700 ${label.length > 1 ? 17 : 21}px "Bahnschrift", "Segoe UI", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, size / 2, size / 2 + 1)
  return canvas.toDataURL('image/png')
}

function trayWithDot(baseDataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth || 32
      const h = img.naturalHeight || 32
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(null)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      const r = Math.max(3, Math.round(w * 0.19))
      const cx = w - r - 1
      const cy = h - r - 1
      ctx.beginPath()
      ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(11, 12, 15, 0.9)'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = ACCENT
      ctx.fill()
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => resolve(null)
    img.src = baseDataUrl
  })
}

declare global {
  interface Window {
    __snagBadge?: (count: number) => string | null
    __snagTrayIcon?: (baseDataUrl: string) => Promise<string | null>
  }
}

export function installBadgePainters(): void {
  window.__snagBadge = badge
  window.__snagTrayIcon = trayWithDot
}
