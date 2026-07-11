// Snag for Chrome — content script.
// Pins one floating download button to the top-right corner of every
// large-enough <video> on the page (including embedded frames). Clicking it
// opens snag://download with the page URL; the Snag app takes it from there.

;(() => {
  const MIN_WIDTH = 250
  const MIN_HEIGHT = 140
  const BTN_SIZE = 36
  const INSET = 10
  const HOST = location.hostname

  let disabled = false
  const buttons = new Map() // <video> element -> its button element

  function deepLink() {
    return 'snag://download?url=' + encodeURIComponent(location.href)
  }

  function makeButton() {
    const btn = document.createElement('button')
    btn.className = 'snag-dl-btn'
    btn.type = 'button'
    btn.title = 'Download with Snag'
    btn.setAttribute('aria-label', 'Download with Snag')
    btn.addEventListener(
      'click',
      (e) => {
        e.preventDefault()
        e.stopPropagation()
        window.location.href = deepLink()
      },
      true
    )
    return btn
  }

  function eligible(video) {
    if (disabled || document.fullscreenElement) return false
    if (!video.isConnected) return false
    const rect = video.getBoundingClientRect()
    if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) return false
    // Fully off-screen: no button.
    if (rect.bottom < 0 || rect.right < 0) return false
    if (rect.top > innerHeight || rect.left > innerWidth) return false
    const style = getComputedStyle(video)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    return true
  }

  function position(video, btn) {
    const rect = video.getBoundingClientRect()
    btn.style.top = Math.min(Math.max(rect.top + INSET, 4), innerHeight - BTN_SIZE - 4) + 'px'
    btn.style.left =
      Math.min(Math.max(rect.right - BTN_SIZE - INSET, 4), innerWidth - BTN_SIZE - 4) + 'px'
  }

  function refresh() {
    const videos = document.querySelectorAll('video')
    const seen = new Set()
    for (const video of videos) {
      seen.add(video)
      let btn = buttons.get(video)
      if (eligible(video)) {
        if (!btn) {
          btn = makeButton()
          document.documentElement.appendChild(btn)
          buttons.set(video, btn)
        }
        btn.style.display = 'block'
        position(video, btn)
      } else if (btn) {
        btn.style.display = 'none'
      }
    }
    // Videos that left the DOM (SPA navigation) take their buttons with them.
    for (const [video, btn] of buttons) {
      if (!seen.has(video)) {
        btn.remove()
        buttons.delete(video)
      }
    }
  }

  let scheduled = false
  function schedule() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      refresh()
    })
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.disabledSites) {
      disabled = (changes.disabledSites.newValue || []).includes(HOST)
      schedule()
    }
  })

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true
  })
  addEventListener('scroll', schedule, { passive: true, capture: true })
  addEventListener('resize', schedule, { passive: true })
  document.addEventListener('fullscreenchange', schedule)
  // Layout can shift without DOM mutations (player resizes, lazy CSS) — cheap heartbeat.
  setInterval(schedule, 800)

  chrome.storage.local
    .get('disabledSites')
    .then(({ disabledSites = [] }) => {
      disabled = disabledSites.includes(HOST)
      schedule()
    })
    .catch(() => schedule())
})()
