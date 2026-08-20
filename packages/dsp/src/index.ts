/**
 * @psy-foundation/dsp
 *
 * Browser DSP toolbox. Web Audio API native where sufficient; AudioWorklet
 * only where measured-necessary.
 *
 * Modules:
 *  - oscillators.ts  PolyBLEP saw/square/triangle, sine, FM, wavetable
 *  - filters.ts      OnePole LP/HP, Biquad (RBJ), MoogLadder 4-pole
 *  - envelopes.ts    Adsr (linear), PitchEnvelope (exponential glide)
 *  - utils.ts        DcBlocker, tanhSaturation, softClip, hardClip, stereo width
 *  - effects.ts      Delay (with LP feedback), PingPongDelay, SchroederReverb
 *  - metering.ts     RmsMeter, PeakMeter, LufsMeter (K-weighted approximation)
 *  - voicePool.ts    VoicePool (pre-allocated, round-robin, no GC in hot path)
 */

export type { Waveform, OscillatorOptions } from './oscillators.ts'
export {
  PolyBlepOsc,
  FmOscillator,
  WavetableOsc,
  buildWavetable,
  wavetables,
} from './oscillators.ts'
export type { BiquadType } from './filters.ts'
export { OnePoleLP, OnePoleHP, BiquadFilter, MoogLadder } from './filters.ts'
export type { EnvelopeStage } from './envelopes.ts'
export { Adsr, PitchEnvelope } from './envelopes.ts'
export {
  DcBlocker,
  tanhSaturation,
  softClip,
  hardClip,
  processStereo,
  applyWidth,
} from './utils.ts'
export { Delay, PingPongDelay, SchroederReverb } from './effects.ts'
export { RmsMeter, PeakMeter, LufsMeter } from './metering.ts'
export type { Voice } from './voicePool.ts'
export { VoicePool } from './voicePool.ts'
