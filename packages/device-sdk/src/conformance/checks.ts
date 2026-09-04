/**
 * Device conformance checks (phase 3.4) — behavioral probes against FRESH
 * device instances. Framework-agnostic: no test-runner imports, no globals.
 *
 * Every check receives a CheckContext and returns a ConformanceCheckResult.
 * Each probe uses its own device instance from the factory so devices cannot
 * pass by carrying state between checks.
 */

import type { BeatEvent, MusicalEvent, NoteEvent } from '@psy-foundation/protocol'
import type { MusicalTransport } from '@psy-foundation/transport'
import type { PsyDevice } from '../device.ts'

export interface ConformanceCheckResult {
  /** Stable check id, e.g. 'C1'. */
  readonly id: string
  /** Human-readable check name. */
  readonly name: string
  readonly pass: boolean
  /** What was probed and what happened — always non-empty. */
  readonly detail: string
}

export interface CheckContext {
  /** Fresh device factory. Each check builds its own instance. */
  readonly makeDevice: () => PsyDevice
  /** Wall-clock budget (ms) for the C6 malformed-event probes. */
  readonly timeoutMs: number
  /** Accept identical ids from the factory (documented stateless-clone factories). */
  readonly statelessClones: boolean
}

export type CheckFn = (ctx: CheckContext) => ConformanceCheckResult

export interface CheckSpec {
  readonly id: string
  readonly name: string
  readonly fn: CheckFn
}

function result(id: string, name: string, pass: boolean, detail: string): ConformanceCheckResult {
  return { id, name, pass, detail }
}

/** A thrown value that is not an Error instance (a "crash", per C6 semantics). */
function isRealError(err: unknown): err is Error {
  return err instanceof Error
}

function describe(err: unknown): string {
  try {
    return isRealError(err) ? `${err.name}: ${err.message}` : String(err)
  } catch {
    return 'unstringifiable thrown value'
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  )
}

