/**
 * Preset Manager — save/load/share PSY4 patches as JSON.
 *
 * Commercial synths (Serum, Vital) have 1000+ factory presets.
 * Users need to save/load/share patches — without this, the synth is a toy.
 *
 * Preset format (JSON):
 * {
 *   name: "Full-On Lead",
 *   category: "Lead",
 *   voice: "lead",           // which voice this preset is for
 *   params: { cutoff: 4200, gain: 0.6, ... },
 *   modulationRoutes: [...],
 *   masterSettings: { lufs: -11, ... }
 * }
 *
 * Usage:
 *   const pm = new PresetManager()
 *   pm.save(preset)  // saves to localStorage
 *   const preset = pm.load('Full-On Lead')
 *   pm.export(preset)  // downloads .psy4 file
 *   pm.import(file)   // reads .psy4 file
 */

export interface Preset {
  id: string               // unique identifier
  name: string            // display name
  category: string         // 'Kick' | 'Bass' | 'Lead' | 'Pad' | 'Acid' | 'Master' | 'Custom'
  voice: string           // which voice type
  description: string     // user notes
  params: Record<string, number>   // voice-specific params
  modulationRoutes?: Array<{ source: string; destination: string; amount: number }>
  masterSettings?: Record<string, number>
  createdAt: number      // timestamp
  updatedAt: number      // timestamp
}

export interface PresetCategory {
  name: string
  presets: Preset[]
}

const STORAGE_KEY = 'psy4-presets'
const PRESET_VERSION = '1.0'

// ── Factory presets (built-in) ──

