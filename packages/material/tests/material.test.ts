import { describe, expect, test } from 'bun:test'
import { backbeat, drivingHats, offbeatHats, psyKick } from '@psy-foundation/music'
import type { Material, MaterialType } from '@psy-foundation/protocol'
import {
  type BassPatternPayload,
  type DrumPatternPayload,
  type FXGesturePayload,
  MaterialLibrary,
  type MotifPayload,
  type PresetPayload,
  type RhythmPayload,
  type TexturePayload,
  createMaterial,
  createSeedLibrary,
  makeBassPatternMaterial,
  makeDrumPatternMaterial,
  makeFXGestureMaterial,
  makeMotifMaterial,
  makePresetMaterial,
  makeRhythmMaterial,
  makeTextureMaterial,
} from '../src/index.ts'

// Shared sample payload used by the createMaterial tests.
const sampleMotifPayload = {
  kind: 'motif' as const,
  rootPc: 4,
  scaleName: 'phrygian-dominant',
  notes: [],
}

describe('createMaterial', () => {
  test('builds a Material with full metadata and zeroed usage stats', () => {
    const m = createMaterial({
      id: 'test-m1',
      role: 'lead',
      style: 'phrygian',
      tempoRange: [140, 150],
      keyCompatibility: [4, 9],
      energy: 0.7,
      novelty: 0.3,
      source: 'test',
      confidence: 0.9,
      payload: sampleMotifPayload,
    })
    expect(m.id).toBe('test-m1')
    expect(m.type).toBe('motif')
    expect(m.role).toBe('lead')
    expect(m.style).toBe('phrygian')
    expect(m.tempoRange).toEqual([140, 150])
    expect(m.keyCompatibility).toEqual([4, 9])
    expect(m.energy).toBe(0.7)
    expect(m.novelty).toBe(0.3)
    expect(m.source).toBe('test')
    expect(m.confidence).toBe(0.9)
    expect(m.usageCount).toBe(0)
    expect(m.reward).toBe(0)
    expect(m.lastUsed).toBeNull()
    expect(m.payload).toBe(sampleMotifPayload)
  })

  test('auto-generates unique ids with the kind prefix when no id is given', () => {
    const a = createMaterial({
      role: 'lead',
      style: 'x',
      tempoRange: [120, 160],
      keyCompatibility: [0],
      energy: 0.5,
      novelty: 0.2,
      source: 's',
      confidence: 0.8,
      payload: sampleMotifPayload,
    })
    const b = createMaterial({
      role: 'lead',
      style: 'x',
      tempoRange: [120, 160],
      keyCompatibility: [0],
      energy: 0.5,
      novelty: 0.2,
      source: 's',
      confidence: 0.8,
      payload: sampleMotifPayload,
    })
    expect(a.id).toMatch(/^motif-\d{4}$/)
    expect(b.id).toMatch(/^motif-\d{4}$/)
    expect(a.id).not.toBe(b.id)
  })
})

