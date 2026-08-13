import { NextRequest, NextResponse } from 'next/server'
import { CompositionEngine } from '@/foundation/music'
import { createIdentityA } from '@/foundation/music'
import { renderFoundationSection } from '@/lib/psy4/forensic-bridge'
import { critiqueAudio } from '@/lib/psy4/audio-critic'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

  const result = await renderFoundationSection(section, { useSamples, bpm: 145 })

  // Downmix to mono for AudioCritic
  const mono = new Float32Array(result.samplesL.length)
  for (let i = 0; i < mono.length; i++) {
    mono[i] = ((result.samplesL[i] ?? 0) + (result.samplesR[i] ?? 0)) * 0.5
  }

  const critique = critiqueAudio(mono, result.sampleRate, 145, 16)

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
    },
  })
}
