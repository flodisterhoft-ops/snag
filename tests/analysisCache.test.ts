import { describe, expect, it, vi } from 'vitest'
import { AnalysisCache } from '../src/main/analysisCache'

interface Info {
  title: string
  isLive: boolean
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('AnalysisCache', () => {
  it('shares one in-flight analysis between concurrent callers', async () => {
    const cache = new AnalysisCache<Info>()
    const pending = deferred<Info>()
    const produce = vi.fn(() => pending.promise)

    const a = cache.get('u', produce)
    const b = cache.get('u', produce)
    expect(produce).toHaveBeenCalledTimes(1)
    pending.resolve({ title: 'x', isLive: false })
    expect(await a).toEqual({ title: 'x', isLive: false })
    expect(await b).toBe(await a)
    expect(await cache.get('u', produce)).toEqual({ title: 'x', isLive: false })
    expect(produce).toHaveBeenCalledTimes(1)
  })

  it('expires entries after the TTL and drops the oldest beyond the size limit', async () => {
    let clock = 0
    const cache = new AnalysisCache<Info>({ ttlMs: 1000, maxEntries: 2, now: () => clock })
    const produce = (title: string) => vi.fn(async () => ({ title, isLive: false }))

    const first = produce('1')
    await cache.get('a', first)
    clock = 500
    await cache.get('a', first)
    expect(first).toHaveBeenCalledTimes(1)

    clock = 1500
    await cache.get('a', first)
    expect(first).toHaveBeenCalledTimes(2)

    await cache.get('b', produce('2'))
    await cache.get('c', produce('3'))
    expect(cache.size).toBe(2)
    const again = produce('1 again')
    await cache.get('a', again)
    expect(again).toHaveBeenCalledTimes(1)
  })

  it('forgets failures immediately so a retry really retries', async () => {
    const cache = new AnalysisCache<Info>()
    const failing = vi.fn(async () => {
      throw new Error('offline')
    })
    await expect(cache.get('u', failing)).rejects.toThrow('offline')
    await Promise.resolve()
    expect(cache.size).toBe(0)
    const ok = vi.fn(async () => ({ title: 'x', isLive: false }))
    await expect(cache.get('u', ok)).resolves.toEqual({ title: 'x', isLive: false })
  })

  it('never keeps results the caller marks uncacheable, such as live streams', async () => {
    const cache = new AnalysisCache<Info>({ cacheable: (info) => !info.isLive })
    const live = vi.fn(async () => ({ title: 'live', isLive: true }))
    await cache.get('u', live)
    await Promise.resolve()
    await cache.get('u', live)
    expect(live).toHaveBeenCalledTimes(2)
  })
})
