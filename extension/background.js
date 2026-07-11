// Snag for Chrome — background service worker.
// Builds snag:// deep links and opens them by assigning location inside the
// page, which triggers Chrome's "Open Snag?" prompt without leaving the page.

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
