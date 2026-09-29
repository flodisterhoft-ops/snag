// Snag for Chrome — background service worker.
// Two jobs: (1) bridge the in-page panel to Snag's loopback API using the
// pairing token from config.js or automatic loopback pairing, and (2) keep the
// classic snag:// deep-link actions for toolbar/context-menu use and as the
// fallback when the app isn't running.

importScripts('config.js')

const MENU_PAGE = 'snag-page'
const MENU_LINK = 'snag-link'
const MENU_VIDEO = 'snag-video'
const MENU_TOGGLE = 'snag-toggle-site'
const VERSION_ALARM = 'snag-check-app-version'

function deepLink(url) {
  return 'snag://download?url=' + encodeURIComponent(url)
}

function isHttp(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

// ---------- Loopback API bridge ----------

let workingPort = null
let pairingToken = (SNAG_CONFIG && SNAG_CONFIG.token) || ''
const DEFAULT_PORTS = [43110, 43111, 43112, 43113, 43114, 43115, 43116, 43117]

async function loadPairingToken() {
  if (pairingToken) return pairingToken
  const stored = await chrome.storage.local.get('snagPairingToken')
  pairingToken = typeof stored.snagPairingToken === 'string' ? stored.snagPairingToken : ''
  return pairingToken
}

async function savePairingToken(token) {
  pairingToken = token
  if (token) await chrome.storage.local.set({ snagPairingToken: token })
  else await chrome.storage.local.remove('snagPairingToken')
}

async function apiFetch(port, path, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      ...options,
      headers: {
        ...(pairingToken ? { Authorization: 'Bearer ' + pairingToken } : {}),
        'Content-Type': 'application/json',
        ...(options && options.headers)
      },
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

async function pairWithSnag(port) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 900)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal
    })
    if (!res.ok) return false
    const data = await res.json()
    if (!data || data.app !== 'snag' || typeof data.token !== 'string') return false
    await savePairingToken(data.token)
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// Find the port Snag is listening on. A port that answered moments ago is
// used as is (the download toasts ask twice a second); a failed call clears
// it. The panel fires several requests at once — they share one scan.
let findSnagPromise = null
let workingPortSeenAt = 0
const PORT_TRUST_MS = 10000

function findSnag() {
  if (workingPort != null && Date.now() - workingPortSeenAt < PORT_TRUST_MS) return Promise.resolve(workingPort)
  if (!findSnagPromise) {
    findSnagPromise = scanForSnag().finally(() => {
      findSnagPromise = null
    })
  }
  return findSnagPromise
}

// Locate the app with the unauthenticated liveness probe, then pair (first
// contact) and check the pairing on that one port only.
async function scanForSnag() {
  await loadPairingToken()
  const port = await findRunningSnag()
  if (port == null) {
    workingPort = null
    return null
  }
  try {
    if (!pairingToken && !(await pairWithSnag(port))) return null
    let res = await apiFetch(port, '/ping', { method: 'GET' }, 900)
    if (res.status === 401) {
      await savePairingToken('')
      if (!(await pairWithSnag(port))) return null
      res = await apiFetch(port, '/ping', { method: 'GET' }, 900)
    }
    if (!res.ok) return null
    const data = await res.json()
    if (!data || data.app !== 'snag') return null
    workingPort = port
    workingPortSeenAt = Date.now()
    return port
  } catch {
    return null
  }
}

// Liveness-only probe, also used while a deep link is starting Snag. It
// never calls /pair and therefore cannot multiply pairing attempts while
// the app is still booting. Every port is probed at once: on Windows a
// closed port can take about a second to refuse, and a one-by-one scan made
// "is Snag running?" take several seconds.
async function findRunningSnag() {
  const configuredPorts = Array.isArray(SNAG_CONFIG && SNAG_CONFIG.ports)
    ? SNAG_CONFIG.ports
    : []
  const ports = [...new Set([...configuredPorts, ...DEFAULT_PORTS])]
  try {
    return await Promise.any(
      ports.map(async (port) => {
        const res = await apiFetch(port, '/health', { method: 'GET' }, 700)
        const data = res.ok ? await res.json() : null
        if (!data || data.app !== 'snag') throw new Error('not snag')
        workingPort = port
        return port
      })
    )
  } catch {
    return null
  }
}

