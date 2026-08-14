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
const section = engine.composeSection({ bars: 4 })

console.log('Starting render...')
const t0 = Date.now()
try {
  const result = await renderFoundationSection(section, { useSamples: false, bpm: 145 })
  const t1 = Date.now()
  console.log(`Render OK in ${t1-t0}ms`)
  console.log(`  duration: ${result.durationSec.toFixed(2)}s`)
  console.log(`  bars: ${result.bars}, events: ${result.events}`)
  console.log(`  LUFS: ${result.lufs.toFixed(2)}`)
  console.log(`  truePeak: ${result.truePeakDb.toFixed(2)}dB`)
  console.log(`  stereoWidth: ${result.stereoWidth.toFixed(3)}`)
  console.log(`  monoCompat: ${result.monoCompatibility.toFixed(3)}`)
  console.log(`  gainReduction: ${result.gainReductionDb.toFixed(2)}dB`)
  let nanCount = 0
  for (let i = 0; i < result.samplesL.length; i++) {
    if (!isFinite(result.samplesL[i]!)) nanCount++
    if (!isFinite(result.samplesR[i]!)) nanCount++
  }
  console.log(`  NaN/Inf count: ${nanCount}`)
  let peakL = 0, peakR = 0
  for (let i = 0; i < result.samplesL.length; i++) {
    peakL = Math.max(peakL, Math.abs(result.samplesL[i]!))
    peakR = Math.max(peakR, Math.abs(result.samplesR[i]!))
  }
  console.log(`  peakL: ${peakL.toFixed(4)}, peakR: ${peakR.toFixed(4)}`)
} catch (e) {
  console.error('RENDER FAILED:', (e as Error).message)
  console.error((e as Error).stack)
}
