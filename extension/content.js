// Snag for Chrome — content script.
// Pins one floating download button to the top-right corner of every
// large-enough <video> (and, on YouTube, to thumbnails under the pointer).
// Clicking it opens a quality-picker panel right on top of the page; the
// download itself then flies into a small progress toast in the corner.
// Starts Snag through snag://open when the app isn't running.

;(() => {
  const MIN_WIDTH = 250
  const MIN_HEIGHT = 140
  const BTN_SIZE = 36
  const INSET = 10
  const PANEL_BASE_WIDTH = 300
  const HOST = location.hostname
  const IS_YT = /(^|\.)youtube\.com$/i.test(HOST)

  // The corner toast is sized for a 1920px-wide viewport; wide 4K desktops
  // get it proportionally larger so it stays readable. The picker panel keeps
  // its size: it sits next to the video, where big is in the way.
  function uiScale() {
    return Math.min(1.6, Math.max(1, Math.max(innerWidth, screen.width || 0) / 1920))
  }

  let disabled = false
  const buttons = new Map() // <video> element -> its button element
  const analysisByUrl = new Map()
  let prefetchTimer = null
  let prefetchUrl = null

  const LANG_NAMES = {
    en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian',
    pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', ru: 'Russian', uk: 'Ukrainian',
    tr: 'Turkish', ar: 'Arabic', hi: 'Hindi', bn: 'Bengali', ja: 'Japanese',
    ko: 'Korean', zh: 'Chinese', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian',
    fa: 'Persian', ur: 'Urdu', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam',
    mr: 'Marathi', pa: 'Punjabi', sv: 'Swedish', no: 'Norwegian', da: 'Danish',
    fi: 'Finnish', cs: 'Czech', el: 'Greek', ro: 'Romanian', hu: 'Hungarian'
  }

  function langBase(code) {
    return String(code || '').toLowerCase().split('-')[0]
  }
  function langLabel(code) {
    if (!code) return 'Original'
    return LANG_NAMES[langBase(code)] || code.toUpperCase()
  }

  function formatBytes(n) {
    if (!n || !isFinite(n) || n <= 0) return '—'
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
    return (n >= 100 || i === 0 ? Math.round(n) : i >= 3 ? n.toFixed(2) : n.toFixed(1)) + ' ' + units[i]
  }

  function shortPath(p) {
    if (!p) return ''
    const parts = p.split(/[\\/]/)
    return parts.length > 2 ? '…\\' + parts.slice(-2).join('\\') : p
  }

  function deepLink(url) {
    return 'snag://download?url=' + encodeURIComponent(url || location.href)
  }

  // The page URL is not always the video's URL. On X/Twitter the feed itself
  // is not extractable — resolve the enclosing tweet's permalink instead.
  function resolveTargetUrl(video) {
    if (/(^|\.)youtube\.com$/i.test(HOST)) {
      // Homepage hover previews are portaled into a global ytd-video-preview,
      // outside the thumbnail card. YouTube keeps the real watch link inside
      // that preview even though the <video> itself has no useful ancestor URL.
      const preview = video && video.closest && video.closest('ytd-video-preview')
      const previewLink = preview && preview.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]')
      const candidate = previewLink ? previewLink.href : location.href
      try {
        const parsed = new URL(candidate, location.origin)
        const videoId = parsed.searchParams.get('v')
        if (videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
        const short = parsed.pathname.match(/^\/shorts\/([\w-]+)/)
        if (short) return `https://www.youtube.com/shorts/${short[1]}`
      } catch {
        // Fall through to the normal page URL.
      }
    }
    if (/(^|\.)(x\.com|twitter\.com)$/i.test(HOST)) {
      const statusRe = /\/([A-Za-z0-9_]+)\/status\/(\d+)/
      const article = video && video.closest && video.closest('article')
      if (article) {
        for (const a of article.querySelectorAll('a[href*="/status/"]')) {
          const m = (a.getAttribute('href') || '').match(statusRe)
          if (m) return `https://${HOST}/${m[1]}/status/${m[2]}`
        }
      }
      const m = location.pathname.match(statusRe)
      if (m) return `https://${HOST}/${m[1]}/status/${m[2]}`
    }
    return location.href
  }

  // Title and thumbnail the page already knows, so the panel can show the
  // video header the instant it opens instead of after yt-dlp finishes.
  function pageMeta(video) {
    const url = resolveTargetUrl(video)
    let title = (document.title || '').replace(/\s*[-–|]\s*(YouTube|Vimeo|TikTok|X|Twitter|Dailymotion|Twitch)\s*$/i, '').trim()
    let thumbnail = null
    const yt = url.match(/[?&]v=([\w-]{6,})/) || url.match(/\/shorts\/([\w-]{6,})/)
    if (/(^|\.)youtube\.com$/i.test(HOST) && yt) thumbnail = `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`
    else {
      const og = document.querySelector('meta[property="og:image"], meta[name="twitter:image"]')
      if (og && og.content && /^https?:/i.test(og.content)) thumbnail = og.content
    }
    if (window !== window.top && !thumbnail) title = ''
    return { title, thumbnail }
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: 'extension' })
          else resolve(res || { ok: false, error: 'extension' })
        })
      } catch {
        resolve({ ok: false, error: 'extension' })
      }
    })
  }

  function requestAnalysis(url) {
    let request = analysisByUrl.get(url)
    if (!request) {
      request = sendMessage({ type: 'snag:analyze', url }).then((result) => {
        if (!result || result.error === 'not-running' || result.error === 'not-paired' || result.error === 'extension') {
          analysisByUrl.delete(url)
        }
        return result
      })
      analysisByUrl.set(url, request)
      while (analysisByUrl.size > 8) analysisByUrl.delete(analysisByUrl.keys().next().value)
    }
    return request
  }

  function prefetchAnalysis(video) {
    const url = resolveTargetUrl(video)
    if (analysisByUrl.has(url)) return
    if (prefetchTimer && prefetchUrl === url) return
    clearTimeout(prefetchTimer)
    prefetchUrl = url
    prefetchTimer = setTimeout(() => {
      prefetchTimer = null
      prefetchUrl = null
      void requestAnalysis(url)
    }, 700)
  }

  // ---------- Container compatibility (friendly codec names from Snag) ----------

  const VIDEO_COMPAT = {
    mp4: /^(H\.264|H\.265|AV1)/i,
    webm: /^(VP9|VP8|AV1)/i,
    mkv: /./
  }
  const AUDIO_COMPAT = {
    mp4: /^(AAC|AC-3)/i,
    webm: /^(Opus|Vorbis)/i,
    mkv: /./
  }

  // Unknown codecs (blank strings from X/Twitter) pass when the source file
  // is already in the container's family — mirrors Snag's own rules.
  function videoOk(container, f) {
    if (container === 'mkv') return true
    if (!f.vcodec) return f.ext === (container === 'mp4' ? 'mp4' : 'webm')
    return VIDEO_COMPAT[container].test(f.vcodec)
  }
  function audioOk(container, f) {
    if (container === 'mkv') return true
    if (!f.acodec) return container === 'mp4' ? f.ext === 'm4a' || f.ext === 'mp4' : f.ext === 'webm'
    return AUDIO_COMPAT[container].test(f.acodec)
  }

  function compatibleAudio(container, group) {
    const ok = (group.formats || []).filter((f) => audioOk(container, f))
    ok.sort((a, b) => {
      const nativeA = container === 'mp4' ? a.ext === 'm4a' : a.ext === 'webm'
      const nativeB = container === 'mp4' ? b.ext === 'm4a' : b.ext === 'webm'
      if (nativeA !== nativeB) return nativeA ? -1 : 1
      return (b.abr || 0) - (a.abr || 0)
    })
    return ok[0] || null
  }

  function qualityLabel(height) {
    if (height <= 0) return 'Best'
    if (height >= 4320) return '8K'
    if (height >= 2160) return '4K'
    if (height >= 1440) return '2K'
    return `${height}p`
  }

  function recommendedRow(rows, multipleAudio, preferred) {
    return (multipleAudio && rows.find((r) => r.container === 'mkv')) ||
      (!multipleAudio && rows.find((r) => r.container === 'mp4')) ||
      rows.find((r) => r.container === preferred) || rows[0] || null
  }

  // Best stream for each container at the explicitly selected resolution.
  function rowsForQuality(info, selectedGroups, targetHeight) {
    const rows = []
    for (const container of ['mp4', 'mkv', 'webm']) {
      const candidates = (info.videoFormats || []).filter((f) => {
        if (info.hasMultipleAudioLanguages && f.isProgressive) return false
        if (!videoOk(container, f)) return false
        if (f.isProgressive && f.acodec && f.acodec !== 'none' && !AUDIO_COMPAT[container].test(f.acodec)) return false
        return true
      })
      if (!candidates.length) continue
      let pool = candidates.filter((f) => (f.height || 0) === targetHeight)
      if (!pool.length) continue
      const maxFps = Math.max(...pool.map((f) => f.fps || 0))
      pool = pool.filter((f) => (f.fps || 0) === maxFps)
      pool.sort((a, b) => (a.filesize ?? Infinity) - (b.filesize ?? Infinity) || (b.tbr || 0) - (a.tbr || 0))
      const video = pool[0]

      const tracks = video.isProgressive
        ? []
        : selectedGroups.map((g) => compatibleAudio(container, g)).filter(Boolean)
      if (!video.isProgressive && !tracks.length) continue

      let total = video.filesize
      let approx = video.filesizeIsApprox
      for (const t of tracks) {
        if (total != null && t.filesize != null) total += t.filesize
        else approx = true
      }
      rows.push({ container, video, tracks, total, approx })
    }
    return rows
  }

  // ---------- Panel ----------

  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
    .num { font-variant-numeric: tabular-nums; }
    .panel {
      width: ${PANEL_BASE_WIDTH}px; max-height: 78vh; overflow-y: auto; overscroll-behavior: contain;
      background: linear-gradient(180deg, #191c23, #14161c); color: #eef0f3;
      border: 1px solid rgba(255,255,255,0.14); border-radius: 16px;
      box-shadow: 0 24px 60px -18px rgba(0,0,0,0.85);
      font-size: 13px; line-height: 1.45;
      transform-origin: top right; animation: snagIn 0.30s cubic-bezier(0.2, 0.9, 0.28, 1.12) both;
    }
    .panel:focus-visible { outline: 2px solid #c6f24d; outline-offset: 3px; }
    .panel.closing { animation: snagOut 0.16s ease both; }
    @keyframes snagIn { from { opacity: .35; transform: scale(0.09); border-radius: 50%; } to { opacity: 1; transform: none; border-radius: 16px; } }
    @keyframes snagOut { from { opacity: 1; transform: none; } to { opacity: .2; transform: scale(0.09); border-radius: 50%; } }
    .panel::-webkit-scrollbar { width: 9px; }
    .panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
    .panel button { font-family: inherit; }

    /* header */
    .head { display: flex; align-items: center; gap: 10px; padding: 11px 12px 10px; border-bottom: 1px solid rgba(255,255,255,0.07); }
    .thumb { width: 58px; height: 36px; border-radius: 8px; flex-shrink: 0; position: relative; overflow: hidden; background: linear-gradient(135deg,#2c3446 0%,#1a2030 55%,#39303f 100%); }
    .thumb::after { content: ''; position: absolute; inset: 0; margin: auto; width: 0; height: 0; border-left: 9px solid rgba(255,255,255,0.85); border-top: 6px solid transparent; border-bottom: 6px solid transparent; }
    .thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .head-txt { flex: 1; min-width: 0; }
    .head-txt .t { font-weight: 600; font-size: 13px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .head-txt .m { color: #6f757f; font-size: 11px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dot { width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0; background: linear-gradient(150deg,#c6f24d,#a9e02f); display: grid; place-items: center; }
    .dot svg { width: 15px; height: 15px; stroke: #17200a; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .x { width: 26px; height: 26px; border: 0; background: none; color: #a7adb7; cursor: pointer; border-radius: 7px; font-size: 14px; flex-shrink: 0; }
    .x:hover { background: rgba(255,255,255,0.08); color: #fff; }

    /* segmented Video / Audio */
    .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; margin: 10px 12px 0; padding: 3px; background: #0f1116; border: 1px solid rgba(255,255,255,0.07); border-radius: 11px; position: relative; }
    .seg-ind { position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc(50% - 4px); background: #252a34; border-radius: 8px; transition: left .22s cubic-bezier(.3,.8,.3,1); }
    .seg.audio .seg-ind { left: calc(50% + 1px); }
    .seg button { position: relative; z-index: 1; padding: 6px 0; border: 0; border-radius: 8px; background: none; color: #a7adb7; font-size: 12.5px; font-weight: 600; cursor: pointer; transition: color .18s; }
    .seg button.on { color: #fff; }

    /* quality list */
    .list { padding: 8px 6px 2px; display: flex; flex-direction: column; gap: 1px; }
    .qrow { display: flex; align-items: center; gap: 7px; width: 100%; padding: 7px 6px 7px 8px; border: 0; border-radius: 9px; background: none; color: #eef0f3; cursor: pointer; text-align: left; transition: background .13s; }
    .qrow:hover { background: rgba(255,255,255,0.045); }
    .qrow:focus-visible { outline: 2px solid #c6f24d; outline-offset: -2px; }
    .qrow .radio { width: 16px; height: 16px; border-radius: 50%; border: 1.6px solid rgba(255,255,255,0.28); flex-shrink: 0; display: grid; place-items: center; transition: border-color .15s; }
    .qrow.on .radio { border-color: #c6f24d; }
    .qrow .radio::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #c6f24d; transform: scale(0); transition: transform .18s cubic-bezier(.3,.8,.3,1); }
    .qrow.on .radio::after { transform: scale(1); }
    .qrow .q { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 4px; white-space: nowrap; }
    .qrow .q strong { font-size: 13.5px; font-weight: 700; letter-spacing: 0.01em; }
    .qrow .q strong em { font-style: normal; font-size: 10px; font-weight: 700; color: #8d949f; vertical-align: 1px; margin-left: 1px; }
    .qrow .size { color: #a7adb7; font-size: 12px; min-width: 44px; text-align: right; flex-shrink: 0; white-space: nowrap; }
    .qrow.on .size { color: #eef0f3; font-weight: 600; }
    .qrow.on .q { flex: 0 0 auto; }
    .qrow.on .fchips { margin-left: auto; }
    .fchips { display: flex; gap: 2px; flex-shrink: 0; }
    .fchip { display: inline-flex; align-items: center; gap: 2px; padding: 3px 4px; border-radius: 7px; border: 1px solid rgba(255,255,255,0.13); background: none; cursor: pointer; color: #a7adb7; font-size: 10px; font-weight: 700; letter-spacing: 0.03em; transition: border-color .13s, color .13s, background .13s; }
    .fchip:hover { border-color: rgba(255,255,255,0.3); }
    .fchip.on { border-color: #c6f24d; background: rgba(198,242,77,0.13); color: #eef0f3; }
    .star { width: 8px; height: 8px; fill: #c6f24d; flex-shrink: 0; }

    /* audio tab */
    .audio-view { padding: 12px 12px 4px; display: flex; flex-direction: column; gap: 12px; }
    .audio-view .group .lbl2 { color: #6f757f; font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 7px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .chip { flex: 1; min-width: 0; display: inline-flex; align-items: center; justify-content: center; gap: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 5px 6px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.13); background: #0f1116; background-clip: padding-box; color: #a7adb7; font-size: 11px; font-weight: 600; cursor: pointer; transition: border-color .13s, color .13s, background .13s; }
    .chip:hover { border-color: rgba(255,255,255,0.3); }
    .chip.on { background: rgba(198,242,77,0.13); border-color: #c6f24d; color: #eef0f3; }
    .lang-pref { padding: 10px; border: 1px solid rgba(198,242,77,0.22); border-radius: 10px; background: rgba(198,242,77,0.055); }
    .lang-pref p { margin: 0 0 8px; color: #a7adb7; font-size: 11.5px; line-height: 1.4; }
    .lang-pref .btn2 { width: 100%; padding: 8px 10px; }

    /* footer: download + share */
    .foot { padding: 10px 12px 12px; border-top: 1px solid rgba(255,255,255,0.07); margin-top: 7px; display: flex; flex-direction: column; }
    .foot-row { display: flex; gap: 8px; }
    .share { width: 42px; flex-shrink: 0; border: 0; border-radius: 12px; background: #252a34; color: #c6f24d; cursor: pointer; display: grid; place-items: center; transition: background .15s, transform .1s; }
    .share:hover { background: #2f3542; }
    .share:active { transform: translateY(1px); }
    .share:disabled { opacity: 0.5; cursor: not-allowed; }
    .share svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    /* share-app chooser: a small card that slides out beside the panel */
    .share-fly { position: absolute; left: calc(100% + 8px); bottom: 0; min-width: 200px; width: max-content; display: flex; flex-direction: column; gap: 2px; padding: 10px 8px 8px; background: linear-gradient(180deg, #191c23, #14161c); color: #eef0f3; border: 1px solid rgba(255,255,255,0.14); border-radius: 16px; box-shadow: 0 24px 60px -18px rgba(0,0,0,0.85); transform-origin: bottom left; animation: snagFlyIn .22s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    .share-fly.left { left: auto; right: calc(100% + 8px); transform-origin: bottom right; animation-name: snagFlyInLeft; }
    .share-fly .lbl2 { color: #eef0f3; font-size: 13px; font-weight: 600; padding: 2px 10px 10px; }
    .share-fly .item { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 0; border-radius: 8px; background: transparent; color: #eef0f3; font-size: 13px; font-weight: 600; text-align: left; white-space: nowrap; cursor: pointer; animation: snagChipIn .22s ease both; }
    .share-fly .item:hover { background: rgba(255,255,255,0.08); }
    .share-fly .item img, .share-fly .item svg { width: 20px; height: 20px; border-radius: 5px; flex-shrink: 0; }
    @keyframes snagChipIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
    @keyframes snagFlyIn { from { opacity: 0; transform: translateX(-10px) scale(0.96); } to { opacity: 1; transform: none; } }
    @keyframes snagFlyInLeft { from { opacity: 0; transform: translateX(10px) scale(0.96); } to { opacity: 1; transform: none; } }
    .go { flex: 1; min-width: 0; padding: 11px 12px; border: 0; border-radius: 12px; cursor: pointer; background: linear-gradient(160deg,#c6f24d,#aee235); color: #17200a; display: flex; align-items: center; justify-content: space-between; gap: 8px; box-shadow: 0 10px 26px -12px rgba(198,242,77,0.55); transition: filter .15s, transform .1s; }
    .go:hover { filter: brightness(1.05); }
    .go:active { transform: translateY(1px); }
    .go:disabled { opacity: 0.5; cursor: not-allowed; filter: none; box-shadow: none; }
    .go .gl { font-weight: 800; font-size: 14px; }
    .go .gs { font-size: 10.5px; font-weight: 700; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em; }

    /* message states (loading / not running / error) */
    .center { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 26px 14px; color: #a7adb7; text-align: center; }
    .spin { width: 22px; height: 22px; border: 2.5px solid rgba(255,255,255,0.15); border-top-color: #c6f24d; border-radius: 50%; animation: snagSpin 0.8s linear infinite; }
    @keyframes snagSpin { to { transform: rotate(360deg); } }
    .btn2 { padding: 9px 16px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.2); background: none; color: #eef0f3; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    .btn2:hover { border-color: #c6f24d; }
    .accent2 { background: linear-gradient(160deg, #c6f24d, #aee235); color: #17200a; border: 0; font-weight: 800; }
    .err { color: #ff9d94; font-size: 12.5px; text-align: center; }

    @media (prefers-reduced-motion: reduce) {
      .panel, .panel.closing, .spin, .seg-ind, .qrow .radio::after, .share-fly, .share-fly .item { animation-duration: 0.001ms !important; transition: none !important; }
    }
  `

  let panel = null // { host, shadow, root, state..., destroy() }

  function closePanel(immediate) {
    if (!panel) return
    const p = panel
    panel = null
    p.cleanup()
    if (p.returnFocus && p.returnFocus.isConnected) p.returnFocus.focus({ preventScroll: true })
    if (immediate) p.host.remove()
    else {
      p.root.classList.add('closing')
      setTimeout(() => p.host.remove(), 170)
    }
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text != null) node.textContent = text
    return node
  }

  // The panel is a page element anchored where its button was when clicked
  // (document coordinates): it scrolls with the page like the video does,
  // and once it has scrolled out of view it closes, leaving just the button.
  // Corner buttons open it leftwards under their right edge; the thumbnail
  // button sits top-left, so its panel grows to the right. Returns which
  // corner it grows from, for the open animation.
  function positionPanel(host, btn) {
    const r = btn.getBoundingClientRect()
    const fromLeft = btn.classList.contains('snag-thumb-btn') && r.left + PANEL_BASE_WIDTH + 8 <= innerWidth
    const preferred = fromLeft ? r.left : r.right - PANEL_BASE_WIDTH
    const left = Math.max(8, Math.min(preferred, innerWidth - PANEL_BASE_WIDTH - 8))
    const top = Math.max(8, r.top)
    host.style.left = left + scrollX + 'px'
    host.style.top = top + scrollY + 'px'
    return fromLeft ? 'top left' : 'top right'
  }

  // Window resized: keep the panel inside the page width.
  function clampPanel(host) {
    const left = parseFloat(host.style.left) || 8
    const maxLeft = scrollX + innerWidth - PANEL_BASE_WIDTH - 8
    host.style.left = Math.max(scrollX + 8, Math.min(left, maxLeft)) + 'px'
  }

  // Scrolled far enough that the panel is no longer on screen: fold it away.
  function panelScrolledAway(host) {
    const r = host.getBoundingClientRect()
    return r.bottom < -24 || r.top > innerHeight + 24
  }

  // `target` ({ url, title, thumbnail }) is set for thumbnail buttons, where
  // there is no <video> to derive the page URL and metadata from.
  function openPanel(btn, video, target) {
    closePanel(true)

    const host = el('div', 'snag-panel-host')
    host.dataset.snagPanel = 'true'
    host.style.cssText = `position:absolute;z-index:2147483647;width:${PANEL_BASE_WIDTH}px;`
    const shadow = host.attachShadow({ mode: 'open' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(PANEL_CSS)
    shadow.adoptedStyleSheets = [sheet]

    const root = el('div', 'panel')
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', 'Snag download options')
    root.setAttribute('aria-modal', 'false')
    root.tabIndex = -1
    shadow.appendChild(root)
    document.documentElement.appendChild(host)
    root.style.transformOrigin = positionPanel(host, btn)
    btn.style.visibility = 'hidden'

    const pageUrl = target ? target.url : resolveTargetUrl(video)
    const state = {
      info: null, defaults: null, kind: 'video',
      quality: 0, container: null,
      groups: [], selectedLangs: [],
      audioLang: null, audioFmt: 'mp3',
      busy: false, launched: false, wakeTimer: null
    }

    // ----- dismissal wiring -----
    const onDocClick = (e) => {
      if (!panel) return
      const path = e.composedPath ? e.composedPath() : []
      if (path.includes(host) || path.includes(btn)) return
      closePanel()
    }
    const onKey = (e) => { if (e.key === 'Escape') closePanel() }
    const onNav = () => closePanel(true)
    const onResize = () => clampPanel(host)
    let scrollCheck = 0
    const onScroll = () => {
      if (scrollCheck) return
      scrollCheck = requestAnimationFrame(() => {
        scrollCheck = 0
        if (panel && panel.host === host && panelScrolledAway(host)) closePanel()
      })
    }
    const outsideClickTimer = setTimeout(() => document.addEventListener('click', onDocClick, true), 0)
    document.addEventListener('keydown', onKey, true)
    addEventListener('popstate', onNav)
    addEventListener('yt-navigate-start', onNav, true)
    addEventListener('resize', onResize)
    addEventListener('scroll', onScroll, { passive: true, capture: true })
    document.addEventListener('fullscreenchange', onNav)

    panel = {
      host, root, pageUrl, anchor: btn, returnFocus: btn,
      cleanup: () => {
        if (btn.isConnected) btn.style.visibility = 'visible'
        if (state.wakeTimer) clearTimeout(state.wakeTimer)
        clearTimeout(outsideClickTimer)
        document.removeEventListener('click', onDocClick, true)
        document.removeEventListener('keydown', onKey, true)
        removeEventListener('popstate', onNav)
        removeEventListener('yt-navigate-start', onNav, true)
        removeEventListener('resize', onResize)
        removeEventListener('scroll', onScroll, true)
        if (scrollCheck) cancelAnimationFrame(scrollCheck)
        document.removeEventListener('fullscreenchange', onNav)
      }
    }
    const meta = target ? { title: target.title || '', thumbnail: target.thumbnail || null } : pageMeta(video)

    const LOGO = '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>'
    const STAR_ICON = '<svg class="star" viewBox="0 0 24 24" aria-label="Recommended" role="img"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>'
    const CONTAINER_HINTS = {
      mp4: 'MP4 plays everywhere: phones, TVs, editors. Best default.',
      mkv: 'MKV holds any codec plus several audio tracks and subtitles in one file. Needed for dubs.',
      webm: 'WebM is the open format for VP9 and AV1. Browsers and most players.'
    }
    const AUDIO_HINTS = {
      mp3: 'MP3 plays everywhere.',
      m4a: 'M4A (AAC): the same quality as MP3 at a smaller size; Apple-friendly.',
      opus: 'Opus makes the smallest files; modern players only.',
      best: 'Original keeps the source track as is, with no re-encoding.'
    }
    const SHARE_ICON = '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.6 6.8-4.2"/><path d="m8.6 13.4 6.8 4.2"/></svg>'
    const APP_ICONS = {
      telegram: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#2AABEE"/><path d="M5.4 11.6l11.6-4.5c.5-.2 1 .1.8.9l-2 9.3c-.1.7-.6.8-1.1.5l-3-2.2-1.5 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.6-5.1c.2-.2 0-.3-.3-.1l-7 4.4-3-.9c-.7-.2-.7-.7.3-.9z" fill="#fff"/></svg>',
      windows: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" fill="#0a5bd6"/><path d="M6 7.3l5-.7v5H6zM12 6.5l6-.9V11.6h-6zM6 12.4h5v5l-5-.7zM12 12.4h6v6l-6-.9z" fill="#fff"/></svg>'
    }
    // Logo for a share target: the built-in symbol, or the app's own icon
    // (a data: PNG from Snag) for programs the user added.
    function appIconNode(target) {
      if (target.kind === 'custom' && typeof target.icon === 'string' && target.icon.startsWith('data:image/')) {
        const img = document.createElement('img')
        img.alt = ''
        img.src = target.icon
        return img
      }
      const svg = APP_ICONS[target.kind]
      if (!svg) return null
      const span = document.createElement('span')
      span.innerHTML = svg
      return span.firstChild
    }
    const noMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

    function selectedGroups() {
      return state.selectedLangs
        .map((key) => state.groups.find((g) => (g.language || '') === key))
        .filter(Boolean)
    }

    function hostLabel() {
      return HOST.replace(/^www\./, '')
    }

    // Framerate shown next to the quality only when it beats standard 30.
    function fpsForHeight(height) {
      const at = (state.info.videoFormats || []).filter((f) => (f.height || 0) === height)
      const max = at.length ? Math.max(...at.map((f) => f.fps || 0)) : 0
      return max > 30 ? Math.round(max) : 0
    }

    function buildHeights() {
      const info = state.info
      const measured = [...new Set((info.videoFormats || []).map((f) => f.height || 0).filter(Boolean))]
      const base = measured.length ? measured : (info.videoFormats || []).length ? [0] : []
      return base
        .sort((a, b) => b - a)
        .filter((height) => rowsForQuality(info, selectedGroups(), height).length > 0)
    }

    // ----- message screens (loading / not running / error) -----
    function buildHead(title, thumbnail, line) {
      const head = el('div', 'head')
      if (thumbnail) {
        const thumb = el('span', 'thumb')
        const img = document.createElement('img')
        img.alt = ''
        img.referrerPolicy = 'no-referrer'
        img.addEventListener('error', () => img.remove())
        img.src = thumbnail
        thumb.appendChild(img)
        head.appendChild(thumb)
      } else {
        const dot = el('span', 'dot')
        dot.innerHTML = LOGO
        head.appendChild(dot)
      }
      const txt = el('div', 'head-txt')
      txt.appendChild(el('div', 't', title || 'Snag'))
      if (line) txt.appendChild(el('div', 'm', line))
      const x = el('button', 'x', '✕')
      x.type = 'button'
      x.title = 'Close'
      x.setAttribute('aria-label', 'Close download options')
      x.addEventListener('click', () => closePanel())
      head.append(txt, x)
      return head
    }

    function renderMessage(children) {
      root.textContent = ''
      const head = buildHead(meta.title, meta.thumbnail, meta.title ? hostLabel() : '')
      const body = el('div', 'center')
      for (const n of children) body.appendChild(n)
      root.append(head, body)
    }

    function renderLoading(msg) {
      renderMessage([el('span', 'spin'), el('span', null, msg)])
    }

    function renderNotRunning(hint) {
      const strong = el('strong', null, "Snag isn't running")
      const line = el('span', null, hint || 'Start it once and downloads open right here.')
      const open = el('button', 'btn2 accent2', 'Open Snag')
      open.type = 'button'
      open.addEventListener('click', () => launchSnag(true))
      renderMessage([strong, line, open])
    }

    // Start the app through its snag://open link. The browser only allows a
    // protocol launch on a fresh user gesture, so this fires straight from
    // the click that opened the panel; while Snag boots the panel waits, then
    // continues with the analysis on its own.
    function launchSnag(force) {
      if (state.launched && !force) {
        renderNotRunning()
        return
      }
      state.launched = true
      renderLoading('Starting Snag…')
      try {
        location.href = 'snag://open'
      } catch {
        /* the wait below reports if nothing came up */
      }
      waitForSnag()
    }

    function waitForSnag() {
      if (state.wakeTimer) clearTimeout(state.wakeTimer)
      const deadline = Date.now() + 40000
      const check = async () => {
        if (!panel || panel.host !== host) return
        const res = await sendMessage({ type: 'snag:ping' })
        if (!panel || panel.host !== host) return
        if (res && res.running) {
          state.wakeTimer = null
          void loadAndRender()
          return
        }
        if (Date.now() >= deadline) {
          state.wakeTimer = null
          renderNotRunning("Snag didn't start — is it installed?")
          return
        }
        state.wakeTimer = setTimeout(check, 1000)
      }
      state.wakeTimer = setTimeout(check, 1200)
    }

    function renderError(message) {
      const err = el('span', 'err', message)
      const retry = el('button', 'btn2', 'Try again')
      retry.type = 'button'
      retry.addEventListener('click', start)
      const app = el('button', 'btn2', 'Open in Snag app')
      app.type = 'button'
      app.addEventListener('click', () => { location.href = deepLink(pageUrl); closePanel() })
      renderMessage([err, retry, app])
    }

    // ----- the picker itself (header stays, middle collapses on download) -----
    function renderReady() {
      root.textContent = ''

      // Header: thumbnail + title + duration/site.
      const line = []
      if (state.info.durationString) line.push(state.info.durationString)
      else if (state.info.isLive) line.push('Live')
      line.push(hostLabel())
      const head = buildHead(state.info.title, state.info.thumbnail || meta.thumbnail, line.join(' · '))

      // Middle: Video/Audio toggle + the active view. Collapses while downloading.
      const mid = el('div', 'mid')
      const seg = el('div', 'seg')
      const segInd = el('span', 'seg-ind')
      const vTab = el('button', 'on', 'Video')
      vTab.type = 'button'
      const aTab = el('button', null, 'Audio')
      aTab.type = 'button'
      seg.append(segInd, vTab, aTab)
      const videoView = el('div', null)
      const audioView = el('div', 'audio-view')
      audioView.style.display = 'none'
      mid.append(seg, videoView, audioView)

      // Footer: Download, and a small Share button (download, then hand the
      // file to a share app). Progress lives in the corner toast.
      const foot = el('div', 'foot')
      const footRow = el('div', 'foot-row')
      const go = el('button', 'go')
      go.type = 'button'
      const goLabel = el('span', 'gl', 'Download')
      go.append(goLabel)
      const goSub = el('span', 'gs num')
      go.append(goSub)
      const shareBtn = el('button', 'share')
      shareBtn.type = 'button'
      shareBtn.innerHTML = SHARE_ICON
      footRow.append(go, shareBtn)
      foot.append(footRow)

      // The chooser is a second card beside the panel, level with its bottom
      // edge (next to the Share button): a sibling inside the shadow root, so
      // the panel's own scrolling cannot clip it. It slides out to the right, or to the left when the
      // panel sits at the right edge of the window.
      let shareFly = null
      function closeShareFly() {
        if (shareFly) shareFly.remove()
        shareFly = null
      }
      function openShareFly(list) {
        closeShareFly()
        const fly = el('div', 'share-fly')
        fly.setAttribute('role', 'menu')
        fly.setAttribute('aria-label', 'Share with')
        fly.appendChild(el('span', 'lbl2', 'Share with'))
        list.forEach((t, i) => {
          const item = el('button', 'item')
          item.type = 'button'
          item.setAttribute('role', 'menuitem')
          const icon = appIconNode(t)
          if (icon) item.appendChild(icon)
          item.appendChild(document.createTextNode(t.label))
          item.style.animationDelay = 40 + i * 35 + 'ms'
          item.addEventListener('click', () => {
            closeShareFly()
            void enqueue({ shareWhenDone: true, shareTarget: t.id })
          })
          fly.appendChild(item)
        })
        const hostRect = host.getBoundingClientRect()
        shadow.appendChild(fly)
        const width = fly.getBoundingClientRect().width
        if (hostRect.right + 8 + width > innerWidth - 8 && hostRect.left - 8 - width >= 8) fly.classList.add('left')
        shareFly = fly
      }
      root.addEventListener('scroll', closeShareFly, { passive: true })

      function shareTargets() {
        const list = state.defaults && state.defaults.shareTargets
        return Array.isArray(list) ? list.filter((t) => t && typeof t.id === 'string') : []
      }
      const targets = shareTargets()
      shareBtn.title =
        state.defaults && state.defaults.shareAsk && targets.length > 1
          ? 'Download, then share…'
          : 'Download, then share with ' + (targets[0] ? targets[0].label : 'the Windows share panel')
      shareBtn.setAttribute('aria-label', shareBtn.title)
      shareBtn.addEventListener('click', () => {
        const list = shareTargets()
        if (state.defaults && state.defaults.shareAsk && list.length > 1) {
          if (shareFly) closeShareFly()
          else openShareFly(list)
          return
        }
        void enqueue({ shareWhenDone: true, shareTarget: list[0] ? list[0].id : undefined })
      })

      root.append(head, mid, foot)

      // ---- resolution + container data for this video ----
      const heights = buildHeights()
      const rowsByHeight = new Map()
      for (const h of heights) rowsByHeight.set(h, rowsForQuality(state.info, selectedGroups(), h))

      if (!heights.includes(state.quality)) state.quality = heights[0] || 0
      ensureContainer()

      function ensureContainer() {
        const rows = rowsByHeight.get(state.quality) || []
        if (!rows.some((r) => r.container === state.container)) {
          const rec = recommendedRow(rows, selectedGroups().length >= 2, state.defaults?.preferredContainer || 'mp4')
          state.container = rec ? rec.container : (rows[0] && rows[0].container) || null
        }
      }

      function sizeText(height, container) {
        const rows = rowsByHeight.get(height) || []
        const row = rows.find((r) => r.container === container) || rows[0]
        return row ? formatBytes(row.total) : '—'
      }

      function updateGo() {
        if (state.kind === 'video') {
          const rows = rowsByHeight.get(state.quality) || []
          go.disabled = state.busy || !rows.some((r) => r.container === state.container)
          shareBtn.disabled = go.disabled
          goSub.textContent =
            qualityLabel(state.quality) + ' · ' + (state.container || '').toUpperCase() +
            ' · ' + sizeText(state.quality, state.container)
        } else {
          go.disabled = state.busy || !state.groups.length
          shareBtn.disabled = go.disabled
          const label = state.audioFmt === 'best' ? 'Original' : state.audioFmt.toUpperCase()
          const grp = state.groups.find((g) => (g.language || '') === state.audioLang)
          const lang = state.groups.length >= 2 && grp ? ' · ' + langLabel(grp.language) : ''
          goSub.textContent = label + lang
        }
      }

      // ---- video tab: quality rows with one travelling set of format chips ----
      function buildVideoView() {
        videoView.textContent = ''
        const list = el('div', 'list')
        videoView.appendChild(list)
        const rowEls = []
        const sizeEls = []

        const chips = el('span', 'fchips')
        let chipEls = {}

        function buildChips(containers) {
          for (const btn2 of Object.values(chipEls)) btn2.remove()
          chipEls = {}
          const rows = rowsByHeight.get(state.quality) || []
          const rec = recommendedRow(rows, selectedGroups().length >= 2, state.defaults?.preferredContainer || 'mp4')
          for (const c of containers) {
            const b = el('button', 'fchip' + (c === state.container ? ' on' : ''), c.toUpperCase())
            b.type = 'button'
            if (rec && rec.container === c) b.insertAdjacentHTML('afterbegin', STAR_ICON)
            b.title = (CONTAINER_HINTS[c] || c.toUpperCase()) + '\n' + sizeText(state.quality, c)
            b.addEventListener('click', (e) => {
              e.stopPropagation()
              if (state.container === c) return
              state.container = c
              for (const [k, elc] of Object.entries(chipEls)) elc.classList.toggle('on', k === c)
              for (const s of sizeEls) s.el.textContent = sizeText(s.height, c)
              updateGo()
            })
            chipEls[c] = b
            chips.appendChild(b)
          }
        }

        const containersFor = (height) => (rowsByHeight.get(height) || []).map((r) => r.container)
        const placeChips = (height) => {
          const row = rowEls[heights.indexOf(height)]
          if (row) row.insertBefore(chips, row.querySelector('.size'))
        }

        function selectQuality(height) {
          if (state.quality === height) return
          const from = chips.getBoundingClientRect()
          rowEls[heights.indexOf(state.quality)]?.classList.remove('on')
          state.quality = height
          ensureContainer()
          rowEls[heights.indexOf(height)]?.classList.add('on')
          buildChips(containersFor(height))
          placeChips(height)
          for (const s of sizeEls) s.el.textContent = sizeText(s.height, state.container)
          const to = chips.getBoundingClientRect()
          const dx = from.left - to.left
          const dy = from.top - to.top
          if (!noMotion && (dx || dy)) {
            chips.animate(
              [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
              { duration: 240, easing: 'cubic-bezier(.3,.8,.3,1)' }
            )
          }
          updateGo()
        }

        heights.forEach((height) => {
          const row = el('div', 'qrow' + (height === state.quality ? ' on' : ''))
          row.setAttribute('role', 'button')
          row.tabIndex = 0
          const strong = el('strong', null, qualityLabel(height))
          const fps = fpsForHeight(height)
          if (fps) strong.appendChild(el('em', null, String(fps)))
          const q = el('span', 'q')
          q.appendChild(strong)
          const size = el('span', 'size num', sizeText(height, state.container))
          row.append(el('span', 'radio'), q, size)
          row.addEventListener('click', () => selectQuality(height))
          row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectQuality(height) }
          })
          rowEls.push(row)
          sizeEls.push({ el: size, height })
          list.appendChild(row)
        })

        if (!heights.length) list.appendChild(el('div', 'err', 'No compatible video formats.'))

        buildChips(containersFor(state.quality))
        if (heights.length) placeChips(state.quality)
      }

      // ---- audio tab: output format, plus language when the video is multi-dub ----
      function buildAudioView() {
        audioView.textContent = ''
        const fgroup = el('div', 'group')
        fgroup.appendChild(el('div', 'lbl2', 'Format'))
        const fmts = el('div', 'chips')
        for (const f of ['mp3', 'm4a', 'opus', 'best']) {
          const p = el('button', 'chip' + (state.audioFmt === f ? ' on' : ''), f === 'best' ? 'Original' : f.toUpperCase())
          p.type = 'button'
          if (f === 'mp3') p.insertAdjacentHTML('afterbegin', STAR_ICON)
          p.title = AUDIO_HINTS[f] || ''
          p.addEventListener('click', () => { state.audioFmt = f; buildAudioView(); updateGo() })
          fmts.appendChild(p)
        }
        fgroup.appendChild(fmts)
        audioView.appendChild(fgroup)

        if (state.groups.length >= 2) {
          const lgroup = el('div', 'group')
          lgroup.appendChild(el('div', 'lbl2', 'Language'))
          const favorites = (state.defaults?.favorites || []).map(langBase).filter(Boolean)
          if (!favorites.length) {
            const prompt = el('div', 'lang-pref')
            prompt.appendChild(el('p', null, 'Set your preferred audio language in Settings.'))
            const settings = el('button', 'btn2 accent2', 'Open Settings')
            settings.type = 'button'
            settings.addEventListener('click', async () => {
              const res = await sendMessage({ type: 'snag:open-settings', section: 'languages' })
              if (res && res.ok) closePanel()
            })
            prompt.appendChild(settings)
            lgroup.appendChild(prompt)
          } else {
            const preferred = state.groups.filter((g) => favorites.includes(langBase(g.language)))
            const visible = preferred.length
              ? preferred
              : state.groups.filter((g) => (g.language || '') === state.audioLang).slice(0, 1)
            const langs = el('div', 'chips')
            for (const g of visible) {
              const key = g.language || ''
              const p = el('button', 'chip' + (state.audioLang === key ? ' on' : ''), langLabel(g.language) + (g.isDefault ? ' ★' : ''))
              p.type = 'button'
              p.addEventListener('click', () => { state.audioLang = key; buildAudioView(); updateGo() })
              langs.appendChild(p)
            }
            lgroup.appendChild(langs)
          }
          audioView.appendChild(lgroup)
        }
      }

      function switchTab(kind) {
        if (state.kind === kind) return
        state.kind = kind
        seg.classList.toggle('audio', kind === 'audio')
        vTab.classList.toggle('on', kind === 'video')
        aTab.classList.toggle('on', kind === 'audio')
        videoView.style.display = kind === 'video' ? '' : 'none'
        audioView.style.display = kind === 'audio' ? '' : 'none'
        updateGo()
      }
      vTab.addEventListener('click', () => switchTab('video'))
      aTab.addEventListener('click', () => switchTab('audio'))


      // `extra` merges into the request: { shareWhenDone, shareTarget } for the
      // Share button.
      async function enqueue(extra) {
        if (state.busy) return
        const info = state.info
        let request
        if (state.kind === 'video') {
          const rows = rowsByHeight.get(state.quality) || []
          const chosen = rows.find((r) => r.container === state.container)
          if (!chosen) return
          request = {
            url: info.url, title: info.title, thumbnail: info.thumbnail,
            kind: 'video',
            videoFormatId: chosen.video.formatId,
            audioFormatId: chosen.tracks[0] ? chosen.tracks[0].formatId : undefined,
            audioFormatIds: chosen.tracks.length >= 2 ? chosen.tracks.map((t) => t.formatId) : undefined,
            mergeContainer: chosen.container,
            audioLanguage: chosen.tracks[0] ? chosen.tracks[0].language : null,
            selectionLabel:
              chosen.video.qualityLabel + ' · ' + chosen.container.toUpperCase() +
              (chosen.tracks.length >= 2
                ? ' · ' + chosen.tracks.map((t) => LANG_NAMES[langBase(t.language)] || langBase(t.language).toUpperCase()).join(' + ') + ' audio'
                : '')
          }
        } else {
          const group = state.groups.find((g) => (g.language || '') === state.audioLang) || state.groups[0]
          request = {
            url: info.url, title: info.title, thumbnail: info.thumbnail,
            kind: 'audio',
            audioFormatId: group && group.formats[0] ? group.formats[0].formatId : undefined,
            audioLanguage: group ? group.language : null,
            audioOutputFormat: state.audioFmt,
            selectionLabel: state.audioFmt === 'best' ? 'Original' : state.audioFmt.toUpperCase()
          }
        }

        if (extra) Object.assign(request, extra)
        state.busy = true
        updateGo()
        goLabel.textContent = 'Adding…'

        const res = await sendMessage({ type: 'snag:enqueue', request })
        state.busy = false
        if (!panel || panel.host !== host) return
        if (res.ok && res.data && res.data.ok && res.data.jobId) {
          // The thumbnail flies from the panel into the corner toast, which
          // then follows the download; the panel itself is done.
          trackDownload(
            res.data.jobId,
            {
              title: info.title || meta.title,
              thumbnail: info.thumbnail || meta.thumbnail,
              label: request.selectionLabel + (request.shareWhenDone ? ' · then share' : '')
            },
            head.querySelector('.thumb') || head.querySelector('.dot')
          )
          closePanel()
        } else if (res.error === 'not-running') {
          goLabel.textContent = 'Download'
          updateGo()
          launchSnag()
        } else {
          goLabel.textContent = 'Download'
          updateGo()
          renderError((res.data && res.data.error) || 'Could not add the download.')
        }
      }

      go.addEventListener('click', () => void enqueue(null))

      buildVideoView()
      buildAudioView()
      updateGo()
    }

    async function start() {
      renderLoading('Reading video…')
      const ping = await sendMessage({ type: 'snag:ping' })
      if (!panel || panel.host !== host) return
      if (!ping || !ping.running) {
        launchSnag()
        return
      }
      await loadAndRender()
    }

    async function loadAndRender() {
      renderLoading('Reading video…')
      const [defaultsRes, analyzeRes] = await Promise.all([
        sendMessage({ type: 'snag:defaults' }),
        requestAnalysis(pageUrl)
      ])
      if (!panel || panel.host !== host) return
      if (analyzeRes.error === 'not-running' || analyzeRes.error === 'extension') {
        launchSnag()
        return
      }
      if (analyzeRes.error === 'not-paired') {
        renderNotRunning('Snag is running but refused the connection. Reload the extension once.')
        return
      }
      const data = analyzeRes.data
      if (!data || !data.ok || !data.info) {
        renderError((data && data.error) || 'Could not read this video.')
        return
      }
      state.info = data.info
      state.defaults = defaultsRes.ok ? defaultsRes.data : null
      state.groups = data.info.audioGroups || []

      // Languages that get merged as switchable tracks come from the app's
      // saved favorites — the panel no longer asks; it just applies them.
      const favs = (state.defaults?.favorites || ['en']).map(langBase)
      const picked = []
      for (const base of favs) {
        const g = state.groups.find((x) => x.language && langBase(x.language) === base)
        if (g && !picked.includes(g.language || '')) picked.push(g.language || '')
      }
      if (picked.length && !state.defaults?.multiAudioEnabled) picked.splice(1)
      if (!picked.length && state.groups.length) {
        const def = state.groups.find((g) => langBase(g.language) === 'en') ||
          state.groups.find((g) => g.isDefault) || state.groups[0]
        picked.push(def.language || '')
      }
      state.selectedLangs = picked
      state.audioLang = picked[0] ?? null

      // Default to the top resolution; pick the container Snag recommends
      // (MKV when merging 2+ languages, otherwise MP4 / the saved preference).
      const heights = buildHeights()
      state.quality = heights[0] || 0
      const topRows = rowsForQuality(state.info, selectedGroups(), state.quality)
      const rec = recommendedRow(topRows, selectedGroups().length >= 2, state.defaults?.preferredContainer || 'mp4')
      state.container = rec ? rec.container : (topRows[0] && topRows[0].container) || null

      const prefAudio = state.defaults?.preferredAudioFormat
      state.audioFmt = ['mp3', 'm4a', 'opus', 'best'].includes(prefAudio) ? prefAudio : 'mp3'

      state.kind = 'video'
      renderReady()
      requestAnimationFrame(() => root.focus({ preventScroll: true }))
    }

    void start()
  }

  // ---------- Floating button (unchanged behavior, new click target) ----------

  function targetUrlFor(btn) {
    return btn._snagTarget ? btn._snagTarget.url : resolveTargetUrl(btn._snagVideo)
  }

  function makeButton(video) {
    const btn = document.createElement('button')
    btn._snagVideo = video
    btn.className = 'snag-dl-btn'
    btn.type = 'button'
    btn.title = 'Download with Snag'
    btn.setAttribute('aria-label', 'Download with Snag')
    // Hovering is a strong hint that a click is coming: start (or reuse) the
    // analysis right away so the picker is ready when the panel opens.
    btn.addEventListener('pointerenter', () => {
      const url = targetUrlFor(btn)
      if (!analysisByUrl.has(url)) void requestAnalysis(url)
    })
    btn.addEventListener(
      'click',
      (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (panel) {
          if (panel.anchor === btn) closePanel()
          else {
            closePanel(true)
            openPanel(btn, btn._snagVideo, btn._snagTarget)
          }
        } else openPanel(btn, btn._snagVideo, btn._snagTarget)
      },
      true
    )
    return btn
  }

  const MINW = MIN_WIDTH
  const MINH = MIN_HEIGHT

  function eligible(video) {
    if (disabled || document.fullscreenElement) return false
    if (!video.isConnected) return false
    const rect = video.getBoundingClientRect()
    if (rect.width < MINW || rect.height < MINH) return false
    if (rect.bottom < 0 || rect.right < 0) return false
    if (rect.top > innerHeight || rect.left > innerWidth) return false
    const style = getComputedStyle(video)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    return true
  }

  // Player controls the button must never sit on top of (mute/captions on
  // YouTube's hover previews, share or settings on other players). The button
  // goes below the whole cluster of controls in its column — never wedged in
  // between two of them — and stays at the corner when the corner is free.
  const CONTROL_SELECTOR =
    'button, a[href], input, select, textarea, [role="button"], [role="slider"], [role="menuitem"], [role="link"], [role="checkbox"], [role="switch"]'
  const PROBE_STEP = 8
  const PROBE_LIMIT = 220
  const CLUSTER_GAP = 6
  const PLACEMENT_RECHECK_MS = 1500
  // Anything larger than this under the button is a wrapper or a card link,
  // not an overlay control (mute, captions, share are all well under it).
  const MAX_CONTROL_SIZE = 120

  function controlAt(x, y, btn, video) {
    let stack
    try {
      stack = document.elementsFromPoint(x, y)
    } catch {
      return null
    }
    for (const node of stack) {
      if (node === btn || (node.dataset && node.dataset.snagPanel)) continue
      if (node.classList && node.classList.contains('snag-dl-btn')) continue
      if (node === video) return null
      const control = node.closest ? node.closest(CONTROL_SELECTOR) : null
      if (!control) continue
      // A link wrapping the whole player is not a control in the way, and
      // neither is any card-sized element.
      if (video && control.contains(video)) return null
      const r = control.getBoundingClientRect()
      if (r.width > MAX_CONTROL_SIZE || r.height > MAX_CONTROL_SIZE) return null
      return control
    }
    return null
  }

  // Bars fixed to the top of the viewport (YouTube's masthead) float above a
  // scrolled player; the button must not slide underneath them.
  function fixedTopInset(x, video) {
    let stack
    try {
      stack = document.elementsFromPoint(x, 4)
    } catch {
      return 0
    }
    let inset = 0
    for (const node of stack) {
      if (!(node instanceof Element) || node === document.documentElement || node === document.body) continue
      if (node === video || (video && node.contains(video))) continue
      if (node.classList && node.classList.contains('snag-dl-btn')) continue
      if (node.dataset && node.dataset.snagPanel) continue
      const pos = getComputedStyle(node).position
      if (pos !== 'fixed' && pos !== 'sticky') continue
      const r = node.getBoundingClientRect()
      if (r.top <= 4 && r.bottom > inset && r.bottom < innerHeight * 0.4) inset = r.bottom
    }
    return inset
  }

  // Height of a player's top bar when it has one (classic YouTube layout),
  // so the button starts below it instead of colliding on hover.
  function playerTopChrome(video) {
    const player = video && video.closest && video.closest('.html5-video-player')
    const top = player && player.querySelector('.ytp-chrome-top')
    if (!top) return 0
    const h = top.getBoundingClientRect().height
    return h > 0 && h < 120 ? h : 0
  }

  // The part of a video that can actually be seen: hover previews and some
  // players crop a larger <video> behind an overflow-hidden frame, and the
  // button belongs in the corner of the visible picture, not the hidden one.
  function visibleRect(video) {
    const b = video.getBoundingClientRect()
    const r = { left: b.left, top: b.top, right: b.right, bottom: b.bottom }
    let node = video.parentElement
    for (let i = 0; node && i < 8; i++, node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.overflowX === 'visible' && style.overflowY === 'visible' && style.clipPath === 'none') continue
      const c = node.getBoundingClientRect()
      if (c.width === 0 || c.height === 0) continue
      r.left = Math.max(r.left, c.left)
      r.top = Math.max(r.top, c.top)
      r.right = Math.min(r.right, c.right)
      r.bottom = Math.min(r.bottom, c.bottom)
    }
    r.width = Math.max(0, r.right - r.left)
    r.height = Math.max(0, r.bottom - r.top)
    return r
  }

  // Offset below `baseTop` at which the button clears every overlay control
  // in its column — the fallback when there is no room beside them.
  function clearOffset(left, baseTop, maxTop, btn, video) {
    const x = left + BTN_SIZE / 2
    const rects = []
    const seen = new Set()
    const limit = Math.min(baseTop + PROBE_LIMIT, maxTop + BTN_SIZE)
    for (let y = baseTop; y <= limit; y += PROBE_STEP) {
      const control = controlAt(x, y, btn, video)
      if (control && !seen.has(control)) {
        seen.add(control)
        rects.push(control.getBoundingClientRect())
      }
    }
    let top = baseTop
    for (let guard = 0; guard < 12; guard++) {
      const hit = rects.filter((r) => r.top < top + BTN_SIZE + CLUSTER_GAP && r.bottom > top - CLUSTER_GAP)
      if (!hit.length) break
      top = Math.max(...hit.map((r) => r.bottom)) + CLUSTER_GAP
    }
    return Math.max(0, Math.round(top - baseTop))
  }

  // Where the button goes relative to the top-right corner slot: the corner
  // itself when it is free; otherwise directly left of the whole group of
  // controls sitting there (mute, captions), so it always stays on the top
  // edge in a familiar spot. Only when that would leave the picture does it
  // drop below the controls instead.
  function cornerPlacement(left, baseTop, visLeft, maxTop, btn, video) {
    const y = baseTop + BTN_SIZE / 2
    const rects = []
    const seen = new Set()
    const minX = Math.max(visLeft + INSET, left - 360)
    for (let x = left + BTN_SIZE / 2; x >= minX; x -= PROBE_STEP) {
      const control = controlAt(x, y, btn, video)
      if (control && !seen.has(control)) {
        seen.add(control)
        rects.push(control.getBoundingClientRect())
      }
    }
    let slotLeft = left
    let hit = false
    for (let guard = 0; guard < 12; guard++) {
      const touching = rects.filter(
        (r) =>
          r.right > slotLeft - CLUSTER_GAP &&
          r.left < slotLeft + BTN_SIZE + CLUSTER_GAP &&
          r.bottom > baseTop - CLUSTER_GAP &&
          r.top < baseTop + BTN_SIZE + CLUSTER_GAP
      )
      if (!touching.length) break
      hit = true
      slotLeft = Math.min(...touching.map((r) => r.left)) - CLUSTER_GAP - BTN_SIZE
    }
    if (!hit) return { dx: 0, dy: 0 }
    if (slotLeft >= visLeft + INSET) return { dx: Math.round(slotLeft - left), dy: 0 }
    return { dx: 0, dy: clearOffset(left, baseTop, maxTop, btn, video) }
  }

  // Returns false when the visible part of the video is too small to host
  // the button (mostly scrolled out of view).
  function position(video, btn) {
    const rect = visibleRect(video)
    const visLeft = Math.max(rect.left, 0)
    const visRight = Math.min(rect.right, innerWidth)
    const left = visRight - BTN_SIZE - INSET
    const headerBottom = fixedTopInset(left + BTN_SIZE / 2, video)
    const visTop = Math.max(rect.top, headerBottom)
    const visBottom = Math.min(rect.bottom, innerHeight)
    if (visBottom - visTop < BTN_SIZE + 2 * INSET || visRight - visLeft < BTN_SIZE + 2 * INSET) return false

    const baseTop = rect.top >= headerBottom ? rect.top + INSET + playerTopChrome(video) : visTop + INSET
    const maxTop = visBottom - BTN_SIZE - INSET

    const now = performance.now()
    const place = btn._snagPlace || (btn._snagPlace = { dx: 0, dy: 0, key: '', checkedAt: 0 })
    const key = Math.round(rect.width) + 'x' + Math.round(rect.height) + '@' + Math.round(baseTop)
    if (key !== place.key || now - place.checkedAt > PLACEMENT_RECHECK_MS) {
      place.key = key
      place.checkedAt = now
      const spot = cornerPlacement(left, baseTop, visLeft, maxTop, btn, video)
      place.dx = spot.dx
      place.dy = spot.dy
    }
    btn.style.left = left + place.dx + 'px'
    btn.style.top = Math.min(baseTop + place.dy, maxTop) + 'px'
    return true
  }

  // ---------- Corner toasts: one per running download ----------

  const TOAST_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
    .list { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
    .card {
      width: 300px; display: flex; gap: 10px; align-items: center; padding: 9px 10px;
      background: linear-gradient(180deg, #191c23, #14161c); color: #eef0f3;
      border: 1px solid rgba(255,255,255,0.14); border-radius: 14px;
      box-shadow: 0 18px 44px -16px rgba(0,0,0,0.85);
      opacity: 0; transform: translateY(14px) scale(0.96);
      transition: opacity .25s ease, transform .32s cubic-bezier(.2,.9,.3,1.15);
    }
    .card.in { opacity: 1; transform: none; }
    .card.out { opacity: 0; transform: translateY(8px) scale(0.97); }
    .thumb { position: relative; width: 52px; height: 32px; border-radius: 7px; overflow: hidden; flex-shrink: 0; background: linear-gradient(135deg,#2c3446 0%,#1a2030 55%,#39303f 100%); }
    .thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .thumb .ok { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(198,242,77,0.94); opacity: 0; transition: opacity .2s; }
    .card.done .thumb .ok { opacity: 1; }
    .ok svg { width: 20px; height: 20px; stroke: #17200a; fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 24; stroke-dashoffset: 24; }
    .card.done .ok svg { animation: snagCheck .45s .12s cubic-bezier(.3,.8,.3,1) forwards; }
    @keyframes snagCheck { to { stroke-dashoffset: 0; } }
    .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .t { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 11px; color: #a7adb7; white-space: nowrap; }
    .row span { overflow: hidden; text-overflow: ellipsis; }
    .row strong { color: #c6f24d; font-weight: 800; font-variant-numeric: tabular-nums; flex-shrink: 0; }
    .track { height: 5px; border-radius: 999px; background: #0f1116; border: 1px solid rgba(255,255,255,0.08); overflow: hidden; }
    .fill { height: 100%; width: 0; border-radius: inherit; background: linear-gradient(90deg,#aee235,#d5ff63); transition: width .35s ease; }
    .card.done .fill { width: 100% !important; }
    .card.err .fill { background: #ff6b5e; }
    .card.err .row { color: #ff9d94; white-space: normal; }
    .card.done .row strong { color: #eef0f3; }
    .x { width: 24px; height: 24px; border: 0; background: none; color: #a7adb7; cursor: pointer; border-radius: 7px; font-size: 13px; flex-shrink: 0; }
    .x:hover { background: rgba(255,255,255,0.08); color: #fff; }
    @media (prefers-reduced-motion: reduce) { .card, .fill, .ok, .ok svg { transition: none !important; animation-duration: 0.001ms !important; } }
  `
  const CHECK = '<svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 6"/></svg>'

  let toastList = null
  const toasts = new Map() // jobId -> { card, timer, done }

  function ensureToastList() {
    if (toastList && toastList.isConnected) return toastList
    const host = el('div', 'snag-toast-host')
    host.dataset.snagPanel = 'true'
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;zoom:' + uiScale() + ';'
    const shadow = host.attachShadow({ mode: 'open' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(TOAST_CSS)
    shadow.adoptedStyleSheets = [sheet]
    toastList = el('div', 'list')
    toastList.style.pointerEvents = 'auto'
    shadow.appendChild(toastList)
    document.documentElement.appendChild(host)
    return toastList
  }

  // A copy of the panel's thumbnail arcs down into the corner where the
  // toast is about to appear — the download visibly leaves the page.
  function flyToCorner(fromEl, done) {
    const noMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    const from = fromEl && fromEl.isConnected ? fromEl.getBoundingClientRect() : null
    if (noMotion || !from || from.width < 4) {
      done()
      return
    }
    const ghost = el('div')
    ghost.dataset.snagPanel = 'true'
    ghost.style.cssText =
      'position:fixed;z-index:2147483647;pointer-events:none;overflow:hidden;border-radius:8px;' +
      'background:linear-gradient(150deg,#c6f24d,#a9e02f);box-shadow:0 12px 30px -10px rgba(0,0,0,.7);' +
      `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;`
    const img = fromEl.querySelector('img')
    if (img && img.currentSrc) {
      const copy = document.createElement('img')
      copy.src = img.currentSrc
      copy.referrerPolicy = 'no-referrer'
      copy.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;'
      ghost.appendChild(copy)
    }
    document.documentElement.appendChild(ghost)
    const scale = uiScale()
    const toX = innerWidth - (16 + 300 - 10) * scale
    const toY = innerHeight - (16 + 50 - 9) * scale
    const dx = toX - from.left
    const dy = toY - from.top
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      ghost.remove()
      done()
    }
    try {
      const anim = ghost.animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.18}px) scale(0.8)`, opacity: 1, offset: 0.42, easing: 'cubic-bezier(.2,.9,.4,1)' },
          { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0.25, offset: 1 }
        ],
        { duration: 640, easing: 'cubic-bezier(.4,.6,.3,1)', fill: 'forwards' }
      )
      anim.onfinish = finish
      anim.oncancel = finish
    } catch {
      finish()
    }
    setTimeout(finish, 900)
  }

  function trackDownload(jobId, meta, fromEl) {
    const list = ensureToastList()
    const card = el('div', 'card')
    const thumb = el('span', 'thumb')
    if (meta.thumbnail) {
      const img = document.createElement('img')
      img.alt = ''
      img.referrerPolicy = 'no-referrer'
      img.addEventListener('error', () => img.remove())
      img.src = meta.thumbnail
      thumb.appendChild(img)
    }
    const ok = el('span', 'ok')
    ok.innerHTML = CHECK
    thumb.appendChild(ok)
    const body = el('div', 'body')
    const title = el('div', 't', meta.title || 'Download')
    title.title = meta.title || ''
    const row = el('div', 'row')
    const status = el('span', null, 'Starting…')
    const pct = el('strong', 'num', '')
    row.append(status, pct)
    // Snag reports the total size once the first bytes arrive, and the real
    // size on disk when the file is finished.
    let sizeText = ''
    const track = el('div', 'track')
    const fill = el('div', 'fill')
    track.appendChild(fill)
    const detail = el('div', 'row')
    const speed = el('span', 'num', meta.label || '')
    const eta = el('span', 'num', '')
    detail.append(speed, eta)
    body.append(title, row, track, detail)
    const x = el('button', 'x', '✕')
    x.type = 'button'
    x.title = 'Cancel download'
    x.setAttribute('aria-label', 'Cancel download')
    card.append(thumb, body, x)
    list.appendChild(card)

    const entry = { card, timer: null, settled: false }
    toasts.set(jobId, entry)

    const remove = () => {
      if (entry.timer) clearTimeout(entry.timer)
      toasts.delete(jobId)
      card.classList.add('out')
      card.classList.remove('in')
      setTimeout(() => card.remove(), 300)
    }
    x.addEventListener('click', () => {
      if (!entry.settled) void sendMessage({ type: 'snag:cancel', jobId })
      remove()
    })

    const settle = (state, message) => {
      entry.settled = true
      card.classList.add(state)
      x.title = 'Dismiss'
      x.setAttribute('aria-label', 'Dismiss')
      if (state === 'done') {
        status.textContent = 'Saved to your folder'
        pct.textContent = '✓'
        speed.textContent = sizeText || meta.label || ''
        eta.textContent = ''
        entry.timer = setTimeout(remove, 4200)
      } else {
        status.textContent = message || 'The download stopped.'
        pct.textContent = ''
        speed.textContent = ''
        eta.textContent = ''
      }
    }

    const poll = async () => {
      if (!toasts.has(jobId) || entry.settled) return
      const res = await sendMessage({ type: 'snag:job', jobId })
      if (!toasts.has(jobId) || entry.settled) return
      const job = res.ok && res.data && res.data.job
      if (job && job.sizeLabel) sizeText = job.sizeLabel
      if (!job) {
        settle('err', res.error === 'not-running' ? 'Snag closed — check its queue.' : (res.data && res.data.error) || 'Lost track of this download.')
        return
      }
      if (job.status === 'completed') {
        settle('done')
        return
      }
      if (job.status === 'error' || job.status === 'canceled') {
        settle('err', job.status === 'canceled' ? 'Canceled.' : job.errorMessage || 'The download failed.')
        return
      }
      const percent = Math.max(0, Math.min(100, Number(job.progress) || 0))
      status.textContent =
        job.status === 'queued' ? 'Waiting…'
          : job.status === 'paused' ? 'Paused'
            : job.status === 'processing' ? (job.phase || 'Finishing') + '…'
              : 'Downloading'
      pct.textContent = Math.round(percent) + '%'
      fill.style.width = percent + '%'
      // While bytes are moving the total rides on the status line, which
      // leaves the speed a line of its own; the longer post-processing phases
      // keep that line to themselves and show the size below instead.
      const moving = job.status === 'downloading'
      if (sizeText && moving) status.textContent += ' · ' + sizeText
      speed.textContent = job.speed || (moving ? '' : sizeText) || meta.label || ''
      eta.textContent = job.eta ? 'ETA ' + job.eta : ''
      entry.timer = setTimeout(poll, 600)
    }

    flyToCorner(fromEl, () => {
      requestAnimationFrame(() => card.classList.add('in'))
      void poll()
    })
  }

  // ---------- Thumbnail hover button (YouTube grids, sidebars, search) ----------

  const THUMB_LINK_SELECTOR = 'a[href*="/watch?v="], a[href*="/shorts/"]'
  const THUMB_BTN_INSET = 6
  let thumbBtn = null
  let thumbLink = null
  let thumbHideTimer = null
  let thumbPrefetchTimer = null

  // YouTube watch/shorts links: on youtube.com any relative link counts;
  // elsewhere only absolute links into youtube.com (embedded thumbnails).
  function watchUrlFrom(href) {
    try {
      const parsed = new URL(href, location.origin)
      if (!IS_YT && !/(^|.)(youtube.com|youtu.be)$/i.test(parsed.hostname)) return null
      const id = parsed.searchParams.get('v')
      if (id && /^[\w-]{6,}$/.test(id)) return { id, url: `https://www.youtube.com/watch?v=${id}` }
      const short = parsed.pathname.match(/^\/shorts\/([\w-]{6,})/)
      if (short) return { id: short[1], url: `https://www.youtube.com/shorts/${short[1]}` }
    } catch {
      /* not a video link */
    }
    return null
  }

  // The picture link of a video card: big enough, carries an image, and is
  // not the player itself.
  function thumbnailLink(node) {
    if (!node || !node.closest) return null
    const link = node.closest(THUMB_LINK_SELECTOR)
    if (!link || !watchUrlFrom(link.href)) return null
    if (!link.querySelector('img, yt-image, yt-img-shadow, yt-thumbnail-view-model')) return null
    if (link.querySelector('video') || link.closest('ytd-video-preview, .html5-video-player')) return null
    const r = link.getBoundingClientRect()
    if (r.width < 110 || r.height < 60) return null
    return link
  }

  function thumbMeta(link) {
    const target = watchUrlFrom(link.href)
    const card = link.closest(
      'ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-reel-item-renderer'
    )
    const titleEl = card && card.querySelector('#video-title, .yt-lockup-metadata-view-model__title, h3, [title]')
    const title = (
      (titleEl && (titleEl.getAttribute('title') || titleEl.textContent)) ||
      link.getAttribute('aria-label') ||
      link.getAttribute('title') ||
      ''
    ).replace(/\s+/g, ' ').trim()
    return { url: target.url, title, thumbnail: `https://i.ytimg.com/vi/${target.id}/hqdefault.jpg` }
  }

  function placeThumbButton() {
    if (!thumbBtn || !thumbLink) return false
    if (!thumbLink.isConnected) return false
    const r = thumbLink.getBoundingClientRect()
    if (r.width < 110 || r.height < 60 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false
    const top = Math.max(r.top + THUMB_BTN_INSET, fixedTopInset(r.left + THUMB_BTN_INSET + 15, null) + 4)
    if (top + 30 > r.bottom - 4) return false
    thumbBtn.style.left = r.left + THUMB_BTN_INSET + 'px'
    thumbBtn.style.top = top + 'px'
    return true
  }

  function hideThumbButton() {
    if (thumbHideTimer) clearTimeout(thumbHideTimer)
    thumbHideTimer = null
    if (panel && thumbBtn && panel.anchor === thumbBtn) return
    thumbLink = null
    if (thumbBtn) thumbBtn.style.display = 'none'
  }

  function showThumbButton(link) {
    if (!thumbBtn) {
      thumbBtn = makeButton(null)
      thumbBtn.classList.add('snag-thumb-btn')
      thumbBtn.addEventListener('pointerenter', () => {
        if (thumbHideTimer) clearTimeout(thumbHideTimer)
        thumbHideTimer = null
      })
      thumbBtn.addEventListener('pointerleave', () => {
        thumbHideTimer = setTimeout(hideThumbButton, 260)
      })
      document.documentElement.appendChild(thumbBtn)
    }
    thumbLink = link
    thumbBtn._snagTarget = thumbMeta(link)
    thumbBtn.style.display = placeThumbButton() ? 'block' : 'none'
    // Resting on a card for a moment is a strong hint: start reading the
    // video now so the panel is ready when the button gets clicked.
    clearTimeout(thumbPrefetchTimer)
    const url = thumbBtn._snagTarget.url
    thumbPrefetchTimer = setTimeout(() => {
      thumbPrefetchTimer = null
      if (thumbLink === link && !analysisByUrl.has(url)) void requestAnalysis(url)
    }, 600)
  }

  // Called from refresh(): follow scrolling.
  function updateThumbButton() {
    if (!thumbBtn || !thumbLink || thumbBtn.style.display === 'none') return
    if (!placeThumbButton()) hideThumbButton()
  }

  // True while the thumbnail button is showing over the same spot as this
  // video (YouTube's hover preview): that button stays, this video gets none.
  function coveredByThumbButton(video) {
    if (!thumbBtn || !thumbLink || thumbBtn.style.display === 'none' || !thumbLink.isConnected) return false
    const r = thumbLink.getBoundingClientRect()
    const v = video.getBoundingClientRect()
    return v.left < r.right && v.right > r.left && v.top < r.bottom && v.bottom > r.top
  }

  function pointerInsideThumb(e) {
    if (!thumbLink || !thumbLink.isConnected) return false
    const r = thumbLink.getBoundingClientRect()
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
  }

  document.addEventListener(
    'pointerover',
    (e) => {
      if (disabled) return
      const node = e.target
      if (node === thumbBtn || (node.classList && node.classList.contains('snag-dl-btn'))) return
      const link = thumbnailLink(node)
      if (link) {
        if (thumbHideTimer) clearTimeout(thumbHideTimer)
        thumbHideTimer = null
        if (link !== thumbLink) showThumbButton(link)
      } else if (thumbLink && !thumbHideTimer) {
        // The hover preview is a separate element drawn over the card; the
        // pointer is still on the card as long as it is inside its box.
        if (pointerInsideThumb(e)) return
        thumbHideTimer = setTimeout(hideThumbButton, 260)
      }
    },
    true
  )

  let lastHref = location.href

  function refresh() {
    // SPA navigation (YouTube etc.): the dialog belongs to the previous video.
    if (location.href !== lastHref) {
      lastHref = location.href
      closePanel(true)
    }
    // Belt and braces for the scroll listener: a panel that has left the
    // screen (smooth scrolling, programmatic jumps) folds away on the heartbeat.
    if (panel && panelScrolledAway(panel.host)) closePanel()
    const videos = document.querySelectorAll('video')
    const currentVideos = new Set(videos)
    const seen = new Set()
    for (const video of videos) {
      seen.add(video)
      let btn = buttons.get(video)
      if (eligible(video) && !coveredByThumbButton(video)) {
        if (!btn) {
          // YouTube and other SPA players frequently replace the <video>
          // element while keeping the same visible player. Reuse the existing
          // overlay so it cannot disappear between pointer-down and click.
          const orphan = [...buttons.entries()].find(([oldVideo]) => !currentVideos.has(oldVideo))
          if (orphan) {
            const [oldVideo, oldButton] = orphan
            buttons.delete(oldVideo)
            btn = oldButton
            btn._snagVideo = video
          } else {
            btn = makeButton(video)
            document.documentElement.appendChild(btn)
          }
          buttons.set(video, btn)
        }
        // While a page is still laying itself out the player jumps around;
        // show the button only once its box has held still for a moment.
        if (!btn._snagSettled) {
          const rect = video.getBoundingClientRect()
          const sig = [rect.left, rect.top, rect.width, rect.height].map(Math.round).join(',')
          const now = performance.now()
          if (btn._snagSig !== sig) {
            btn._snagSig = sig
            btn._snagSigAt = now
          }
          if (now - btn._snagSigAt < 180) {
            btn.style.display = 'none'
            setTimeout(schedule, 200)
            continue
          }
          btn._snagSettled = true
        }
        if (position(video, btn)) {
          btn.style.display = 'block'
          prefetchAnalysis(video)
        } else {
          btn.style.display = 'none'
        }
      } else if (btn) {
        btn.style.display = 'none'
      }
    }
    updateThumbButton()

    // Videos that left the DOM (SPA navigation) take their buttons with them.
    // An open panel stays where it is; it belongs to the video it was opened for.
    for (const [video, btn] of buttons) {
      if (!seen.has(video)) {
        if (panel && panel.returnFocus === btn) {
          const replacement = [...buttons.values()].find((candidate) => candidate !== btn && candidate.isConnected && candidate.style.display !== 'none')
          if (replacement) panel.returnFocus = replacement
        }
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
      if (disabled) closePanel(true)
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
  // Layout can shift without DOM mutations (player resizes, lazy CSS) — cheap
  // heartbeat, but only on pages that actually have a video.
  setInterval(() => {
    if (buttons.size || document.getElementsByTagName('video').length) schedule()
  }, 800)

  chrome.storage.local
    .get('disabledSites')
    .then(({ disabledSites = [] }) => {
      disabled = disabledSites.includes(HOST)
      schedule()
    })
    .catch(() => schedule())
})()
