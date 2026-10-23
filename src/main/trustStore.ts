import { X509Certificate } from 'crypto'
import { getCACertificates, setDefaultCACertificates } from 'tls'

// Eight eMudhra intermediates under emSign ECC Root CA - G3 had their private
// keys compromised (GHSA-6q48-6c7w-9gw2). Electron 43's Node still trusts all
// four emSign roots, and no Electron release ships a fixed Node yet.
const DISTRUSTED = /eMudhra|emSign/i

export function withoutDistrustedRoots(pems: readonly string[]): string[] {
  return pems.filter((pem) => !DISTRUSTED.test(new X509Certificate(pem).subject))
}

// Covers Node's own fetch and https, which the GitHub release check uses.
// Only bundled and NODE_EXTRA_CA_CERTS roots: with NODE_USE_SYSTEM_CA set, the
// Windows store would let a Sectigo cross-signed chain to the same
// intermediates validate again.
export function distrustCompromisedRoots(): void {
  try {
    setDefaultCACertificates(
      withoutDistrustedRoots([...getCACertificates('bundled'), ...getCACertificates('extra')])
    )
  } catch (err) {
    console.error('[snag] Could not remove the eMudhra roots from Node TLS:', err)
  }
}