describe('factory builders', () => {
  test('makeMotifMaterial generates a motif with notes > 0', () => {
    const m = makeMotifMaterial({ rootPc: 4, scaleName: 'phrygian-dominant', seed: 1 })
    expect(m.type).toBe('motif')
    const payload = m.payload as MotifPayload
    expect(payload.kind).toBe('motif')
    expect(payload.rootPc).toBe(4)
    expect(payload.scaleName).toBe('phrygian-dominant')
    expect(payload.notes.length).toBeGreaterThan(0)
  })

  test('makeMotifMaterial throws on an unknown scale', () => {
    expect(() => makeMotifMaterial({ rootPc: 0, scaleName: 'not-a-scale' })).toThrow()
  })

  test('makeBassPatternMaterial produces a bass-pattern payload', () => {
    const m = makeBassPatternMaterial({
      rootPc: 9,
      scaleName: 'phrygian-dominant',
      style: 'kb3',
      seed: 1,
    })
    expect(m.type).toBe('bass-pattern')
    const payload = m.payload as BassPatternPayload
    expect(payload.kind).toBe('bass-pattern')
    expect(payload.rootPc).toBe(9)
    expect(payload.style).toBe('kb3')
    expect(payload.notes.length).toBeGreaterThan(0)
    expect(m.role).toBe('bass')
  })

  test('makeRhythmMaterial wraps a RhythmPattern into a rhythm payload', () => {
    const m = makeRhythmMaterial({ pattern: psyKick(), role: 'kick', energy: 0.8 })
    expect(m.type).toBe('rhythm')
    const payload = m.payload as RhythmPayload
    expect(payload.kind).toBe('rhythm')
    expect(payload.steps).toBe(16)
    expect(payload.hits.length).toBe(16)
    expect(payload.hits.filter((h) => h).length).toBe(4)
    expect(payload.velocities.length).toBe(16)
    expect(payload.micros.length).toBe(16)
    expect(m.role).toBe('kick')
  })

  test('makeDrumPatternMaterial builds a multi-track drum pattern', () => {
    const m = makeDrumPatternMaterial({
      tracks: {
        kick: psyKick(),
        hats: offbeatHats(16),
        snare: backbeat(16),
      },
      role: 'drums',
      style: 'psytrance',
    })
    expect(m.type).toBe('drum-pattern')
    const payload = m.payload as DrumPatternPayload
    expect(payload.kind).toBe('drum-pattern')
    const trackNames = Object.keys(payload.tracks)
    expect(trackNames).toEqual(expect.arrayContaining(['kick', 'hats', 'snare']))
    expect(trackNames.length).toBe(3)
    const kickHits = payload.tracks.kick?.hits
    expect(kickHits).toBeDefined()
    expect(kickHits?.filter((h) => h).length).toBe(4)
  })

  test('makePresetMaterial stores engine + params', () => {
    const m = makePresetMaterial({
      engine: 'psy-lead',
      params: { cutoff: 0.7, resonance: 0.3 },
      role: 'lead',
      style: 'psytrance',
    })
    expect(m.type).toBe('preset')
    const payload = m.payload as PresetPayload
    expect(payload.kind).toBe('preset')
    expect(payload.engine).toBe('psy-lead')
    expect(payload.params.cutoff).toBe(0.7)
    expect(payload.params.resonance).toBe(0.3)
  })

  test('makeFXGestureMaterial stores an automation envelope', () => {
    const m = makeFXGestureMaterial({
      param: 'cutoff',
      points: [
        { t: 0, v: 0 },
        { t: 1, v: 1 },
      ],
      durationSec: 4,
      role: 'fx',
    })
    expect(m.type).toBe('fx-gesture')
    const payload = m.payload as FXGesturePayload
    expect(payload.kind).toBe('fx-gesture')
    expect(payload.param).toBe('cutoff')
    expect(payload.points.length).toBe(2)
    expect(payload.durationSec).toBe(4)
  })

  test('makeTextureMaterial stores partials and optional LFO', () => {
    const m = makeTextureMaterial({
      rootHz: 55,
      partials: [
        { ratio: 1, amp: 1 },
        { ratio: 2, amp: 0.5 },
      ],
      lfo: { rateHz: 0.1, depth: 0.2 },
      role: 'texture',
    })
    expect(m.type).toBe('texture')
    const payload = m.payload as TexturePayload
    expect(payload.kind).toBe('texture')
    expect(payload.rootHz).toBe(55)
    expect(payload.partials.length).toBe(2)
    expect(payload.lfo).toBeDefined()
    expect(payload.lfo?.rateHz).toBe(0.1)
  })
})

