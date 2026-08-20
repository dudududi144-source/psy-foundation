/**
 * PSY Design System — shared visual language for the PSY device family.
 *
 * Inspired by PsySynthPro's hardware synth aesthetic:
 * - Dark chassis with radial gradients
 * - OLED-style display panels
 * - Brushed metal textures
 * - Wood cheek accents
 * - Precision knobs and meters
 *
 * Adapted for psy-foundation as a render engine dashboard:
 * - Cyan accents for reference/analysis data
 * - Violet accents for harmony/musical data
 * - Emerald accents for scores/success
 * - Rose accents for failures/warnings
 *
 * Usage: import { DESIGN } from './design-system'
 * Then use DESIGN.colors, DESIGN.gradients, DESIGN.shadows in components.
 */

export const DESIGN = {
  // ─── Color Palette ───
  colors: {
    // Backgrounds
    bgDeep: '#08090d',
    bgDark: '#0d0f14',
    bgPanel: '#14161c',
    bgCard: '#191c22',
    bgElevated: '#23262d',

    // Accents
    cyan: '#00e5ff', // reference/analysis
    cyanDim: '#00b8cc',
    violet: '#a78bfa', // harmony/musical
    violetDim: '#7c3aed',
    emerald: '#10b981', // scores/success
    emeraldDim: '#059669',
    amber: '#f59e0b', // warnings
    rose: '#f43f5e', // failures
    zinc: '#71717a', // neutral
    zincDim: '#3f3f46',

    // Text
    textPrimary: '#fafafa',
    textSecondary: '#a1a1aa',
    textTertiary: '#52525b',
  },

  // ─── Gradients ───
  gradients: {
    // Background — deep space with subtle color pools
    background: `
      radial-gradient(1100px 500px at 15% -10%, rgba(96, 60, 180, 0.12) 0%, transparent 60%),
      radial-gradient(900px 500px at 85% 110%, rgba(20, 120, 130, 0.08) 0%, transparent 60%),
      linear-gradient(180deg, #0d0f14 0%, #08090d 100%)
    `,

    // Chassis — brushed metal
    chassis: `
      repeating-linear-gradient(90deg, rgba(255,255,255,0.012) 0 1px, transparent 1px 3px),
      linear-gradient(180deg, #23262d 0%, #191c22 12%, #14161c 55%, #0f1116 100%)
    `,

    // OLED display — dark cyan glow
    oled: `linear-gradient(180deg, #03131a 0%, #020a0f 100%)`,

    // Wood cheeks
    wood: `
      repeating-linear-gradient(90deg, rgba(0,0,0,0.16) 0 2px, transparent 2px 6px),
      repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 14px),
      linear-gradient(90deg, #4d3117, #7a4f28 28%, #5d3c1c 72%, #3d2611)
    `,
  },

  // ─── Shadows ───
  shadows: {
    // Chassis depth
    chassis: `
      0 40px 80px rgba(0,0,0,0.7),
      0 0 0 1px rgba(255,255,255,0.04) inset,
      0 2px 0 rgba(255,255,255,0.05) inset,
      0 -3px 0 rgba(0,0,0,0.6) inset
    `,

    // Panel elevation
    panel: `
      0 4px 12px rgba(0,0,0,0.4),
      0 0 0 1px rgba(255,255,255,0.03) inset
    `,

    // OLED glow
    oled: `
      inset 0 0 24px rgba(0, 229, 255, 0.07),
      inset 0 3px 10px rgba(0,0,0,0.9),
      0 1px 0 rgba(255,255,255,0.05)
    `,
  },

  // ─── Typography ───
  fonts: {
    sans: "'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', 'Courier New', monospace",
  },

  // ─── Component Presets ───
  components: {
    // Metric card
    metricCard: {
      container: 'rounded-lg border p-4 backdrop-blur-sm',
      label: 'text-xs uppercase tracking-wider font-medium',
      value: 'text-2xl font-semibold tabular-nums',
      sublabel: 'text-xs mt-0.5',
    },

    // Score badge
    scoreBadge: (score: number) => {
      const color = score > 0.7 ? 'emerald' : score > 0.5 ? 'amber' : 'rose'
      return {
        color,
        className: `text-3xl font-bold tabular-nums text-${color}-400`,
      }
    },

    // Progress bar
    progressBar: (value: number, invert = false) => {
      const good = invert ? value < 0.5 : value > 0.5
      const color = good ? 'bg-emerald-500' : value > 0.3 ? 'bg-amber-500' : 'bg-rose-500'
      return { color, pct: Math.round(value * 100) }
    },
  },

  // ─── Voice Type Colors ───
  voiceColors: {
    kick: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400' },
    bass: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400' },
    lead: { bg: 'bg-violet-500/10', border: 'border-violet-500/30', text: 'text-violet-400' },
    pad: { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-400' },
    acid: { bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/30', text: 'text-fuchsia-400' },
    texture: { bg: 'bg-teal-500/10', border: 'border-teal-500/30', text: 'text-teal-400' },
    hat: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-400' },
    snare: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400' },
    shaker: { bg: 'bg-lime-500/10', border: 'border-lime-500/30', text: 'text-lime-400' },
    sub: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400' },
    riser: { bg: 'bg-sky-500/10', border: 'border-sky-500/30', text: 'text-sky-400' },
    impact: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400' },
  },
} as const

// ─── Design Presets for Future Devices ───

export interface DeviceDesignPreset {
  name: string
  device: string
  accentColor: string
  bgGradient: string
  panelStyle: string
  meterColor: string
}

export const DEVICE_PRESETS: DeviceDesignPreset[] = [
  {
    name: 'Render Engine',
    device: 'psy-foundation',
    accentColor: DESIGN.colors.emerald,
    bgGradient: DESIGN.gradients.background,
    panelStyle: 'chassis',
    meterColor: DESIGN.colors.cyan,
  },
  {
    name: 'Drum Device',
    device: 'psydrum',
    accentColor: DESIGN.colors.amber,
    bgGradient: DESIGN.gradients.background,
    panelStyle: 'chassis',
    meterColor: DESIGN.colors.amber,
  },
  {
    name: 'Synth Device',
    device: 'psysynth',
    accentColor: DESIGN.colors.violet,
    bgGradient: DESIGN.gradients.background,
    panelStyle: 'chassis',
    meterColor: DESIGN.colors.violet,
  },
  {
    name: 'Performance Platform',
    device: 'psystar',
    accentColor: DESIGN.colors.cyan,
    bgGradient: DESIGN.gradients.background,
    panelStyle: 'chassis',
    meterColor: DESIGN.colors.cyan,
  },
  {
    name: 'Live Synth',
    device: 'psysynthpro',
    accentColor: '#00e5ff',
    bgGradient: DESIGN.gradients.background,
    panelStyle: 'chassis',
    meterColor: '#00e5ff',
  },
]