export const FACTORY_PRESETS: Preset[] = [
  // Kick presets
  {
    id: 'factory-kick-fullon',
    name: 'Full-On Kick',
    category: 'Kick',
    voice: 'kick',
    description: 'Punchy full-on psytrance kick with strong sub',
    params: { fundamental: 38, subDecay: 0.25, subLevel: 1.0, midDecay: 0.05, midLevel: 0.5, clickDecay: 0.002, clickLevel: 0.35, saturation: 1.8 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'factory-kick-darkpsy',
    name: 'Darkpsy Kick',
    category: 'Kick',
    voice: 'kick',
    description: 'Dark, fast-decay kick for darkpsy',
    params: { fundamental: 42, subDecay: 0.18, subLevel: 0.9, midDecay: 0.04, midLevel: 0.4, clickDecay: 0.001, clickLevel: 0.45, saturation: 2.2 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  // Bass presets
  {
    id: 'factory-bass-rolling',
    name: 'Rolling Bass',
    category: 'Bass',
    voice: 'bass',
    description: 'Classic psytrance rolling 16th bass',
    params: { subLevel: 0.5, bodyLevel: 0.45, characterLevel: 0.15, cutoffStart: 1200, cutoffEnd: 150, res: 0.3, pluckDecay: 0.05 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'factory-bass-progressive',
    name: 'Progressive Bass',
    category: 'Bass',
    voice: 'bass',
    description: 'Smoother, longer decay for progressive psytrance',
    params: { subLevel: 0.4, bodyLevel: 0.55, characterLevel: 0.2, cutoffStart: 1000, cutoffEnd: 200, res: 0.25, pluckDecay: 0.08 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  // Lead presets
  {
    id: 'factory-lead-fullon',
    name: 'Full-On Lead',
    category: 'Lead',
    voice: 'lead',
    description: 'Bright, energetic lead for full-on psytrance',
    params: { cutoff: 4200, gain: 0.6, octaveLevel: 0.6, airLevel: 0.12, fmLevel: 0.35, detune: 12, res: 0.7 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'factory-lead-psychedelic',
    name: 'Psychedelic Lead',
    category: 'Lead',
    voice: 'lead',
    description: 'FM-heavy lead with modulation',
    params: { cutoff: 3800, gain: 0.55, octaveLevel: 0.5, airLevel: 0.1, fmLevel: 0.5, detune: 18, res: 0.8 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  // Acid presets
  {
    id: 'factory-acid-303',
    name: 'TB-303 Acid',
    category: 'Acid',
    voice: 'acid',
    description: 'Classic TB-303 squelch',
    params: { cutoff: 800, res: 0.85, lfoRate: 2.0, lfoDepth: 0.7, envAmount: 2.0, distortion: 3.0 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'factory-acid-dark',
    name: 'Dark Acid',
    category: 'Acid',
    voice: 'acid',
    description: 'Darker, slower acid for darkpsy',
    params: { cutoff: 600, res: 0.9, lfoRate: 1.2, lfoDepth: 0.8, envAmount: 2.5, distortion: 4.0 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  // Pad presets
  {
    id: 'factory-pad-atmosphere',
    name: 'Atmosphere Pad',
    category: 'Pad',
    voice: 'pad',
    description: 'Evolving atmospheric pad',
    params: { cutoff: 600, res: 0.3, filterLfoRate: 0.15, filterLfoDepth: 0.5, shimmerLevel: 0.3, attack: 0.3, release: 0.4 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  // Master presets
  {
    id: 'factory-master-club',
    name: 'Club Master',
    category: 'Master',
    voice: 'master',
    description: 'Loud club-ready master chain',
    params: { targetLufs: -11, ceiling: 0.89, stereoWidth: 1.4, monoBelowHz: 120 },
    masterSettings: { glueRatio: 2.0, glueMakeup: 1.3, satAmount: 0.15 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'factory-master-streaming',
    name: 'Streaming Master',
    category: 'Master',
    voice: 'master',
    description: 'Streaming-optimized master (-14 LUFS)',
    params: { targetLufs: -14, ceiling: 0.95, stereoWidth: 1.2, monoBelowHz: 100 },
    masterSettings: { glueRatio: 1.5, glueMakeup: 1.1, satAmount: 0.1 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

export class PresetManager {
  private presets: Map<string, Preset> = new Map()

  constructor() {
    this.loadFromStorage()
    // Ensure factory presets are always available
    for (const preset of FACTORY_PRESETS) {
      if (!this.presets.has(preset.id)) {
        this.presets.set(preset.id, preset)
      }
    }
  }

  /** Get all presets (factory + user) */
  getAll(): Preset[] {
    return Array.from(this.presets.values()).sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category)
      return a.name.localeCompare(b.name)
    })
  }

  /** Get presets by category */
  getByCategory(category: string): Preset[] {
    return this.getAll().filter(p => p.category === category)
  }

  /** Get preset by ID */
  get(id: string): Preset | undefined {
    return this.presets.get(id)
  }

  /** Get categories list */
  getCategories(): string[] {
    const cats = new Set<string>()
    for (const p of this.presets.values()) cats.add(p.category)
    return Array.from(cats).sort()
  }

  /** Save a new or updated preset */
  save(preset: Preset): void {
    preset.updatedAt = Date.now()
    this.presets.set(preset.id, preset)
    this.saveToStorage()
  }

  /** Create a new preset from current params */
  create(name: string, category: string, voice: string, params: Record<string, number>, description: string = ''): Preset {
    const preset: Preset = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      category,
      voice,
      description,
      params,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.save(preset)
    return preset
  }

  /** Delete a preset by ID (factory presets cannot be deleted) */
  delete(id: string): boolean {
    const preset = this.presets.get(id)
    if (!preset || preset.id.startsWith('factory-')) return false
    this.presets.delete(id)
    this.saveToStorage()
    return true
  }

  /** Export preset to JSON file */
  export(preset: Preset): void {
    const data = {
      version: PRESET_VERSION,
      preset,
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${preset.name.replace(/\s+/g, '-')}.psy4.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  /** Import preset from JSON file */
  async import(file: File): Promise<Preset | null> {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!data.preset || !data.preset.name || !data.preset.params) {
        throw new Error('Invalid preset file format')
      }
      // Generate new ID to avoid conflicts
      const preset: Preset = {
        ...data.preset,
        id: `imported-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      this.save(preset)
      return preset
    } catch (e) {
      console.error('Preset import failed:', e)
      return null
    }
  }

  /** Search presets by name/description */
  search(query: string): Preset[] {
    const q = query.toLowerCase()
    return this.getAll().filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    )
  }

  private loadFromStorage(): void {
    if (typeof localStorage === 'undefined') return
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored)
        if (data.presets && Array.isArray(data.presets)) {
          for (const p of data.presets) {
            this.presets.set(p.id, p)
          }
        }
      }
    } catch (e) {
      console.error('Failed to load presets from storage:', e)
    }
  }

  private saveToStorage(): void {
    if (typeof localStorage === 'undefined') return
    try {
      const data = {
        version: PRESET_VERSION,
        presets: Array.from(this.presets.values()),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.error('Failed to save presets to storage:', e)
    }
  }

  /** Get preset count */
  get count(): number { return this.presets.size }

  /** Check if preset is factory (read-only) */
  isFactory(id: string): boolean { return id.startsWith('factory-') }
}
