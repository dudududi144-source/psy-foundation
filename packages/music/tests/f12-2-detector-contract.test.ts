/**
 * F12.2 Failure detector contract tests — deliberate bad fixtures.
 *
 * Each failure type gets:
 * 1. A valid fixture (should NOT trigger)
 * 2. An invalid fixture (SHOULD trigger)
 * 3. Expected vs actual comparison
 */

import { describe, expect, test } from 'bun:test'
import { detectMusicalFailures } from '../src/enhanced-failure-detector.ts'
import type {
  ArrangementPlan,
  EnhancedFailureDetectOptions,
  GroovePlan,
} from '../src/enhanced-failure-detector.ts'

// Helper: build a valid arrangement with N bars of the given state
function arrangement(bars: number, state = 'DROP'): ArrangementPlan {
  return {
    bars,
    slots: Array.from({ length: bars }, (_, i) => ({
      barIndex: i,
      state: state as ArrangementPlan['slots'][0]['state'],
      roles: {
        kick: true,
        bass: true,
        lead: true,
        hats: true,
        percussion: true,
        fills: false,
        texture: false,
      },
      density: 0.7,
      energy: 0.7,
    })),
    seed: 1,
  }
}

function groove(): GroovePlan {
  return {
    subdivision: 4,
    kickSteps: [0, 4, 8, 12],
    bassKickAlignment: 'LOCKED',
    accentSteps: [0, 4, 8, 12],
    hatSteps: [2, 6, 10, 14],
    hatStyle: 'OFFBEAT',
    syncopationBudget: 0.3,
    swing: 0,
    fillBars: [],
    density: 0.7,
    stepsPerBar: 16,
    context: {} as GroovePlan['context'],
    seed: 1,
    bars: 8,
  }
}

function opts(
  bars: number,
  overrides: Partial<EnhancedFailureDetectOptions> = {}
): EnhancedFailureDetectOptions {
  return {
    kickNotes: Array.from({ length: bars }, (_, bar) =>
      [0, 4, 8, 12].map((step) => ({ step, bar }))
    ).flat(),
    bassNotes: Array.from({ length: bars }, (_, bar) => [
      { midi: 40, step: 0, bar, function: 'ROOT' },
      { midi: 47, step: 8, bar, function: 'FIFTH' },
    ]).flat(),
    leadNotes: Array.from({ length: bars }, (_, bar) => [
      { midi: 64, step: 0, bar, velocity: 0.7 },
      { midi: 67, step: 4, bar, velocity: 0.6 },
    ]).flat(),
    hatNotes: Array.from({ length: bars }, (_, bar) =>
      [2, 6, 10, 14].map((step) => ({ step, bar }))
    ).flat(),
    arrangement: arrangement(bars, 'DROP'),
    groove: groove(),
    bars,
    stepsPerBar: 16,
    ...overrides,
  }
}

describe('KICK_MISSING', () => {
  test('valid: kick present in DROP → OK', () => {
    const report = detectMusicalFailures(opts(8))
    const kickMissing = report.failures.find((f) => f.type === 'KICK_MISSING')
    expect(kickMissing).toBeUndefined()
  })

  test('invalid: DROP + empty kickNotes → KICK_MISSING FAIL', () => {
    const report = detectMusicalFailures(opts(8, { kickNotes: [] }))
    const kickMissing = report.failures.find((f) => f.type === 'KICK_MISSING')
    expect(kickMissing).toBeDefined()
    expect(kickMissing.level).toBe('FAIL')
    expect(kickMissing.bars).toBeDefined()
    expect(kickMissing.bars.length).toBe(8)
  })

  test('invalid: GROOVE + empty kickNotes → KICK_MISSING FAIL', () => {
    const arr = arrangement(8, 'GROOVE')
    const report = detectMusicalFailures(opts(8, { kickNotes: [], arrangement: arr }))
    const kickMissing = report.failures.find((f) => f.type === 'KICK_MISSING')
    expect(kickMissing).toBeDefined()
    expect(kickMissing.level).toBe('FAIL')
  })

  test('valid: BREAK + empty kickNotes → no KICK_MISSING (intentional silence)', () => {
    const arr = arrangement(8, 'BREAK')
    const report = detectMusicalFailures(opts(8, { kickNotes: [], arrangement: arr }))
    const kickMissing = report.failures.find((f) => f.type === 'KICK_MISSING')
    expect(kickMissing).toBeUndefined()
  })
})

