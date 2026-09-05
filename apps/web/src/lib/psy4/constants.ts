/**
 * Shared constants for the PSY4 render engine.
 *
 * Phase 1 Day 4: centralized sample-rate default.
 * Previously, `SR = 44100` was hard-coded in 8+ files independently.
 * Now all modules import DEFAULT_SR from here, and accept an `sr` parameter
 * for non-default sample rates (48kHz, 96kHz).
 */

/** Default sample rate (Hz). Matches the audio industry standard. */
export const DEFAULT_SR = 44100

/** Common alternative sample rates for offline rendering. */
export const SR_48K = 48000
export const SR_96K = 96000
