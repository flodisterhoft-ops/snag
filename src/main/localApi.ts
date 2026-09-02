import { app } from 'electron'
import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { randomBytes, timingSafeEqual, createHash } from 'crypto'
import { readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { analyzeCached, clearAnalysisCache } from './metadata'
import { cookieArgs, cookieSyncWanted, saveBrowserCookies } from './cookies'
import { downloadManager } from './downloader'
import { loadSettings, saveSettings } from './settings'
import { isHttpUrl } from './protocol'
import { openSettingsWindow } from './windows'
import { shareTargetsWithIcons } from './share'
import {
  allowedCorsOrigin,
  isSettingsSection,
  isSnagExtensionOrigin,
  normalizeAudioLanguages
} from '@shared/browserIntegration'
import type { DownloadRequest, VideoContainer, AudioOutputFormat } from '@shared/types'

// Loopback API for the Chrome extension's in-page download panel. Bound to
// 127.0.0.1 only and authenticated with a pairing token that Snag writes into
// the extension folder it generates — websites never see the token, so they
// cannot drive this API even though it runs on localhost.

export const LOCAL_API_PORTS = [43110, 43111, 43112, 43113, 43114, 43115, 43116, 43117]
const MAX_BODY_BYTES = 64 * 1024
// A full cookie export for a dozen sites is a few hundred kilobytes at most.
const MAX_COOKIE_BODY_BYTES = 2 * 1024 * 1024

let server: Server | null = null
let activePort: number | null = null
let cachedToken: string | null = null

function tokenFile(): string {
  return join(app.getPath('userData'), 'local-api-token')
}

// One token per installation, generated on first use and reused so the
// extension folder stays paired across app updates.
export function getLocalApiToken(): string {
  if (cachedToken) return cachedToken
  try {
    const existing = readFileSync(tokenFile(), 'utf8').trim()
    if (/^[a-f0-9]{48,}$/i.test(existing)) {
      cachedToken = existing
      return existing
    }
  } catch {
    /* fall through to generation */
  }
  const fresh = randomBytes(32).toString('hex')
  try {
    writeFileSync(tokenFile(), fresh, 'utf8')
  } catch (err) {
    console.error('[snag] Could not persist the local API token:', err)
  }
  cachedToken = fresh
  return fresh
}

function isAuthorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const provided = Buffer.from(header.slice(7).trim())
  const expected = Buffer.from(getLocalApiToken())
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  origin?: string
): void {
  const headers: Record<string, string> = { Vary: 'Origin' }
  // The Bearer token is the actual gate; CORS only needs to let the
  // extension's service worker read responses. Web pages get no grant, so
  // even the token-free /health probe cannot tell them Snag is installed.
  const allowedOrigin = allowedCorsOrigin(origin)
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
  }
  if (status === 204) {
    res.writeHead(status, headers)
    res.end()
    return
  }
  headers['Content-Type'] = 'application/json'
  res.writeHead(status, headers)
  res.end(JSON.stringify(payload))
}

function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Request body too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const CONTAINERS: ReadonlySet<string> = new Set(['mp4', 'mkv', 'webm'])
const AUDIO_FORMATS: ReadonlySet<string> = new Set(['mp3', 'm4a', 'opus', 'wav', 'flac', 'best'])
const FORMAT_ID_RE = /^[\w.+-]{1,64}$/

function str(v: unknown, max = 500): string | undefined {
  return typeof v === 'string' && v.length <= max ? v : undefined
}

// Build a DownloadRequest from untrusted JSON: whitelist every field, and take
// the save folder from settings rather than the network.
function requestFromBody(raw: unknown): DownloadRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const b = raw as Record<string, unknown>
  const url = str(b.url, 2048)
  if (!url || !isHttpUrl(url)) return null

  const kind = b.kind === 'audio' ? 'audio' : 'video'
  const videoFormatId = str(b.videoFormatId, 64)
  const audioFormatId = str(b.audioFormatId, 64)
  if (videoFormatId && !FORMAT_ID_RE.test(videoFormatId)) return null
  if (audioFormatId && !FORMAT_ID_RE.test(audioFormatId)) return null
  let audioFormatIds: string[] | undefined
  if (Array.isArray(b.audioFormatIds)) {
    const ids = b.audioFormatIds.filter(
      (v): v is string => typeof v === 'string' && FORMAT_ID_RE.test(v)
    )
    if (ids.length >= 2 && ids.length <= 8) audioFormatIds = ids
  }
  const mergeContainer = CONTAINERS.has(String(b.mergeContainer))
    ? (b.mergeContainer as VideoContainer)
    : undefined
  const audioOutputFormat = AUDIO_FORMATS.has(String(b.audioOutputFormat))
    ? (b.audioOutputFormat as AudioOutputFormat)
    : undefined

  return {
    url,
    title: str(b.title, 300) || url,
    thumbnail: str(b.thumbnail, 2048) ?? null,
    kind,
    videoFormatId,
    audioFormatId,
    audioFormatIds,
    mergeContainer,
    audioLanguage: str(b.audioLanguage, 20) ?? null,
    audioOutputFormat,
    openWhenDone: b.openWhenDone === true || undefined,
    shareWhenDone: b.shareWhenDone === true || undefined,
    shareTarget: b.shareWhenDone === true ? str(b.shareTarget, 64) : undefined,
    saveDir: loadSettings().defaultSaveDir,
    selectionLabel: str(b.selectionLabel, 120) || 'From browser'
  }
}

