/**
 * @psy-foundation/dsp
 *
 * Browser DSP toolbox. Web Audio API native where sufficient; AudioWorklet
 * only where measured-necessary.
 *
 * Modules:
 *  - oscillators.ts  PolyBLEP saw/square/triangle, sine, FM, wavetable
 *  - filters.ts      OnePole LP/HP, Biquad (RBJ), MoogLadder 4-pole
 *  - filters-zdf.ts  ZDFSVF (Zavalishin/Simper TPT state-variable filter) [D4]
 *  - envelopes.ts    Adsr (linear), PitchEnvelope (exponential glide)
 *  - utils.ts        DcBlocker, tanhSaturation, softClip, hardClip, stereo width
 *  - effects.ts      Delay (with LP feedback), PingPongDelay, SchroederReverb
 *  - metering.ts     RmsMeter, PeakMeter (the fake LufsMeter was removed — D5;
 *                    the real ITU meter is master/loudness.ts)
 *  - master/         THE master chain (moved from apps/web psy4 — D1):
 *                    multiband.ts (MultibandCompressor, LR4Crossover,
 *                    BandCompressor, BiquadSection), ott.ts (OTT, with the
 *                    D3 per-channel-expander bug fix), limiter.ts
 *                    (TruePeakLimiter), loudness.ts (ITU-R BS.1770-4
 *                    measureLUFS / lufsToGainOffset)
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
export { ZDFSVF } from './filters-zdf.ts'
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
export { RmsMeter, PeakMeter } from './metering.ts'
export { measureTruePeakDb } from './true-peak.ts'
export type { Voice } from './voicePool.ts'
export { VoicePool } from './voicePool.ts'

// ─── Master chain (D1 — moved from apps/web/src/lib/psy4, one source) ───────

export {
  BiquadSection,
  LR4Crossover,
  BandCompressor,
  MultibandCompressor,
} from './master/multiband.ts'
export type {
  BiquadType as MasterBiquadType,
  BandCompressorOptions,
  BandDynamicsSettings,
  MultibandCompressorOptions,
} from './master/multiband.ts'
export { OTT } from './master/ott.ts'
export type { OTTOptions } from './master/ott.ts'
export { TruePeakLimiter } from './master/limiter.ts'
export type { TruePeakLimiterOptions } from './master/limiter.ts'
export { measureLUFS, lufsToGainOffset } from './master/loudness.ts'
export type { LUFSResult } from './master/loudness.ts'

/** Release version of the foundation (single source of truth — see version.ts). */
export { FOUNDATION_VERSION } from './version.ts'
