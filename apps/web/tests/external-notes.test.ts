/**
 * Task 17 — the WHAT→HOW wire: faithful external-note rendering.
 *
 * The consumer contract under test:
 * 1. External notes render through the SAME sound chain as render-forensic
 *    (voices → ChannelFX → bus glue → master chain) — so the output obeys
 *    the sound contract (LUFS targeting, limiter, stereo).
 * 2. FAITHFUL means faithful: the caller's composition is rendered exactly —
 *    no internal kick/bass/hats (silence between external events), no
 *    8-bar energy contour (a note at bar 4 renders as loud as bar 0), no
 *    re-humanization (byte-stable timing).
 * 3. Determinism: same notes + seed → byte-identical PCM; different seed →
 *    different bytes (the seed feeds voice excitation, not composition).
 * 4. The default path is untouched: renderFoundationSection WITHOUT
 *    externalNotes still generates its own composition (non-silence with
 *    zero external notes is impossible in faithful mode — the contrast
 *    proves the guard actually switches modes).
 */
import { describe, expect, test } from 'bun:test'
import {
  buildExternalSection,
  renderExternalNotes,
  renderFoundationSection,
} from '../src/lib/psy4/forensic-bridge'

// Small render geometry keeps each test under ~1-2s.
const BARS = 4

function leadMelodyNotes(): Parameters<typeof renderExternalNotes>[0] {
  // A deterministic 4-bar lead line on the beat grid: one note per bar start
  // + one offbeat eighth (step fraction .5) to prove fractional timing works.
  const notes = []
  for (let bar = 0; bar < BARS; bar++) {
    notes.push({
      track: 'lead' as const,
      midi: 64 + bar,
      step: bar * 16,
      durationSteps: 4,
      velocity: 0.8,
    })
    notes.push({
      track: 'lead' as const,
      midi: 71 + bar,
      step: bar * 16 + 2.5,
      durationSteps: 2,
      velocity: 0.6,
    })
  }
  return notes
}

async function render(notes: Parameters<typeof renderExternalNotes>[0], seed = 42) {
  return renderExternalNotes(notes, { bars: BARS, bpm: 145, seed })
}

function rms(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += (buf[i] ?? 0) * (buf[i] ?? 0)
  return Math.sqrt(sum / Math.max(1, buf.length))
}

