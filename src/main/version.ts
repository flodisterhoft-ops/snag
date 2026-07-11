// Dotted-numeric version comparison that handles both app versions ("1.2.0",
// "v1.2.0") and yt-dlp date versions ("2026.07.04"). Returns 1 / 0 / -1.
// Kept free of Electron imports so it stays unit-testable.
export function compareVersions(a: string, b: string): number {
  const parse = (s: string): number[] =>
    s
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((p) => Number.parseInt(p, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}
