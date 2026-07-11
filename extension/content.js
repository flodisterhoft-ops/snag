// Snag for Chrome — content script.
// Pins one floating download button to the top-right corner of every
// large-enough <video>. Clicking it slides a quality-picker panel down from
// the button, right on top of the page — analyze, pick, download, all without
// leaving the video. Falls back to snag:// links when the app isn't running.

;(() => {
  const MIN_WIDTH = 250
  const MIN_HEIGHT = 140
  const BTN_SIZE = 36
  const INSET = 10
  const PANEL_WIDTH = 400
  const HOST = location.hostname

  let disabled = false
  const buttons = new Map() // <video> element -> its button element

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
    return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + units[i]
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

  // Best row per container: highest resolution, then fps, then smallest file.
  function bestRows(info, selectedGroups) {
    const rows = []
    for (const container of ['mp4', 'mkv', 'webm']) {
      const candidates = (info.videoFormats || []).filter((f) => {
        if (!videoOk(container, f)) return false
        if (f.isProgressive && f.acodec && f.acodec !== 'none' && !AUDIO_COMPAT[container].test(f.acodec)) return false
        return true
      })
      if (!candidates.length) continue
      const maxH = Math.max(...candidates.map((f) => f.height || 0))
      let pool = candidates.filter((f) => (f.height || 0) === maxH)
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
    rows.sort((a, b) => (a.total ?? Infinity) - (b.total ?? Infinity))
    return rows
  }

  // ---------- Panel ----------

  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
    .panel {
      width: ${PANEL_WIDTH}px; max-height: 74vh; overflow-y: auto; overscroll-behavior: contain;
      background: linear-gradient(180deg, #191c23, #14161c); color: #eef0f3;
      border: 1px solid rgba(255,255,255,0.14); border-radius: 16px;
      box-shadow: 0 24px 60px -18px rgba(0,0,0,0.85);
      font-size: 13px; line-height: 1.45;
      transform-origin: top right; animation: snagIn 0.24s cubic-bezier(0.24, 0.9, 0.32, 1.15) both;
    }
    .panel.closing { animation: snagOut 0.16s ease both; }
    @keyframes snagIn { from { opacity: 0; transform: translateY(-10px) scale(0.96); } to { opacity: 1; transform: none; } }
    @keyframes snagOut { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-8px) scale(0.97); } }
    .panel::-webkit-scrollbar { width: 9px; }
    .panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
    .head { display: flex; align-items: center; gap: 9px; padding: 13px 14px; border-bottom: 1px solid rgba(255,255,255,0.07); position: sticky; top: 0; background: #191c23; z-index: 2; border-radius: 16px 16px 0 0; }
    .dot { width: 24px; height: 24px; border-radius: 7px; flex-shrink: 0; background: linear-gradient(150deg, #c6f24d, #a9e02f); display: grid; place-items: center; }
    .dot svg { width: 14px; height: 14px; stroke: #17200a; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .title { flex: 1; font-weight: 600; font-size: 13px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .x { width: 26px; height: 26px; border: 0; background: none; color: #a7adb7; cursor: pointer; border-radius: 7px; font-size: 15px; flex-shrink: 0; }
    .x:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .body { padding: 13px 14px 14px; display: flex; flex-direction: column; gap: 12px; }
    .center { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 26px 12px; color: #a7adb7; text-align: center; }
    .spin { width: 22px; height: 22px; border: 2.5px solid rgba(255,255,255,0.15); border-top-color: #c6f24d; border-radius: 50%; animation: snagSpin 0.8s linear infinite; }
    @keyframes snagSpin { to { transform: rotate(360deg); } }
    .tabs { display: inline-flex; padding: 3px; background: #0f1116; border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; gap: 2px; align-self: flex-start; }
    .tab { padding: 6px 16px; border: 0; border-radius: 7px; background: none; color: #a7adb7; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    .tab.on { background: #20242c; color: #fff; }
    .label { font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #6f757f; font-weight: 700; }
    .rows { display: flex; flex-direction: column; gap: 7px; }
    .row { display: flex; align-items: center; gap: 11px; width: 100%; padding: 10px 12px; text-align: left; background: #0f1116; border: 1px solid rgba(255,255,255,0.12); border-radius: 11px; color: #eef0f3; cursor: pointer; }
    .row:hover { border-color: rgba(255,255,255,0.22); }
    .row.on { background: rgba(198,242,77,0.13); border-color: #c6f24d; }
    .rdot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.25); flex-shrink: 0; }
    .row.on .rdot { border-color: #c6f24d; background: radial-gradient(circle, #c6f24d 42%, transparent 48%); }
    .rc { font-weight: 800; font-size: 14px; min-width: 48px; letter-spacing: 0.03em; }
    .rq { flex: 1; min-width: 0; }
    .rq b { font-size: 13px; }
    .rq small { display: block; color: #6f757f; font-size: 11px; }
    .rs { text-align: right; font-family: Consolas, monospace; font-size: 12px; }
    .rs .tag { display: block; font-size: 9.5px; color: #c6f24d; font-family: 'Segoe UI', sans-serif; font-weight: 700; }
    .badge { display: inline-block; margin-left: 6px; padding: 1px 5px; border-radius: 4px; background: rgba(255,180,84,0.2); color: #ffb454; font-size: 9.5px; font-weight: 700; vertical-align: 2px; }
    .pills { display: flex; flex-wrap: wrap; gap: 7px; }
    .pill { padding: 6px 13px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.14); background: #0f1116; color: #a7adb7; font-size: 12px; font-weight: 600; cursor: pointer; }
    .pill:hover { border-color: rgba(255,255,255,0.25); }
    .pill.on { background: rgba(198,242,77,0.14); border-color: #c6f24d; color: #eef0f3; }
    .pill.ghost { color: #6f757f; border-style: dashed; }
    .more-wrap { overflow: hidden; max-height: 0; transition: max-height 0.25s ease; }
    .more-wrap.open { max-height: 220px; }
    .more-wrap .pills { padding-top: 7px; }
    .note { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #a7adb7; }
    .note::before { content: '✦'; color: #c6f24d; }
    .foot { display: grid; grid-template-columns: 1fr 1.1fr; gap: 10px; align-items: stretch; }
    .save { display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 10px 13px; background: #0f1116; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; min-width: 0; }
    .save small { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #6f757f; font-weight: 700; }
    .save span { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dl { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; padding: 13px 16px; border: 0; border-radius: 12px; background: linear-gradient(160deg, #c6f24d, #aee235); color: #17200a; font-weight: 800; font-size: 15px; cursor: pointer; box-shadow: 0 10px 26px -12px rgba(198,242,77,0.7); }
    .dl:hover { filter: brightness(1.05); }
    .dl:active { transform: translateY(1px); }
    .dl:disabled { opacity: 0.45; cursor: not-allowed; }
    .dl small { font-size: 10.5px; font-weight: 700; opacity: 0.75; }
    .ok-mark { width: 46px; height: 46px; border-radius: 50%; background: rgba(198,242,77,0.15); border: 1.5px solid #c6f24d; display: grid; place-items: center; color: #c6f24d; font-size: 22px; }
    .btn2 { padding: 9px 16px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.2); background: none; color: #eef0f3; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    .btn2:hover { border-color: #c6f24d; }
    .accent2 { background: linear-gradient(160deg, #c6f24d, #aee235); color: #17200a; border: 0; font-weight: 800; }
    .err { color: #ff9d94; font-size: 12.5px; text-align: center; }
  `

  let panel = null // { host, shadow, root, state..., destroy() }

  function closePanel(immediate) {
    if (!panel) return
    const p = panel
    panel = null
    p.cleanup()
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

  function positionPanel(host, btn) {
    const r = btn.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.right - PANEL_WIDTH, innerWidth - PANEL_WIDTH - 8))
    const top = Math.min(r.bottom + 8, innerHeight - 120)
    host.style.left = left + 'px'
    host.style.top = top + 'px'
  }

  function openPanel(btn, video) {
    closePanel(true)

    const host = el('div')
    host.style.cssText = `position:fixed;z-index:2147483647;width:${PANEL_WIDTH}px;`
    const shadow = host.attachShadow({ mode: 'closed' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(PANEL_CSS)
    shadow.adoptedStyleSheets = [sheet]

    const root = el('div', 'panel')
    shadow.appendChild(root)
    document.documentElement.appendChild(host)
    positionPanel(host, btn)

    const pageUrl = resolveTargetUrl(video)
    const state = {
      info: null, defaults: null, kind: 'video',
      rows: [], container: null,
      groups: [], selectedLangs: [], moreOpen: false,
      audioLang: null, audioFmt: 'mp3',
      busy: false
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
    document.addEventListener('click', onDocClick, true)
    document.addEventListener('keydown', onKey, true)
    addEventListener('popstate', onNav)
    addEventListener('yt-navigate-start', onNav, true)
    document.addEventListener('fullscreenchange', onNav)

    panel = {
      host, root, pageUrl,
      reposition: () => positionPanel(host, btn),
      cleanup: () => {
        document.removeEventListener('click', onDocClick, true)
        document.removeEventListener('keydown', onKey, true)
        removeEventListener('popstate', onNav)
        removeEventListener('yt-navigate-start', onNav, true)
        document.removeEventListener('fullscreenchange', onNav)
      }
    }

    // ----- rendering -----
    const LOGO = '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>'

    function header(title) {
      const head = el('div', 'head')
      const dot = el('span', 'dot')
      dot.innerHTML = LOGO
      const t = el('span', 'title', title)
      const x = el('button', 'x', '✕')
      x.addEventListener('click', () => closePanel())
      head.append(dot, t, x)
      return head
    }

    function renderShell(title, bodyNodes) {
      root.textContent = ''
      root.appendChild(header(title))
      const body = el('div', 'body')
      for (const n of bodyNodes) body.appendChild(n)
      root.appendChild(body)
    }

    function renderLoading(msg) {
      const c = el('div', 'center')
      c.append(el('span', 'spin'), el('span', null, msg))
      renderShell('Snag', [c])
    }

    function renderNotRunning() {
      const c = el('div', 'center')
      c.append(el('strong', null, "Snag isn't running"))
      c.append(el('span', null, 'Start it once and downloads open right here.'))
      const open = el('button', 'btn2 accent2', 'Open Snag')
      open.addEventListener('click', () => { location.href = deepLink(pageUrl); closePanel() })
      c.appendChild(open)
      renderShell('Snag', [c])
    }

    function renderError(message) {
      const c = el('div', 'center')
      c.append(el('span', 'err', message))
      const retry = el('button', 'btn2', 'Try again')
      retry.addEventListener('click', start)
      const app = el('button', 'btn2', 'Open in Snag app')
      app.addEventListener('click', () => { location.href = deepLink(pageUrl); closePanel() })
      c.append(retry, app)
      renderShell('Snag', [c])
    }

    function renderAdded() {
      const c = el('div', 'center')
      const mark = el('span', 'ok-mark', '✓')
      c.append(mark, el('strong', null, 'Added to Snag'))
      c.append(el('span', null, 'Downloading in the background — you can keep watching.'))
      renderShell(state.info.title, [c])
      setTimeout(() => closePanel(), 1900)
    }

    function selectedGroups() {
      return state.groups.filter((g) => state.selectedLangs.includes(g.language || ''))
    }

    // Favorite pills first (ranked by settings order), the rest behind "More".
    function pillSection(single) {
      const wrap = el('div')
      if (!state.info.hasMultipleAudioLanguages || state.groups.length < 2) return wrap
      wrap.append(el('div', 'label', 'Audio tracks'))
      wrap.lastChild.style.marginBottom = '7px'

      const favs = (state.defaults?.favorites || ['en']).map(langBase)
      const ranked = []
      const rest = []
      for (const base of favs) {
        const g = state.groups.find((x) => x.language && langBase(x.language) === base)
        if (g && !ranked.includes(g)) ranked.push(g)
      }
      for (const g of state.groups) {
        if (!ranked.includes(g)) rest.push(g)
      }
      // Nothing favorited on this video: promote the default track.
      if (!ranked.length) {
        const def = state.groups.find((g) => g.isDefault) || state.groups[0]
        ranked.push(def)
        const i = rest.indexOf(def)
        if (i >= 0) rest.splice(i, 1)
      }

      const mainRow = el('div', 'pills')
      const moreWrap = el('div', 'more-wrap' + (state.moreOpen ? ' open' : ''))
      const moreRow = el('div', 'pills')
      moreWrap.appendChild(moreRow)

      const toggle = (g) => {
        const key = g.language || ''
        if (single) {
          state.audioLang = key
        } else {
          const i = state.selectedLangs.indexOf(key)
          if (i >= 0) {
            if (state.selectedLangs.length > 1) state.selectedLangs.splice(i, 1)
          } else {
            state.selectedLangs.push(key)
          }
        }
        renderPicker()
      }

      const pillFor = (g) => {
        const key = g.language || ''
        const active = single ? state.audioLang === key : state.selectedLangs.includes(key)
        const p = el('button', 'pill' + (active ? ' on' : ''), langLabel(g.language) + (g.isDefault ? ' ★' : ''))
        p.addEventListener('click', () => toggle(g))
        return p
      }

      for (const g of ranked) mainRow.appendChild(pillFor(g))
      if (rest.length) {
        const more = el('button', 'pill ghost', state.moreOpen ? 'Hide ▴' : `More (${rest.length}) ▾`)
        more.addEventListener('click', () => { state.moreOpen = !state.moreOpen; renderPicker() })
        mainRow.appendChild(more)
        for (const g of rest) moreRow.appendChild(pillFor(g))
      }

      wrap.append(mainRow, moreWrap)
      if (!single && state.selectedLangs.length >= 2) {
        const n = el('div', 'note', 'Both languages embedded as switchable tracks.')
        n.style.marginTop = '8px'
        wrap.appendChild(n)
      }
      return wrap
    }

    function renderPicker() {
      const info = state.info
      const nodes = []

      // Tabs
      const tabs = el('div', 'tabs')
      for (const k of ['video', 'audio']) {
        const t = el('button', 'tab' + (state.kind === k ? ' on' : ''), k === 'video' ? 'Video' : 'Audio')
        t.addEventListener('click', () => { state.kind = k; renderPicker() })
        tabs.appendChild(t)
      }
      nodes.push(tabs)

      if (state.kind === 'video') {
        nodes.push(pillSection(false))

        state.rows = bestRows(info, selectedGroups())
        if (!state.rows.some((r) => r.container === state.container)) {
          state.container = state.rows[0] ? state.rows[0].container : null
        }
        const list = el('div', 'rows')
        const smallest = state.rows[0]
        for (const r of state.rows) {
          const row = el('button', 'row' + (r.container === state.container ? ' on' : ''))
          const q = el('span', 'rq')
          const b = el('b', null, r.video.qualityLabel)
          if (r.video.dynamicRange && r.video.dynamicRange !== 'SDR') {
            const hdr = el('span', 'badge', r.video.dynamicRange)
            b.appendChild(hdr)
          }
          const sub = el('small', null, (r.video.vcodec || 'original') + (r.tracks.length >= 2 ? ` · ${r.tracks.length} audio tracks` : ''))
          q.append(b, sub)
          const s = el('span', 'rs', (r.approx ? '~' : '') + formatBytes(r.total))
          if (r === smallest && state.rows.length > 1) s.appendChild(el('span', 'tag', 'smallest'))
          row.append(el('span', 'rdot'), el('span', 'rc', r.container.toUpperCase()), q, s)
          row.addEventListener('click', () => { state.container = r.container; renderPicker() })
          list.appendChild(row)
        }
        if (!state.rows.length) list.appendChild(el('div', 'err', 'No downloadable video streams found.'))
        nodes.push(list)
      } else {
        nodes.push(pillSection(true))
        const fmts = el('div', 'pills')
        for (const f of ['mp3', 'm4a', 'opus', 'best']) {
          const p = el('button', 'pill' + (state.audioFmt === f ? ' on' : ''), f === 'best' ? 'Original' : f.toUpperCase())
          p.addEventListener('click', () => { state.audioFmt = f; renderPicker() })
          fmts.appendChild(p)
        }
        const lw = el('div')
        lw.append(el('div', 'label', 'Format'))
        lw.lastChild.style.marginBottom = '7px'
        lw.appendChild(fmts)
        nodes.push(lw)
      }

      // Footer: save-to + thick download button, two columns.
      const foot = el('div', 'foot')
      const save = el('div', 'save')
      save.append(el('small', null, 'Save to'), el('span', null, shortPath(state.defaults?.saveDir || '')))
      save.title = (state.defaults?.saveDir || '') + ' — change in Snag settings'
      const dl = el('button', 'dl')
      const chosen = state.rows.find((r) => r.container === state.container)
      let sub = ''
      if (state.kind === 'video' && chosen) {
        sub = chosen.video.qualityLabel + ' · ' + chosen.container.toUpperCase()
        if (chosen.tracks.length >= 2) sub += ' · ' + chosen.tracks.map((t) => langBase(t.language).toUpperCase()).join('+')
      } else if (state.kind === 'audio') {
        sub = (state.audioFmt === 'best' ? 'Original' : state.audioFmt.toUpperCase())
      }
      dl.append(el('span', null, state.busy ? 'Adding…' : 'Download'), el('small', null, sub))
      dl.disabled = state.busy || (state.kind === 'video' && !chosen)
      dl.addEventListener('click', () => void enqueue(chosen))
      foot.append(save, dl)
      nodes.push(foot)

      renderShell(info.title, nodes)
    }

    async function enqueue(chosen) {
      if (state.busy) return
      state.busy = true
      renderPicker()
      const info = state.info
      let request
      if (state.kind === 'video' && chosen) {
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
              ? ' · ' + chosen.tracks.map((t) => langBase(t.language).toUpperCase()).join('+') + ' audio'
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
          selectionLabel: (state.audioFmt === 'best' ? 'Original' : state.audioFmt.toUpperCase())
        }
      }
      const res = await sendMessage({ type: 'snag:enqueue', request })
      state.busy = false
      if (res.ok && res.data && res.data.ok) renderAdded()
      else if (res.error === 'not-running') renderNotRunning()
      else renderError((res.data && res.data.error) || 'Could not add the download.')
    }

    async function start() {
      renderLoading('Reading video…')
      const [defaultsRes, analyzeRes] = await Promise.all([
        sendMessage({ type: 'snag:defaults' }),
        sendMessage({ type: 'snag:analyze', url: pageUrl })
      ])
      if (!panel || panel.host !== host) return
      if (analyzeRes.error === 'not-running' || analyzeRes.error === 'not-paired' || analyzeRes.error === 'extension') {
        renderNotRunning()
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

      // Preselect favorites present on the video (ranked), else the default track.
      const favs = (state.defaults?.favorites || ['en']).map(langBase)
      const picked = []
      for (const base of favs) {
        const g = state.groups.find((x) => x.language && langBase(x.language) === base)
        if (g && !picked.includes(g.language || '')) picked.push(g.language || '')
      }
      if (!picked.length && state.groups.length) {
        const def = state.groups.find((g) => g.isDefault) || state.groups[0]
        picked.push(def.language || '')
      }
      state.selectedLangs = picked
      state.audioLang = picked[0] ?? null
      state.kind = 'video'
      renderPicker()
    }

    void start()
  }

  // ---------- Floating button (unchanged behavior, new click target) ----------

  function makeButton(video) {
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
        if (panel) closePanel()
        else openPanel(btn, video)
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

  function position(video, btn) {
    const rect = video.getBoundingClientRect()
    btn.style.top = Math.min(Math.max(rect.top + INSET, 4), innerHeight - BTN_SIZE - 4) + 'px'
    btn.style.left =
      Math.min(Math.max(rect.right - BTN_SIZE - INSET, 4), innerWidth - BTN_SIZE - 4) + 'px'
  }

  let lastHref = location.href

  function refresh() {
    // SPA navigation (YouTube etc.): the dialog belongs to the previous video.
    if (location.href !== lastHref) {
      lastHref = location.href
      closePanel(true)
    }
    const videos = document.querySelectorAll('video')
    const seen = new Set()
    for (const video of videos) {
      seen.add(video)
      let btn = buttons.get(video)
      if (eligible(video)) {
        if (!btn) {
          btn = makeButton(video)
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
    if (panel) panel.reposition()
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
