/**
 * Automation Engine — parameter automation with breakpoint curves.
 *
 * Every commercial DAW has automation: draw curves that change parameters
 * over time. PSY4 needs this for professional workflow integration.
 *
 * Features:
 * - Breakpoint curve editor (per parameter)
 * - Envelope lanes (timeline view)
 * - Linear / exponential / bezier interpolation
 * - Export automation as VST parameter changes
 *
 * Usage:
 *   const auto = new AutomationEngine()
 *   auto.addLane('cutoff', [
 *     { time: 0, value: 2000 },
 *     { time: 1.5, value: 6000 },
 *     { time: 3.0, value: 2000 },
 *   ])
 *   const value = auto.getValue('cutoff', 1.0)  // interpolate at 1.0s
 */

export type InterpolationType = 'linear' | 'exponential' | 'step' | 'bezier'

export interface AutomationPoint {
  time: number // seconds
  value: number // parameter value
  interpolation?: InterpolationType // how to interpolate to next point
  tension?: number // for bezier (0-1, 0.5 = smooth)
}

export interface AutomationLane {
  name: string // parameter name (e.g. 'cutoff')
  points: AutomationPoint[] // sorted by time
  minValue: number
  maxValue: number
  defaultValue: number
  unit?: string // 'Hz', '%', etc.
  color?: string // for UI display
}

export class AutomationEngine {
  private lanes: Map<string, AutomationLane> = new Map()
  private listeners: Set<() => void> = new Set()

  /** Add or replace an automation lane */
  addLane(lane: AutomationLane): void {
    // Sort points by time
    lane.points.sort((a, b) => a.time - b.time)
    this.lanes.set(lane.name, lane)
    this.notifyListeners()
  }

  /** Remove a lane */
  removeLane(name: string): boolean {
    const removed = this.lanes.delete(name)
    if (removed) this.notifyListeners()
    return removed
  }

  /** Get a lane by name */
  getLane(name: string): AutomationLane | undefined {
    return this.lanes.get(name)
  }

  /** Get all lanes */
  getLanes(): AutomationLane[] {
    return Array.from(this.lanes.values())
  }

  /** Add a point to a lane */
  addPoint(laneName: string, point: AutomationPoint): void {
    const lane = this.lanes.get(laneName)
    if (!lane) return
    lane.points.push(point)
    lane.points.sort((a, b) => a.time - b.time)
    this.notifyListeners()
  }

  /** Remove a point from a lane by time */
  removePoint(laneName: string, time: number): void {
    const lane = this.lanes.get(laneName)
    if (!lane) return
    lane.points = lane.points.filter((p) => Math.abs(p.time - time) > 0.001)
    this.notifyListeners()
  }

  /**
   * Get the automated value at a specific time.
   * Interpolates between surrounding points.
   */
  getValue(name: string, time: number): number {
    const lane = this.lanes.get(name)
    if (!lane || lane.points.length === 0) return lane?.defaultValue ?? 0

    // Before first point
    if (time <= lane.points[0]!.time) return lane.points[0]!.value

    // After last point
    const last = lane.points[lane.points.length - 1]!
    if (time >= last.time) return last.value

    // Find surrounding points
    let prev = lane.points[0]!
    let next = last
    for (let i = 0; i < lane.points.length - 1; i++) {
      if (lane.points[i]!.time <= time && lane.points[i + 1]!.time > time) {
        prev = lane.points[i]!
        next = lane.points[i + 1]!
        break
      }
    }

    // Interpolate
    const t = (time - prev.time) / (next.time - prev.time || 1)
    const interp = prev.interpolation ?? 'linear'

    switch (interp) {
      case 'linear':
        return prev.value + (next.value - prev.value) * t
      case 'exponential':
        // Exponential interpolation (good for frequency)
        const ratio = prev.value !== 0 ? next.value / prev.value : 1
        return prev.value * Math.pow(ratio, t)
      case 'step':
        return prev.value // Hold until next point
      case 'bezier':
        // Simple bezier with tension
        const tension = prev.tension ?? 0.5
        // Smoothstep interpolation
        const smoothT = t * t * (3 - 2 * t) * tension + t * (1 - tension)
        return prev.value + (next.value - prev.value) * smoothT
      default:
        return prev.value + (next.value - prev.value) * t
    }
  }

  /**
   * Render automation to a parameter array.
   * Samples the automation at a fixed rate.
   */
  renderToParameterArray(name: string, durationSec: number, sampleRate: number): Float32Array {
    const numSamples = Math.floor(durationSec * sampleRate)
    const output = new Float32Array(numSamples)
    for (let i = 0; i < numSamples; i++) {
      const time = i / sampleRate
      output[i] = this.getValue(name, time)
    }
    return output
  }

  /** Get all automated parameter names */
  getAutomatedParameters(): string[] {
    return Array.from(this.lanes.keys())
  }

  /** Check if a parameter is automated */
  isAutomated(name: string): boolean {
    const lane = this.lanes.get(name)
    return lane !== undefined && lane.points.length > 0
  }

  /** Clear all automation */
  clear(): void {
    this.lanes.clear()
    this.notifyListeners()
  }

  /** Export automation as JSON (for saving/loading) */
  exportJSON(): string {
    const data = {
      version: '1.0',
      lanes: Array.from(this.lanes.entries()).map(([name, lane]) => ({
        ...lane,
        name,
      })),
    }
    return JSON.stringify(data, null, 2)
  }

  /** Import automation from JSON */
  importJSON(json: string): boolean {
    try {
      const data = JSON.parse(json)
      if (!data.lanes || !Array.isArray(data.lanes)) return false
      this.lanes.clear()
      for (const lane of data.lanes) {
        this.addLane(lane)
      }
      return true
    } catch {
      return false
    }
  }

  /** Subscribe to changes */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    this.listeners.forEach((l) => l())
  }

  /** Get stats */
  getStats(): { laneCount: number; totalPoints: number } {
    let totalPoints = 0
    for (const lane of this.lanes.values()) {
      totalPoints += lane.points.length
    }
    return { laneCount: this.lanes.size, totalPoints }
  }
}

/**
 * Factory: create default automation lanes for common parameters.
 */
export function createDefaultLanes(): AutomationLane[] {
  return [
    {
      name: 'cutoff',
      points: [
        { time: 0, value: 2000, interpolation: 'exponential' },
        { time: 4, value: 6000, interpolation: 'exponential' },
        { time: 8, value: 2000 },
      ],
      minValue: 200,
      maxValue: 8000,
      defaultValue: 3000,
      unit: 'Hz',
      color: '#00e5ff',
    },
    {
      name: 'leadGain',
      points: [
        { time: 0, value: 0.5 },
        { time: 16, value: 0.8 },
        { time: 32, value: 0.5 },
      ],
      minValue: 0,
      maxValue: 1,
      defaultValue: 0.6,
      unit: '',
      color: '#a78bfa',
    },
    {
      name: 'stereoWidth',
      points: [
        { time: 0, value: 1.0, interpolation: 'bezier', tension: 0.5 },
        { time: 16, value: 1.5 },
        { time: 32, value: 1.0 },
      ],
      minValue: 0.5,
      maxValue: 2.0,
      defaultValue: 1.0,
      unit: '',
      color: '#10b981',
    },
    {
      name: 'targetLufs',
      points: [
        { time: 0, value: -11 },
        { time: 32, value: -9 },
      ],
      minValue: -18,
      maxValue: -6,
      defaultValue: -11,
      unit: 'dB',
      color: '#f59e0b',
    },
  ]
}
