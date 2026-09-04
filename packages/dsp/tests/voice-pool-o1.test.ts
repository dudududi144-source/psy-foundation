import { describe, expect, test } from 'bun:test'
import { VoicePool } from '../src/index.ts'
import type { Voice } from '../src/index.ts'

/**
 * Behavior tests for the O(1) voice pool (phase 3.3b backport of the
 * psy-sampler free-set design). The API the older dsp.test.ts locks is kept:
 * allocate/noteOn/allOff/panic/size/activeCount/all. New here: release().
 */

class SpyVoice implements Voice {
  active = false
  panicCount = 0
  noteOnCount = 0
  noteOn(note: number, velocity: number): void {
    this.active = true
    this.noteOnCount += 1
    void note
    void velocity
  }
  noteOff(): void {
    this.active = false
  }
  panic(): void {
    this.panicCount += 1
    this.active = false
  }
}

function makePool(voiceCount: number): VoicePool<SpyVoice> {
  return new VoicePool(() => new SpyVoice(), voiceCount)
}

/** Seeded mulberry32 — determinism law: no Math.random in tests. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('VoicePool O(1) — allocation and stealing', () => {
  test('allocates voiceCount distinct voices; the next allocate steals the OLDEST and panics it', () => {
    const pool = makePool(4)
    const handed: SpyVoice[] = []
    for (let i = 0; i < 4; i++) handed.push(pool.allocate())
    expect(new Set(handed).size).toBe(4) // all distinct
    expect(pool.activeCount).toBe(4)

    const stolen = pool.allocate()
    expect(handed).toContain(stolen) // a reuse, not a new voice
    expect(stolen).toBe(pool.all[0]) // exact oldest outstanding allocation
    expect(stolen.panicCount).toBe(1) // the stolen voice was panic()ed
    expect(pool.activeCount).toBe(4) // steal does not change the outstanding count

    const stolenAgain = pool.allocate()
    expect(stolenAgain).toBe(pool.all[1]) // round-robin: next-oldest
    expect(stolenAgain.panicCount).toBe(1)
  })

  test('release returns the index to the free set and it is reused next (no panic)', () => {
    const pool = makePool(2)
    const _a = pool.noteOn(60, 0.9)
    const b = pool.noteOn(62, 0.9)
    expect(pool.activeCount).toBe(2)

    pool.release(b)
    expect(pool.activeCount).toBe(1)

    const c = pool.noteOn(64, 0.8)
    expect(c).toBe(b) // freed index reused first
    expect(b.panicCount).toBe(0) // reuse is clean — no panic on a released voice

    // Double release is an honest no-op (idempotent).
    pool.release(b)
    pool.release(b)
    expect(pool.activeCount).toBe(1)

    // A voice from a different pool is ignored.
    const stranger = makePool(1)
    const foreign = stranger.allocate()
    expect(() => pool.release(foreign)).not.toThrow()
    expect(pool.activeCount).toBe(1)
    expect(stranger.activeCount).toBe(1)
  })

  test('steal-then-release bookkeeping stays exact', () => {
    const pool = makePool(2)
    const a = pool.noteOn(60, 0.9)
    const b = pool.noteOn(62, 0.9)
    const stolen = pool.allocate() // steals a (oldest), re-hands it
    expect(stolen).toBe(a)
    expect(pool.activeCount).toBe(2)

    pool.release(b) // release the untouched voice
    expect(pool.activeCount).toBe(1)
    const next = pool.allocate()
    expect(next).toBe(b) // freed slot reused
    expect(next.panicCount).toBe(0)
  })

  test('allOff/panic return every index to the free set and reset steal order', () => {
    const pool = makePool(3)
    for (let i = 0; i < 3; i++) pool.noteOn(60 + i, 0.9)
    pool.allOff()
    expect(pool.activeCount).toBe(0)

    const v = pool.allocate()
    expect(v).toBe(pool.all[0]) // rotation restarts from index 0
    expect(v.panicCount).toBe(0)

    pool.panic()
    expect(pool.activeCount).toBe(0)
    expect(pool.all.every((voice) => !voice.active)).toBe(true)
  })
})

describe('VoicePool O(1) — property: no index handed out twice while bookkept free', () => {
  test('500 seeded ops (alloc/release/steal/allOff/panic) keep the shadow model exact', () => {
    const rng = mulberry32(0x600dc0de)
    const SIZE = 8
    const pool = makePool(SIZE)
    const indexOf = (v: SpyVoice) => pool.all.indexOf(v)

    // Shadow model: `free` mirrors the pool's free set; `outstanding` lists
    // handed-out indices in allocation order (oldest first).
    const free = new Set<number>(Array.from({ length: SIZE }, (_, i) => i))
    const outstanding: number[] = []
    let allocs = 0
    let steals = 0
    let releases = 0

    const resetShadow = () => {
      free.clear()
      for (let i = 0; i < SIZE; i++) free.add(i)
      outstanding.length = 0
    }

    for (let op = 0; op < 500; op++) {
      const roll = rng()
      if (roll < 0.55) {
        const v = pool.allocate()
        const idx = indexOf(v)
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(idx).toBeLessThan(SIZE)
        allocs += 1
        if (outstanding.length < SIZE) {
          // Must be a free-pop of an index the shadow knows is free.
          expect(free.has(idx)).toBe(true)
          free.delete(idx)
          outstanding.push(idx)
        } else {
          // Exhausted: steal. Free set must be empty and the target must be
          // exactly the oldest outstanding allocation.
          expect(free.size).toBe(0)
          expect(outstanding[0]).toBe(idx)
          steals += 1
          outstanding.shift()
          outstanding.push(idx)
        }
      } else if (roll < 0.85) {
        if (outstanding.length > 0) {
          const k = Math.floor(rng() * outstanding.length)
          const idx = outstanding[k]
          pool.release(pool.all[idx])
          outstanding.splice(k, 1)
          free.add(idx)
          releases += 1
        } else {
          // Release of a never-allocated (free) voice must be a harmless no-op.
          const idx = Math.floor(rng() * SIZE)
          expect(() => pool.release(pool.all[idx])).not.toThrow()
        }
      } else if (roll < 0.93) {
        pool.allOff()
        resetShadow()
      } else {
        pool.panic()
        resetShadow()
      }

      // Truth invariants after EVERY op:
      expect(pool.activeCount).toBe(outstanding.length)
      expect(free.size + outstanding.length).toBe(SIZE)
      expect(pool.all).toHaveLength(SIZE)
    }

    expect(allocs).toBeGreaterThan(150)
    expect(steals).toBeGreaterThan(5)
    expect(releases).toBeGreaterThan(80)
  })
})

describe('VoicePool O(1) — determinism and cost sanity', () => {
  test('identical op sequences on identical pools produce identical allocation sequences', () => {
    const run = (): number[] => {
      const pool = makePool(6)
      const rng = mulberry32(1234)
      const seq: number[] = []
      const outstanding: SpyVoice[] = []
      for (let op = 0; op < 1000; op++) {
        const roll = rng()
        if (roll < 0.6) {
          const v = pool.allocate()
          seq.push(pool.all.indexOf(v))
          outstanding.push(v)
        } else if (outstanding.length > 0) {
          const k = Math.floor(rng() * outstanding.length)
          pool.release(outstanding[k])
          outstanding.splice(k, 1)
        }
      }
      return seq
    }
    expect(run()).toEqual(run())
  })

  test('10k alloc/release cycles complete within a generous time bound (sanity, not a benchmark)', () => {
    const CYCLES = 10_000
    const pool = makePool(64)
    // Warm-up (JIT + allocator state).
    for (let i = 0; i < 2000; i++) {
      const v = pool.noteOn(60, 0.9)
      pool.release(v)
    }
    const t0 = performance.now()
    for (let i = 0; i < CYCLES; i++) {
      const v = pool.noteOn(60, 0.9)
      pool.release(v)
    }
    const elapsedMs = performance.now() - t0
    // Generous bound: ~200k ops/sec. This is a pathological-regression tripwire
    // (e.g. an accidental O(n) scan or unbounded growth), NOT a vanity number.
    // The O(1) property itself is proven by the deterministic behavior tests above.
    expect(elapsedMs).toBeLessThan(2000)
    expect(pool.activeCount).toBe(0)
  })
})
