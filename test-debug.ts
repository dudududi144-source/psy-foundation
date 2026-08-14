// Force fresh module load
delete require.cache
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

// Manual band-pass + attack/decay measurement
const SR = 44100
const hpAlpha = 2 * Math.PI * 300 / SR
const hpA = hpAlpha / (1 + hpAlpha)
const lpAlpha = 2 * Math.PI * 800 / SR
const lpA = lpAlpha / (1 + lpAlpha)
const bassMid = new Float32Array(mono.length)
let hpPrev = 0, lpPrev = 0
for (let i = 0; i < mono.length; i++) {
  const x = mono[i]!
  hpPrev = hpPrev + hpA * (x - hpPrev)
  const hpOut = x - hpPrev
  lpPrev = lpPrev + lpA * (hpOut - lpPrev)
  bassMid[i] = lpPrev
}

const numSteps = 128 // 8 bars * 16 steps
const sps = Math.floor(mono.length / numSteps)
const attackLen = Math.max(10, Math.floor(sps * 0.15))
const tailStart = sps - attackLen
console.log(`sps=${sps} attackLen=${attackLen} tailStart=${tailStart}`)
let totalRatio = 0, count = 0
for (let s = 0; s < numSteps; s++) {
  const stepStart = s * sps
  let attackEnergy = 0, tailEnergy = 0
  for (let i = 0; i < attackLen; i++) {
    attackEnergy += Math.abs(bassMid[stepStart + i] ?? 0)
    tailEnergy += Math.abs(bassMid[stepStart + tailStart + i] ?? 0)
  }
  attackEnergy /= attackLen
  tailEnergy /= attackLen
  if (attackEnergy > 0.001) {
    const ratio = tailEnergy / attackEnergy
    totalRatio += ratio
    count++
    if (s < 4) console.log(`  step ${s}: attack=${attackEnergy.toFixed(6)} tail=${tailEnergy.toFixed(6)} ratio=${ratio.toFixed(4)}`)
  }
}
console.log(`Manual decayOverlap: ${(totalRatio/count).toFixed(4)} (count=${count})`)

const c = critiqueAudio(mono, result.sampleRate, 145, 16)
console.log('Critic decayOverlap:', c.bass.decayOverlap.toFixed(4))
console.log('Score:', c.overallScore.toFixed(4))