async function callSnag(path, options, timeoutMs) {
  const port = await findSnag()
  if (port == null) return { ok: false, error: 'not-running' }
  // Reading a video can take two minutes; without an extension call now and
  // then Chrome would stop this worker halfway through the wait.
  const keepAlive =
    timeoutMs > 20000 ? setInterval(() => chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError), 20000) : null
  try {
    const res = await apiFetch(port, path, options, timeoutMs)
    const data = await res.json()
    if (res.status === 401) {
      workingPortSeenAt = 0
      return { ok: false, error: 'not-paired' }
    }
    workingPortSeenAt = Date.now()
    return { ok: res.ok, data }
  } catch (err) {
    // Snag answered and is still busy: a slow request is not a closed app.
    if (err && err.name === 'AbortError') return { ok: false, error: 'timeout' }
    workingPort = null
    return { ok: false, error: 'not-running' }
  } finally {
    if (keepAlive) clearInterval(keepAlive)
  }
}

// Signed-in downloads: when the user enabled "Use my browser logins" in Snag,
// the app asks (on /ping) for a fresh export and the cookies of these sites are
// sent over the paired loopback connection. Nothing leaves the machine.
const COOKIE_DOMAINS = [
  'youtube.com', 'google.com', 'x.com', 'twitter.com', 'vimeo.com', 'twitch.tv',
  'patreon.com', 'reddit.com', 'dailymotion.com', 'instagram.com', 'facebook.com', 'tiktok.com'
]

async function exportCookies(port) {
  if (!chrome.cookies || typeof chrome.cookies.getAll !== 'function') return
  const collected = []
  for (const domain of COOKIE_DOMAINS) {
    let list = []
    try {
      list = await chrome.cookies.getAll({ domain })
    } catch {
      continue
    }
    for (const c of list) {
      collected.push({
        domain: c.domain,
        path: c.path,
        name: c.name,
        value: c.value,
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        hostOnly: !!c.hostOnly,
        expirationDate: typeof c.expirationDate === 'number' ? c.expirationDate : null
      })
    }
  }
  try {
    await apiFetch(port, '/cookies', { method: 'POST', body: JSON.stringify({ cookies: collected }) }, 5000)
  } catch {
    /* retried on the next heartbeat Snag asks for */
  }
}

// Snag refreshes its stable unpacked-extension folder whenever the desktop app
// starts. After one manual reload installs this code, future app upgrades are
// detected here and Chrome reloads the extension from that refreshed folder.
async function reloadForNewAppVersion() {
  const port = await findSnag()
  if (port == null) return
  try {
    const res = await apiFetch(port, '/ping', { method: 'GET' }, 1200)
    if (!res.ok) return
    const data = await res.json()
    if (!data || data.app !== 'snag' || typeof data.version !== 'string') return
    const stored = await chrome.storage.local.get(['snagObservedAppVersion', 'snagObservedExtensionRevision'])
    const previous = stored.snagObservedAppVersion
    const previousRevision = stored.snagObservedExtensionRevision
    const revision = typeof data.extensionRevision === 'string' ? data.extensionRevision : ''
    await chrome.storage.local.set({ snagObservedAppVersion: data.version, snagObservedExtensionRevision: revision })
    await apiFetch(port, '/extension/heartbeat', { method: 'POST', body: '{}' }, 1200)
    if (data.cookieSyncWanted === true) await exportCookies(port)
    // A new app version or a refreshed extension folder (same version, newer
    // files) both mean Chrome is still running stale code from this folder.
    const versionChanged = typeof previous === 'string' && previous !== data.version
    const revisionChanged =
      typeof previousRevision === 'string' && previousRevision !== '' && revision !== '' && previousRevision !== revision
    if (versionChanged || revisionChanged) chrome.runtime.reload()
  } catch {
    /* Snag may be starting or shutting down; the next alarm retries. */
  }
}

