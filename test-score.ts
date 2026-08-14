import { critiqueAudio } from './src/lib/psy4/audio-critic'
import { CompositionEngine } from './src/foundation/music'
import { createIdentityA } from './src/foundation/music'
import { renderFoundationSection } from './src/lib/psy4/forensic-bridge'

async function test(bars: number, config?: any) {
  const ctx = {
    tonic: 4, scaleName: 'phrygian-dominant', octave: 4, bpm: 145,
    beatsPerBar: 4, beatPosition: 0, barPosition: 0, phrasePosition: 0,
    harmonicContext: [], density: 0.7, energy: 0.7, tension: 0.3,
    sectionRole: 'full-on', repetitionPressure: 0.3, noveltyPressure: 0.5,
  }
  const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
  const section = engine.composeSection({ bars })
  const result = await renderFoundationSection(section, { useSamples: true, bpm: 145, config })
  const mono = new Float32Array(result.samplesL.length)
  for (let i = 0; i < mono.length; i++) mono[i] = (result.samplesL[i]! + result.samplesR[i]!) * 0.5
  const c = critiqueAudio(mono, result.sampleRate, 145, 16)
  console.log(`\n=== ${bars} bars ===`)
  console.log(`Score: ${c.overallScore.toFixed(4)}`)
  console.log(`noteSeparation: ${c.bass.noteSeparation.toFixed(4)}`)
  console.log(`decayOverlap: ${c.bass.decayOverlap.toFixed(4)}`)
  console.log(`highEndPresence: ${c.mix.highEndPresence.toFixed(4)}`)
  console.log(`brightness: ${c.timbre.brightness.toFixed(4)}`)
  console.log(`dynamicRange: ${c.mix.dynamicRange.toFixed(4)}`)
  console.log(`masking: ${c.mix.masking.toFixed(4)}`)
  console.log(`Failures:`)
  for (const f of c.failures) console.log(`  ${f.code}: ${f.severity.toFixed(3)}`)
}

await test(8)
await test(32)
