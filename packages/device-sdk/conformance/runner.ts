/**
 * Conformance runner (phase 3.4) — framework-agnostic. No bun:test/vitest/
 * jest imports: call it from any test framework, script, or CI job and assert
 * on the returned report object.
 *
 * The runner is fault-isolated like DeviceHost: a check that itself throws
 * (or a factory that explodes) fails ITS OWN check with a detail message and
 * the suite always completes with a full report.
 */

import type { PsyDevice } from '../src/device.ts'
import { CONFORMANCE_CHECKS } from './checks.ts'
import type { CheckContext, ConformanceCheckResult } from './checks.ts'

export type { CheckContext, CheckFn, CheckSpec, ConformanceCheckResult } from './checks.ts'
export { CONFORMANCE_CHECKS, wellFormedBeatEvent, wellFormedNoteEvent } from './checks.ts'

export interface ConformanceOptions {
  /** Wall-clock budget (ms) for C6 malformed-event probes. Default 1000. */
  timeoutMs?: number
  /** Accept identical ids from the factory (documented stateless-clone factories). Default false. */
  statelessClones?: boolean
}

export interface ConformanceReport {
  /** True only if every check passed. */
  readonly pass: boolean
  /** One result per check, in execution order (C1..C8). */
  readonly checks: readonly ConformanceCheckResult[]
}

const DEFAULT_TIMEOUT_MS = 1000

function describe(err: unknown): string {
  try {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  } catch {
    return 'unstringifiable thrown value'
  }
}

/**
 * Run the full device conformance suite against a device factory.
 *
 * Every check builds a FRESH device via `makeDevice()`. The report is a plain
 * object: `report.pass` is the boolean verdict, `report.checks` carries
 * per-check `{ id, name, pass, detail }` rows for CI output.
 */
export function runDeviceConformance(
  makeDevice: () => PsyDevice,
  opts: ConformanceOptions = {}
): ConformanceReport {
  const ctx: CheckContext = {
    makeDevice,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    statelessClones: opts.statelessClones ?? false,
  }
  const checks: ConformanceCheckResult[] = CONFORMANCE_CHECKS.map(({ id, name, fn }) => {
    try {
      return fn(ctx)
    } catch (err) {
      // Isolate the isolator: a crashing probe fails its own check instead of
      // aborting the suite.
      return { id, name, pass: false, detail: `conformance probe crashed: ${describe(err)}` }
    }
  })
  return { pass: checks.every((c) => c.pass), checks }
}
