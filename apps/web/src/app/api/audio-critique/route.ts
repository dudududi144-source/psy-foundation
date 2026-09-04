import { renderOnce, validateBarsSeed } from '@/lib/api-params'
import { critiqueAudio } from '@/lib/psy4/audio-critic'
import { DEFAULT_RENDER_CONFIG, renderFoundationSection } from '@/lib/psy4/forensic-bridge'
import { PSYTRANCE_PROGRESSIONS, buildProgression, midiToNoteName } from '@/lib/psy4/harmony'
import { analyzeReference } from '@/lib/psy4/reference-analyzer'
import { CompositionEngine } from '@psy-foundation/music'
import { createIdentityA } from '@psy-foundation/music'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Best config (synced with render-forensic route)
const BEST_CONFIG = {
  ...DEFAULT_RENDER_CONFIG,
  bassGain: 0.8,
  subBassGain: 0.6,
  padGain: 0.7,
}

export async function GET(req: NextRequest) {
  const params = validateBarsSeed(req, 8)
  if (!params.ok) return params.response
  const { bars, seed } = params
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

  // Phase 0 (truth): single render attempt, honest 500 on failure (the old
  // catch-retry silently re-rendered everything without samples).
  const rendered = await renderOnce(() =>
    renderFoundationSection(section, { useSamples, bpm: 145, config: BEST_CONFIG })
  )
  if (!rendered.ok) {
    console.error('Render failed:', rendered.error.message)
    return NextResponse.json({ error: `Render failed: ${rendered.error.message}` }, { status: 500 })
  }
  const result = rendered.result

  // Downmix to mono for AudioCritic
  const mono = new Float32Array(result.samplesL.length)
  for (let i = 0; i < mono.length; i++) {
    mono[i] = ((result.samplesL[i] ?? 0) + (result.samplesR[i] ?? 0)) * 0.5
  }

  // D8.1: supply stereo channels + the composed lead notes so the critic's
  // stereoContrast / melodicClarity / motifIdentity / callResponse are REAL
  // measurements instead of constants or spectral stand-ins.
  const notes = section.bars.flatMap((bar) =>
    bar.leadNotes.map((n) => ({
      pitchMidi: n.midi,
      startStep: bar.barIndex * section.groove.stepsPerBar + n.step,
      durationSteps: n.durationSteps,
      velocity: n.velocity,
    }))
  )
  const critique = critiqueAudio(mono, result.sampleRate, 145, 16, {
    stereo: { left: result.samplesL, right: result.samplesR },
    notes,
  })

  // Reference profile (new in v6.7)
  const analysis = analyzeReference(result.samplesL, result.samplesR, result.sampleRate)

  // Harmony info (new in v6.6)
  const progression = buildProgression(
    40,
    'phrygianDominant',
    PSYTRANCE_PROGRESSIONS['psy-dominant']!
  )
  const chordNames = progression.map((c) => c.name)

  return NextResponse.json({
    overallScore: critique.overallScore,
    failures: critique.failures.map((f) => ({
      code: f.code,
      severity: f.severity,
      diagnosis: f.diagnosis,
      correctionHint: f.correctionHint,
    })),
    metrics: {
      // lowEnd
      kickClarity: critique.lowEnd.kickClarity,
      bassClarity: critique.lowEnd.bassClarity,
      kickBassSeparation: critique.lowEnd.kickBassSeparation,
      subMud: critique.lowEnd.subMud,
      phaseRisk: critique.lowEnd.phaseRisk,
      // transient
      punch: critique.transient.punch,
      attackSharpness: critique.transient.attackSharpness,
      kickDefinition: critique.transient.kickDefinition,
      // bass
      bassDecayOverlap: critique.bass.decayOverlap,
      noteSeparation: critique.bass.noteSeparation,
      pitchStability: critique.bass.pitchStability,
      spectralConsistency: critique.bass.spectralConsistency,
      // groove
      onsetClarity: critique.groove.onsetClarity,
      pocketConsistency: critique.groove.pocketConsistency,
      kickBassLock: critique.groove.kickBassLock,
      excessiveUniformity: critique.groove.excessiveUniformity,
      // lead
      leadArticulation: critique.lead.articulation,
      melodicClarity: critique.lead.melodicClarity,
      phraseContrast: critique.lead.phraseContrast,
      repetitionBalance: critique.lead.repetitionBalance,
      harmonicClarity: critique.lead.harmonicClarity,
      // timbre
      brightness: critique.timbre.brightness,
      roughness: critique.timbre.roughness,
      noisiness: critique.timbre.noisiness,
      spectralMovement: critique.timbre.spectralMovement,
      modulationDepth: critique.timbre.modulationDepth,
      identityStrength: critique.timbre.identityStrength,
      // mix
      lowMidMud: critique.mix.lowMidMud,
      harshness: critique.mix.harshness,
      highEndPresence: critique.mix.highEndPresence,
      stereoContrast: critique.mix.stereoContrast,
      masking: critique.mix.masking,
      dynamicRange: critique.mix.dynamicRange,
      // musicality
      tensionRelease: critique.musicality.tensionRelease,
      motifIdentity: critique.musicality.motifIdentity,
      development: critique.musicality.development,
      callResponse: critique.musicality.callResponse,
      rhythmicInterest: critique.musicality.rhythmicInterest,
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
      samplePeakDb: result.samplePeakDb,
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
    version: 'v8.8',
  })
}
