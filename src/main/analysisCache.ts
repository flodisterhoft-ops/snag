// Short-lived memo for media analyses. yt-dlp takes several seconds per URL,
// and the same link is analyzed repeatedly in normal use: the Chrome button
// prefetches on hover, the click opens the panel, the quick dialog may follow
// via snag://, and the user re-analyzes after changing a setting. Serving all
// of those from one result makes everything after the first feel instant.
//
// In-flight promises are shared so concurrent callers never start a second
// yt-dlp process, failures are dropped immediately so a retry is real, and
// live streams are never cached because their formats keep changing.

export interface AnalysisCacheOptions<T> {
  ttlMs?: number
  maxEntries?: number
  now?: () => number
  // Return false to keep a successful result out of the cache.
  cacheable?: (value: T) => boolean
}

interface Entry<T> {
  promise: Promise<T>
  at: number
}

export class AnalysisCache<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number
  private readonly cacheable: (value: T) => boolean

  constructor(options: AnalysisCacheOptions<T> = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000
    this.maxEntries = options.maxEntries ?? 50
    this.now = options.now ?? Date.now
    this.cacheable = options.cacheable ?? (() => true)
  }

  get(key: string, produce: () => Promise<T>): Promise<T> {
    const at = this.now()
    const hit = this.entries.get(key)
    if (hit && at - hit.at < this.ttlMs) return hit.promise

    const promise = produce()
    const entry: Entry<T> = { promise, at }
    this.entries.set(key, entry)
    promise.then(
      (value) => {
        if (!this.cacheable(value) && this.entries.get(key) === entry) this.entries.delete(key)
      },
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key)
      }
    )
    this.trim(at)
    return promise
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }

  private trim(at: number): void {
    for (const [key, entry] of this.entries) {
      if (at - entry.at >= this.ttlMs) this.entries.delete(key)
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}
