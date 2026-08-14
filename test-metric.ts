import { critiqueAudio } from './src/lib/psy4/audio-critic'
import { CompositionEngine } from './src/foundation/music'
import { createIdentityA } from './src/foundation/music'
import { renderFoundationSection } from './src/lib/psy4/forensic-bridge'

const ctx = {
  tonic: 4, scaleName: 'phrygian-dominant', octave: 4, bpm: 145,
  beatsPerBar: 4, beatPosition: 0, barPosition: 0, phrasePosition: 0,
  harmonicContext: [], density: 0.7, energy: 0.7, tension: 0.3,
  sectionRole: 'full-on', repetitionPressure: 0.3, noveltyPressure: 0.5,
}
const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
const section = engine.composeSection({ bars: 8 })
const result = await renderFoundationSection(section, { useSamples: true, bpm: 145 })
const mono = new Float32Array(result.samplesL.length)
for (let i = 0; i < mono.length; i++) mono[i] = (result.samplesL[i]! + result.samplesR[i]!) * 0.5
const c = critiqueAudio(mono, result.sampleRate, 145, 16)
console.log('Score:', c.overallScore.toFixed(4))
console.log('bass.decayOverlap:', c.bass.decayOverlap.toFixed(4))
console.log('Failures:')
for (const f of c.failures) console.log(`  ${f.code}: ${f.severity.toFixed(3)}`)
