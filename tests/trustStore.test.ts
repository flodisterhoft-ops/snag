import { X509Certificate } from 'crypto'
import { readFileSync } from 'fs'
import type { Certificate } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCACertificates: vi.fn(),
  setDefaultCACertificates: vi.fn(),
  appOn: vi.fn(),
  defaultSession: { setCertificateVerifyProc: vi.fn() }
}))

vi.mock('tls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('tls')>()),
  getCACertificates: mocks.getCACertificates,
  setDefaultCACertificates: mocks.setDefaultCACertificates
}))
vi.mock('electron', () => ({
  app: { on: mocks.appOn, whenReady: () => Promise.resolve() },
  session: { defaultSession: mocks.defaultSession }
}))

import { chainHasDistrustedCertificate, distrustCompromisedRoots, withoutDistrustedRoots } from '../src/main/trustStore'

// The root whose eMudhra intermediates were compromised, as Electron 43.1.0's
// Node bundles it.
const EMSIGN_ECC_G3 = `-----BEGIN CERTIFICATE-----
MIICTjCCAdOgAwIBAgIKPPYHqWhwDtqLhDAKBggqhkjOPQQDAzBrMQswCQYDVQQGEwJJTjET
MBEGA1UECxMKZW1TaWduIFBLSTElMCMGA1UEChMcZU11ZGhyYSBUZWNobm9sb2dpZXMgTGlt
aXRlZDEgMB4GA1UEAxMXZW1TaWduIEVDQyBSb290IENBIC0gRzMwHhcNMTgwMjE4MTgzMDAw
WhcNNDMwMjE4MTgzMDAwWjBrMQswCQYDVQQGEwJJTjETMBEGA1UECxMKZW1TaWduIFBLSTEl
MCMGA1UEChMcZU11ZGhyYSBUZWNobm9sb2dpZXMgTGltaXRlZDEgMB4GA1UEAxMXZW1TaWdu
IEVDQyBSb290IENBIC0gRzMwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAQjpQy4LRL1KPOxst3i
AhKAnjlfSU2fySU0WXTsuwYc58Byr+iuL+FBVIcUqEqy6HyC5ltqtdyzdc6LBtCGI79G1Y4P
PwT01xySfvalY8L1X44uT6EYGQIrMgqCZH0Wk9GjQjBAMB0GA1UdDgQWBBR8XQKEE9TMipuB
zhccLikenEhjQjAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQD
AwNpADBmAjEAvvNhzwIQHWSVB7gYboiFBS+DCBeQyh+KTOgNG3qxrdWBCUfvO6wIBHxcmbHt
RwfSAjEAnbpV/KlK6O3t5nYBQnvI+GDZjVGLVTv7jHvrZQnD+JbNR6iC8hZVdyR+EhCVBCyj
-----END CERTIFICATE-----`

async function bundledRoot(commonName: string): Promise<string> {
  const { getCACertificates } = await vi.importActual<typeof import('tls')>('tls')
  const pem = getCACertificates('bundled').find((p) => new X509Certificate(p).subject.endsWith(`CN=${commonName}`))
  if (!pem) throw new Error(`${commonName} is not in this Node's bundled roots`)
  return pem
}

const subjectOf = (pem: string): string => new X509Certificate(pem).subject

// Chains as Chromium hands them to the verify proc: leaf first, then issuerCert.
type Name = [commonName: string, organization: string]
function chain(...names: Name[]): Certificate {
  let issuerCert: Certificate | undefined
  for (let i = names.length - 1; i >= 0; i--) {
    const [cn, o] = names[i]
    const [issuerCn, issuerO] = names[i + 1] ?? names[i]
    const principal = (commonName: string, organization: string) => ({
      commonName,
      organizations: organization ? [organization] : [],
      organizationUnits: [],
      locality: '',
      state: '',
      country: ''
    })
    issuerCert = { subject: principal(cn, o), issuer: principal(issuerCn, issuerO), issuerCert } as unknown as Certificate
  }
  return issuerCert as Certificate
}

