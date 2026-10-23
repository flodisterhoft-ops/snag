import { X509Certificate } from 'crypto'
import { app, session, type Certificate, type CertificatePrincipal, type Session } from 'electron'
import { getCACertificates, setDefaultCACertificates } from 'tls'

// Eight eMudhra intermediates under emSign ECC Root CA - G3 had their private
// keys compromised (GHSA-6q48-6c7w-9gw2). Electron 43's Node and Chromium
// still trust them, and no Electron release ships a fix yet.
const DISTRUSTED = /eMudhra|emSign/i

export function withoutDistrustedRoots(pems: readonly string[]): string[] {
  return pems.filter((pem) => !DISTRUSTED.test(new X509Certificate(pem).subject))
}

const names = (p: CertificatePrincipal | undefined): string[] => [
  p?.commonName ?? '',
  ...(p?.organizations ?? []),
  ...(p?.organizationUnits ?? [])
]

// Reads the names Chromium parsed, so no second parser can disagree with it.
// Only CA names count: the leaf's own subject is the site, which may be called
// anything.
export function chainHasDistrustedCertificate(certificate: Certificate | undefined): boolean {
  for (let cert = certificate, depth = 0; cert && depth < 10; cert = cert.issuerCert, depth++) {
    const caNames = depth === 0 ? names(cert.issuer) : [...names(cert.subject), ...names(cert.issuer)]
    if (caNames.some((name) => DISTRUSTED.test(name))) return true
  }
  return false
}

// -2 rejects the connection; -3 keeps Chromium's own verdict.
function guardSession(ses: Session): void {
  ses.setCertificateVerifyProc(({ certificate, validatedCertificate }, callback) => {
    try {
      const distrusted =
        chainHasDistrustedCertificate(certificate) || chainHasDistrustedCertificate(validatedCertificate)
      callback(distrusted ? -2 : -3)
    } catch (err) {
      console.error('[snag] Certificate check failed:', err)
      callback(-3)
    }
  })
}

// Node: its own fetch and https, which the GitHub release check uses. Only
// bundled and NODE_EXTRA_CA_CERTS roots: with NODE_USE_SYSTEM_CA set, the
// Windows store would let a Sectigo cross-signed chain to the same
// intermediates validate again.
// Chromium: every session, including the partition electron-updater checks
// for and downloads installers through.
export function distrustCompromisedRoots(): void {
  try {
    setDefaultCACertificates(
      withoutDistrustedRoots([...getCACertificates('bundled'), ...getCACertificates('extra')])
    )
  } catch (err) {
    console.error('[snag] Could not remove the eMudhra roots from Node TLS:', err)
  }
  app.on('session-created', guardSession)
  void app.whenReady().then(() => guardSession(session.defaultSession))
}
