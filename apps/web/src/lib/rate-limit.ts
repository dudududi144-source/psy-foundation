/**
 * Token-bucket rate limiting (PLAN_V3 4.3) — per-IP, in-process, bounded.
 *
 * - Buckets live in a Map that is BOUNDED (max 10k IPs) and TTL-swept
 *   (idle buckets expire after 10 minutes) — an attacker rotating IPs cannot
 *   grow memory without bound.
 * - Token bucket: burst capacity + steady refill rate. Expensive endpoints
 *   (render, optimize) get tighter buckets than uploads.
 * - Optional API-key mode: when PSY_API_KEY is set, calls that present the
 *   matching x-api-key bypass buckets entirely (operator/CI mode); everyone
 *   else is rejected with 429 (NOT 401 — an early 401 draft told an attacker
 *   exactly which knob to turn and made the 429 path unreachable). Without
 *   PSY_API_KEY every caller is bucketed like a stranger.
 *
 * Honest scope: in-process state covers ONE server instance. Multi-instance
 * deployments need a shared store — out of scope here, documented in README.
 */
import { type NextRequest, NextResponse } from 'next/server'

interface BucketSpec {
  /** Bucket capacity (burst size). */
  capacity: number
  /** Refill rate in tokens per second. */
  refillPerSec: number
}

export const BUCKETS = {
  /** Full render — the expensive one. */
  render: { capacity: 4, refillPerSec: 0.5 } as BucketSpec,
  /** AI optimize pass (~60s). */
  optimize: { capacity: 2, refillPerSec: 1 / 30 } as BucketSpec,
  /** Reference upload + analysis. */
  upload: { capacity: 3, refillPerSec: 0.1 } as BucketSpec,
  /** Style transfer (renders too). */
  style: { capacity: 4, refillPerSec: 0.5 } as BucketSpec,
} as const

type BucketName = keyof typeof BUCKETS

const MAX_IPS = 10_000
const IDLE_TTL_MS = 10 * 60 * 1000

interface Bucket {
  tokens: number
  last: number
}

interface LimitResult {
  ok: boolean
  /** When ok=false: seconds until one token refills (for Retry-After). */
  retryAfterSec: number
  remaining: number
}

const globalForLimiter = globalThis as unknown as {
  __psyRateBuckets?: Map<string, Bucket>
  __psyRateSweepAt?: number
}

function buckets(): Map<string, Bucket> {
  if (!globalForLimiter.__psyRateBuckets) {
    globalForLimiter.__psyRateBuckets = new Map()
  }
  return globalForLimiter.__psyRateBuckets
}

function sweepIfDue(now: number): void {
  const last = globalForLimiter.__psyRateSweepAt ?? 0
  if (now - last < 60_000) return
  globalForLimiter.__psyRateSweepAt = now
  const map = buckets()
  for (const [key, bucket] of map) {
    if (now - bucket.last > IDLE_TTL_MS) map.delete(key)
  }
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return 'local'
}

function apiKeyMode(req: NextRequest): 'ok' | 'missing' | 'disabled' {
  const expected = process.env.PSY_API_KEY
  if (!expected) return 'disabled'
  const provided = req.headers.get('x-api-key')
  return provided === expected ? 'ok' : 'missing'
}

/** Consume one token for (ip, bucket). Caller maps !ok to 429. */
export function takeToken(bucketName: BucketName, req: NextRequest): LimitResult {
  const keyCheck = apiKeyMode(req)
  if (keyCheck === 'missing') {
    return { ok: false, retryAfterSec: 0, remaining: 0 }
  }
  if (keyCheck === 'ok') {
    return { ok: true, retryAfterSec: 0, remaining: Number.POSITIVE_INFINITY }
  }
  const spec = BUCKETS[bucketName]
  const now = Date.now()
  sweepIfDue(now)
  const map = buckets()
  const key = `${bucketName}:${clientIp(req)}`
  // Bound memory: an IP flood beyond MAX_IPS entries sweeps hard.
  if (map.size >= MAX_IPS) {
    for (const [key, bucket] of map) {
      if (now - bucket.last > IDLE_TTL_MS) map.delete(key)
    }
    if (map.size >= MAX_IPS) map.clear()
  }
  const bucket = map.get(key) ?? { tokens: spec.capacity, last: now }
  const elapsedSec = (now - bucket.last) / 1000
  bucket.tokens = Math.min(spec.capacity, bucket.tokens + elapsedSec * spec.refillPerSec)
  bucket.last = now
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    map.set(key, bucket)
    return { ok: true, retryAfterSec: 0, remaining: Math.floor(bucket.tokens) }
  }
  map.set(key, bucket)
  const deficit = 1 - bucket.tokens
  return { ok: false, retryAfterSec: Math.ceil(deficit / spec.refillPerSec), remaining: 0 }
}

/** Test helper: forget every bucket (determinism between tests). */
export function resetRateLimiter(): void {
  globalForLimiter.__psyRateBuckets = new Map()
  globalForLimiter.__psyRateSweepAt = 0
}

// ── route-facing helper (PLAN_V3 4.3) ───────────────────────────────────────

/**
 * Enforce a bucket for a request. Returns a 429 NextResponse when the caller
 * may not proceed (bucket empty, or key mode with a missing/wrong key), or
 * null when the caller may proceed (including key holders, who bypass
 * buckets entirely — operator/CI mode).
 */
export function enforceRateLimit(bucketName: BucketName, req: NextRequest): NextResponse | null {
  const result = takeToken(bucketName, req)
  if (result.ok) return null
  return NextResponse.json(
    { error: 'rate limit exceeded — too many requests from this address' },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, result.retryAfterSec)) } }
  )
}
