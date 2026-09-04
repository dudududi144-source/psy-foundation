import type { MusicalEvent, TransportState } from '@psy-foundation/protocol'

/**
 * Local scheduling helper (GAP-D1, PLAN_V3 3.5) — the device-side half of
 * `PsyDevice.onScheduledEvent`.
 *
 * A device queues (event, atBeat) pairs here, then feeds every transport
 * snapshot it receives into `tick(snapshot)`. The scheduler:
 *
 * - RELEASES events whose `atBeat` has arrived (atBeat <= snapshot.beat),
 *   oldest first, and passes them to the device's `onScheduledEvent`
 *   together with the snapshot they fired under;
 * - STALES events that arrived too late to be musical (atBeat < snapshot.beat
 *   - graceBeats): dropped, counted, never fired — a late kick is worse than
 *   a missing kick;
 * - stays O(1) amortized per snapshot: the queue is kept sorted by atBeat at
 *   insertion (events are typically scheduled in ascending order), and
 *   release/stale only consume from the front.
 *
 * Beat math is pure — no clocks of its own (a device must not manage time;
 * see the "device does not manage its own clock" contract test).
 */
export interface LocalSchedulerOptions {
  /** How many beats a queued event may be late before it is staled. Default 0.25 (one 16th at 4/4). */
  graceBeats?: number
}

export interface LocalSchedulerStats {
  readonly pending: number
  readonly released: number
  readonly staled: number
}

interface Queued {
  atBeat: number
  event: MusicalEvent
  seq: number
}

export class LocalScheduler {
  private readonly graceBeats: number
  private queue: Queued[] = []
  private seq = 0
  private releasedCount = 0
  private staledCount = 0

  constructor(opts: LocalSchedulerOptions = {}) {
    this.graceBeats = Math.max(0, opts.graceBeats ?? 0.25)
  }

  /**
   * Queue an event to fire at an absolute transport beat. Stable for equal
   * beats (insertion order wins).
   */
  schedule(event: MusicalEvent, atBeat: number): void {
    if (!Number.isFinite(atBeat))
      throw new RangeError(`LocalScheduler.schedule: atBeat must be finite (got ${atBeat})`)
    const item: Queued = { atBeat, event, seq: this.seq++ }
    // Ascending by atBeat; stable by seq for ties. Linear scan from the tail —
    // scheduling is near-ordered in practice, so this is O(1) amortized.
    let i = this.queue.length
    while (i > 0 && (this.queue[i - 1] as Queued).atBeat > atBeat) i--
    this.queue.splice(i, 0, item)
  }

  /**
   * Feed a transport snapshot: stales overdue events, then releases every
   * event whose beat has arrived (atBeat <= snapshot.beat), in order, through
   * `emit`. Returns the number of events released by this call.
   */
  tick(
    snapshot: TransportState,
    emit: (event: MusicalEvent, transport: TransportState) => void
  ): number {
    // Stale first: too late to be musical.
    const staleBefore = snapshot.beat - this.graceBeats
    while (this.queue.length > 0 && (this.queue[0] as Queued).atBeat < staleBefore) {
      this.queue.shift()
      this.staledCount++
    }
    // Release everything that has arrived.
    let released = 0
    while (this.queue.length > 0 && (this.queue[0] as Queued).atBeat <= snapshot.beat) {
      const item = this.queue.shift() as Queued
      emit(item.event, snapshot)
      this.releasedCount++
      released++
    }
    return released
  }

  /** Drop everything queued (e.g. device onStop) — staled, not released. */
  clear(): void {
    this.staledCount += this.queue.length
    this.queue = []
  }

  get pendingCount(): number {
    return this.queue.length
  }

  stats(): LocalSchedulerStats {
    return { pending: this.queue.length, released: this.releasedCount, staled: this.staledCount }
  }
}
