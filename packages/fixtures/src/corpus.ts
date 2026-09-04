import {
  genBreakdown,
  genDenseBass,
  genDoubleTime,
  genFalseKick,
  genGap2s,
  genGap500ms,
  genHalfTime,
  genJitter150,
  genLeadHeavy,
  genMissingBeat,
  genPerfect150,
  genSparse,
  genTempoJump,
  genTempoRamp,
} from './generators.ts'
import { genMelodyPentatonic, genRhythm16thGrid, genWhiteNoise } from './special.ts'
import type { Fixture } from './types.ts'

export const corpus: Fixture[] = [
  // Rhythmic / tempo anomalies (the original corpus).
  genPerfect150(),
  genJitter150(),
  genTempoRamp(),
  genTempoJump(),
  genMissingBeat(),
  genFalseKick(),
  genHalfTime(),
  genDoubleTime(),
  genGap500ms(),
  genGap2s(),
  genSparse(),
  genDenseBass(),
  genLeadHeavy(),
  genBreakdown(),
  // GAP-F1/F2/F3 (PLAN_V3 3.5): melody, 16th grid, noise.
  genMelodyPentatonic(),
  genRhythm16thGrid(),
  genWhiteNoise(),
]

export function getFixture(id: string): Fixture {
  const f = corpus.find((x) => x.id === id)
  if (!f) throw new Error(`Unknown fixture: ${id}`)
  return f
}
