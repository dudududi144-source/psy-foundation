/**
 * Voice lifecycle — pooled voice allocation (the pattern from psy5).
 *
 * Voices are pre-allocated and run for the lifetime of the engine. `noteOn`
 * only re-targets AudioParams; no nodes are created or destroyed in the hot
 * path. This eliminates GC-induced audio dropouts.
 *
 * This module provides the abstract pool logic. A concrete voice (synth voice,
 * drum voice, etc.) implements the `Voice` interface.
 *
 * ## O(1) allocation
 *
 * Allocation never scans. A free-index Set hands out released indices, and a
 * doubly-linked "outstanding" FIFO tracks handed-out indices in allocation
 * order. When the pool is exhausted, the head of that FIFO — the OLDEST
 * still-outstanding allocation — is stolen: its `panic()` is called and the
 * index is re-handed out as the newest. Steals therefore rotate through the
 * outstanding voices round-robin, and every operation (allocate, release,
 * steal) is O(1) with O(n) total bookkeeping memory, allocated once in the
 * constructor.
 *
 * O(1) free-set allocation design backported from the psy-sampler
 * foundation-shim (family repo, read-only reference). Delta from that design:
 * the steal path here is an exact oldest-outstanding FIFO instead of a plain
 * round-robin cursor, and `release()` is O(1) via a voice→index map instead
 * of an `indexOf` scan.
 *
 * ## Ownership contract
 *
 * - `pool.release(v)` returns a voice's index to the free set (O(1),
 *   idempotent; voices from a different pool are ignored).
 * - A voice that deactivates itself (e.g. its `noteOff` was called directly)
 *   is NOT returned to the free set until released. If it is never released
 *   it remains "outstanding" and will eventually be reclaimed by a steal
 *   (panic + reuse) once the pool is exhausted.
 * - `allOff()`/`panic()` return every index to the free set and reset the
 *   steal order.
 */
// O(1) free-set allocation design backported from the psy-sampler foundation-shim (family repo, read-only reference).

export interface Voice {
  /** Whether this voice is currently sounding. */
  readonly active: boolean
  /** Trigger the voice with a note + velocity. */
  noteOn(note: number, velocity: number): void
  /** Release the voice (note off). */
  noteOff(): void
  /** Force-stop immediately (panic). */
  panic(): void
}

const NOT_IN_LIST = -1

/**
 * Voice pool — O(1) allocation of pre-created voices.
 *
 * Generic over the voice type. The caller provides a `voiceFactory` that
 * creates a fresh voice on initialization.
 */
export class VoicePool<V extends Voice> {
  private readonly voices: V[]
  private readonly maxVoices: number
  /** Indices currently free (handed back via release/allOff/panic). Insertion-ordered. */
  private readonly freeSet: Set<number>
  /** Outstanding FIFO over indices, intrusive doubly-linked list (O(1) unlink). Head = oldest. */
  private readonly outPrev: Int32Array
  private readonly outNext: Int32Array
  private readonly inList: Uint8Array
  private outHead = NOT_IN_LIST
  private outTail = NOT_IN_LIST
  private _activeCount = 0
  /** Voice → index map so release() is O(1) instead of an indexOf scan. */
  private readonly indexByVoice: Map<V, number>

  constructor(voiceFactory: () => V, voiceCount: number) {
    this.voices = Array.from({ length: voiceCount }, () => voiceFactory())
    this.maxVoices = voiceCount
    this.freeSet = new Set(Array.from({ length: voiceCount }, (_, i) => i))
    this.outPrev = new Int32Array(voiceCount).fill(NOT_IN_LIST)
    this.outNext = new Int32Array(voiceCount).fill(NOT_IN_LIST)
    this.inList = new Uint8Array(voiceCount)
    this.indexByVoice = new Map<V, number>()
    this.voices.forEach((v, i) => this.indexByVoice.set(v, i))
  }

  /**
   * Allocate a voice. O(1): pops the oldest free index, or — when every voice
   * is outstanding — steals the oldest outstanding voice (panic()s it first).
   * Throws on a zero-voice pool instead of silently returning undefined.
   */
  allocate(): V {
    const freeIdx = firstOf(this.freeSet)
    if (freeIdx !== undefined) {
      this.freeSet.delete(freeIdx)
      this.linkOutstanding(freeIdx)
      this._activeCount += 1
      // freeIdx comes from freeSet — always a valid voice index.
      return this.voices[freeIdx]!
    }
    if (this.maxVoices === 0) {
      throw new Error('VoicePool.allocate(): pool has zero voices (voiceCount = 0)')
    }
    const idx = this.outHead
    // Steal path only runs when NO voice is free → the outstanding list is
    // non-empty → outHead is a valid voice index.
    const stolen = this.voices[idx]!
    this.unlinkOutstanding(idx)
    this.linkOutstanding(idx) // re-handed out: becomes the newest outstanding
    stolen.panic()
    return stolen
  }

  /**
   * Return a voice's index to the free set. O(1) and idempotent; releasing a
   * voice that belongs to a different pool is an honest no-op.
   */
  release(voice: V): void {
    const idx = this.indexByVoice.get(voice)
    if (idx === undefined) return
    if (this.freeSet.has(idx)) return
    if (this.inList[idx] === 1) {
      this.unlinkOutstanding(idx)
      this._activeCount -= 1
    }
    this.freeSet.add(idx)
  }

  /** Trigger a note on an allocated voice. */
  noteOn(note: number, velocity: number): V {
    const v = this.allocate()
    v.noteOn(note, velocity)
    return v
  }

  /** Release all voices (note off on everything). */
  allOff(): void {
    for (const v of this.voices) v.noteOff()
    this.returnAll()
  }

  /** Panic — force-stop all voices. */
  panic(): void {
    for (const v of this.voices) v.panic()
    this.returnAll()
  }

  get size(): number {
    return this.maxVoices
  }

  /** O(1) — maintained incrementally instead of scanning. */
  get activeCount(): number {
    return this._activeCount
  }

  /** Get all voices (for per-voice processing). */
  get all(): readonly V[] {
    return this.voices
  }

  private linkOutstanding(idx: number): void {
    this.outPrev[idx] = this.outTail
    this.outNext[idx] = NOT_IN_LIST
    if (this.outTail !== NOT_IN_LIST) {
      this.outNext[this.outTail] = idx
    } else {
      this.outHead = idx
    }
    this.outTail = idx
    this.inList[idx] = 1
  }

  private unlinkOutstanding(idx: number): void {
    // Any index in the outstanding list was written by linkOutstanding first.
    const prev = this.outPrev[idx]!
    const next = this.outNext[idx]!
    if (prev !== NOT_IN_LIST) {
      this.outNext[prev] = next
    } else {
      this.outHead = next
    }
    if (next !== NOT_IN_LIST) {
      this.outPrev[next] = prev
    } else {
      this.outTail = prev
    }
    this.outPrev[idx] = NOT_IN_LIST
    this.outNext[idx] = NOT_IN_LIST
    this.inList[idx] = 0
  }

  private returnAll(): void {
    this.freeSet.clear()
    for (let i = 0; i < this.maxVoices; i++) {
      this.freeSet.add(i)
      this.inList[i] = 0
      this.outPrev[i] = NOT_IN_LIST
      this.outNext[i] = NOT_IN_LIST
    }
    this.outHead = NOT_IN_LIST
    this.outTail = NOT_IN_LIST
    this._activeCount = 0
  }
}

/** First element in Set insertion order (oldest released index first). O(1). */
function firstOf(set: Set<number>): number | undefined {
  return set.values().next().value
}