// The two forged test hosts' real chains. The intermediate's common name never
// says eMudhra or emSign; only its organization does.
const EMUDHRA_DIRECT = chain(
  ['dv-g3b-emudhra.we-have-a-problem.com', ''],
  ['EM DV TLS CA - G3B', 'eMudhra BV'],
  ['emSign Root TLS CA - G3', 'eMudhra Technologies Limited'],
  ['emSign ECC Root CA - G3', 'eMudhra Technologies Limited']
)
const EMUDHRA_VIA_AAA = chain(
  ['dv-g3b-aaa-emudhra.we-have-a-problem.com', ''],
  ['EM DV TLS CA - G3B', 'eMudhra BV'],
  ['AAA Certificate Services', 'Comodo CA Limited']
)
const GITHUB = chain(
  ['api.github.com', ''],
  ['Sectigo ECC Domain Validation Secure Server CA', 'Sectigo Limited'],
  ['USERTrust ECC Certification Authority', 'The USERTRUST Network']
)
// A site may be named after eMudhra; only the CAs above it matter.
const EMUDHRA_SITE_ON_DIGICERT = chain(
  ['www.emudhra.com', 'eMudhra Technologies Limited'],
  ['DigiCert Global G2 TLS RSA SHA256 2020 CA1', 'DigiCert Inc'],
  ['DigiCert Global Root G2', 'DigiCert Inc']
)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCACertificates.mockReturnValue([])
})

describe('Node trust store', () => {
  it('drops every eMudhra and emSign root and keeps the others', async () => {
    const { getCACertificates } = await vi.importActual<typeof import('tls')>('tls')
    const kept = withoutDistrustedRoots([...getCACertificates('bundled'), EMSIGN_ECC_G3])
    expect(kept).not.toContain(EMSIGN_ECC_G3)
    expect(kept.map(subjectOf).filter((s) => /eMudhra|emSign/i.test(s))).toEqual([])
    expect(kept).toContain(await bundledRoot('ISRG Root X1'))
  })

  it('trusts the bundled and NODE_EXTRA_CA_CERTS roots minus emSign, never the Windows store', async () => {
    const isrg = await bundledRoot('ISRG Root X1')
    const corporate = await bundledRoot('DigiCert Global Root G2')
    mocks.getCACertificates.mockImplementation((type: string) =>
      type === 'bundled' ? [isrg, EMSIGN_ECC_G3] : type === 'extra' ? [corporate, EMSIGN_ECC_G3] : ['unexpected']
    )
    distrustCompromisedRoots()
    expect(mocks.setDefaultCACertificates).toHaveBeenCalledWith([isrg, corporate])
    expect(mocks.getCACertificates.mock.calls.map(([type]) => type).sort()).toEqual(['bundled', 'extra'])
  })

  it('keeps Snag starting when Node rejects the list', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.setDefaultCACertificates.mockImplementation(() => {
      throw new Error('unsupported')
    })
    expect(() => distrustCompromisedRoots()).not.toThrow()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('runs before anything else in the main process', () => {
    const index = readFileSync('src/main/index.ts', 'utf8')
    const call = index.search(/^distrustCompromisedRoots\(\)\r?$/m)
    expect(call).toBeGreaterThan(index.lastIndexOf('\nimport '))
    expect(call).toBeLessThan(index.indexOf('app.setAppUserModelId('))
  })
})

describe('Chromium certificate guard', () => {
  it('flags chains through an eMudhra CA, including the Sectigo cross-signed one', () => {
    expect(chainHasDistrustedCertificate(EMUDHRA_DIRECT)).toBe(true)
    expect(chainHasDistrustedCertificate(EMUDHRA_VIA_AAA)).toBe(true)
    expect(chainHasDistrustedCertificate(GITHUB)).toBe(false)
    expect(chainHasDistrustedCertificate(EMUDHRA_SITE_ON_DIGICERT)).toBe(false)
    expect(chainHasDistrustedCertificate(undefined)).toBe(false)
  })

  it('guards the default session and every session created later, such as electron-updater’s', async () => {
    distrustCompromisedRoots()
    expect(mocks.appOn).toHaveBeenCalledWith('session-created', expect.any(Function))
    const guard = mocks.appOn.mock.calls[0][1] as (ses: unknown) => void
    const updaterSession = { setCertificateVerifyProc: vi.fn() }
    guard(updaterSession)
    await new Promise((resolve) => setImmediate(resolve))
    expect(mocks.defaultSession.setCertificateVerifyProc).toHaveBeenCalledTimes(1)

    const verify = updaterSession.setCertificateVerifyProc.mock.calls[0][0]
    const verdict = (certificate: Certificate, validatedCertificate: Certificate): number => {
      const callback = vi.fn()
      verify({ hostname: 'example.test', certificate, validatedCertificate }, callback)
      return callback.mock.calls[0][0]
    }
    expect(verdict(EMUDHRA_VIA_AAA, EMUDHRA_VIA_AAA)).toBe(-2)
    expect(verdict(GITHUB, EMUDHRA_DIRECT)).toBe(-2)
    expect(verdict(GITHUB, GITHUB)).toBe(-3)
  })
})
