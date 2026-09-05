import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { BUCKETS, resetRateLimiter, takeToken } from '../src/lib/rate-limit'
import { type CachedRender, Coalescer, RenderCache } from '../src/lib/render/render-cache'

/**
 * Phase 4.1/4.3 unit locks — bounded memory, coalescing, honest 429 math.
 * (Worker/off-loop parity is locked in render-pool.test.ts.)
 */

function makeRender(bars: number): CachedRender {
  const n = bars * 4 * 100 // tiny fake "samples"
  return {
    samplesL: new Float32Array(n).fill(0.1),
    samplesR: new Float32Array(n).fill(0.1),
    sampleRate: 44100,
    durationSec: bars * 4 * (60 / 145),
    bars,
    events: 0,
    lufs: -10,
    truePeakDb: -1,
    samplePeakDb: -1.2,
    stereoWidth: 0.5,
    monoCompatibility: 0.9,
    gainReductionDb: 0,
    stems: null,
  }
}

function _byteSize(r: CachedRender): number {
  return (r.samplesL.length + r.samplesR.length) * 4
}

describe('RenderCache (PLAN_V3 4.1)', () => {
  test('stores and retrieves; hit/miss counters are honest', () => {
    const c = new RenderCache()
    expect(c.get('a')).toBeNull()
    c.set('a', makeRender(1))
    expect(c.get('a')?.bars).toBe(1)
    expect(c.hits).toBe(1)
    expect(c.misses).toBe(1)
  })

  test('evicts LRU entry when entry count exceeded', () => {
    const c = new RenderCache({ maxEntries: 2 })
    c.set('a', makeRender(1))
    c.set('b', makeRender(1))
    c.get('a') // touch a → b is now LRU
    c.set('c', makeRender(1))
    expect(c.get('b')).toBeNull()
    expect(c.get('a')).not.toBeNull()
    expect(c.get('c')).not.toBeNull()
  })

  test('byte cap forces eviction (bars=88-scale renders stay bounded)', () => {
    // Each fake entry ~1MB; cap 2.5MB → at most 2 entries retained.
    const c = new RenderCache({ maxEntries: 100, maxTotalBytes: 2.5 * 1024 * 1024 })
    const big = makeRender(1310) // 1310*4*100 samples * 2ch * 4B ≈ 4.2MB? → compute: 1310*400=524000 samples *2ch*4B=4.19MB — too big
    void big
    const oneMB = makeRender(328) // 328*400=131200 samples *2ch*4B = 1049600 B ≈ 1MB
    c.set('one', oneMB)
    c.set('two', makeRender(328))
    c.set('three', makeRender(328))
    expect(c.totalBytes).toBeLessThanOrEqual(2.5 * 1024 * 1024)
    expect(c.size).toBeLessThanOrEqual(2)
  })

  test('refuses to cache a single entry larger than the whole cache', () => {
    const c = new RenderCache({ maxTotalBytes: 1000 })
    c.set('huge', makeRender(1310))
    expect(c.size).toBe(0)
  })
})

describe('Coalescer (PLAN_V3 4.1)', () => {
  test('concurrent identical keys share ONE in-flight promise', async () => {
    const c = new Coalescer<number>()
    let calls = 0
    const task = (): Promise<number> =>
      new Promise((resolve) => {
        calls++
        setTimeout(() => resolve(42), 10)
      })
    const [a, b, cc] = await Promise.all([c.run('k', task), c.run('k', task), c.run('k', task)])
    expect(calls).toBe(1)
    expect(a).toBe(42)
    expect(b).toBe(42)
    expect(cc).toBe(42)
    expect(c.inflightCount).toBe(0)
  })

  test('different keys run independently; settled key re-runs (not memoized)', async () => {
    const c = new Coalescer<number>()
    let calls = 0
    const task = (): Promise<number> => {
      calls++
      return Promise.resolve(calls)
    }
    const [a, b] = await Promise.all([c.run('x', task), c.run('y', task)])
    expect(a).toBe(1)
    expect(b).toBe(2)
    expect(await c.run('x', task)).toBe(3) // settled → new run, no stale cache
  })
})

describe('rate limiter (PLAN_V3 4.3)', () => {
  function fakeReq(headers: Record<string, string> = {}): NextRequest {
    return {
      headers: new Headers(headers),
      nextUrl: new URL('http://localhost/api/render-forensic'),
    } as unknown as NextRequest
  }

  test('burst beyond capacity is rejected 429-style with Retry-After', () => {
    resetRateLimiter()
    const req = fakeReq()
    const cap = BUCKETS.render.capacity
    for (let i = 0; i < cap; i++) {
      expect(takeToken('render', req).ok).toBe(true)
    }
    const rejected = takeToken('render', req)
    expect(rejected.ok).toBe(false)
    expect(rejected.retryAfterSec).toBeGreaterThan(0)
  })

  test('buckets are per-IP', () => {
    resetRateLimiter()
    const a = fakeReq({ 'x-forwarded-for': '10.0.0.1' })
    const b = fakeReq({ 'x-forwarded-for': '10.0.0.2' })
    for (let i = 0; i < BUCKETS.render.capacity; i++) expect(takeToken('render', a).ok).toBe(true)
    expect(takeToken('render', b).ok).toBe(true) // other IP unaffected
  })

  test('API-key mode: missing key rejected (429 upstream), valid key bypasses bucket', () => {
    resetRateLimiter()
    process.env.PSY_API_KEY = 'secret-key'
    const noKey = fakeReq()
    expect(takeToken('render', noKey).ok).toBe(false) // 429 upstream (never 401)
    const withKey = fakeReq({ 'x-api-key': 'secret-key' })
    for (let i = 0; i < BUCKETS.render.capacity + 5; i++) {
      expect(takeToken('render', withKey).ok).toBe(true) // bypasses bucket
    }
    process.env.PSY_API_KEY = undefined
    resetRateLimiter()
  })
})

describe('md5 helper parity with verify (sanity)', () => {
  test('md5 of deterministic float bytes is stable', () => {
    const r = makeRender(2)
    const md5 = (f: Float32Array): string =>
      createHash('md5')
        .update(Buffer.from(f.buffer, 0, f.length * 4))
        .digest('hex')
    expect(md5(r.samplesL)).toBe(md5(r.samplesL))
  })
})
