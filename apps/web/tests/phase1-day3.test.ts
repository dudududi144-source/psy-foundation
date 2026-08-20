/**
 * Phase 1 Day 3 — MoogLadder docstring fix + SchroederReverb stereo fix.
 */
import { describe, expect, test } from 'bun:test'
import { MoogLadder } from '../src/lib/psy4/forensic/dsp'
import { SchroederReverb } from '../src/lib/psy4/forensic/mixing'

const SR = 44100

describe('MoogLadder — Phase 1 Day 3 honest docstring', () => {
  test('lowpass attenuates high frequencies', () => {
    const filter = new MoogLadder()
    filter.reset()

    // 2kHz sine, cutoff at 500Hz → should be attenuated
    const n = SR * 0.5
    let outputEnergy = 0
    let inputEnergy = 0
    for (let i = 0; i < n; i++) {
      const x = Math.sin((2 * Math.PI * 2000 * i) / SR) * 0.5
      inputEnergy += x * x
      const out = filter.process(x, 500, 0.3, 1.0, SR)
      outputEnergy += out * out
    }
    // Output should be quieter than input (lowpass filtering 2kHz at 500Hz cutoff)
    expect(outputEnergy).toBeLessThan(inputEnergy * 0.5)
  })

  test('passes low frequencies', () => {
    const filter = new MoogLadder()
    filter.reset()

    // 100Hz sine, cutoff at 2000Hz → should pass through
    const n = SR * 0.5
    let outputEnergy = 0
    for (let i = 0; i < n; i++) {
      const x = Math.sin((2 * Math.PI * 100 * i) / SR) * 0.5
      const out = filter.process(x, 2000, 0.3, 1.0, SR)
      if (i > SR * 0.1) outputEnergy += out * out // skip transient
    }
    // Output should have non-trivial energy (not silenced)
    expect(outputEnergy).toBeGreaterThan(0.001)
  })

  test('resonance boosts cutoff frequency', () => {
    const filterLow = new MoogLadder()
    filterLow.reset()
    const filterHigh = new MoogLadder()
    filterHigh.reset()

    const cutoff = 1000
    const n = SR * 0.5
    let energyLow = 0
    let energyHigh = 0
    for (let i = 0; i < n; i++) {
      const x = Math.sin((2 * Math.PI * cutoff * i) / SR) * 0.3
      const outLow = filterLow.process(x, cutoff, 0.1, 1.0, SR) // low resonance
      const outHigh = filterHigh.process(x, cutoff, 0.9, 1.0, SR) // high resonance
      if (i > SR * 0.1) {
        energyLow += outLow * outLow
        energyHigh += outHigh * outHigh
      }
    }
    // High resonance should boost the signal at cutoff frequency
    expect(energyHigh).toBeGreaterThan(energyLow)
  })

  test('output is finite (no NaN/Infinity)', () => {
    const filter = new MoogLadder()
    for (let i = 0; i < 1000; i++) {
      const x = Math.sin((2 * Math.PI * 440 * i) / SR) * 0.5
      const out = filter.process(x, 1000, 0.7, 1.0, SR)
      expect(Number.isFinite(out)).toBe(true)
    }
  })
})

describe('SchroederReverb — Phase 1 Day 3 true stereo', () => {
  test('produces stereo output (L ≠ R for stereo input)', () => {
    const reverb = new SchroederReverb()
    // Process enough samples to fill the comb delay lines
    let lEnergy = 0
    let rEnergy = 0
    let lMinusR = 0
    let lPlusR = 0
    for (let i = 0; i < SR; i++) {
      // Stereo input: L = 440Hz, R = 660Hz (different frequencies)
      const inL = Math.sin((2 * Math.PI * 440 * i) / SR) * 0.5
      const inR = Math.sin((2 * Math.PI * 660 * i) / SR) * 0.5
      const [outL, outR] = reverb.process(inL, inR, SR)
      lEnergy += outL * outL
      rEnergy += outR * outR
      lMinusR += (outL - outR) * (outL - outR)
      lPlusR += (outL + outR) * (outL + outR)
    }
    // Both channels should have energy
    expect(lEnergy).toBeGreaterThan(0.001)
    expect(rEnergy).toBeGreaterThan(0.001)
    // L and R should be decorrelated (not identical)
    // side energy / (mid+side energy) should be > 0.1
    const stereoRatio = lMinusR / (lMinusR + lPlusR + 1e-12)
    expect(stereoRatio).toBeGreaterThan(0.05) // at least 5% side content
  })

  test('mono input produces similar L/R energy levels', () => {
    const reverb = new SchroederReverb()
    let lEnergy = 0
    let rEnergy = 0
    for (let i = 0; i < SR; i++) {
      const inMono = Math.sin((2 * Math.PI * 440 * i) / SR) * 0.5
      const [outL, outR] = reverb.process(inMono, inMono, SR)
      lEnergy += outL * outL
      rEnergy += outR * outR
    }
    // With identical L and R input, both channels should have similar energy
    // (not identical because different delay lengths create decorrelation)
    const ratio = lEnergy / (rEnergy + 1e-12)
    expect(ratio).toBeGreaterThan(0.5)
    expect(ratio).toBeLessThan(2.0)
  })

  test('output is finite', () => {
    const reverb = new SchroederReverb()
    for (let i = 0; i < 1000; i++) {
      const [outL, outR] = reverb.process(0.5, 0.5, SR)
      expect(Number.isFinite(outL)).toBe(true)
      expect(Number.isFinite(outR)).toBe(true)
    }
  })

  test('NaN input returns zeros (guard)', () => {
    const reverb = new SchroederReverb()
    const [outL, outR] = reverb.process(Number.NaN, 0.5, SR)
    expect(outL).toBe(0)
    expect(outR).toBe(0)
  })

  test('reset clears state', () => {
    const reverb = new SchroederReverb()
    // Process some signal
    for (let i = 0; i < 1000; i++) {
      reverb.process(0.5, 0.5, SR)
    }
    // Reset
    reverb.reset()
    // Output after reset should be very quiet (only the new input)
    let energy = 0
    for (let i = 0; i < 100; i++) {
      const [outL, outR] = reverb.process(0.1, 0.1, SR)
      energy += outL * outL + outR * outR
    }
    // Should be small (no accumulated reverb tail)
    expect(energy / 100).toBeLessThan(0.01)
  })
})
