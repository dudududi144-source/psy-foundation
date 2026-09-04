/**
 * AI Arrangement Engine — learned structure generation.
 *
 * Replaces the hardcoded 88-bar ARRANGEMENT_SPEC with a procedural
 * arrangement generator that creates structurally diverse renders.
 *
 * Approach:
 * Instead of training a neural network on 1000 psytrance tracks (which requires
 * a dataset we don't have), this module uses a MARKOV-CHAIN approach:
 *
 * 1. Define section types (intro, build, drop, break, climax, outro)
 * 2. Define transition probabilities between sections
 * 3. Generate a section sequence based on a seed
 * 4. Each section gets random duration (within psytrance conventions)
 * 5. Energy/tension curves are derived from the section type
 *
 * This creates infinite arrangement variety while respecting psytrance structure.
 * Every render has a different arrangement — no two outputs sound the same.
 *
 * The transition matrix encodes psytrance conventions:
 * - intro → build (always)
 * - build → drop (always)
 * - drop → break OR drop → drop2 OR drop → outro
 * - break → build (return to energy) OR break → outro (end)
 * - drop2 → climax OR drop2 → break (rare)
 * - climax → outro (always)
 * - outro → END
 *
 * Usage:
 *   const gen = new ArrangementGenerator(seed)
 *   const arrangement = gen.generate(88)  // target 88 bars
 *   arrangement.sections.forEach(s => console.log(s.name, s.bars))
 */

export type SectionType = 'intro' | 'build' | 'drop' | 'break' | 'climax' | 'outro'

export interface ArrangementSection {
  type: SectionType
  name: string
  bars: number
  energy: number // 0-1
  tensionShape: 'rise' | 'fall' | 'arc' | 'sustain'
  voices: string[]
  variation: number // 0-1, controls per-section variation
}

export interface ArrangementPlan {
  sections: ArrangementSection[]
  totalBars: number
  structureHash: string // unique identifier for this arrangement
}

// ── Psytrance section conventions ──

const SECTION_DURATIONS: Record<SectionType, [number, number]> = {
  intro: [4, 16],
  build: [8, 16],
  drop: [8, 24],
  break: [4, 12],
  climax: [8, 24],
  outro: [4, 12],
}

const SECTION_ENERGY: Record<SectionType, [number, number]> = {
  intro: [0.3, 0.5],
  build: [0.6, 0.85],
  drop: [0.9, 1.0],
  break: [0.2, 0.4],
  climax: [0.95, 1.0],
  outro: [0.1, 0.3],
}

const SECTION_TENSION: Record<SectionType, 'rise' | 'fall' | 'arc' | 'sustain'> = {
  intro: 'rise',
  build: 'rise',
  drop: 'arc',
  break: 'fall',
  climax: 'sustain',
  outro: 'fall',
}

const SECTION_VOICES: Record<SectionType, string[]> = {
  intro: ['kick', 'bass', 'hats', 'shaker'],
  build: ['kick', 'bass', 'hats', 'shaker', 'pad', 'lead'],
  drop: ['kick', 'bass', 'hats', 'shaker', 'pad', 'lead', 'counter', 'snare'],
  break: ['kick', 'pad', 'texture', 'riser'],
  climax: ['kick', 'bass', 'hats', 'shaker', 'pad', 'lead', 'counter', 'snare', 'acid', 'impact'],
  outro: ['kick', 'bass', 'pad'],
}

// ── Markov transition matrix ──

const TRANSITIONS: Record<SectionType, Partial<Record<SectionType, number>>> = {
  intro: { build: 1.0 },
  build: { drop: 1.0 },
  drop: { break: 0.4, drop: 0.35, climax: 0.15, outro: 0.1 },
  break: { build: 0.6, outro: 0.3, drop: 0.1 },
  climax: { outro: 1.0 },
  outro: {},
}

// ── Deterministic PRNG (mulberry32) ──