describe('LEAD_REGISTER_ESCAPE', () => {
  test('valid: lead at MIDI 64-72 → OK', () => {
    const report = detectMusicalFailures(opts(8))
    const regEscape = report.failures.find((f) => f.type === 'LEAD_REGISTER_ESCAPE')
    expect(regEscape).toBeUndefined()
  })

  test('valid: lead at MIDI 84 (boundary) → OK (threshold is >84)', () => {
    const report = detectMusicalFailures(
      opts(8, {
        leadNotes: [{ midi: 84, step: 0, bar: 0, velocity: 0.7 }],
      })
    )
    const regEscape = report.failures.find((f) => f.type === 'LEAD_REGISTER_ESCAPE')
    expect(regEscape).toBeUndefined()
  })

  test('invalid: lead at MIDI 85 → LEAD_REGISTER_ESCAPE WARNING', () => {
    const report = detectMusicalFailures(
      opts(8, {
        leadNotes: [{ midi: 85, step: 0, bar: 0, velocity: 0.7 }],
      })
    )
    const regEscape = report.failures.find((f) => f.type === 'LEAD_REGISTER_ESCAPE')
    expect(regEscape).toBeDefined()
    expect(regEscape?.level).toBe('WARNING')
    expect(regEscape?.evidence).toContain('85')
  })

  test('invalid: lead at MIDI 90 → LEAD_REGISTER_ESCAPE WARNING', () => {
    const report = detectMusicalFailures(
      opts(8, {
        leadNotes: [{ midi: 90, step: 0, bar: 0, velocity: 0.7 }],
      })
    )
    const regEscape = report.failures.find((f) => f.type === 'LEAD_REGISTER_ESCAPE')
    expect(regEscape).toBeDefined()
    expect(regEscape?.level).toBe('WARNING')
    expect(regEscape?.evidence).toContain('90')
  })
})

describe('BASS_UNCOUPLED', () => {
  test('valid: bass on step 0 (aligned with kick) → OK', () => {
    const report = detectMusicalFailures(opts(8))
    const uncoupled = report.failures.find((f) => f.type === 'BASS_UNCOUPLED')
    expect(uncoupled).toBeUndefined()
  })

  test('invalid: bass never on step 0 → BASS_UNCOUPLED', () => {
    const report = detectMusicalFailures(
      opts(8, {
        bassNotes: Array.from({ length: 8 }, (_, bar) => [
          { midi: 40, step: 2, bar, function: 'ROOT' },
        ]).flat(),
      })
    )
    const uncoupled = report.failures.find((f) => f.type === 'BASS_UNCOUPLED')
    expect(uncoupled).toBeDefined()
  })
})

describe('ROOT_ONLY_BASS', () => {
  test('valid: bass uses ROOT + FIFTH → OK', () => {
    const report = detectMusicalFailures(opts(8))
    const rootSpam = report.failures.find((f) => f.type === 'BASS_ROOT_SPAM')
    expect(rootSpam).toBeUndefined()
  })

  test('invalid: bass only uses root pitch class → BASS_ROOT_SPAM', () => {
    const report = detectMusicalFailures(
      opts(8, {
        bassNotes: Array.from({ length: 8 }, (_, bar) => [
          { midi: 40, step: 0, bar, function: 'ROOT' },
          { midi: 40, step: 8, bar, function: 'ROOT' },
        ]).flat(),
      })
    )
    const rootSpam = report.failures.find((f) => f.type === 'BASS_ROOT_SPAM')
    expect(rootSpam).toBeDefined()
  })
})

describe('EXCESSIVE_VARIATION', () => {
  test('valid: normal variation → OK', () => {
    const report = detectMusicalFailures(opts(8))
    const excessive = report.failures.find((f) => f.type === 'EXCESSIVE_VARIATION')
    expect(excessive).toBeUndefined()
  })
})

describe('NO_SPACE', () => {
  test('valid: bars with some silence → OK', () => {
    const report = detectMusicalFailures(opts(8))
    const noSpace = report.failures.find((f) => f.type === 'NO_SPACE')
    expect(noSpace).toBeUndefined()
  })
})

describe('PARTS_NOT_INTERLOCKED', () => {
  test('valid: bass aligns with kick on beat 1 → OK', () => {
    const report = detectMusicalFailures(opts(8))
    const notInterlocked = report.failures.find((f) => f.type === 'PARTS_NOT_INTERLOCKED')
    expect(notInterlocked).toBeUndefined()
  })
})
