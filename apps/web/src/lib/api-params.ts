import { type NextRequest, NextResponse } from 'next/server'

/**
 * Phase 0 (truth): bounded query-parameter validation for the compute API.
 *
 * Before this module, bars/seed/variations were unclamped: `?bars=9999999`
 * built ten million bars of composition events and allocated accordingly —
 * a trivial single-request DoS that also stalls the Node event loop for
 * every other connection (renders are synchronous CPU work).
 */

/** Hard render ceiling: 88 bars ≈ 145s of audio ≈ ~25MB WAV. */
export const MAX_BARS = 88
export const MAX_VARIATIONS = 24
/** seeds are uint32-ish; keep 31 bits so all multiplies stay in float-safe range. */
export const MAX_SEED = 2147483647

export interface ValidatedParams {
  bars: number
  seed: number
}

function badRequest(errors: string[]): NextResponse {
  return NextResponse.json({ error: 'Invalid query parameters', details: errors }, { status: 400 })
}

/**
 * Parse + validate bars & seed. Returns either the values or a ready 400
 * response. `barsDefault` differs per route (render: 8, arrangement: 88).
 */
export function validateBarsSeed(
  req: NextRequest,
  barsDefault: number
): { ok: true; bars: number; seed: number } | { ok: false; response: NextResponse } {
  const errors: string[] = []
  const rawBars = req.nextUrl.searchParams.get('bars')
  const rawSeed = req.nextUrl.searchParams.get('seed')

  let bars = barsDefault
  if (rawBars !== null) {
    bars = Number.parseInt(rawBars, 10)
    if (!Number.isInteger(bars) || bars < 1 || bars > MAX_BARS) {
      errors.push(`bars must be an integer in [1, ${MAX_BARS}] (got "${rawBars}")`)
    }
  }

  let seed = 42
  if (rawSeed !== null) {
    seed = Number.parseInt(rawSeed, 10)
    if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
      errors.push(`seed must be an integer in [0, ${MAX_SEED}] (got "${rawSeed}")`)
    }
  }

  if (errors.length > 0) return { ok: false, response: badRequest(errors) }
  return { ok: true, bars, seed }
}

/** Validate variations for the arrangement route. */
export function validateVariations(
  req: NextRequest
): { ok: true; variations: number } | { ok: false; response: NextResponse } {
  const raw = req.nextUrl.searchParams.get('variations')
  if (raw === null) return { ok: true, variations: 1 }
  const v = Number.parseInt(raw, 10)
  if (!Number.isInteger(v) || v < 1 || v > MAX_VARIATIONS) {
    return {
      ok: false,
      response: badRequest([
        `variations must be an integer in [1, ${MAX_VARIATIONS}] (got "${raw}")`,
      ]),
    }
  }
  return { ok: true, variations: v }
}

/**
 * Render a section with an honest single-attempt contract. If sample loading
 * fails the request fails with the real error — no silent full-song re-render
 * (the old catch-retry doubled CPU cost and hid root causes).
 */
export async function renderOnce<T>(
  fn: () => Promise<T>
): Promise<{ ok: true; result: T } | { ok: false; error: Error }> {
  try {
    return { ok: true, result: await fn() }
  } catch (e) {
    return { ok: false, error: e as Error }
  }
}