describe('Task 17 — renderExternalNotes (faithful WHAT→HOW consumer)', () => {
  test('external lead melody renders non-silent audio through the master chain', async () => {
    const r = await render(leadMelodyNotes())
    expect(r.samplesL.length).toBeGreaterThan(0)
    expect(r.durationSec).toBeCloseTo((BARS * 16 * (60 / 145 / 4)) as number, 2)
    // Non-silent and actually loud enough to have been mastered:
    expect(rms(r.samplesL)).toBeGreaterThan(0.01)
    // The sound contract: LUFS targeting ran (integrated loudness is finite
    // and in a mastered range, not raw voice level).
    expect(Number.isFinite(r.lufs)).toBe(true)
    expect(r.lufs).toBeLessThan(-5)
    expect(r.truePeakDb).toBeLessThanOrEqual(-1.2 + 0.05)
    // 8 notes + 8 scheduled note-offs (lead pool sustains until released).
    expect(r.events).toBe(BARS * 4)
  })

  test('FAITHFUL: silence where no external note was sent', async () => {
    // Two isolated lead notes at the very start; the rest of the render
    // window must be silent — no generated kick/bass/hats/pads may appear.
    const notes = [
      { track: 'lead' as const, midi: 69, step: 0, durationSteps: 4, velocity: 0.9 },
      { track: 'lead' as const, midi: 76, step: 6, durationSteps: 2, velocity: 0.7 },
    ]
    const r = await render(notes)
    const sr = r.sampleRate
    const secPerStep = 60 / 145 / 4
    // After the second note's release (+ generous voice tail), everything is silence.
    const tailStart = Math.floor((6 + 2 + 8) * secPerStep * sr)
    const tailRms = rms(r.samplesL.slice(tailStart))
    expect(tailRms).toBeLessThan(1e-4)
    // And the note onset itself is NOT silence.
    const onsetRms = rms(r.samplesL.slice(0, Math.floor(2 * secPerStep * sr)))
    expect(onsetRms).toBeGreaterThan(0.01)
  })

  test('FAITHFUL: no 8-bar energy contour — bar-4 note is as loud as bar-0 note', async () => {
    // Internal composition dips bar 4 to energy 0.2 (break). A faithful
    // consumer's identical notes must render at the same level in every bar.
    // (The synth's LFO phase differs between the two windows — free-running
    // modulation is voice state, not arrangement — so compare peaks.)
    const notes = [
      { track: 'lead' as const, midi: 69, step: 0, durationSteps: 2, velocity: 0.8 },
      { track: 'lead' as const, midi: 69, step: 64, durationSteps: 2, velocity: 0.8 },
    ]
    // 8 bars so step 64 (the internal break-dip bar, barIdx 4) is inside
    // the render window.
    const r = await renderExternalNotes(notes, { bars: 8, bpm: 145, seed: 42 })
    const sr = r.sampleRate
    const secPerStep = 60 / 145 / 4
    const window = Math.floor(1.5 * secPerStep * sr)
    const peakOf = (start: number) => {
      let p = 0
      for (let i = start; i < start + window; i++) p = Math.max(p, Math.abs(r.samplesL[i] ?? 0))
      return p
    }
    const a = peakOf(0)
    const b = peakOf(Math.floor(64 * secPerStep * sr))
    // Same note, same velocity → same peak (±20%); the internal break dip
    // would show up as a 5× difference.
    expect(b).toBeGreaterThan(a * 0.8)
    expect(b).toBeLessThan(a * 1.25)
  }, 30000)

  test('determinism: same notes + seed → byte-identical; different seed → different', async () => {
    const notes = leadMelodyNotes()
    const a = await render(notes, 42)
    const b = await render(notes, 42)
    const c = await render(notes, 43)
    expect(a.samplesL.length).toBe(b.samplesL.length)
    let same = true
    let diff = false
    for (let i = 0; i < a.samplesL.length; i++) {
      if ((a.samplesL[i] ?? 0) !== (b.samplesL[i] ?? 0)) same = false
      if ((a.samplesL[i] ?? 0) !== (c.samplesL[i] ?? 0)) diff = true
    }
    expect(same).toBe(true)
    expect(diff).toBe(true)
  }, 30000)

  test('fractional step positions render as sent (off-grid humanized timing)', async () => {
    const onGrid = [{ track: 'lead' as const, midi: 69, step: 0, durationSteps: 2, velocity: 0.8 }]
    const offGrid = [
      { track: 'lead' as const, midi: 69, step: 0.5, durationSteps: 2, velocity: 0.8 },
    ]
    const a = await render(onGrid)
    const b = await render(offGrid)
    // Same voice + note → same peak amplitude ballpark (the FIR safety pass
    // applies content-dependent gain, so exact equality is not a contract).
    let peakA = 0
    let peakB = 0
    for (let i = 0; i < a.samplesL.length; i++) {
      peakA = Math.max(peakA, Math.abs(a.samplesL[i] ?? 0))
      peakB = Math.max(peakB, Math.abs(b.samplesL[i] ?? 0))
    }
    expect(peakB).toBeGreaterThan(peakA * 0.7)
    expect(peakB).toBeLessThan(peakA * 1.4)
    // And the outputs must differ (timing moved).
    let diff = false
    for (let i = 0; i < Math.min(a.samplesL.length, b.samplesL.length); i++) {
      if ((a.samplesL[i] ?? 0) !== (b.samplesL[i] ?? 0)) diff = true
    }
    expect(diff).toBe(true)
  }, 30000)

  test('drum tracks route to their own voices (kick excites the low band)', async () => {
    const notes = [{ track: 'kick' as const, midi: 36, step: 0, durationSteps: 1, velocity: 1.0 }]
    const r = await render(notes)
    const sr = r.sampleRate
    // Kick body lives in the first ~200ms and rings out under 1s (measured:
    // RMS at t≥1s is < 1e-20); after that the faithful render is silent.
    const kickRms = rms(r.samplesL.slice(0, Math.floor(0.2 * sr)))
    const tailRms = rms(r.samplesL.slice(Math.floor(1.5 * sr)))
    expect(kickRms).toBeGreaterThan(0.05)
    expect(tailRms).toBeLessThan(1e-3)
  }, 30000)

  test('default path untouched: no externalNotes → internal composition runs', async () => {
    const section = buildExternalSection(BARS, 42)
    // The OLD path generates its own composition from ANY section — even an
    // empty skeleton — because kick/bass/hats/arrangement are internal. That
    // is exactly the behavior the faithful guard must bypass.
    const internal = await renderFoundationSection(section, { bpm: 145 })
    expect(internal.events).toBeGreaterThan(100)
    expect(rms(internal.samplesL)).toBeGreaterThan(0.01)
    // …and WITH externalNotes the same skeleton becomes the faithful renderer:
    // ONLY the 8 external events + their 8 note-offs, no internal composition.
    const faithful = await renderExternalNotes(leadMelodyNotes(), {
      bars: BARS,
      bpm: 145,
      seed: 42,
    })
    expect(faithful.events).toBe(BARS * 4)
    expect(rms(faithful.samplesL)).toBeGreaterThan(0.01)
  }, 30000)
})
