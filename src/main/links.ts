import { isHttpUrl } from './protocol'

// Pure helpers shared by the clipboard watcher and the global shortcut.

// Hosts where a copied link is almost certainly a video worth pre-analyzing.
// Other links are still offered, just not analyzed until the user asks.
const VIDEO_HOSTS = [
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'twitch.tv',
  'dailymotion.com',
  'instagram.com',
  'facebook.com',
  'fb.watch',
  'reddit.com',
  'streamable.com',
  'bilibili.com',
  'soundcloud.com',
  'rumble.com',
  'odysee.com'
]

export function isKnownVideoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return VIDEO_HOSTS.some((known) => host === known || host.endsWith(`.${known}`))
  } catch {
    return false
  }
}

// Pull a single http(s) URL out of clipboard text; null when it holds none or many.
export function clipboardUrl(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 2048 || /\s/.test(trimmed)) return null
  return isHttpUrl(trimmed) ? new URL(trimmed).toString() : null
}
