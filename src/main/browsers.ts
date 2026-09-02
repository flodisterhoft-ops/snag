import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { BrowserInfo } from '@shared/types'

// Chromium browsers that can load Snag's extension. Edge ships with Windows,
// so a user without Chrome still lands on a working extensions page.

interface BrowserDefinition extends BrowserInfo {
  progIds: RegExp
  candidates: () => (string | undefined)[]
}

const PF = (): string | undefined => process.env['PROGRAMFILES']
const PF86 = (): string | undefined => process.env['PROGRAMFILES(X86)']
const LOCAL = (): string | undefined => process.env['LOCALAPPDATA']
const under = (root: string | undefined, ...parts: string[]): string | undefined =>
  root ? join(root, ...parts) : undefined

export const BROWSERS: readonly BrowserDefinition[] = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    scheme: 'chrome',
    progIds: /^ChromeHTML|^ChromeBHTML/i,
    candidates: () => [
      under(PF(), 'Google', 'Chrome', 'Application', 'chrome.exe'),
      under(PF86(), 'Google', 'Chrome', 'Application', 'chrome.exe'),
      under(LOCAL(), 'Google', 'Chrome', 'Application', 'chrome.exe')
    ]
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    scheme: 'edge',
    progIds: /^MSEdgeHTM/i,
    candidates: () => [
      under(PF86(), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      under(PF(), 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ]
  },
  {
    id: 'brave',
    name: 'Brave',
    scheme: 'brave',
    progIds: /^BraveHTML/i,
    candidates: () => [
      under(PF(), 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      under(PF86(), 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      under(LOCAL(), 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
    ]
  }
]

// Maps the ProgId Windows stores for the https handler to one of ours.
export function browserForProgId(progId: string | null | undefined): BrowserInfo | null {
  if (!progId) return null
  const match = BROWSERS.find((browser) => browser.progIds.test(progId.trim()))
  return match ? { id: match.id, name: match.name, scheme: match.scheme } : null
}

// Pulls the ProgId out of `reg query` output for the UserChoice key.
export function parseProgIdOutput(output: string): string | null {
  const match = output.match(/ProgId\s+REG_SZ\s+(\S+)/i)
  return match ? match[1] : null
}

function installedExecutable(browser: BrowserDefinition): string | null {
  return browser.candidates().find((candidate): candidate is string => !!candidate && existsSync(candidate)) ?? null
}

export function installedBrowsers(): BrowserInfo[] {
  return BROWSERS.filter((browser) => installedExecutable(browser)).map(({ id, name, scheme }) => ({
    id,
    name,
    scheme
  }))
}

let defaultBrowserPromise: Promise<BrowserInfo | null> | null = null

// The user's default browser, if it is one Snag supports; otherwise the first
// supported browser that is installed. Cached for the process lifetime.
export function defaultBrowser(): Promise<BrowserInfo | null> {
  if (defaultBrowserPromise) return defaultBrowserPromise
  defaultBrowserPromise = new Promise((resolve) => {
    const fallback = (): BrowserInfo | null => installedBrowsers()[0] ?? null
    if (process.platform !== 'win32') {
      resolve(fallback())
      return
    }
    execFile(
      'reg',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
        '/v',
        'ProgId'
      ],
      { windowsHide: true, timeout: 3000 },
      (error, stdout) => {
        const preferred = error ? null : browserForProgId(parseProgIdOutput(stdout))
        const definition = preferred && BROWSERS.find((browser) => browser.id === preferred.id)
        resolve(definition && installedExecutable(definition) ? preferred : fallback())
      }
    )
  })
  return defaultBrowserPromise
}

export interface OpenPageResult {
  browser: BrowserInfo | null
  error: string
}

// Open a browser-internal page such as chrome://extensions in the preferred
// browser, falling back to any installed one. `path` is the part after `://`.
export function openBrowserPage(preferred: BrowserInfo | null, path: string): OpenPageResult {
  if (process.platform !== 'win32') return { browser: null, error: `Open chrome://${path} in your browser.` }
  const ordered = [...BROWSERS].sort((a, b) => Number(b.id === preferred?.id) - Number(a.id === preferred?.id))
  for (const browser of ordered) {
    const executable = installedExecutable(browser)
    if (!executable) continue
    try {
      const child = spawn(executable, [`${browser.scheme}://${path}`], { detached: true, stdio: 'ignore' })
      child.unref()
      return { browser: { id: browser.id, name: browser.name, scheme: browser.scheme }, error: '' }
    } catch (err) {
      return { browser: null, error: (err as Error).message || `${browser.name} could not be opened.` }
    }
  }
  return {
    browser: null,
    error: 'No Chrome, Edge, or Brave installation was found. Open chrome://extensions manually.'
  }
}

export function openExternalUrlIn(preferred: BrowserInfo | null, url: string): OpenPageResult {
  const ordered = [...BROWSERS].sort((a, b) => Number(b.id === preferred?.id) - Number(a.id === preferred?.id))
  for (const browser of ordered) {
    const executable = installedExecutable(browser)
    if (!executable) continue
    try {
      const child = spawn(executable, [url], { detached: true, stdio: 'ignore' })
      child.unref()
      return { browser: { id: browser.id, name: browser.name, scheme: browser.scheme }, error: '' }
    } catch (err) {
      return { browser: null, error: (err as Error).message || `${browser.name} could not be opened.` }
    }
  }
  return { browser: null, error: 'No supported browser was found.' }
}

// Chrome's documented "external extension" mechanism: a per-user registry
// entry naming a Chrome Web Store ID makes Chrome download the extension on
// its next start and ask the user once whether to enable it. Only works for
// extensions published in the Web Store, so it stays dormant until then.
export function registerChromeExternalExtension(extensionId: string): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve('Automatic installation is only available on Windows.')
      return
    }
    execFile(
      'reg',
      [
        'add',
        `HKCU\\Software\\Google\\Chrome\\Extensions\\${extensionId}`,
        '/v',
        'update_url',
        '/t',
        'REG_SZ',
        '/d',
        'https://clients2.google.com/service/update2/crx',
        '/f'
      ],
      { windowsHide: true, timeout: 5000 },
      (error, _stdout, stderr) => resolve(error ? stderr.trim() || error.message : '')
    )
  })
}
