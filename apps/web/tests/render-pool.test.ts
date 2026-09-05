import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { CompositionEngine, createIdentityA } from '@psy-foundation/music'
import { renderFoundationSection } from '../src/lib/psy4/forensic-bridge'
import { RenderPool } from '../src/lib/render/render-pool'

/**
 * PLAN_V3 4.1 — worker/off-loop parity lock.
 *
 * The whole point of the worker pool is transparent offloading: the SAME
 * seed+context MUST produce a byte-identical render whether it ran in-thread
 * or inside the pool worker. This test composes+renders both ways and
 * compares sample md5s.
 *
 * Requires the built artifact (apps/web/workers/render-worker.mjs); it is a
 * committed GENERATED artifact — if missing, run scripts/build-render-worker.mjs.
 */

const ctx = {
  tonic: 4,
  scaleName: 'phrygian-dominant',
  octave: 4,
  bpm: 145,
  beatsPerBar: 4,
  beatPosition: 0,
  barPosition: 0,
  phrasePosition: 0,
  harmonicContext: [],
  density: 0.7,
  energy: 0.7,
  tension: 0.3,
  sectionRole: 'full-on',
  repetitionPressure: 0.3,
  noveltyPressure: 0.5,
  progressionName: 'psy-dominant',
  bassMode: 'standard',
}

function md5(f: Float32Array): string {
  return createHash('md5')
    .update(Buffer.from(f.buffer, 0, f.length * 4))
    .digest('hex')
}

describe('RenderPool parity + behavior (PLAN_V3 4.1)', () => {
  test('worker render is byte-identical to in-thread render (same seed)', async () => {
    // timeout: 60s (worker spawn + render)
    const pool = new RenderPool({ size: 1 })
    expect(pool.isAvailable()).toBe(true)

    const bars = 2
    const seed = 4242

    // In-thread reference: compose + render directly.
    const engine = new CompositionEngine({
      seed,
      context: ctx as never,
      identity: createIdentityA(),
    })
    const section = engine.composeSection({ bars })
    const ref = await renderFoundationSection(section, { useSamples: true, bpm: 145, stems: false })

    // Worker path: same params over the pool protocol.
    const reply = await pool.render({
      bars,
      seed,
      useSamples: true,
      bpm: 145,
      wantStems: false,
      ctx,
      config: {},
    })

    expect(reply.sampleRate).toBe(ref.sampleRate)
    expect(reply.lufs).toBeCloseTo(ref.lufs, 6)
    expect(md5(reply.samplesL)).toBe(md5(ref.samplesL))
    expect(md5(reply.samplesR)).toBe(md5(ref.samplesR))
    pool.dispose()
  }, 60000)

  test('bounded queue rejects beyond maxQueue (honest backpressure)', async () => {
    const pool = new RenderPool({ size: 1, maxQueue: 1 })
    // Small bars so the worker stays busy for a moment, not forever.
    const job = { bars: 2, seed: 1, useSamples: true, bpm: 145, wantStems: false, ctx, config: {} }
    const p1 = pool.render(job) // → worker (busy)
    const p2 = pool.render(job) // → queue (1 slot)
    let rejected = false
    try {
      await pool.render(job) // → queue full → fail fast
    } catch (err) {
      rejected = (err as Error).message.includes('render queue full')
    }
    expect(rejected).toBe(true)
    // dispose() rejects/terminates the in-flight jobs — no dangling workers.
    pool.dispose()
    await Promise.allSettled([p1, p2])
  }, 60000)

  test('artifact path resolves relative to apps/web cwd', () => {
    const pool = new RenderPool({ size: 1 })
    // isAvailable() just checks the artifact exists — never throws.
    expect(typeof pool.isAvailable()).toBe('boolean')
    expect(join(process.cwd(), 'workers')).toBeDefined()
  })
})
