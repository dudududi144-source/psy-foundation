import { NextRequest, NextResponse } from 'next/server'
import { CompositionEngine } from '@/foundation/music'
import { createIdentityA } from '@/foundation/music'
import { renderFoundationSection, DEFAULT_RENDER_CONFIG } from '@/lib/psy4/forensic-bridge'
import { critiqueAudio } from '@/lib/psy4/audio-critic'
import { analyzeReference } from '@/lib/psy4/reference-analyzer'
import { PSYTRANCE_PROGRESSIONS, buildProgression, midiToNoteName } from '@/lib/psy4/harmony'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Best config (v6.8 — ZDF SVF + harmony + humanizer)
const BEST_CONFIG = DEFAULT_RENDER_CONFIG

export async function GET(req: NextRequest) {
  const bars = parseInt(req.nextUrl.searchParams.get('bars') ?? '8', 10)
  const seed = parseInt(req.nextUrl.searchParams.get('seed') ?? '42', 10)
  const useSamples = req.nextUrl.searchParams.get('samples') !== 'false'

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
  }

  const engine = new CompositionEngine({ seed, context: ctx, identity: createIdentityA() })
  const section = engine.composeSection({ bars })

  let result
  try {
    result = await renderFoundationSection(section, { useSamples, bpm: 145, config: BEST_CONFIG })
  } catch (e) {
    console.error('Render failed, retrying without samples:', (e as Error).message)
    result = await renderFoundationSection(section, { useSamples: false, bpm: 145, config: BEST_CONFIG })
  }

  // Downmix to mono for AudioCritic
  const mono = new Float32Array(result.samplesL.length)
  for (let i = 0; i < mono.length; i++) {
    mono[i] = ((result.samplesL[i] ?? 0) + (result.samplesR[i] ?? 0)) * 0.5
  }

  const critique = critiqueAudio(mono, result.sampleRate, 145, 16)

  // Reference profile (new in v6.7)
  const analysis = analyzeReference(result.samplesL, result.samplesR, result.sampleRate)

  // Harmony info (new in v6.6)
  const progression = buildProgression(40, 'phrygianDominant', PSYTRANCE_PROGRESSIONS['psy-dominant']!)
  const chordNames = progression.map(c => c.name)

  return NextResponse.json({
    overallScore: critique.overallScore,
    failures: critique.failures.map(f => ({
      code: f.code,
      severity: f.severity,
      diagnosis: f.diagnosis,
      correctionHint: f.correctionHint,
    })),
    metrics: {
      kickClarity: critique.lowEnd.kickClarity,
      bassClarity: critique.lowEnd.bassClarity,
      kickBassSeparation: critique.lowEnd.kickBassSeparation,
      subMud: critique.lowEnd.subMud,
      punch: critique.transient.punch,
      attackSharpness: critique.transient.attackSharpness,
      bassDecayOverlap: critique.bass.decayOverlap,
      noteSeparation: critique.bass.noteSeparation,
      onsetClarity: critique.groove.onsetClarity,
      kickBassLock: critique.groove.kickBassLock,
      leadArticulation: critique.lead.articulation,
      melodicClarity: critique.lead.melodicClarity,
      brightness: critique.timbre.brightness,
      spectralMovement: critique.timbre.spectralMovement,
      lowMidMud: critique.mix.lowMidMud,
      masking: critique.mix.masking,
      dynamicRange: critique.mix.dynamicRange,
    },
    renderInfo: {
      durationSec: result.durationSec,
      bars: result.bars,
      events: result.events,
      sampleRate: result.sampleRate,
      stereo: true,
      samples: useSamples,
      lufs: result.lufs,
      truePeakDb: result.truePeakDb,
      stereoWidth: result.stereoWidth,
      monoCompatibility: result.monoCompatibility,
      gainReductionDb: result.gainReductionDb,
    },
    renderProfile: {
      bpm: analysis.profile.bpm,
      spectralCentroid: Math.round(analysis.profile.spectralCentroid),
      bassEnergy: analysis.profile.bassEnergy,
      midEnergy: analysis.profile.midEnergy,
      highEnergy: analysis.profile.highEnergy,
      airEnergy: analysis.profile.airEnergy,
      crestFactor: analysis.profile.crestFactor,
      dynamicRange: analysis.profile.dynamicRange,
      lowMidMud: analysis.profile.lowMidMud,
    },
    harmony: {
      scale: 'phrygianDominant',
      progression: chordNames,
      rootNote: midiToNoteName(40),
    },
    version: 'v8.1',
  })
}