// Identity of the unpacked extension folder Chrome loads. It changes whenever
// Snag refreshes that folder, so the extension can reload itself even when the
// app version did not change (local builds, hotfixes).
let extensionRevisionCache: { key: string; at: number } | null = null
function extensionRevision(): string {
  const now = Date.now()
  if (extensionRevisionCache && now - extensionRevisionCache.at < 30000) return extensionRevisionCache.key
  const dir = join(app.getPath('userData'), 'browser-extension')
  const parts: string[] = []
  for (const name of ['manifest.json', 'content.js', 'content.css', 'background.js']) {
    try {
      const st = statSync(join(dir, name))
      parts.push(name + ':' + st.size + ':' + Math.round(st.mtimeMs))
    } catch {
      parts.push(name + ':missing')
    }
  }
  const key = createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)
  extensionRevisionCache = { key, at: now }
  return key
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  const reply = (status: number, payload: unknown): void => sendJson(res, status, payload, origin)
  if (req.method === 'OPTIONS') {
    reply(204, null)
    return
  }
  const path = (req.url ?? '/').split('?')[0]

  // Startup polling only needs to distinguish Snag from an unused/local port.
  // Keep it token-free so waking the app does not repeatedly attempt pairing.
  if (req.method === 'GET' && path === '/health') {
    reply(200, { app: 'snag' })
    return
  }

  // Existing unpacked installs may live outside Snag's generated extension
  // folder and therefore have no token in config.js. Only Snag's own extension
  // — pinned by the `key` in its manifest — can request a token; other
  // extensions and ordinary websites are rejected.
  if (req.method === 'POST' && path === '/pair') {
    if (!isSnagExtensionOrigin(origin)) {
      reply(403, { error: 'extension origin required' })
      return
    }
    reply(200, { app: 'snag', token: getLocalApiToken() })
    return
  }

  if (!isAuthorized(req)) {
    reply(401, { error: 'unauthorized' })
    return
  }

  if (req.method === 'GET' && path === '/ping') {
    reply(200, {
      app: 'snag',
      version: app.getVersion(),
      extensionRevision: extensionRevision(),
      // Asks the extension to send a fresh cookie export on this heartbeat.
      cookieSyncWanted: cookieSyncWanted(loadSettings())
    })
    return
  }

  // Cookie export from Snag's own extension for signed-in downloads. Only the
  // pinned extension may send it, only while the user enabled that source.
  if (req.method === 'POST' && path === '/cookies') {
    if (!isSnagExtensionOrigin(origin)) {
      reply(403, { ok: false, error: 'extension origin required' })
      return
    }
    if (loadSettings().cookieSource !== 'extension') {
      reply(409, { ok: false, error: 'Browser sign-in is not enabled in Snag.' })
      return
    }
    let count: number
    try {
      const body = JSON.parse(await readBody(req, MAX_COOKIE_BODY_BYTES)) as { cookies?: unknown }
      count = saveBrowserCookies(body.cookies)
    } catch (err) {
      reply(400, { ok: false, error: (err as Error).message || 'Invalid cookie export.' })
      return
    }
    saveSettings({ cookiesSyncedAt: Date.now() })
    clearAnalysisCache()
    reply(200, { ok: true, count })
    return
  }

  if (req.method === 'GET' && path === '/defaults') {
    const s = loadSettings()
    reply(200, {
      saveDir: s.defaultSaveDir,
      favorites: s.multiAudio.languages,
      multiAudioEnabled: s.multiAudio.enabled,
      bestQualityMode: s.bestQualityMode,
      preferredContainer: s.preferredVideoContainer,
      preferredAudioFormat: s.preferredAudioFormat,
      // Usable share apps for the panel's Share button, in the user's order.
      shareTargets: (await shareTargetsWithIcons(s))
        .filter((t) => t.enabled && t.installed)
        .map((t) => ({ id: t.id, label: t.label, kind: t.kind, icon: t.icon })),
      shareAsk: s.shareAsk
    })
    return
  }

  if (req.method === 'POST' && path === '/open-settings') {
    let section: unknown
    try {
      section = (JSON.parse((await readBody(req)) || '{}') as { section?: unknown }).section
    } catch {
      /* no section requested */
    }
    openSettingsWindow(isSettingsSection(section) ? section : 'general')
    reply(200, { ok: true })
    return
  }

  if (req.method === 'POST' && path === '/extension/heartbeat') {
    const settings = loadSettings()
    const now = Date.now()
    if (now - settings.browserExtensionLastSeen > 5 * 60 * 1000) {
      saveSettings({ browserExtensionLastSeen: now })
    }
    reply(200, { ok: true })
    return
  }

  if (req.method === 'POST' && path.startsWith('/jobs/') && path.endsWith('/cancel')) {
    const id = path.slice('/jobs/'.length, -'/cancel'.length)
    if (!/^job_[a-z0-9_]+$/i.test(id)) {
      reply(400, { ok: false, error: 'Invalid job id.' })
      return
    }
    if (!downloadManager.getJob(id)) {
      reply(404, { ok: false, error: 'Download not found.' })
      return
    }
    downloadManager.cancel(id)
    reply(200, { ok: true })
    return
  }

  if (req.method === 'GET' && path.startsWith('/jobs/')) {
    const id = path.slice('/jobs/'.length)
    if (!/^job_[a-z0-9_]+$/i.test(id)) {
      reply(400, { ok: false, error: 'Invalid job id.' })
      return
    }
    const job = downloadManager.getJob(id)
    if (!job) {
      reply(404, { ok: false, error: 'Download not found.' })
      return
    }
    reply(200, {
      ok: true,
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        speed: job.speed,
        eta: job.eta,
        sizeLabel: job.sizeLabel,
        phase: job.phase ?? null,
        errorMessage: job.errorMessage
      }
    })
    return
  }

  if (req.method === 'POST' && path === '/preferences/audio-languages') {
    let languages: string[] = []
    try {
      const body = JSON.parse(await readBody(req)) as { languages?: unknown }
      languages = normalizeAudioLanguages(body.languages)
    } catch {
      /* handled below */
    }
    if (languages.length === 0) {
      reply(400, { ok: false, error: 'Choose at least one language.' })
      return
    }
    const settings = saveSettings({
      multiAudio: { enabled: languages.length >= 2, languages }
    })
    reply(200, { ok: true, favorites: settings.multiAudio.languages })
    return
  }

  if (req.method === 'POST' && path === '/analyze') {
    let url: string | undefined
    try {
      const body = JSON.parse(await readBody(req)) as { url?: unknown }
      url = str(body.url, 2048)
    } catch {
      /* handled below */
    }
    if (!url || !isHttpUrl(url)) {
      reply(400, { ok: false, error: 'A valid http(s) url is required.' })
      return
    }
    try {
      const settings = loadSettings()
      const info = await analyzeCached(url, settings.ytdlpPath, cookieArgs(settings))
      reply(200, { ok: true, info })
    } catch (err) {
      reply(200, { ok: false, error: (err as Error).message })
    }
    return
  }

  if (req.method === 'POST' && path === '/enqueue') {
    let request: DownloadRequest | null = null
    try {
      request = requestFromBody(JSON.parse(await readBody(req)))
    } catch {
      /* handled below */
    }
    if (!request) {
      reply(400, { ok: false, error: 'Invalid download request.' })
      return
    }
    const job = downloadManager.enqueue(request)
    reply(200, { ok: true, jobId: job.id })
    return
  }

  reply(404, { error: 'not found' })
}

async function tryListen(port: number): Promise<Server | null> {
  return new Promise((resolve) => {
    const candidate = createServer((req, res) => {
      void handle(req, res).catch((err) => {
        console.error('[snag] Local API error:', err)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
      })
    })
    candidate.once('error', () => resolve(null))
    candidate.listen(port, '127.0.0.1', () => resolve(candidate))
  })
}

export async function startLocalApi(): Promise<number | null> {
  if (server) return activePort
  for (const port of LOCAL_API_PORTS) {
    const listening = await tryListen(port)
    if (listening) {
      server = listening
      activePort = port
      console.log(`[snag] Local API listening on 127.0.0.1:${port}`)
      return port
    }
  }
  console.error('[snag] Local API could not bind any port; the in-page panel will fall back.')
  return null
}

export function stopLocalApi(): void {
  server?.close()
  server = null
  activePort = null
}