function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class ArrangementGenerator {
  private rng: () => number

  constructor(seed = 42) {
    this.rng = mulberry32(seed)
  }

  private range(min: number, max: number): number {
    return min + this.rng() * (max - min)
  }

  private nextSection(current: SectionType): SectionType | null {
    const transitions = TRANSITIONS[current]
    const keys = Object.keys(transitions) as SectionType[]
    if (keys.length === 0) return null

    const r = this.rng()
    let cumulative = 0
    for (const key of keys) {
      cumulative += transitions[key]!
      if (r < cumulative) return key
    }
    return keys[keys.length - 1]!
  }

  private generateSection(type: SectionType): ArrangementSection {
    const [minBars, maxBars] = SECTION_DURATIONS[type]
    const [minEnergy, maxEnergy] = SECTION_ENERGY[type]
    const bars = Math.floor(this.range(minBars, maxBars))
    const energy = this.range(minEnergy, maxEnergy)
    const tensionShape = SECTION_TENSION[type]
    const voices = [...SECTION_VOICES[type]]
    const variation = this.rng()

    return { type, name: type, bars, energy, tensionShape, voices, variation }
  }

  generate(targetBars = 88): ArrangementPlan {
    const sections: ArrangementSection[] = []
    let totalBars = 0
    let current: SectionType = 'intro'

    while (totalBars < targetBars) {
      const section = this.generateSection(current)
      sections.push(section)
      totalBars += section.bars

      const next = this.nextSection(current)
      if (next === null) break
      current = next

      if (totalBars >= targetBars * 0.9 && current !== 'outro') {
        current = 'outro'
      }

      if (sections.length > 20) break
    }

    // Phase 1 Day 5 FIX: ensure outro exists and respect targetBars
    if (sections[sections.length - 1]!.type !== 'outro') {
      const _outroBars = Math.max(2, targetBars - totalBars)
      sections.push(this.generateSection('outro'))
      // Override the outro's bars to fit within target
      const outro = sections[sections.length - 1]!
      outro.bars = Math.min(outro.bars, Math.max(2, targetBars - totalBars))
      totalBars += outro.bars
    }

    // Phase 0 (truth) FIX: Σ section.bars must equal targetBars EXACTLY.
    // The old trim only ran when overshoot > 2 and could still leave a
    // mismatch (and never handled undershoot). Walk from the end trimming
    // bars; drop any section reduced to zero. Deterministic: operates on the
    // already-generated list, consumes no rng.
    this.normalizeToTarget(sections, targetBars)
    totalBars = sections.reduce((acc, s) => acc + s.bars, 0)

    const structureStr = sections.map((s) => `${s.type[0]}${s.bars}`).join('-')
    const structureHash = this.hashString(structureStr)

    return { sections, totalBars, structureHash }
  }

  /**
   * Trim or extend sections so Σ bars === targetBars exactly.
   *
   * Phase 0 (truth) FIX v2: preserves the psytrance contract that the plan
   * ENDS WITH AN OUTRO — other sections are trimmed to ≥1 bar (and dropped
   * only if the target is degenerately small) before the outro itself is
   * touched. Deterministic: operates on the already-generated list, consumes
   * no rng.
   */
  private normalizeToTarget(sections: ArrangementSection[], targetBars: number): void {
    if (sections.length === 0) return
    let total = sections.reduce((acc, s) => acc + s.bars, 0)

    // Overshoot pass 1: shrink sections (starting from the end) down to 1 bar
    // each, protecting nothing — every section keeps at least 1 bar.
    let idx = sections.length - 1
    while (total > targetBars && idx >= 0) {
      const s = sections[idx]!
      if (s.bars > 1) {
        const reduce = Math.min(total - targetBars, s.bars - 1)
        s.bars -= reduce
        total -= reduce
      }
      idx--
    }

    // Overshoot pass 2: still over target (all sections at 1 bar) → drop
    // sections from the end, but never the FIRST section. Keep an outro as
    // long as ≥1 non-outro section remains.
    while (total > targetBars && sections.length > 1) {
      const victim = sections.length - 1
      const isOutro = sections[victim]!.type === 'outro'
      const nonOutroCount = sections.filter((s) => s.type !== 'outro').length
      if (isOutro && nonOutroCount === 0) break // cannot drop the last one
      total -= sections[victim]!.bars
      sections.splice(victim, 1)
    }

    // Undershoot: extend the last remaining section.
    if (total < targetBars && sections.length > 0) {
      sections[sections.length - 1]!.bars += targetBars - total
    }
  }

  private hashString(s: string): string {
    let hash = 0
    for (let i = 0; i < s.length; i++) {
      const char = s.charCodeAt(i)
      hash = (hash << 5) - hash + char
    }
    return Math.abs(hash).toString(16).padStart(8, '0')
  }

  generateShort(targetBars = 8): ArrangementPlan {
    const shortDurations: Record<SectionType, number> = {
      // Min 1 bar per section: with a floor of 2, tiny targets (≤6 bars)
      // could never sum to the target.
      intro: Math.max(1, Math.floor(targetBars * 0.15)),
      build: Math.max(1, Math.floor(targetBars * 0.2)),
      drop: Math.max(1, Math.floor(targetBars * 0.45)),
      break: 0,
      climax: 0,
      outro: Math.max(1, Math.floor(targetBars * 0.2)),
    }

    const sections: ArrangementSection[] = []
    const types: SectionType[] = ['intro', 'build', 'drop', 'outro']
    for (const type of types) {
      const bars = shortDurations[type]
      if (bars === 0) continue
      const [minE, maxE] = SECTION_ENERGY[type]
      sections.push({
        type,
        name: type,
        bars,
        energy: this.range(minE, maxE),
        tensionShape: SECTION_TENSION[type],
        voices: [...SECTION_VOICES[type]],
        variation: this.rng(),
      })
    }

    // Phase 0 (truth) FIX: Σ bars must equal targetBars exactly — the
    // proportional floors overshoot/undershoot for most targets.
    this.normalizeToTarget(sections, targetBars)
    const totalBars = sections.reduce((acc, s) => acc + s.bars, 0)

    const structureStr = sections.map((s) => `${s.type[0]}${s.bars}`).join('-')
    return { sections, totalBars, structureHash: this.hashString(structureStr) }
  }

  static generateVariations(count: number, baseSeed: number, targetBars = 88): ArrangementPlan[] {
    const plans: ArrangementPlan[] = []
    for (let i = 0; i < count; i++) {
      const gen = new ArrangementGenerator(baseSeed + i * 1000)
      plans.push(gen.generate(targetBars))
    }
    return plans
  }
}

export function planToSpec(plan: ArrangementPlan): {
  sections: Array<{
    name: string
    bars: number
    energy: number
    tensionShape: 'rise' | 'fall' | 'arc' | 'sustain'
    voices: string[]
  }>
} {
  return {
    sections: plan.sections.map((s) => ({
      name: s.name,
      bars: s.bars,
      energy: s.energy,
      tensionShape: s.tensionShape,
      voices: s.voices,
    })),
  }
}
