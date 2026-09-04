import { describe, expect, test } from 'bun:test'
import type { MusicalEvent } from '@psy-foundation/protocol'
import { runDeviceConformance } from '../src/conformance/runner.ts'
import type { PsyDevice } from '../src/device.ts'
import { ReferenceDevice } from '../src/reference.ts'

/**
 * Conformance suite proof (phase 3.4, PLAN_V3_MASTER).
 *
 * 1. The in-repo reference device PASSES the full suite (C1..C8).
 * 2. Deliberately broken devices FAIL the suite with the NAMED checks that
 *    caught them — proving the suite detects real faults, not vacuous green.
 *
 * The suite itself is framework-agnostic; these tests are the in-repo proof
 * that it behaves as documented in conformance/README.md.
 */

describe('device conformance — reference device', () => {
  test('ReferenceDevice passes all checks C1..C8', () => {
    // A routable device declares at least one role (C2's contract) — the
    // reference device defaults to none, so the factory provides one.
    const report = runDeviceConformance(() => new ReferenceDevice({ roles: ['reference'] }))
    expect(report.pass).toBe(true)
    expect(report.checks.map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'])
    for (const check of report.checks) {
      expect(check.pass).toBe(true)
      expect(check.detail.length).toBeGreaterThan(0)
    }
  })

  test('report is a plain serializable object (no runner leakage)', () => {
    const report = runDeviceConformance(() => new ReferenceDevice({ roles: ['reference'] }))
    const json = JSON.stringify(report)
    expect(json).toContain('"C1"')
    expect(json).toContain('"pass":true')
    expect(JSON.parse(json)).toEqual(report)
  })
})

describe('device conformance — detects real faults (negative proofs)', () => {
  test('device throwing in capabilities() fails C2 and is omitted from clean results', () => {
    class BrokenCapabilities implements PsyDevice {
      readonly id = 'broken-capabilities'
      capabilities(): never {
        throw new Error('capabilities exploded')
      }
      onTransport(): void {}
      onContext(): void {}
      onEvent(): void {}
    }
    const report = runDeviceConformance(() => new BrokenCapabilities())
    expect(report.pass).toBe(false)
    const c2 = report.checks.find((c) => c.id === 'C2')
    expect(c2?.pass).toBe(false)
    expect(c2?.detail).toContain('capabilities exploded')
  })

  test('device throwing in onStart fails C3 (lifecycle)', () => {
    class BrokenStart implements PsyDevice {
      readonly id = 'broken-start'
      capabilities() {
        return {
          audio: false,
          midi: false,
          inputs: 0,
          outputs: 0,
          voices: 0,
          latencyMs: 0,
          roles: [],
        }
      }
      onTransport(): void {}
      onContext(): void {}
      onEvent(): void {}
      onStart(): void {
        throw new Error('start exploded')
      }
    }
    const report = runDeviceConformance(() => new BrokenStart())
    expect(report.pass).toBe(false)
    const c3 = report.checks.find((c) => c.id === 'C3')
    expect(c3?.pass).toBe(false)
    expect(c3?.detail).toContain('start exploded')
  })

  test('device that throws a non-Error value on malformed event fails C6 (honest failure)', () => {
    class CrashDevice implements PsyDevice {
      readonly id = 'crash-device'
      capabilities() {
        return {
          audio: false,
          midi: false,
          inputs: 0,
          outputs: 0,
          voices: 0,
          latencyMs: 0,
          roles: [],
        }
      }
      onTransport(): void {}
      onContext(): void {}
      onEvent(event: MusicalEvent): void {
        // C6's contract: return or throw a real Error. Throwing a bare string
        // is a "crash" — the exact fault class C6 exists to catch.
        if ((event as { type?: unknown }).type === 'definitely-not-a-real-event-type') {
          throw 'not an Error'
        }
      }
    }
    const report = runDeviceConformance(() => new CrashDevice())
    expect(report.pass).toBe(false)
    const c6 = report.checks.find((c) => c.id === 'C6')
    expect(c6?.pass).toBe(false)
    expect(c6?.detail).toContain('crashed')
  })

  test('factory with duplicate ids fails C8 unless statelessClones is opted in', () => {
    const dupFactory = (): PsyDevice => new ReferenceDevice({ id: 'dup' })
    const strict = runDeviceConformance(dupFactory)
    expect(strict.pass).toBe(false)
    const c8 = strict.checks.find((c) => c.id === 'C8')
    expect(c8?.pass).toBe(false)

    const lenient = runDeviceConformance(dupFactory, { statelessClones: true })
    expect(lenient.checks.find((c) => c.id === 'C8')?.pass).toBe(true)
  })

  test('a probe that itself crashes fails its own check but the suite still completes', () => {
    // A factory that explodes must not abort the run — every check returns a row.
    const report = runDeviceConformance(() => {
      throw new Error('factory exploded')
    })
    expect(report.pass).toBe(false)
    expect(report.checks).toHaveLength(8)
    for (const check of report.checks) {
      expect(check.pass).toBe(false)
      expect(check.detail).toContain('factory exploded')
    }
  })
})
