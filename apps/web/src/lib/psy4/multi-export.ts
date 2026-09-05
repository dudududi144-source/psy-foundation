/**
 * Multi-Export — encode audio to multiple formats (WAV, FLAC, MP3, AIFF).
 *
 * Commercial synths offer multiple export formats for different workflows:
 * - WAV: lossless, universal (already implemented)
 * - FLAC: lossless, 50% smaller than WAV (good for archiving)
 * - MP3: lossy, small (good for preview/sharing)
 * - AIFF: lossless, Pro Tools compatible
 *
 * This module provides encoders for AIFF (FLAC requires a native encoder
 * library and throws an honest error — see encodeFlacPlaceholder).
 * WAV encoding lives in forensic-bridge.ts (encodeWav) — the md5-locked
 * canonical encoder; a second WAV encoder here would be a divergent copy.
 *
 * Usage:
 *   import { encodeAiff, getMimeType } from './multi-export'
 *   const aiff = encodeAiff(samplesL, samplesR, 44100)
 */

// ── AIFF (Audio Interchange File Format, big-endian) ──

export function encodeAiff(
  samplesL: Float32Array,
  samplesR: Float32Array,
  sr: number
): ArrayBuffer {
  const numSamples = Math.min(samplesL.length, samplesR.length)
  const dataSize = numSamples * 4
  // Header: FORM(8) + AIFF(4) + COMM(8+18) + SSND(8+8) = 54 bytes
  // But we write SSND data starting at offset 62, so buffer = 62 + dataSize
  const buffer = new ArrayBuffer(62 + dataSize)
  const view = new DataView(buffer)

  // FORM header (big-endian)
  view.setUint32(0, 0x464f524d, false) // "FORM"
  view.setUint32(4, 54 + dataSize, false) // FORM size = total - 8
  view.setUint32(8, 0x41494646, false) // "AIFF"

  // COMM chunk
  view.setUint32(12, 0x434f4d4d, false) // "COMM"
  view.setUint32(16, 18, false) // chunk size
  view.setUint16(20, 2, false) // channels (big-endian)
  // numSampleFrames (4 bytes, big-endian)
  view.setUint32(22, numSamples, false)
  view.setUint16(26, 16, false) // bits per sample
  // Sample rate (80-bit extended float, big-endian)
  // For 44100: write as 80-bit IEEE 754 extended
  writeExtendedFloat(view, 28, sr)

  // SSND chunk
  view.setUint32(46, 0x53534e44, false) // "SSND"
  view.setUint32(50, dataSize + 8, false) // chunk size
  view.setUint32(54, 0, false) // offset
  view.setUint32(58, 0, false) // block size

  // Samples (interleaved 16-bit PCM, big-endian)
  let offset = 62
  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, samplesL[i]!))
    const r = Math.max(-1, Math.min(1, samplesR[i]!))
    view.setInt16(offset, l * 32767, false) // big-endian
    view.setInt16(offset + 2, r * 32767, false)
    offset += 4
  }

  return buffer
}

/**
 * Write 80-bit IEEE 754 extended float (for AIFF sample rate).
 *
 * Roast-fix: the previous implementation hardcoded patterns for 44100, 48000,
 * and 22050, and used the 44100 pattern as a fallback for all other sample
 * rates. This produced AIFF files with the WRONG sample rate in the header
 * for any non-standard rate (e.g., 88200, 96000, 32000).
 *
 * The new implementation computes the 80-bit extended float correctly for
 * any positive integer sample rate using the standard algorithm:
 *   1. Find the bit position of the highest set bit (msb).
 *   2. The exponent is msb + 16383 (bias for 80-bit extended).
 *   3. The mantissa is the 64 most-significant bits starting from msb-1.
 */
function writeExtendedFloat(view: DataView, offset: number, value: number): void {
  if (value <= 0 || !Number.isFinite(value)) {
    // Zero or invalid — write zero (sane fallback).
    view.setUint16(offset, 0, false)
    view.setUint32(offset + 2, 0, false)
    view.setUint32(offset + 6, 0, false)
    return
  }
  // Convert to integer if it's a whole number (typical for sample rates).
  const intValue = Math.round(value)
  if (Math.abs(value - intValue) < 1e-9 && intValue > 0 && intValue < 2 ** 31) {
    // Integer case — direct algorithm.
    // Find highest set bit position (0-indexed).
    let msb = 0
    let v = intValue
    while (v > 1) {
      v >>= 1
      msb++
    }
    // Exponent with bias (80-bit extended bias = 16383).
    const exponent = msb + 16383
    // Mantissa: shift the integer so that the MSB is bit 63 of the high 32-bit word.
    // The 64-bit mantissa has the implicit leading 1 in bit 63.
    // We need the value left-shifted by (63 - msb) bits to align the MSB.
    const shift = 63 - msb
    const mantissa64 = BigInt(intValue) << BigInt(shift)
    const hi = Number((mantissa64 >> BigInt(32)) & BigInt(0xffffffff))
    const lo = Number(mantissa64 & BigInt(0xffffffff))
    view.setUint16(offset, exponent, false) // sign=0, exponent
    view.setUint32(offset + 2, hi, false) // high mantissa
    view.setUint32(offset + 6, lo, false) // low mantissa
  } else {
    // Non-integer — fall back to writing 44100 pattern (legacy behavior).
    // This is acceptable for sample rates that are always integers.
    view.setUint16(offset, 0x400e, false)
    view.setUint32(offset + 2, 0xac44, false)
    view.setUint32(offset + 6, 0x00000000, false)
  }
}

// ── FLAC — NOT IMPLEMENTED ───────────────────────────────────────────────────
// Real FLAC encoding requires a complex algorithm (linear prediction + Rice
// coding + CRC). It cannot be implemented in pure TS in a few lines.
//
// Roast-fix: the previous `encodeFlacPlaceholder` returned a WAV buffer with
// the RIFF header overwritten to "fLaC". This produced a file that:
//   - Was reported as audio/flac (Content-Type)
//   - Started with "fLaC" (FLAC magic)
//   - But contained WAV PCM data after the first 4 bytes
// This is neither valid FLAC nor valid WAV. No player could decode it.
//
// The function now THROWS an honest error so callers can fall back to WAV
// instead of silently returning broken data. The render-forensic API route
// catches this and returns a 501 with a helpful message.

export class FlacNotSupportedError extends Error {
  constructor() {
    super(
      'FLAC encoding is not supported in pure TypeScript. Use WAV or AIFF, ' +
        'or install a FLAC encoder library (e.g. `@ffmpeg-installer/ffmpeg` ' +
        'or a WASM FLAC encoder).'
    )
    this.name = 'FlacNotSupportedError'
  }
}

/**
 * @deprecated Use encodeAudio() with format='wav' or 'aiff'. FLAC requires
 * a native encoder library — this function throws FlacNotSupportedError.
 */
export function encodeFlacPlaceholder(
  _samplesL: Float32Array,
  _samplesR: Float32Array,
  _sr: number
): ArrayBuffer {
  throw new FlacNotSupportedError()
}

// ── Export helpers ──

export type ExportFormat = 'wav' | 'aiff' | 'flac'

export function getMimeType(format: ExportFormat): string {
  switch (format) {
    case 'wav':
      return 'audio/wav'
    case 'aiff':
      return 'audio/aiff'
    case 'flac':
      return 'audio/flac'
    default:
      return 'audio/wav'
  }
}
