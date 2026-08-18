/**
 * PSY4 — Canonical Render Engine
 *
 * Architecture:
 *   voice-specs.ts     → Single source of truth for all voice parameters
 *   psy-voices.ts      → Voice implementations (kick, bass, lead, pad, acid, etc.)
 *   forensic-bridge.ts → Main renderer (RawScore → Stereo PCM)
 *   audio-critic.ts    → Audio quality analysis (8 areas, 12 failure codes)
 *
 * DSP primitives (forensic/):
 *   dsp.ts             → Oscillators, filters (ZDF SVF + Moog), envelopes, saturation
 *   prng.ts            → Deterministic PRNG
 *   mixing.ts          → Bus processors, master chain, reverb, delay
 *
 * Master chain modules:
 *   channel-fx.ts       → Per-voice EQ + delay + reverb + pan + width
 *   channel-presets.ts  → Voice-type FX presets
 *   multiband.ts        → 3-band LR4 crossover compressor
 *   ms-processor.ts     → M/S stereo widener (mono <120Hz)
 *   loudness.ts         → ITU-R BS.1770-4 LUFS measurement
 *   limiter.ts          → 4x oversampled true-peak limiter
 *   modulation-matrix.ts → Routable modulation (6 LFOs × 8 destinations)
 *   auto-fixer.ts       → Closed-loop render→critique→fix optimization
 *
 * Consumers: /api/render-forensic, /api/audio-critique, /api/optimize
 */

// Voice specifications (single source of truth)
export { KICK_SPEC, BASS_SPEC, LEAD_SPEC, PAD_SPEC, ACID_SPEC, HAT_SPEC, SNARE_SPEC, BUS_GAINS, MASTER_SPEC, ARRANGEMENT_SPEC } from './voice-specs'
export type { KickSpec, BassSpec, LeadSpec, PadSpec, AcidSpec, HatSpec, SnareSpec, BusGains, MasterSpec, ArrangementSpec } from './voice-specs'

// Voice implementations
export { PsyKick, PsyBass, PsyLead, PsyHat, PsySample, PsySnare, PsySubBass, PsyPad, PsyShaker, PsyAcid, PsyTexture, PsyRiser, PsyImpact } from './psy-voices'

// DSP primitives
export { fastTanh, polyBlep, MoogLadder, ZDFSVF, OnePoleLP, OnePoleHP, PinkNoise, ADSR, DecayEnv, BLSaw, BLSquare, BLTriangle, SineOsc, OversampledSaturation } from './forensic/dsp'
export { Rng } from './forensic/prng'
export { BusProcessor, MasterChain, SchroederReverb, StereoDelay } from './forensic/mixing'

// Render engine
export { renderFoundationSection, encodeWav, DEFAULT_RENDER_CONFIG } from './forensic-bridge'
export type { RenderConfig, RenderResult } from './forensic-bridge'

// Audio analysis
export { critiqueAudio } from './audio-critic'
export type { AudioCritique, AudioFailure } from './audio-critic'

// Master chain
export { ChannelFX } from './channel-fx'
export type { ChannelFXConfig } from './channel-fx'
export { CHANNEL_PRESETS } from './channel-presets'
export type { VoiceType } from './channel-presets'
export { MultibandCompressor } from './multiband'
export { StereoWidener } from './ms-processor'
export { measureLUFS, lufsToGainOffset } from './loudness'
export type { LUFSResult } from './loudness'
export { TruePeakLimiter } from './limiter'
export { ModulationMatrix } from './modulation-matrix'
export type { ModRoute, ModSource, ModDestination } from './modulation-matrix'

// Auto-fixer
export { optimizeRender } from './auto-fixer'
export type { OptimizationReport, OptimizationIteration } from './auto-fixer'

// RenderDevice (PsyDevice consumer)
export { RenderDevice, createRenderDevice } from './render-device'
export type { RenderDeviceOptions, RenderDeviceResult } from './render-device'

// Foundation shim (PsyDevice contract)
export type { PsyDevice, MusicalEvent, NoteEvent, DeviceCapabilities, MusicalContext, MusicalTransport } from './foundation-shim'
export { InMemoryChannel } from './foundation-shim'

// Harmony engine (ported from PSYSTAR)
export { SCALE_INTERVALS, CHORD_INTERVALS, PSYTRANCE_PROGRESSIONS, buildScale, buildScaleSpanning, buildChord, buildChordNamed, diatonicChord, buildProgression, midiToNoteName, midiToFreq, freqToMidi, snapToScale } from './harmony'
export type { ScaleType, ChordType, Chord } from './harmony'

// Humanizer (ported from PSYSTAR)
export { mulberry32, jitterVelocity, driftTime, shouldSkip, humanizeEvents } from './humanizer'
export type { HumanizableEvent } from './humanizer'

// Reference analyzer (from PSYSTAR style_clone concept)
export { analyzeReference, compareProfiles } from './reference-analyzer'
export type { ReferenceProfile, RenderComparison, AnalysisResult } from './reference-analyzer'
