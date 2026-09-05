/**
 * Render result cache + request coalescing (PLAN_V3 4.1).
 *
 * - LRU over COMPLETED renders keyed by the canonical params hash
 *   (route builds the key; this module only enforces bounded memory).
 *   Bounded BOTH by entry count and by total Float32 bytes — a bars=88
 *   stereo render is ~3.4 MB × 2 buses, so the byte cap is the honest bound.
 * - Request coalescing: concurrent identical requests share ONE in-flight
 *   promise. 20 concurrent renders at the same params cost 1 render.
 *
 * The cache stores the RAW render result (Float32Arrays), not the encoded
 * WAV — encoding format/stem selection happens per-request afterwards.
 */
export interface CachedRender {
  samplesL: Float32Array
  samplesR: Float32Array
  sampleRate: number
  durationSec: number
  bars: number
  events: number
  lufs: number
  truePeakDb: number
  samplePeakDb: number
  stereoWidth: number
  monoCompatibility: number
  gainReductionDb: number
  stems: null | Record<string, Float32Array>
}

export interface CacheOptions {
  maxEntries?: number
  /** Total Float32 sample bytes across cached results. Default 64 MiB. */
  maxTotalBytes?: number
}

export class RenderCache {
  readonly maxEntries: number
  readonly maxTotalBytes: number
  private map = new Map<string, CachedRender>()
  private bytes = 0
  hits = 0
  misses = 0
  coalesced = 0

  constructor(opts: CacheOptions = {}) {
    this.maxEntries = Math.max(1, opts.maxEntries ?? 8)
    this.maxTotalBytes = Math.max(1, opts.maxTotalBytes ?? 64 * 1024 * 1024)
  }

  private sizeOf(r: CachedRender): number {
    let floats = r.samplesL.length + r.samplesR.length
    if (r.stems) for (const a of Object.values(r.stems)) floats += a.length
    return floats * 4
  }

  get(key: string): CachedRender | null {
    const hit = this.map.get(key)
    if (!hit) {
      this.misses++
      return null
    }
    // LRU touch: delete+set moves the entry to Map insertion order's newest end.
    this.map.delete(key)
    this.map.set(key, hit)
    this.hits++
    return hit
  }

  set(key: string, value: CachedRender): void {
    // Replace-or-insert: drop any existing entry for this key first.
    const existing = this.map.get(key)
    if (existing) {
      this.bytes -= this.sizeOf(existing)
      this.map.delete(key)
    }
    const size = this.sizeOf(value)
    // A single entry bigger than the whole cache: refuse to cache (honest).
    if (size > this.maxTotalBytes) return
    this.map.set(key, value)
    this.bytes += size
    while (this.map.size > this.maxEntries || this.bytes > this.maxTotalBytes) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      const evicted = this.map.get(oldest)
      this.map.delete(oldest)
      if (evicted) this.bytes -= this.sizeOf(evicted)
    }
  }

  get size(): number {
    return this.map.size
  }

  get totalBytes(): number {
    return this.bytes
  }
}

/** In-flight request registry — concurrent identical keys share one promise. */
export class Coalescer<T> {
  private inflight = new Map<string, Promise<T>>()

  run(key: string, make: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) return existing
    const p = make().finally(() => {
      this.inflight.delete(key)
    })
    this.inflight.set(key, p)
    return p
  }

  get inflightCount(): number {
    return this.inflight.size
  }
}

const globalForCache = globalThis as unknown as {
  __psyRenderCache?: RenderCache
  __psyRenderCoalescer?: Coalescer<never>
}

export function getRenderCache(): RenderCache {
  if (!globalForCache.__psyRenderCache) {
    globalForCache.__psyRenderCache = new RenderCache()
  }
  return globalForCache.__psyRenderCache
}

export function getRenderCoalescer<T>(): Coalescer<T> {
  if (!globalForCache.__psyRenderCoalescer) {
    globalForCache.__psyRenderCoalescer = new Coalescer<never>()
  }
  return globalForCache.__psyRenderCoalescer as unknown as Coalescer<T>
}