chrome.alarms.create(VERSION_ALARM, { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === VERSION_ALARM) void reloadForNewAppVersion()
})
chrome.runtime.onStartup.addListener(() => void reloadForNewAppVersion())
void reloadForNewAppVersion()

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false

  if (message.type === 'snag:ping') {
    findRunningSnag().then((port) => sendResponse({ running: port != null }))
    return true
  }
  if (message.type === 'snag:defaults') {
    callSnag('/defaults', { method: 'GET' }, 3000).then(sendResponse)
    return true
  }
  if (message.type === 'snag:open-settings') {
    const section = typeof message.section === 'string' ? message.section : undefined
    callSnag('/open-settings', { method: 'POST', body: JSON.stringify({ section }) }, 3000).then(sendResponse)
    return true
  }
  if (message.type === 'snag:analyze') {
    // Snag allows 60 s per yt-dlp run and a second run for YouTube videos
    // the fast client refuses.
    callSnag(
      '/analyze',
      { method: 'POST', body: JSON.stringify({ url: message.url }) },
      130000
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
  if (message.type === 'snag:job') {
    callSnag(`/jobs/${encodeURIComponent(message.jobId || '')}`, { method: 'GET' }, 3000).then(sendResponse)
    return true
  }
  if (message.type === 'snag:cancel') {
    callSnag(
      `/jobs/${encodeURIComponent(message.jobId || '')}/cancel`,
      { method: 'POST', body: '{}' },
      3000
    ).then(sendResponse)
    return true
  }
  if (message.type === 'snag:set-audio-favorites') {
    callSnag(
      '/preferences/audio-languages',
      { method: 'POST', body: JSON.stringify({ languages: message.languages }) },
      3000
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

function hostOf(url) {
  try {
    return isHttp(url) ? new URL(url).hostname : null
  } catch {
    return null
  }
}

async function disabledSiteList() {
  const { disabledSites = [] } = await chrome.storage.local.get('disabledSites')
  return Array.isArray(disabledSites) ? disabledSites : []
}

// The per-site switch lives in the right-click menu, where one stray click
// hid the button on YouTube without a trace. The menu entry is a checkbox
// that shows the active tab's state, and a hidden site says so on the
// toolbar icon.
async function syncSiteUi(tab) {
  if (!tab || tab.id == null) return
  const host = hostOf(tab.url)
  const off = !!host && (await disabledSiteList()).includes(host)
  const ignore = () => void chrome.runtime.lastError
  chrome.action.setBadgeText({ tabId: tab.id, text: off ? 'off' : '' }, ignore)
  if (off) chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#5b616e' }, ignore)
  chrome.action.setTitle(
    {
      tabId: tab.id,
      title: off
        ? 'Snag button hidden on this site. Right-click the page, open Snag for Chrome and tick “Show the Snag button on this site”. Click to send this page to Snag.'
        : 'Send this page to Snag'
    },
    ignore
  )
  if (tab.active) chrome.contextMenus.update(MENU_TOGGLE, { checked: !off, enabled: !!host }, ignore)
}

async function syncActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (tab) await syncSiteUi(tab)
}

async function setSiteShown(tab, shown) {
  const host = hostOf(tab.url)
  if (!host) return
  const sites = (await disabledSiteList()).filter((h) => h !== host)
  if (!shown) sites.push(host)
  // Content scripts on this site react via chrome.storage.onChanged.
  await chrome.storage.local.set({ disabledSites: sites })
  const tabs = await chrome.tabs.query({})
  await Promise.all(tabs.filter((t) => hostOf(t.url) === host).map(syncSiteUi))
}

function createMenus() {
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
    chrome.contextMenus.create({ id: 'snag-sep', type: 'separator', contexts: ['page', 'video'] })
    chrome.contextMenus.create(
      {
        id: MENU_TOGGLE,
        type: 'checkbox',
        checked: true,
        title: 'Show the Snag button on this site',
        contexts: ['page', 'video']
      },
      () => void syncActiveTab()
    )
  })
}

chrome.runtime.onInstalled.addListener(createMenus)
chrome.runtime.onStartup.addListener(() => void syncActiveTab())
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (!chrome.runtime.lastError) void syncSiteUi(tab)
  })
})
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (change.url || change.status === 'complete') void syncSiteUi(tab)
})
chrome.windows.onFocusChanged.addListener(() => void syncActiveTab())

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
      // Chrome flips the checkbox itself; `checked` is the new state.
      void setSiteShown(tab, info.checked !== false)
      break
  }
})
