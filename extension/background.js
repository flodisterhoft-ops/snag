// Snag for Chrome — background service worker.
// Two jobs: (1) bridge the in-page panel to Snag's loopback API using the
// pairing token from config.js (written by the Snag app), and (2) keep the
// classic snag:// deep-link actions for toolbar/context-menu use and as the
// fallback when the app isn't running.

importScripts('config.js')

const MENU_PAGE = 'snag-page'
const MENU_LINK = 'snag-link'
const MENU_VIDEO = 'snag-video'
const MENU_TOGGLE = 'snag-toggle-site'

function deepLink(url) {
  return 'snag://download?url=' + encodeURIComponent(url)
}

function isHttp(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

// ---------- Loopback API bridge ----------

let workingPort = null

async function apiFetch(port, path, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      ...options,
      headers: {
        Authorization: 'Bearer ' + SNAG_CONFIG.token,
        'Content-Type': 'application/json',
        ...(options && options.headers)
      },
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

// Find the port Snag is listening on (cached once found; re-scanned on failure).
async function findSnag() {
  if (!SNAG_CONFIG.token || !SNAG_CONFIG.ports || SNAG_CONFIG.ports.length === 0) return null
  const candidates = workingPort
    ? [workingPort, ...SNAG_CONFIG.ports.filter((p) => p !== workingPort)]
    : SNAG_CONFIG.ports
  for (const port of candidates) {
    try {
      const res = await apiFetch(port, '/ping', { method: 'GET' }, 900)
      if (res.ok) {
        const data = await res.json()
        if (data && data.app === 'snag') {
          workingPort = port
          return port
        }
      }
    } catch {
      /* try next port */
    }
  }
  workingPort = null
  return null
}

async function callSnag(path, options, timeoutMs) {
  const port = await findSnag()
  if (port == null) return { ok: false, error: 'not-running' }
  try {
    const res = await apiFetch(port, path, options, timeoutMs)
    const data = await res.json()
    if (res.status === 401) return { ok: false, error: 'not-paired' }
    return { ok: res.ok, data }
  } catch {
    workingPort = null
    return { ok: false, error: 'not-running' }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false

  if (message.type === 'snag:ping') {
    findSnag().then((port) => sendResponse({ running: port != null }))
    return true
  }
  if (message.type === 'snag:defaults') {
    callSnag('/defaults', { method: 'GET' }, 3000).then(sendResponse)
    return true
  }
  if (message.type === 'snag:analyze') {
    callSnag(
      '/analyze',
      { method: 'POST', body: JSON.stringify({ url: message.url }) },
      45000
    ).then(sendResponse)
    return true
  }
  if (message.type === 'snag:enqueue') {
    callSnag(
      '/enqueue',
      { method: 'POST', body: JSON.stringify(message.request) },
      8000
    ).then(sendResponse)
    return true
  }
  return false
})

// ---------- Deep-link actions (toolbar, context menus, fallback) ----------

async function sendToSnag(tabId, targetUrl) {
  if (!isHttp(targetUrl)) return
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (link) => {
        window.location.href = link
      },
      args: [deepLink(targetUrl)]
    })
  } catch {
    // Restricted page (chrome://, Web Store, PDF viewer) — nothing we can do.
  }
}

async function toggleSite(tab) {
  let host
  try {
    host = new URL(tab.url).hostname
  } catch {
    return
  }
  if (!host) return
  const { disabledSites = [] } = await chrome.storage.local.get('disabledSites')
  const idx = disabledSites.indexOf(host)
  if (idx >= 0) disabledSites.splice(idx, 1)
  else disabledSites.push(host)
  // Content scripts on this site react via chrome.storage.onChanged.
  await chrome.storage.local.set({ disabledSites })
}

chrome.runtime.onInstalled.addListener(() => {
  // Recreate deterministically on extension updates; existing IDs otherwise
  // make the onInstalled handler fail partway through.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title: 'Download this page with Snag',
      contexts: ['page']
    })
    chrome.contextMenus.create({
      id: MENU_VIDEO,
      title: 'Download this video with Snag',
      contexts: ['video', 'audio']
    })
    chrome.contextMenus.create({
      id: MENU_LINK,
      title: 'Download link with Snag',
      contexts: ['link']
    })
    chrome.contextMenus.create({
      id: MENU_TOGGLE,
      title: 'Show/hide Snag button on this site',
      contexts: ['page', 'video']
    })
  })
})

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id != null) sendToSnag(tab.id, tab.url)
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return
  switch (info.menuItemId) {
    case MENU_PAGE:
      sendToSnag(tab.id, info.pageUrl || tab.url)
      break
    case MENU_VIDEO:
      // Media src is usually a useless blob: URL — the page (or embed frame)
      // URL is what yt-dlp can actually extract from.
      sendToSnag(tab.id, info.frameUrl || info.pageUrl || tab.url)
      break
    case MENU_LINK:
      sendToSnag(tab.id, info.linkUrl)
      break
    case MENU_TOGGLE:
      toggleSite(tab)
      break
  }
})