describe('MaterialLibrary', () => {
  test('add and get return the stored material', () => {
    const lib = new MaterialLibrary()
    const m = makeMotifMaterial({
      rootPc: 4,
      scaleName: 'phrygian-dominant',
      seed: 1,
      id: 'lib-m1',
    })
    lib.add(m)
    const got = lib.get('lib-m1')
    expect(got).toBeDefined()
    expect(got as Material).toBe(m)
    expect(lib.size).toBe(1)
  })

  test('add throws on duplicate id', () => {
    const lib = new MaterialLibrary()
    const m = makeMotifMaterial({
      rootPc: 4,
      scaleName: 'phrygian-dominant',
      seed: 1,
      id: 'dup',
    })
    lib.add(m)
    expect(() => lib.add(m)).toThrow(/already exists/)
  })

  test('remove deletes a material and returns whether it existed', () => {
    const lib = new MaterialLibrary()
    const m = makeMotifMaterial({
      rootPc: 4,
      scaleName: 'phrygian-dominant',
      seed: 1,
      id: 'rm-1',
    })
    lib.add(m)
    expect(lib.remove('rm-1')).toBe(true)
    expect(lib.get('rm-1')).toBeUndefined()
    expect(lib.size).toBe(0)
    expect(lib.remove('rm-1')).toBe(false)
  })

  test('query by type returns only matching kinds', () => {
    const lib = createSeedLibrary()
    const motifs = lib.query({ type: 'motif' })
    expect(motifs.length).toBe(4)
    for (const m of motifs) {
      expect(m.type).toBe('motif')
    }
  })

  test('query by role filters on the role field', () => {
    const lib = createSeedLibrary()
    const kicks = lib.query({ role: 'kick' })
    expect(kicks.length).toBe(2)
    for (const m of kicks) {
      expect(m.role).toBe('kick')
    }
  })

  test('query by bpm matches materials whose tempoRange contains it', () => {
    const lib = createSeedLibrary()
    const at145 = lib.query({ bpm: 145 })
    expect(at145.length).toBe(lib.size)
    const at100 = lib.query({ bpm: 100 })
    expect(at100.length).toBe(0)
  })

  test('query by rootPc matches materials whose keyCompatibility includes it', () => {
    const lib = createSeedLibrary()
    // rootPc=3 is not a root of any motif/bass but IS in the ALL_PCS default,
    // so it matches the 11 "key-agnostic" materials (5 rhythms + 2 drums + 2 presets + 1 fx + 1 texture).
    const root3 = lib.query({ rootPc: 3 })
    expect(root3.length).toBe(11)
    // rootPc=4 additionally matches 2 motifs + 1 bass = 14 total.
    const root4 = lib.query({ rootPc: 4 })
    expect(root4.length).toBe(14)
  })

  test('markUsed bumps usageCount and updates lastUsed', () => {
    const lib = new MaterialLibrary()
    const m = makeMotifMaterial({
      rootPc: 4,
      scaleName: 'phrygian-dominant',
      seed: 1,
      id: 'used-1',
    })
    lib.add(m)
    lib.markUsed('used-1', 1000)
    lib.markUsed('used-1', 2000)
    const got = lib.get('used-1') as Material
    expect(got.usageCount).toBe(2)
    expect(got.lastUsed).toBe(2000)
  })

  test('addReward accumulates and toJSON/fromJSON round-trips', () => {
    const lib = new MaterialLibrary()
    const m = makeMotifMaterial({
      rootPc: 4,
      scaleName: 'phrygian-dominant',
      seed: 1,
      id: 'rew-1',
    })
    lib.add(m)
    lib.addReward('rew-1', 0.5)
    lib.addReward('rew-1', 0.3)
    const got = lib.get('rew-1') as Material
    expect(got.reward).toBeCloseTo(0.8, 5)

    // Round-trip the whole seed library through JSON.
    const seed = createSeedLibrary()
    const json = seed.toJSON()
    const restored = MaterialLibrary.fromJSON(json)
    expect(restored.size).toBe(seed.size)
    const origList = seed.list()
    const restoredList = restored.list()
    expect(restoredList.length).toBe(origList.length)
    for (let i = 0; i < origList.length; i++) {
      const o = origList[i] as Material
      const r = restoredList[i] as Material
      expect(r.id).toBe(o.id)
      expect(r.type).toBe(o.type)
      expect(r.role).toBe(o.role)
      expect(r.energy).toBe(o.energy)
    }
  })
})

describe('createSeedLibrary', () => {
  test('returns a library with at least 15 materials', () => {
    const lib = createSeedLibrary()
    expect(lib.size).toBeGreaterThanOrEqual(15)
    // The spec targets ~18 starter materials.
    expect(lib.size).toBe(18)
  })

  test('contains at least one of each major material type', () => {
    const lib = createSeedLibrary()
    const types = new Set(lib.list().map((m) => m.type))
    const required: MaterialType[] = [
      'motif',
      'bass-pattern',
      'rhythm',
      'drum-pattern',
      'preset',
      'fx-gesture',
      'texture',
    ]
    for (const t of required) {
      expect(types.has(t)).toBe(true)
    }
  })

  test('every material carries valid metadata', () => {
    const lib = createSeedLibrary()
    for (const m of lib.list()) {
      expect(m.tempoRange[0]).toBeLessThanOrEqual(m.tempoRange[1])
      expect(m.energy).toBeGreaterThanOrEqual(0)
      expect(m.energy).toBeLessThanOrEqual(1)
      expect(m.novelty).toBeGreaterThanOrEqual(0)
      expect(m.novelty).toBeLessThanOrEqual(1)
      expect(m.confidence).toBeGreaterThanOrEqual(0)
      expect(m.confidence).toBeLessThanOrEqual(1)
      expect(m.role).toBeTruthy()
      expect(m.style).toBeTruthy()
      expect(m.source).toBeTruthy()
      expect(m.keyCompatibility.length).toBeGreaterThan(0)
      expect(m.usageCount).toBe(0)
      expect(m.reward).toBe(0)
      expect(m.lastUsed).toBeNull()
    }
  })

  test('deterministic across runs: same ids and types in the same order', () => {
    const a = createSeedLibrary().list()
    const b = createSeedLibrary().list()
    expect(b.length).toBe(a.length)
    for (let i = 0; i < a.length; i++) {
      const ai = a[i] as Material
      const bi = b[i] as Material
      expect(bi.id).toBe(ai.id)
      expect(bi.type).toBe(ai.type)
      expect(bi.role).toBe(ai.role)
    }
    // Sanity: ensure we exercised a non-trivial rhythm generator export too.
    const dh = drivingHats(8)
    expect(dh.hits.every((h) => h)).toBe(true)
  })
})
