import { X509Certificate } from 'crypto'
import { readFileSync } from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCACertificates: vi.fn(),
  setDefaultCACertificates: vi.fn()
}))

vi.mock('tls', async (importOriginal) => ({ ...(await importOriginal<typeof import('tls')>()), ...mocks }))

import { distrustCompromisedRoots, withoutDistrustedRoots } from '../src/main/trustStore'

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

beforeEach(() => {
  mocks.getCACertificates.mockReset()
  mocks.setDefaultCACertificates.mockReset()
})

describe('trust store', () => {
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
    mocks.getCACertificates.mockReturnValue([])
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
    expect(call).toBeGreaterThan(index.lastIndexOf("\nimport "))
    expect(call).toBeLessThan(index.indexOf('app.setAppUserModelId('))
  })
})
