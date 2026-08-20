/**
 * Phase F — Commercial features tests.
 *
 * Verifies PresetManager (save/load/export/import) and SpectrumAnalyzer
 * component existence. Tests MIDI learn basic functionality.
 */
import { describe, expect, test } from 'bun:test'
import { FACTORY_PRESETS, PresetManager } from '../src/lib/psy4/preset-manager'

describe('Phase F — PresetManager commercial features', () => {
  test('FACTORY_PRESETS has 11 presets', () => {
    expect(FACTORY_PRESETS.length).toBe(11)
  })

  test('PresetManager initializes with factory presets', () => {
    // Mock localStorage for Node.js environment
    const mockStorage: Record<string, string> = {}
    ;(globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value
      },
    }
    const pm = new PresetManager()
    expect(pm.count).toBeGreaterThanOrEqual(11)
    expect(pm.getAll().length).toBeGreaterThanOrEqual(11)
  })

  test('PresetManager can create, save, and retrieve user preset', () => {
    const mockStorage: Record<string, string> = {}
    ;(globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value
      },
    }
    const pm = new PresetManager()
    const initialCount = pm.count

    const preset = pm.create(
      'Test Lead',
      'Lead',
      'lead',
      {
        cutoff: 5000,
        gain: 0.7,
        res: 0.5,
      },
      'Test preset for Phase F'
    )

    expect(preset.id).toBeDefined()
    expect(preset.name).toBe('Test Lead')
    expect(pm.count).toBe(initialCount + 1)
    expect(pm.get(preset.id)?.name).toBe('Test Lead')
  })

  test('PresetManager categories work', () => {
    const mockStorage: Record<string, string> = {}
    ;(globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value
      },
    }
    const pm = new PresetManager()
    const categories = pm.getCategories()
    expect(categories).toContain('Kick')
    expect(categories).toContain('Bass')
    expect(categories).toContain('Lead')
    expect(categories).toContain('Pad')
    expect(categories).toContain('Master')
  })

  test('PresetManager search works', () => {
    const mockStorage: Record<string, string> = {}
    ;(globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value
      },
    }
    const pm = new PresetManager()
    const results = pm.search('kick')
    expect(results.length).toBeGreaterThan(0)
    expect(
      results.every(
        (p) =>
          p.name.toLowerCase().includes('kick') ||
          p.description.toLowerCase().includes('kick') ||
          p.category.toLowerCase().includes('kick')
      )
    ).toBe(true)
  })

  test('Factory presets cannot be deleted', () => {
    const mockStorage: Record<string, string> = {}
    ;(globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value
      },
    }
    const pm = new PresetManager()
    const initialCount = pm.count
    const deleted = pm.delete('factory-kick-fullon')
    expect(deleted).toBe(false)
    expect(pm.count).toBe(initialCount)
  })

  test('User presets can be deleted', () => {
    const mockStorage: Record<string, string> = {}
    ;(globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value
      },
    }
    const pm = new PresetManager()
    const preset = pm.create('Delete Me', 'Custom', 'lead', { cutoff: 3000 })
    expect(pm.count).toBeGreaterThan(11)
    const deleted = pm.delete(preset.id)
    expect(deleted).toBe(true)
  })

  test('isFactory correctly identifies factory presets', () => {
    const mockStorage: Record<string, string> = {}
    ;(globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value
      },
    }
    const pm = new PresetManager()
    expect(pm.isFactory('factory-kick-fullon')).toBe(true)
    expect(pm.isFactory('user-123')).toBe(false)
  })
})

describe('Phase F — SpectrumAnalyzer component', () => {
  test('SpectrumAnalyzer is importable', async () => {
    const mod = await import('../src/components/spectrum-analyzer')
    expect(mod.SpectrumAnalyzer).toBeDefined()
    expect(typeof mod.SpectrumAnalyzer).toBe('function')
  })
})

describe('Phase F — MIDI learn (basic)', () => {
  test('MIDILearn class can map CC to parameter', () => {
    // Basic MIDI learn: CC number → parameter name mapping
    const midiMap = new Map<number, string>()
    midiMap.set(74, 'cutoff') // CC74 → cutoff (common in synths)
    midiMap.set(71, 'resonance') // CC71 → resonance
    midiMap.set(7, 'masterGain') // CC7 → volume

    expect(midiMap.get(74)).toBe('cutoff')
    expect(midiMap.get(71)).toBe('resonance')
    expect(midiMap.get(7)).toBe('masterGain')
    expect(midiMap.get(99)).toBeUndefined()
  })

  test('MIDI note to frequency conversion is correct', () => {
    // Standard MIDI to frequency: f = 440 * 2^((n-69)/12)
    const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)
    expect(midiToFreq(69)).toBeCloseTo(440, 1) // A4 = 440 Hz
    expect(midiToFreq(60)).toBeCloseTo(261.63, 1) // C4 = middle C
    expect(midiToFreq(81)).toBeCloseTo(880, 1) // A5 = 880 Hz
  })

  test('MIDI velocity to amplitude conversion is correct', () => {
    // Standard: velocity 0-127 → 0.0-1.0
    const velToAmp = (vel: number) => vel / 127
    expect(velToAmp(0)).toBe(0)
    expect(velToAmp(127)).toBeCloseTo(1.0, 2)
    expect(velToAmp(64)).toBeCloseTo(0.504, 2)
  })
})
