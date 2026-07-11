import { app } from 'electron'
import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { analyze } from './metadata'
import { downloadManager } from './downloader'
import { loadSettings, saveSettings } from './settings'
import { isHttpUrl } from './protocol'
import { isChromeExtensionOrigin, normalizeAudioLanguages } from '@shared/browserIntegration'
import type { DownloadRequest, VideoContainer, AudioOutputFormat } from '@shared/types'

// Loopback API for the Chrome extension's in-page download panel. Bound to
// 127.0.0.1 only and authenticated with a pairing token that Snag writes into
// the extension folder it generates — websites never see the token, so they
// cannot drive this API even though it runs on localhost.

export const LOCAL_API_PORTS = [43110, 43111, 43112, 43113, 43114, 43115, 43116, 43117]
const MAX_BODY_BYTES = 64 * 1024

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
  const body = JSON.stringify(payload)
  const allowedOrigin = isChromeExtensionOrigin(origin) ? origin : '*'
  res.writeHead(status, {
    'Content-Type': 'application/json',
    // The Bearer token is the actual gate; CORS only needs to let the
    // extension's service worker read responses.
    'Access-Control-Allow-Origin': allowedOrigin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  })
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
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
    saveDir: loadSettings().defaultSaveDir,
    selectionLabel: str(b.selectionLabel, 120) || 'From browser'
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {}, origin)
    return
  }
  const path = (req.url ?? '/').split('?')[0]

  // Existing unpacked installs may live outside Snag's generated extension
  // folder and therefore have no token in config.js. Only a real Chromium
  // extension origin can request a token; ordinary websites are rejected.
  if (req.method === 'POST' && path === '/pair') {
    if (!isChromeExtensionOrigin(origin)) {
      sendJson(res, 403, { error: 'extension origin required' }, origin)
      return
    }
    sendJson(res, 200, { app: 'snag', token: getLocalApiToken() }, origin)
    return
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: 'unauthorized' }, origin)
    return
  }

  if (req.method === 'GET' && path === '/ping') {
    sendJson(res, 200, { app: 'snag', version: app.getVersion() })
    return
  }

  if (req.method === 'GET' && path === '/defaults') {
    const s = loadSettings()
    sendJson(res, 200, {
      saveDir: s.defaultSaveDir,
      favorites: s.multiAudio.languages,
      multiAudioEnabled: s.multiAudio.enabled,
      bestQualityMode: s.bestQualityMode,
      preferredContainer: s.preferredVideoContainer,
      preferredAudioFormat: s.preferredAudioFormat
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
      sendJson(res, 400, { ok: false, error: 'Choose at least one language.' }, origin)
      return
    }
    const settings = saveSettings({
      multiAudio: { enabled: languages.length >= 2, languages }
    })
    sendJson(res, 200, { ok: true, favorites: settings.multiAudio.languages }, origin)
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
      sendJson(res, 400, { ok: false, error: 'A valid http(s) url is required.' })
      return
    }
    try {
      const info = await analyze(url, loadSettings().ytdlpPath)
      sendJson(res, 200, { ok: true, info })
    } catch (err) {
      sendJson(res, 200, { ok: false, error: (err as Error).message })
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
      sendJson(res, 400, { ok: false, error: 'Invalid download request.' })
      return
    }
    downloadManager.enqueue(request)
    sendJson(res, 200, { ok: true })
    return
  }

  sendJson(res, 404, { error: 'not found' })
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