/** Recording proxy: logs the externally-invoked method names, forwards to the device. */
function recordedProxy(device: PsyDevice): { proxy: PsyDevice; calls: string[] } {
  const calls: string[] = []
  const proxy = new Proxy(device, {
    get(target, prop) {
      const value = Reflect.get(target, prop)
      if (typeof value !== 'function') return value
      const name = String(prop)
      return (...args: unknown[]) => {
        calls.push(name)
        return (value as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  })
  return { proxy: proxy as PsyDevice, calls }
}

/** Well-formed events built from @psy-foundation/protocol shapes (C4/C5 probes). */
export function wellFormedNoteEvent(): NoteEvent {
  return { type: 'note', note: 60, velocity: 0.8, duration: 0.25, channel: 'conformance', at: 0 }
}

export function wellFormedBeatEvent(): BeatEvent {
  const transport: MusicalTransport = {
    bpm: 150,
    beat: 4,
    bar: 1,
    beatsPerBar: 4,
    beatTime: 1.6,
    barTime: 0,
    phase: 0,
    barPhase: 0,
    confidence: 0.9,
    locked: true,
    revision: 1,
    origin: { audioTime: 0, beatIndex: 0, bpm: 150 },
    lastObservationAgo: 0,
    observationCount: 5,
  }
  return { type: 'beat', beat: 4, bar: 1, transport, at: 1.6 }
}

/** Malformed events for C6: unknown type + well-typed garbage values. */
function malformedEvents(): Array<{ label: string; event: MusicalEvent }> {
  const unknownType = { type: 'definitely-not-a-real-event-type', at: 0 } as unknown as MusicalEvent
  const garbageValues = {
    type: 'note',
    note: Number.NaN,
    velocity: 42,
    duration: -1,
    channel: '',
    at: Number.NaN,
  } as unknown as MusicalEvent
  return [
    { label: 'unknown-type', event: unknownType },
    { label: 'garbage-values', event: garbageValues },
  ]
}

/**
 * C6 outcome semantics (precise, documented in conformance/README.md):
 * - PASS 'returned'  : the call completed within the wall-clock budget.
 * - PASS 'threw'     : the call threw a real Error (controlled rejection).
 * - FAIL 'crash'     : the call threw a non-Error value (uncontrolled crash).
 * - FAIL 'hang'      : the call blocked the thread longer than timeoutMs.
 *   JavaScript cannot preempt a synchronous call, so a literal infinite loop
 *   can only be caught by a CI-level process timeout; the wall-clock budget
 *   here catches everything that eventually returns but blocks too long.
 */
type C6Outcome = { kind: 'returned' | 'threw' | 'crash' | 'hang'; detail: string }

function probeMalformed(device: PsyDevice, event: MusicalEvent, timeoutMs: number): C6Outcome {
  const t0 = performance.now()
  try {
    device.onEvent(event)
  } catch (err) {
    if (isRealError(err)) return { kind: 'threw', detail: `threw ${describe(err)}` }
    return { kind: 'crash', detail: `crashed: threw non-Error value (${describe(err)})` }
  }
  const elapsed = performance.now() - t0
  if (elapsed > timeoutMs) {
    return {
      kind: 'hang',
      detail: `hung: blocked the thread ${Math.round(elapsed)}ms > ${timeoutMs}ms`,
    }
  }
  return { kind: 'returned', detail: 'returned' }
}

// ── The checks ───────────────────────────────────────────────────────────────

/** C1 — id is a non-empty string and stable across reads. */
export const checkIdentity: CheckFn = (ctx) => {
  const id = 'C1'
  const name = 'identity: id is a non-empty string, stable across calls'
  try {
    const device = ctx.makeDevice()
    const first = device.id
    const second = device.id
    const ok =
      typeof first === 'string' && first.length > 0 && first.trim().length > 0 && first === second
    return result(
      id,
      name,
      ok,
      ok
        ? `id=${JSON.stringify(first)}`
        : `id=${JSON.stringify(first)} (stable=${String(first === second)})`
    )
  } catch (err) {
    return result(id, name, false, `factory or probe threw: ${describe(err)}`)
  }
}

/** C2 — capabilities() returns a valid shape, roles non-empty, and is side-effect free. */
export const checkCapabilities: CheckFn = (ctx) => {
  const id = 'C2'
  const name = 'capabilities: valid shape (roles non-empty) and side-effect free'
  try {
    const device = ctx.makeDevice()
    const first = device.capabilities()
    const second = device.capabilities()
    const problems: string[] = []
    if (first === null || typeof first !== 'object') {
      problems.push(`capabilities is ${String(first)}, not an object`)
    } else {
      const c = first as unknown as Record<string, unknown>
      if (typeof c.audio !== 'boolean') problems.push('audio is not a boolean')
      if (typeof c.midi !== 'boolean') problems.push('midi is not a boolean')
      for (const key of ['inputs', 'outputs', 'voices'] as const) {
        const v = c[key]
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
          problems.push(`${key} is not a non-negative integer (${String(v)})`)
        }
      }
      const latency = c.latencyMs
      if (typeof latency !== 'number' || !Number.isFinite(latency) || latency < 0) {
        problems.push(`latencyMs is not a finite non-negative number (${String(latency)})`)
      }
      const roles = c.roles
      if (
        !Array.isArray(roles) ||
        roles.length === 0 ||
        !roles.every((r) => typeof r === 'string')
      ) {
        problems.push(`roles is not a non-empty array of strings (${JSON.stringify(roles)})`)
      }
    }
    const stable = deepEqual(first, second)
    if (!stable) problems.push('two calls returned different values (side effect!)')
    const pass = problems.length === 0
    return result(id, name, pass, pass ? 'valid, stable across two calls' : problems.join('; '))
  } catch (err) {
    return result(id, name, false, `capabilities() threw: ${describe(err)}`)
  }
}

/**
 * C3 — lifecycle: one external onStart, then one external onStop, in order,
 * no throw. If both are unimplemented (optional in PsyDevice) the check passes
 * with an explicit note — there is nothing to verify.
 */
export const checkLifecycle: CheckFn = (ctx) => {
  const id = 'C3'
  const name = 'lifecycle: onStart→onStop exactly once each, in order, no throw'
  try {
    const { proxy, calls } = recordedProxy(ctx.makeDevice())
    proxy.onStart?.()
    proxy.onStop?.()
    const observed = calls.filter((c) => c === 'onStart' || c === 'onStop')
    if (observed.length === 0) {
      return result(
        id,
        name,
        true,
        'onStart/onStop not implemented (optional per PsyDevice) — nothing to verify'
      )
    }
    const pass = observed[0] === 'onStart' && observed[observed.length - 1] === 'onStop'
    return result(
      id,
      name,
      pass,
      pass ? `observed [${observed.join(', ')}]` : `bad sequence [${observed.join(', ')}]`
    )
  } catch (err) {
    return result(id, name, false, `lifecycle threw: ${describe(err)}`)
  }
}

/** C4 — a fresh device tolerates well-formed note + beat events without throwing. */
export const checkWellFormedEvent: CheckFn = (ctx) => {
  const id = 'C4'
  const name = 'event: tolerates a well-formed MusicalEvent (note + beat) without throwing'
  try {
    const device = ctx.makeDevice()
    try {
      device.onEvent(wellFormedNoteEvent())
      device.onEvent(wellFormedBeatEvent())
    } catch (err) {
      return result(id, name, false, `onEvent threw on well-formed input: ${describe(err)}`)
    }
    return result(id, name, true, 'accepted well-formed note and beat events')
  } catch (err) {
    return result(id, name, false, `factory threw: ${describe(err)}`)
  }
}

/** C5 — events delivered after onStop must not throw (post-dispatch safety). */
export const checkPostStopEvent: CheckFn = (ctx) => {
  const id = 'C5'
  const name = 'post-dispatch: tolerates events after onStop without throwing'
  try {
    const device = ctx.makeDevice()
    device.onStart?.()
    device.onStop?.()
    try {
      device.onEvent(wellFormedNoteEvent())
      device.onEvent(wellFormedBeatEvent())
    } catch (err) {
      return result(id, name, false, `onEvent threw after onStop: ${describe(err)}`)
    }
    return result(id, name, true, 'late events after onStop were tolerated')
  } catch (err) {
    return result(id, name, false, `factory or lifecycle threw: ${describe(err)}`)
  }
}

/** C6 — unknown/malformed events are handled honestly: return or real Error, never hang. */
export const checkMalformedEvent: CheckFn = (ctx) => {
  const id = 'C6'
  const name = 'malformed event: returns or throws a real Error, never hangs'
  try {
    const device = ctx.makeDevice()
    const outcomes = malformedEvents().map(({ label, event }) => ({
      label,
      outcome: probeMalformed(device, event, ctx.timeoutMs),
    }))
    const failed = outcomes.filter((o) => o.outcome.kind === 'crash' || o.outcome.kind === 'hang')
    const detail = outcomes
      .map((o) => `${o.label} → ${o.outcome.kind} (${o.outcome.detail})`)
      .join('; ')
    return result(id, name, failed.length === 0, detail)
  } catch (err) {
    return result(id, name, false, `factory threw: ${describe(err)}`)
  }
}

/** C7 — double onStop is safe (hosts may stop twice: unregister after dispose). */
export const checkDoubleStop: CheckFn = (ctx) => {
  const id = 'C7'
  const name = 'lifecycle safety: double onStop does not throw'
  try {
    const device = ctx.makeDevice()
    device.onStop?.()
    try {
      device.onStop?.()
    } catch (err) {
      return result(id, name, false, `second onStop threw: ${describe(err)}`)
    }
    return result(id, name, true, 'second onStop was tolerated')
  } catch (err) {
    return result(id, name, false, `factory threw: ${describe(err)}`)
  }
}

/**
 * C8 — id uniqueness guard. Default semantics: two devices from the same
 * factory MUST differ in id (unique identity per host registry — DeviceHost
 * rejects duplicate ids). Factories documented as producing stateless clones
 * may opt in via `statelessClones: true`, which accepts identical ids.
 * The suite cannot observe the internals of arbitrary devices, so it does not
 * attempt to verify statelessness — passing the flag is a documented claim by
 * the device repo (see conformance/README.md).
 */
export const checkIdUniqueness: CheckFn = (ctx) => {
  const id = 'C8'
  const name = 'factory: distinct ids per instance (or documented stateless clones)'
  try {
    const a = ctx.makeDevice()
    const b = ctx.makeDevice()
    if (a.id !== b.id) {
      return result(
        id,
        name,
        true,
        `unique ids: ${JSON.stringify(a.id)} vs ${JSON.stringify(b.id)}`
      )
    }
    if (ctx.statelessClones) {
      return result(
        id,
        name,
        true,
        `identical id ${JSON.stringify(a.id)} accepted: factory documented as stateless-clones`
      )
    }
    return result(
      id,
      name,
      false,
      `factory produced identical id ${JSON.stringify(a.id)} twice; pass statelessClones:true only if this is a documented stateless-clone factory`
    )
  } catch (err) {
    return result(id, name, false, `factory threw: ${describe(err)}`)
  }
}

/** The minimum conformance set, in execution order. */
export const CONFORMANCE_CHECKS: readonly CheckSpec[] = [
  { id: 'C1', name: 'identity: id is a non-empty string, stable across calls', fn: checkIdentity },
  {
    id: 'C2',
    name: 'capabilities: valid shape (roles non-empty) and side-effect free',
    fn: checkCapabilities,
  },
  {
    id: 'C3',
    name: 'lifecycle: onStart→onStop exactly once each, in order, no throw',
    fn: checkLifecycle,
  },
  {
    id: 'C4',
    name: 'event: tolerates a well-formed MusicalEvent (note + beat) without throwing',
    fn: checkWellFormedEvent,
  },
  {
    id: 'C5',
    name: 'post-dispatch: tolerates events after onStop without throwing',
    fn: checkPostStopEvent,
  },
  {
    id: 'C6',
    name: 'malformed event: returns or throws a real Error, never hangs',
    fn: checkMalformedEvent,
  },
  { id: 'C7', name: 'lifecycle safety: double onStop does not throw', fn: checkDoubleStop },
  {
    id: 'C8',
    name: 'factory: distinct ids per instance (or documented stateless clones)',
    fn: checkIdUniqueness,
  },
]
