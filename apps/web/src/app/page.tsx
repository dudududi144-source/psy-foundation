'use client'

import type { PSY4AudioEngine, VoiceSection } from '@/lib/psy4/audio-engine'
import { DESIGN } from '@/lib/psy4/design-system'
import { Component, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

interface CritiqueData {
  overallScore: number
  failures: { code: string; severity: number; diagnosis: string; correctionHint: string }[]
  metrics: {
    kickClarity: number
    bassClarity: number
    kickBassSeparation: number
    subMud: number
    punch: number
    attackSharpness: number
    bassDecayOverlap: number
    noteSeparation: number
    onsetClarity: number
    kickBassLock: number
    leadArticulation: number
    melodicClarity: number
    brightness: number
    spectralMovement: number
    lowMidMud: number
    masking: number
    dynamicRange: number
  }
  renderInfo: {
    durationSec: number
    bars: number
    events: number
    sampleRate: number
    stereo: boolean
    samples: boolean
    lufs?: number
    truePeakDb?: number
    samplePeakDb?: number
    stereoWidth?: number
    monoCompatibility?: number
    gainReductionDb?: number
  }
  renderProfile?: {
    bpm: number
    spectralCentroid: number
    bassEnergy: number
    midEnergy: number
    highEnergy: number
    airEnergy: number
    crestFactor: number
    dynamicRange: number
    lowMidMud: number
  }
  harmony?: {
    scale: string
    progression: string[]
    rootNote: string
  }
  version?: string
}

interface OptIteration {
  iteration: number
  configName: string
  score: number
  improvement: number
  failures: { code: string; severity: number }[]
}
interface OptReport {
  initialScore: number
  finalScore: number
  improvement: number
  verdict: string
  durationMs: number
  bestIteration: number
  iterations: OptIteration[]
}

// ── PLAN_V3 4.5/4.6 shared UI infrastructure ───────────────────────────────

/** Session JSON schema (PLAN_V3 4.6). Explicit, versioned, honest about what
 *  it restores: render params + realtime sketchpad state + mixer + preset ref. */
interface SessionProject {
  schema: 'psy-foundation-session'
  version: 1
  savedAt: string
  render: { bars: number; seed: number; useSamples: boolean; preset: string | null }
  realtime: { bpm: number; cutoff: number; resonance: number }
  mixer: Record<VoiceSection, number>
}

const SESSION_SCHEMA = 'psy-foundation-session'
const SESSION_VERSION = 1
const SESSION_LS_KEY = 'psy-session-v1'
const MIXER_SECTIONS: VoiceSection[] = ['lead', 'bass', 'pad', 'acid']

/** Deterministic PRNG for the transport pattern (no Math.random — D6 spirit). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Computer-keyboard → MIDI mapping over the displayed key range. */
const KEY_MAP: Record<string, number> = {
  a: 48,
  w: 49,
  s: 50,
  e: 51,
  d: 52,
  f: 53,
  t: 54,
  g: 55,
  y: 56,
  h: 57,
  u: 58,
  j: 59,
  k: 60,
  o: 61,
  l: 62,
  p: 63,
  ';': 64,
}

interface ToastItem {
  id: number
  kind: 'ok' | 'err'
  msg: string
}

function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div
      aria-live="polite"
      className="fixed bottom-16 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-xs"
    >
      {toasts.map((t) => (
        <output
          key={t.id}
          className={`block rounded-md border px-3 py-2 text-xs font-mono shadow-lg ${
            t.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/90 text-emerald-200'
              : 'border-rose-500/40 bg-rose-950/90 text-rose-200'
          }`}
        >
          {t.msg}
        </output>
      ))}
    </div>
  )
}

/** PLAN_V3 4.5: an error boundary so a render-panel crash shows an honest
 *  message instead of a white page. Class component — React requires it. */
class UIErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override render() {
    if (this.state.error) {
      return (
        <section className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-5">
          <h2
            className="text-base font-semibold text-rose-200"
            style={{ fontFamily: DESIGN.fonts.mono }}
          >
            UI crashed — honest failure
          </h2>
          <p className="mt-2 text-xs text-rose-300/80 font-mono">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-3 rounded-md bg-rose-500 px-3 py-1.5 text-xs font-semibold text-rose-950 hover:bg-rose-400"
          >
            Reset panel
          </button>
        </section>
      )
    }
    return this.state.error === null ? this.props.children : null
  }
}

/** PLAN_V3 4.5 transport: deterministic 16-step pattern from the session seed.
 *  bass < 48 → BassVoice; lead 60-71 → LeadVoice (worklet routing rules). */
function buildPattern(seed: number): Array<{ bass: number | null; lead: number | null }> {
  const rnd = mulberry32(seed)
  const root = 33 // A1
  const bassChoices = [0, 0, 0, 7, 0, 0, 3, 5]
  const leadChoices = [0, 3, 5, 7, 10]
  const steps: Array<{ bass: number | null; lead: number | null }> = []
  for (let i = 0; i < 16; i++) {
    const off = bassChoices[Math.floor(rnd() * bassChoices.length)]!
    const bass = rnd() < 0.85 ? root + off : null
    const lead =
      i % 4 === 2 || rnd() < 0.2 ? 60 + leadChoices[Math.floor(rnd() * leadChoices.length)]! : null
    steps.push({ bass, lead })
  }
  return steps
}

function MetricBar({
  label,
  value,
  invert = false,
}: { label: string; value: number; invert?: boolean }) {
  const pct = Math.round(value * 100)
  const good = invert ? value < 0.5 : value > 0.5
  const color = good ? 'bg-emerald-500' : value > 0.3 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 text-zinc-500 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right tabular-nums text-zinc-400">{value.toFixed(3)}</span>
    </div>
  )
}

export default function Home() {
  const [bars, setBars] = useState(8)
  const [seed, setSeed] = useState(42)
  const [useSamples, setUseSamples] = useState(true)
  const [loading, setLoading] = useState(false)
  const [critiqueLoading, setCritiqueLoading] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [critique, setCritique] = useState<CritiqueData | null>(null)
  const [optReport, setOptReport] = useState<OptReport | null>(null)
  // biome-ignore lint/suspicious/noExplicitAny: UI state needs dynamic types
  const [arrangement, setArrangement] = useState<any>(null)
  const [audioReady, setAudioReady] = useState(false)
  // biome-ignore lint/suspicious/noExplicitAny: UI state needs dynamic types
  const [presets, setPresets] = useState<any[]>([])
  const [showPresets, setShowPresets] = useState(false)
  const [uploadingRef, setUploadingRef] = useState(false)
  // biome-ignore lint/suspicious/noExplicitAny: UI state needs dynamic types
  const [referenceInfo, setReferenceInfo] = useState<any>(null)
  // biome-ignore lint/suspicious/noExplicitAny: UI state needs dynamic types
  const audioEngineRef = useRef<any>(null)
  // biome-ignore lint/suspicious/noExplicitAny: UI state needs dynamic types
  const presetMgrRef = useRef<any>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  // ── PLAN_V3 4.5: transport / mixer / keys / MIDI / toasts ────────────────
  const [bpm, setBpm] = useState(145)
  const [transportOn, setTransportOn] = useState(false)
  const [cutoff, setCutoff] = useState(3000)
  const [resonance, setResonance] = useState(0.3)
  const [mixer, setMixer] = useState<Record<VoiceSection, number>>({
    lead: 1,
    bass: 1,
    pad: 1,
    acid: 1,
  })
  const [muted, setMuted] = useState<Record<VoiceSection, boolean>>({
    lead: false,
    bass: false,
    pad: false,
    acid: false,
  })
  const [heldNotes, setHeldNotes] = useState<number[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [appliedPreset, setAppliedPreset] = useState<string | null>(null)
  const [midiReady, setMidiReady] = useState(false)
  const [midiInputs, setMidiInputs] = useState<string[]>([])
  const [midiConnected, setMidiConnected] = useState<string | null>(null)
  const transportRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stepRef = useRef(0)
  const pointerHeldRef = useRef<Set<number>>(new Set())
  const toastIdRef = useRef(0)

  const pushToast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++toastIdRef.current
    setToasts((ts) => [...ts.slice(-3), { id, kind, msg }])
    setTimeout(() => {
      setToasts((ts) => ts.filter((t) => t.id !== id))
    }, 4000)
  }, [])

  /** Lazy engine getter — creates the AudioContext on first user gesture. */
  const getEngine = useCallback(async (): Promise<PSY4AudioEngine | null> => {
    if (audioEngineRef.current) return audioEngineRef.current as PSY4AudioEngine
    try {
      const { PSY4AudioEngine: Engine } = await import('@/lib/psy4/audio-engine')
      const eng = new Engine()
      const ok = await eng.init()
      if (!ok) return null
      await eng.resume()
      audioEngineRef.current = eng
      setAudioReady(true)
      return eng
    } catch (e) {
      console.error('Audio init failed:', e)
      return null
    }
  }, [])

  /** Push current UI mixer/filter state into the live engine (post-init sync). */
  const applyMixer = useCallback(
    (eng: PSY4AudioEngine) => {
      for (const s of MIXER_SECTIONS) eng.setVoiceGain(s, muted[s] ? 0 : mixer[s])
      eng.setCutoff(cutoff)
      eng.setResonance(resonance)
    },
    [mixer, muted, cutoff, resonance]
  )

  const voiceNoteOn = useCallback((midi: number, velocity = 0.8) => {
    const eng = audioEngineRef.current as PSY4AudioEngine | null
    if (!eng) return
    eng.noteOn(midi, velocity)
    setHeldNotes((ns) => (ns.includes(midi) ? ns : [...ns, midi]))
  }, [])

  const voiceNoteOff = useCallback((midi: number) => {
    const eng = audioEngineRef.current as PSY4AudioEngine | null
    if (!eng) return
    eng.noteOff(midi)
    setHeldNotes((ns) => ns.filter((n) => n !== midi))
  }, [])

  const stopTransport = useCallback(() => {
    if (transportRef.current !== null) {
      clearInterval(transportRef.current)
      transportRef.current = null
    }
    ;(audioEngineRef.current as PSY4AudioEngine | null)?.releaseAll()
    setHeldNotes([])
    setTransportOn(false)
  }, [])

  const startTransport = useCallback(async () => {
    const eng = await getEngine()
    if (!eng) {
      pushToast('audio engine unavailable — transport cannot start', 'err')
      return
    }
    applyMixer(eng)
    if (transportRef.current !== null) clearInterval(transportRef.current)
    stepRef.current = 0
    const stepMs = Math.max(40, Math.round(15000 / bpm)) // 16th note
    const pattern = buildPattern(seed)
    transportRef.current = setInterval(() => {
      // Modulo 16 on a 16-entry pattern → always a valid step.
      const step = pattern[stepRef.current % 16]!
      if (step.bass !== null) {
        eng.noteOn(step.bass, 0.9)
        setTimeout(() => eng.noteOff(step.bass as number), stepMs * 0.85)
      }
      if (step.lead !== null) {
        eng.noteOn(step.lead, 0.7)
        setTimeout(() => eng.noteOff(step.lead as number), stepMs * 0.6)
      }
      stepRef.current++
    }, stepMs)
    setTransportOn(true)
  }, [getEngine, applyMixer, bpm, seed, pushToast])

  const setChannelGain = useCallback((s: VoiceSection, gain: number, isMuted: boolean) => {
    const eng = audioEngineRef.current as PSY4AudioEngine | null
    eng?.setVoiceGain(s, isMuted ? 0 : gain)
  }, [])

  const initMidi = useCallback(async () => {
    const eng = await getEngine()
    if (!eng) {
      pushToast('audio engine unavailable — MIDI needs the engine', 'err')
      return
    }
    const ok = await eng.initMIDI()
    if (!ok) {
      pushToast('Web MIDI not available in this browser', 'err')
      return
    }
    setMidiReady(true)
    setMidiInputs(eng.getMIDIInputs())
    pushToast('Web MIDI ready — pick an input below')
  }, [getEngine, pushToast])

  const connectMidi = useCallback(
    (name: string) => {
      const eng = audioEngineRef.current as PSY4AudioEngine | null
      if (!eng) return
      const ok = eng.connectMIDIInput(name)
      setMidiConnected(ok ? name : null)
      pushToast(ok ? `MIDI in connected: ${name}` : 'MIDI input not found', ok ? 'ok' : 'err')
    },
    [pushToast]
  )

  /** PLAN_V3 4.5 — apply a preset to the LIVE sketchpad params that actually
   *  map (cutoff/resonance/lead gain) and tag the offline render with ?preset=. */
  const applyPresetLive = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: preset shape comes from PresetManager
    (p: any) => {
      const eng = audioEngineRef.current as PSY4AudioEngine | null
      const params = p.params ?? {}
      const applied: string[] = []
      if (typeof params.cutoff === 'number') {
        setCutoff(params.cutoff)
        eng?.setCutoff(params.cutoff)
        applied.push(`cutoff ${Math.round(params.cutoff)}Hz`)
      }
      if (typeof params.res === 'number') {
        setResonance(params.res)
        eng?.setResonance(params.res)
        applied.push(`res ${params.res}`)
      }
      if (typeof params.gain === 'number') {
        const g = Math.max(0, Math.min(2, params.gain))
        setMixer((m) => ({ ...m, lead: g }))
        eng?.setVoiceGain('lead', g)
        applied.push(`lead gain ${g.toFixed(2)}`)
      }
      setAppliedPreset(p.name)
      pushToast(
        applied.length > 0
          ? `${p.name} applied (${applied.join(', ')}) · offline render tagged ?preset=`
          : `${p.name}: no realtime-mappable params — tagged for offline render only`
      )
    },
    [pushToast]
  )

  /** PLAN_V3 4.6 — session JSON from current state. */
  const buildSession = useCallback(
    (): SessionProject => ({
      schema: SESSION_SCHEMA,
      version: SESSION_VERSION,
      savedAt: new Date().toISOString(),
      render: { bars, seed, useSamples, preset: appliedPreset },
      realtime: { bpm, cutoff, resonance },
      mixer: { ...mixer },
    }),
    [bars, seed, useSamples, appliedPreset, bpm, cutoff, resonance, mixer]
  )

  const saveSession = useCallback(() => {
    const blob = new Blob([JSON.stringify(buildSession(), null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `psy-session-bars${bars}-seed${seed}.json`
    a.click()
    URL.revokeObjectURL(url)
    pushToast('session saved as JSON')
  }, [buildSession, bars, seed, pushToast])

  const loadSessionFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text()
        const s = JSON.parse(text) as Partial<SessionProject>
        if (s.schema !== SESSION_SCHEMA || s.version !== SESSION_VERSION) {
          pushToast('not a psy-foundation session file (schema/version mismatch)', 'err')
          return
        }
        const clampBars = (n: number) => Math.max(1, Math.min(88, Math.round(n)))
        const r = s.render ?? { bars: 8, seed: 42, useSamples: true, preset: null }
        const rt = s.realtime ?? { bpm: 145, cutoff: 3000, resonance: 0.3 }
        const mx = s.mixer ?? { lead: 1, bass: 1, pad: 1, acid: 1 }
        setBars(clampBars(Number(r.bars) || 8))
        setSeed(Math.max(0, Math.min(2 ** 31 - 1, Math.round(Number(r.seed) || 0))))
        setUseSamples(r.useSamples !== false)
        setAppliedPreset(typeof r.preset === 'string' ? r.preset : null)
        setBpm(Math.max(60, Math.min(200, Math.round(Number(rt.bpm) || 145))))
        setCutoff(Math.max(100, Math.min(12000, Math.round(Number(rt.cutoff) || 3000))))
        setResonance(Math.max(0, Math.min(1, Number(rt.resonance) ?? 0.3)))
        const cleanMixer = MIXER_SECTIONS.reduce(
          (acc, k) => {
            acc[k] = Math.max(0, Math.min(2, Number(mx[k]) || 0))
            return acc
          },
          {} as Record<VoiceSection, number>
        )
        setMixer(cleanMixer)
        const eng = audioEngineRef.current as PSY4AudioEngine | null
        if (eng) {
          for (const k of MIXER_SECTIONS) eng.setVoiceGain(k, cleanMixer[k])
          eng.setCutoff(Math.max(100, Math.min(12000, Math.round(Number(rt.cutoff) || 3000))))
          eng.setResonance(Math.max(0, Math.min(1, Number(rt.resonance) ?? 0.3)))
        }
        pushToast(`session loaded: bars=${r.bars} seed=${r.seed}`)
      } catch {
        pushToast('session file is not valid JSON', 'err')
      }
    },
    [pushToast]
  )

  const render = async () => {
    setLoading(true)
    setCritique(null)
    setAudioUrl(null)
    try {
      const ts = Date.now()
      const presetParam = appliedPreset ? `&preset=${encodeURIComponent(appliedPreset)}` : ''
      const url = `/api/render-forensic?bars=${bars}&seed=${seed}&samples=${useSamples}${presetParam}&nocache=1&t=${ts}`
      setAudioUrl(url)

      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.load()
          audioRef.current.play().catch(() => {})
        }
      }, 200)

      setCritiqueLoading(true)
      const res = await fetch(`/api/audio-critique?bars=${bars}&seed=${seed}&samples=${useSamples}`)
      if (res.ok) {
        const data = (await res.json()) as CritiqueData
        setCritique(data)
      } else {
        pushToast(`critique failed: HTTP ${res.status}`, 'err')
      }
    } catch (e) {
      pushToast(`render failed: ${e instanceof Error ? e.message : 'network error'}`, 'err')
    } finally {
      setLoading(false)
      setCritiqueLoading(false)
    }
  }

  const runOptimize = async () => {
    setOptimizing(true)
    setOptReport(null)
    try {
      const res = await fetch(`/api/optimize?seed=${seed}&bars=8&iterations=16&target=0.75`)
      if (res.ok) {
        const data = (await res.json()) as OptReport
        setOptReport(data)
      }
    } catch (err) {
      console.error('Optimize fetch failed:', err)
    } finally {
      setOptimizing(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only effect
  useEffect(() => {
    // Initialize preset manager and load factory presets
    import('@/lib/psy4/preset-manager').then(({ PresetManager }) => {
      presetMgrRef.current = new PresetManager()
      setPresets(presetMgrRef.current.getAll())
    })
    // PLAN_V3 4.6: best-effort restore of the autosaved session (older than
    // the first render so the render URL picks the restored params up).
    try {
      const raw = window.localStorage.getItem(SESSION_LS_KEY)
      if (raw) {
        const s = JSON.parse(raw) as Partial<SessionProject>
        if (s.schema === SESSION_SCHEMA && s.version === SESSION_VERSION && s.render) {
          setBars(Math.max(1, Math.min(88, Math.round(Number(s.render.bars) || 8))))
          setSeed(Math.max(0, Math.min(2 ** 31 - 1, Math.round(Number(s.render.seed) || 0))))
          setUseSamples(s.render.useSamples !== false)
        }
      }
    } catch {
      /* corrupt autosave — start clean, honest default */
    }
    render()
    // PLAN_V3 4.5 dispose/leak fixes: nothing outlives the page.
    return () => {
      if (transportRef.current !== null) clearInterval(transportRef.current)
      ;(audioEngineRef.current as PSY4AudioEngine | null)?.dispose()
      audioEngineRef.current = null
    }
  }, [])

  // PLAN_V3 4.5: computer keyboard + global pointer-release (mounted only
  // while the engine is ready; every listener is removed on cleanup).
  useEffect(() => {
    if (!audioReady) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')
      ) {
        return
      }
      const midi = KEY_MAP[e.key.toLowerCase()]
      if (midi === undefined) return
      voiceNoteOn(midi, 0.8)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const midi = KEY_MAP[e.key.toLowerCase()]
      if (midi === undefined) return
      voiceNoteOff(midi)
    }
    const onPointerUp = () => {
      // Pointer released anywhere: drop notes still held by a pointer that
      // left its key without firing onPointerUp on it (leak-proof release).
      for (const midi of pointerHeldRef.current) voiceNoteOff(midi)
      pointerHeldRef.current.clear()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [audioReady, voiceNoteOn, voiceNoteOff])

  // PLAN_V3 4.6: autosave the session (best-effort; quota/private mode tolerated).
  useEffect(() => {
    try {
      const session: SessionProject = {
        schema: SESSION_SCHEMA,
        version: SESSION_VERSION,
        savedAt: new Date().toISOString(),
        render: { bars, seed, useSamples, preset: appliedPreset },
        realtime: { bpm, cutoff, resonance },
        mixer: { ...mixer },
      }
      window.localStorage.setItem(SESSION_LS_KEY, JSON.stringify(session))
    } catch {
      /* storage unavailable — autosave is best-effort only */
    }
  }, [bars, seed, useSamples, appliedPreset, bpm, cutoff, resonance, mixer])

  const scoreColor = critique
    ? critique.overallScore > 0.65
      ? 'text-emerald-400'
      : critique.overallScore > 0.5
        ? 'text-amber-400'
        : 'text-rose-400'
    : 'text-zinc-500'

  const optScoreMax = optReport ? Math.max(...optReport.iterations.map((i) => i.score), 0.7) : 1

  return (
    <div
      className="min-h-screen flex flex-col text-zinc-200"
      style={{
        background: DESIGN.gradients.background,
        fontFamily: DESIGN.fonts.sans,
      }}
    >
      <header
        className="border-b border-zinc-800/50 backdrop-blur sticky top-0 z-10"
        style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}
      >
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-4">
          <h1 className="text-lg font-bold text-zinc-50" style={{ fontFamily: DESIGN.fonts.mono }}>
            psy-foundation
          </h1>
          <span className="text-xs text-zinc-500">
            v8.5 · ZDF SVF · ModulationMatrix · wavetable · granular · waveguide · 5-layer lead ·
            LR4 bass · M/S master · dyn-EQ sidechain · stems · 16 iters
          </span>
          {critique?.version && (
            <span className="text-xs text-cyan-500/60" style={{ fontFamily: DESIGN.fonts.mono }}>
              {critique.version}
            </span>
          )}
          <span className="ml-auto text-xs text-zinc-600" style={{ fontFamily: DESIGN.fonts.mono }}>
            {critique ? `${(critique.overallScore * 100).toFixed(0)}/100` : ''}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 space-y-6">
        <UIErrorBoundary>
          {/* Render controls */}
          <section
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-5"
            style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-base font-semibold text-emerald-200"
                style={{ fontFamily: DESIGN.fonts.mono }}
              >
                Render Engine v8.5
              </span>
              {critique && (
                <span className={`ml-auto text-2xl font-bold tabular-nums ${scoreColor}`}>
                  {(critique.overallScore * 100).toFixed(0)}/100
                </span>
              )}
            </div>
            <p
              className="text-xs text-emerald-300/80 mb-4"
              style={{ fontFamily: DESIGN.fonts.mono }}
            >
              RawScore → 14 voices × ChannelFX (EQ+delay+reverb+pan+width) → 3-bus glue → Multiband
              (LR4) → StereoWidener (M/S) → LUFS (-9) → TruePeakLimiter (-1 dBTP)
            </p>
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-zinc-400">Bars:</span>
                <select
                  value={bars}
                  onChange={(e) => setBars(Number(e.target.value))}
                  className="bg-zinc-800 text-zinc-200 rounded px-2 py-1 text-sm border border-zinc-700"
                >
                  <option value={4}>4</option>
                  <option value={8}>8</option>
                  <option value={16}>16</option>
                  <option value={32}>32</option>
                  <option value={88}>88 (full)</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-zinc-400">Seed:</span>
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                  className="bg-zinc-800 text-zinc-200 rounded px-2 py-1 text-sm border border-zinc-700 w-20"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useSamples}
                  onChange={(e) => setUseSamples(e.target.checked)}
                  className="accent-emerald-500"
                />
                <span className="text-zinc-400">909/MD samples</span>
              </label>
              <button
                type="button"
                onClick={render}
                disabled={loading}
                className="ml-auto inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Rendering...' : 'Render + Critique'}
              </button>
            </div>
            {audioUrl && (
              <div className="mt-4">
                {/* biome-ignore lint/a11y/useMediaCaption: procedurally generated
                  instrumental audio — there is no speech to caption and a
                  fabricated track would violate the honesty charter (see
                  docs/ENGINEER_CHARTER.md). Described for AT via aria-label. */}
                <audio
                  crossOrigin="anonymous"
                  ref={audioRef}
                  controls
                  src={audioUrl}
                  aria-label="Generated psytrance render preview (instrumental)"
                  className="w-full"
                />
                <p className="mt-2 text-xs text-zinc-500">
                  <a
                    href={audioUrl}
                    download="psy4-forensic.wav"
                    className="text-emerald-400 hover:underline"
                  >
                    Download WAV
                  </a>
                  {' · '}
                  <a
                    href={`/api/render-forensic?bars=${bars}&seed=${seed}&samples=${useSamples}&format=aiff`}
                    download="psy4-forensic.aiff"
                    className="text-cyan-400 hover:underline"
                  >
                    AIFF
                  </a>
                  {' · '}
                  <a
                    href={`/api/render-forensic?bars=${bars}&seed=${seed}&samples=${useSamples}&format=flac`}
                    download="psy4-forensic.flac"
                    className="text-violet-400 hover:underline"
                  >
                    FLAC
                  </a>
                  {' · '}
                  <span>
                    Stereo 44.1kHz · {critique?.renderInfo.events ?? 0} events ·{' '}
                    {critique?.renderInfo.durationSec.toFixed(1) ?? '—'}s
                  </span>
                  {critique?.renderInfo.lufs !== undefined && (
                    <span>
                      {' '}
                      · LUFS {critique.renderInfo.lufs.toFixed(1)} · Peak{' '}
                      {critique.renderInfo.truePeakDb?.toFixed(1)}dB · Width{' '}
                      {critique.renderInfo.stereoWidth?.toFixed(2)}
                    </span>
                  )}
                </p>
                <p className="mt-2 text-xs text-zinc-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-zinc-400" style={{ fontFamily: DESIGN.fonts.mono }}>
                    Stems (mastering-ready):
                  </span>
                  <a
                    href={`/api/render-forensic?bars=${bars}&seed=${seed}&samples=${useSamples}&stem=drum`}
                    download={`psy4-stem-drum-bars${bars}-seed${seed}.wav`}
                    className="text-cyan-400 hover:underline"
                    title="Download the drum bus (post-bus-glue, pre-master) as a stereo WAV"
                  >
                    Download Drum Stem
                  </a>
                  <a
                    href={`/api/render-forensic?bars=${bars}&seed=${seed}&samples=${useSamples}&stem=bass`}
                    download={`psy4-stem-bass-bars${bars}-seed${seed}.wav`}
                    className="text-cyan-400 hover:underline"
                    title="Download the bass bus (post-bus-glue, pre-master) as a stereo WAV"
                  >
                    Download Bass Stem
                  </a>
                  <a
                    href={`/api/render-forensic?bars=${bars}&seed=${seed}&samples=${useSamples}&stem=music`}
                    download={`psy4-stem-music-bars${bars}-seed${seed}.wav`}
                    className="text-cyan-400 hover:underline"
                    title="Download the music bus (post-bus-glue, pre-master) as a stereo WAV"
                  >
                    Download Music Stem
                  </a>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-400" style={{ fontFamily: DESIGN.fonts.mono }}>
                    Neural:
                  </span>
                  <a
                    href={`/api/style-transfer?bars=${bars}&seed=${seed}&samples=${useSamples}&blend=0.3`}
                    download={`psy4-style-transfer-bars${bars}-seed${seed}.wav`}
                    className="text-fuchsia-400 hover:underline"
                    title="Apply spectral style transfer (RAVE-style, 30% blend)"
                  >
                    Style Transfer (30%)
                  </a>
                  <a
                    href={`/api/style-transfer?bars=${bars}&seed=${seed}&samples=${useSamples}&blend=0.6`}
                    download={`psy4-style-transfer-strong-bars${bars}-seed${seed}.wav`}
                    className="text-fuchsia-400 hover:underline"
                    title="Apply spectral style transfer (RAVE-style, 60% blend)"
                  >
                    Style Transfer (60%)
                  </a>
                </p>
              </div>
            )}
          </section>

          {/* Auto-Optimize */}
          <section
            className="rounded-lg border border-violet-500/40 bg-violet-500/10 p-5"
            style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-base font-semibold text-violet-200"
                style={{ fontFamily: DESIGN.fonts.mono }}
              >
                Auto-Fixer v8.5 (Stage 9)
              </span>
              <button
                type="button"
                onClick={runOptimize}
                disabled={optimizing}
                className="ml-auto inline-flex items-center gap-2 rounded-md bg-violet-500 px-3 py-1.5 text-xs font-semibold text-violet-950 hover:bg-violet-400 disabled:opacity-50 transition-colors"
              >
                {optimizing ? 'Optimizing...' : 'Run Auto-Optimize (16 iters)'}
              </button>
            </div>
            <p
              className="text-xs text-violet-300/80 mb-3"
              style={{ fontFamily: DESIGN.fonts.mono }}
            >
              Closed-loop: render → critique → diagnose → vary DSP parameters (hatGain, leadCutoff,
              bassGain, duckAmount, stereoWidth...) → re-render. 16 plans + 2 adaptive passes with
              severity-scaled corrections.
            </p>
            {optReport && (
              <div className="space-y-3">
                <div className="flex items-baseline gap-4 text-sm">
                  <span className="text-zinc-400">
                    Initial:{' '}
                    <span className="text-zinc-200 font-mono">
                      {optReport.initialScore.toFixed(4)}
                    </span>
                  </span>
                  <span className="text-zinc-400">
                    Final:{' '}
                    <span
                      className={`font-mono font-bold ${optReport.finalScore > optReport.initialScore ? 'text-emerald-400' : 'text-zinc-300'}`}
                    >
                      {optReport.finalScore.toFixed(4)}
                    </span>
                  </span>
                  <span className="text-zinc-400">
                    Δ:{' '}
                    <span
                      className={optReport.improvement >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                    >
                      {optReport.improvement >= 0 ? '+' : ''}
                      {optReport.improvement.toFixed(4)}
                    </span>
                  </span>
                  <span className="text-zinc-400">
                    Verdict:{' '}
                    <span
                      className={`font-semibold ${optReport.verdict === 'PASS' ? 'text-emerald-400' : optReport.verdict === 'PARTIAL' ? 'text-amber-400' : 'text-rose-400'}`}
                    >
                      {optReport.verdict}
                    </span>
                  </span>
                  <span className="text-zinc-500 ml-auto">
                    {(optReport.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>
                {/* Score chart */}
                <div className="flex items-end gap-1 h-24 bg-zinc-900/60 rounded p-2">
                  {optReport.iterations.map((it) => {
                    const h = Math.max(4, (it.score / optScoreMax) * 80)
                    const isBest = it.iteration === optReport.bestIteration
                    return (
                      <div
                        key={it.iteration}
                        className="flex-1 flex flex-col items-center justify-end gap-1"
                        title={`${it.configName}: ${it.score.toFixed(4)}`}
                      >
                        <span className="text-[10px] tabular-nums text-zinc-500">
                          {it.score.toFixed(3)}
                        </span>
                        <div
                          className={`w-full rounded-t ${isBest ? 'bg-violet-400' : 'bg-violet-600'}`}
                          style={{ height: `${h}px` }}
                        />
                        <span className="text-[9px] text-zinc-600 truncate w-full text-center">
                          {it.configName}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Real-Time Sketchpad (AudioWorklet) — PLAN_V3 4.4/4.5 */}
          <section
            className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-5"
            style={{ boxShadow: DESIGN.shadows.panel }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-base font-semibold text-cyan-200"
                style={{ fontFamily: DESIGN.fonts.mono }}
              >
                Real-Time Sketchpad
              </span>
              <button
                type="button"
                onClick={async () => {
                  const eng = await getEngine()
                  if (eng) {
                    applyMixer(eng)
                    pushToast('audio engine ready')
                  } else {
                    pushToast('audio engine failed to start (see console)', 'err')
                  }
                }}
                className="ml-auto inline-flex items-center gap-2 rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-cyan-950 hover:bg-cyan-400 transition-colors"
              >
                {audioReady ? 'Audio Ready' : 'Start Audio'}
              </button>
            </div>
            <p className="text-xs text-cyan-300/80 mb-1">
              AudioWorklet real-time synthesis — click a key, use your computer keyboard (A–; rows),
              or connect MIDI. Keys release on pointer/keyboard release.
            </p>
            {/* PLAN_V3 4.4 realtime honesty: the worklet is BUILT from the ONE canonical
              @psy-foundation/dsp (same classes as the offline master chain — D6), but it
              is a lighter 13-voice arrangement. The offline render is the reference. */}
            <p className="text-xs text-amber-300/80 mb-3">
              Honesty: sketchpad, not the canonical render — same DSP primitives, lighter
              arrangement; the offline render above is the reference output.
            </p>
            {audioReady && (
              <div className="space-y-3">
                {/* Transport (PLAN_V3 4.5) — seeded 16-step loop, honest UI-clock timing */}
                <div className="flex flex-wrap items-center gap-3 rounded border border-cyan-500/20 bg-cyan-500/5 p-2">
                  <button
                    type="button"
                    onClick={() => (transportOn ? stopTransport() : void startTransport())}
                    aria-pressed={transportOn}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      transportOn
                        ? 'bg-rose-500 text-rose-950 hover:bg-rose-400'
                        : 'bg-cyan-500 text-cyan-950 hover:bg-cyan-400'
                    }`}
                  >
                    {transportOn ? '■ Stop' : '▶ Play Loop'}
                  </button>
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-cyan-300">BPM:</span>
                    <input
                      type="number"
                      min={60}
                      max={200}
                      value={bpm}
                      onChange={(e) =>
                        setBpm(Math.max(60, Math.min(200, Number(e.target.value) || 145)))
                      }
                      className="bg-zinc-800 text-zinc-200 rounded px-2 py-1 text-xs border border-zinc-700 w-16"
                      aria-label="Transport tempo in BPM"
                    />
                  </label>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    16-step seeded loop (seed={seed}) · UI-clock scheduler — sketchpad timing, not
                    sample-accurate
                  </span>
                </div>

                {/* Virtual Keyboard — per-note release + ARIA (PLAN_V3 4.5) */}
                <fieldset
                  className="flex flex-wrap gap-1 border-0 p-0 m-0"
                  aria-label="Virtual keyboard"
                >
                  {[48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72].map((midi) => {
                    const noteNames = [
                      'C',
                      'C#',
                      'D',
                      'D#',
                      'E',
                      'F',
                      'F#',
                      'G',
                      'G#',
                      'A',
                      'A#',
                      'B',
                    ]
                    const note = noteNames[midi % 12]! + Math.floor(midi / 12 - 1)
                    const isBlack = noteNames[midi % 12]!.includes('#')
                    const keyHint = Object.entries(KEY_MAP).find(([, m]) => m === midi)?.[0]
                    const held = heldNotes.includes(midi)
                    return (
                      <button
                        type="button"
                        key={midi}
                        aria-label={`Play ${note}`}
                        aria-pressed={held}
                        onPointerDown={() => {
                          pointerHeldRef.current.add(midi)
                          voiceNoteOn(midi, 0.8)
                        }}
                        onPointerUp={() => {
                          pointerHeldRef.current.delete(midi)
                          voiceNoteOff(midi)
                        }}
                        onPointerLeave={() => {
                          if (pointerHeldRef.current.has(midi)) {
                            pointerHeldRef.current.delete(midi)
                            voiceNoteOff(midi)
                          }
                        }}
                        onPointerCancel={() => {
                          pointerHeldRef.current.delete(midi)
                          voiceNoteOff(midi)
                        }}
                        className={`px-2 py-3 text-[10px] font-mono rounded border transition-colors ${
                          held
                            ? 'border-cyan-300 bg-cyan-400 text-cyan-950'
                            : isBlack
                              ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border-zinc-700'
                              : 'bg-zinc-100 text-zinc-900 hover:bg-white border-zinc-300'
                        }`}
                        style={{ minWidth: '32px' }}
                      >
                        {note}
                        {keyHint ? (
                          <span className="block text-[8px] opacity-60">{keyHint}</span>
                        ) : null}
                      </button>
                    )
                  })}
                </fieldset>

                {/* Mixer strip (PLAN_V3 4.5) — per-section gain + mute */}
                <fieldset
                  className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-0 p-0 m-0"
                  aria-label="Mixer strip"
                >
                  {MIXER_SECTIONS.map((s) => (
                    <div
                      key={s}
                      className="rounded border border-cyan-500/20 bg-cyan-500/5 p-2 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-cyan-300 capitalize font-mono">{s}</span>
                        <button
                          type="button"
                          aria-pressed={muted[s]}
                          aria-label={`${muted[s] ? 'Unmute' : 'Mute'} ${s}`}
                          onClick={() => {
                            const next = !muted[s]
                            setMuted((m) => ({ ...m, [s]: next }))
                            setChannelGain(s, mixer[s], next)
                          }}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            muted[s]
                              ? 'bg-rose-500 text-rose-950'
                              : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                          }`}
                        >
                          M
                        </button>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.05"
                        value={mixer[s]}
                        aria-label={`${s} gain`}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          setMixer((m) => ({ ...m, [s]: v }))
                          setChannelGain(s, v, muted[s])
                        }}
                        className="w-full accent-cyan-500"
                      />
                      <span className="text-[10px] text-zinc-500 tabular-nums">
                        {mixer[s].toFixed(2)}
                      </span>
                    </div>
                  ))}
                </fieldset>

                {/* Cutoff slider */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-cyan-300 w-20">Cutoff:</span>
                  <input
                    type="range"
                    min="200"
                    max="8000"
                    value={cutoff}
                    aria-label="Filter cutoff frequency in hertz"
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setCutoff(v)
                      audioEngineRef.current?.setCutoff(v)
                    }}
                    className="flex-1 accent-cyan-500"
                  />
                  <span className="text-zinc-400 w-16">{cutoff} Hz</span>
                </div>
                {/* Resonance slider */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-cyan-300 w-20">Resonance:</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={resonance}
                    aria-label="Filter resonance"
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setResonance(v)
                      audioEngineRef.current?.setResonance(v)
                    }}
                    className="flex-1 accent-cyan-500"
                  />
                  <span className="text-zinc-400 w-16">{resonance.toFixed(2)}</span>
                </div>

                {/* MIDI input wiring (PLAN_V3 4.5 — the previously dead code, live) */}
                <div className="flex flex-wrap items-center gap-2 rounded border border-cyan-500/20 bg-cyan-500/5 p-2 text-xs">
                  <span className="text-cyan-300 font-mono">MIDI:</span>
                  {!midiReady ? (
                    <button
                      type="button"
                      onClick={() => void initMidi()}
                      className="rounded-md bg-cyan-500 px-2.5 py-1 text-[11px] font-semibold text-cyan-950 hover:bg-cyan-400"
                    >
                      Connect MIDI
                    </button>
                  ) : midiInputs.length === 0 ? (
                    <span className="text-zinc-500">no inputs found — plug in a device</span>
                  ) : (
                    midiInputs.map((name) => (
                      <button
                        type="button"
                        key={name}
                        onClick={() => connectMidi(name)}
                        aria-pressed={midiConnected === name}
                        className={`rounded px-2 py-1 text-[11px] font-mono border ${
                          midiConnected === name
                            ? 'border-cyan-300 bg-cyan-400/20 text-cyan-200'
                            : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                        }`}
                      >
                        {name}
                      </button>
                    ))
                  )}
                </div>

                {/* Real-time spectrum analyzer */}
                {audioReady && (
                  <div className="mt-3">
                    <div className="text-xs text-cyan-300 mb-1">Spectrum Analyzer</div>
                    <SpectrumAnalyzerLazy
                      audioEngine={audioEngineRef.current}
                      width={560}
                      height={120}
                    />
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Preset Manager */}
          <section
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-5"
            style={{ boxShadow: DESIGN.shadows.panel }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-base font-semibold text-emerald-200"
                style={{ fontFamily: DESIGN.fonts.mono }}
              >
                Presets
              </span>
              <button
                type="button"
                onClick={async () => {
                  const { PresetManager } = await import('@/lib/psy4/preset-manager')
                  if (!presetMgrRef.current) {
                    presetMgrRef.current = new PresetManager()
                  }
                  setPresets(presetMgrRef.current.getAll())
                  setShowPresets(!showPresets)
                }}
                className="ml-auto inline-flex items-center gap-2 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-400 transition-colors"
              >
                {showPresets ? 'Hide' : 'Browse'} ({presets.length})
              </button>
            </div>
            <p className="text-xs text-emerald-300/80 mb-3">
              {presets.filter((p) => p.id.startsWith('factory-')).length} factory +{' '}
              {presets.filter((p) => !p.id.startsWith('factory-')).length} user presets.
              Save/load/share patches as JSON.
            </p>
            {showPresets && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {presets.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 text-xs rounded border border-emerald-500/20 bg-emerald-500/5 p-2"
                  >
                    <span className="text-emerald-400 font-mono w-20 shrink-0">{p.category}</span>
                    <span className="text-zinc-200 flex-1">{p.name}</span>
                    <span className="text-zinc-500 text-[10px] truncate max-w-32">
                      {p.description}
                    </span>
                    <button
                      type="button"
                      onClick={() => applyPresetLive(p)}
                      className="text-cyan-400 hover:text-cyan-300 text-[10px] font-semibold"
                      title="Apply cutoff/resonance/lead-gain to the realtime sketchpad and tag the offline render with ?preset="
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const pm = presetMgrRef.current
                        if (pm) pm.export(p)
                      }}
                      className="text-emerald-400 hover:text-emerald-300 text-[10px]"
                    >
                      Export
                    </button>
                    {!p.id.startsWith('factory-') && (
                      <button
                        type="button"
                        onClick={() => {
                          const pm = presetMgrRef.current
                          if (pm) {
                            pm.delete(p.id)
                            setPresets(pm.getAll())
                          }
                        }}
                        className="text-rose-400 hover:text-rose-300 text-[10px]"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Session Save/Load (PLAN_V3 4.6) */}
          <section
            className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-5"
            style={{ boxShadow: DESIGN.shadows.panel }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-base font-semibold text-sky-200"
                style={{ fontFamily: DESIGN.fonts.mono }}
              >
                Session
              </span>
              {appliedPreset && (
                <span className="text-xs text-sky-300 font-mono">preset: {appliedPreset}</span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveSession}
                  className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-sky-950 hover:bg-sky-400 transition-colors"
                >
                  Save JSON
                </button>
                <label className="cursor-pointer rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-600 transition-colors">
                  Load JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="sr-only"
                    aria-label="Load session JSON file"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void loadSessionFile(file)
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
            </div>
            <p className="text-xs text-sky-300/80">
              Saves/loads bars, seed, samples flag, preset ref, transport BPM, sketchpad
              cutoff/resonance and mixer gains as versioned JSON. The current session also autosaves
              to localStorage (survives refresh; never uploaded).
            </p>
          </section>

          {/* Reference Upload */}
          <section
            className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 p-5"
            style={{ boxShadow: DESIGN.shadows.panel }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-base font-semibold text-fuchsia-200"
                style={{ fontFamily: DESIGN.fonts.mono }}
              >
                Reference Upload
              </span>
            </div>
            <p className="text-xs text-fuchsia-300/80 mb-3">
              Upload a reference track (WAV) and learn its spectral style for style transfer.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".wav,audio/wav"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setUploadingRef(true)
                  try {
                    const formData = new FormData()
                    formData.append('audio', file)
                    const res = await fetch('/api/upload-reference', {
                      method: 'POST',
                      body: formData,
                    })
                    if (res.ok) {
                      const data = await res.json()
                      setReferenceInfo(data)
                    }
                  } catch (err) {
                    console.error('Upload failed:', err)
                  }
                  setUploadingRef(false)
                }}
                className="text-xs text-zinc-400 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-fuchsia-500 file:text-fuchsia-950 file:font-semibold file:cursor-pointer hover:file:bg-fuchsia-400"
              />
              {uploadingRef && (
                <span className="text-xs text-fuchsia-300 animate-pulse">Analyzing...</span>
              )}
            </div>
            {referenceInfo && (
              <div className="mt-3 text-xs space-y-1">
                <div className="text-fuchsia-300 font-mono">
                  {referenceInfo.name} ({(referenceInfo.size / 1024).toFixed(0)}KB)
                </div>
                <div className="text-zinc-400">
                  Centroid:{' '}
                  <span className="text-zinc-200">{referenceInfo.latent.centroid} Hz</span>
                </div>
                <div className="text-zinc-400">
                  Flatness: <span className="text-zinc-200">{referenceInfo.latent.flatness}</span>{' '}
                  (0=tonal, 1=noise)
                </div>
                <div className="text-fuchsia-400 font-mono text-[10px]">
                  Hash: {referenceInfo.hash}
                </div>
              </div>
            )}
          </section>

          {/* AI Arrangement */}
          <section
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-5"
            style={{ boxShadow: DESIGN.shadows.panel }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-base font-semibold text-amber-200"
                style={{ fontFamily: DESIGN.fonts.mono }}
              >
                AI Arrangement (Phase 4)
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/arrangement?seed=${seed}&bars=88`)
                    if (res.ok) {
                      const data = await res.json()
                      setArrangement(data)
                    }
                  } catch (err) {
                    console.error('Arrangement fetch failed:', err)
                  }
                }}
                className="ml-auto inline-flex items-center gap-2 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-400 transition-colors"
              >
                Generate Arrangement
              </button>
            </div>
            <p className="text-xs text-amber-300/80 mb-3">
              Markov-chain section generator — every seed produces a different structure
              (intro→build→drop→break→drop2→climax→outro with random durations and transitions).
            </p>
            {arrangement && (
              <div className="space-y-2">
                <div className="flex items-baseline gap-3 text-xs">
                  <span className="text-zinc-400">Structure:</span>
                  <span className="text-amber-200 font-mono">{arrangement.summary}</span>
                  <span className="text-zinc-500 ml-auto">
                    Hash:{' '}
                    <span className="font-mono text-amber-400">{arrangement.structureHash}</span>
                  </span>
                  <span className="text-zinc-500">Bars: {arrangement.totalBars}</span>
                </div>
                <div className="grid gap-1.5">
                  {arrangement.sections.map(
                    (
                      s: {
                        name: string
                        bars: number
                        energy: number
                        tensionShape: string
                        voices: unknown[]
                      },
                      i: number
                    ) => (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: index is stable for these lists
                        key={`item-${i}`}
                        className="flex items-center gap-2 text-xs rounded border border-amber-500/20 bg-amber-500/5 p-2"
                      >
                        <span className="text-amber-400 font-mono w-16 shrink-0">{s.name}</span>
                        <span className="text-zinc-400 w-12">{s.bars} bars</span>
                        <span className="text-zinc-400 w-16">E: {Math.round(s.energy * 100)}%</span>
                        <span className="text-zinc-400 w-16">{s.tensionShape}</span>
                        <span className="text-zinc-500 text-[10px] flex-1 truncate">
                          {s.voices.length} voices
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </section>

          {/* AudioCritic Results */}
          {critiqueLoading && (
            <section
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5"
              style={{ background: DESIGN.gradients.oled, boxShadow: DESIGN.shadows.oled }}
            >
              <p
                className="text-sm text-zinc-500 animate-pulse"
                style={{ fontFamily: DESIGN.fonts.mono }}
              >
                Analyzing audio quality...
              </p>
            </section>
          )}

          {critique && (
            <section
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5"
              style={{ background: DESIGN.gradients.oled, boxShadow: DESIGN.shadows.oled }}
            >
              <div className="flex items-baseline gap-3 mb-4">
                <h2
                  className="text-lg font-semibold text-zinc-100"
                  style={{ fontFamily: DESIGN.fonts.mono }}
                >
                  AudioCritic
                </h2>
                <span className={`text-3xl font-bold tabular-nums ${scoreColor}`}>
                  {(critique.overallScore * 100).toFixed(0)}
                </span>
                <span className="text-sm text-zinc-500">/ 100</span>
                <span
                  className="ml-auto text-xs text-zinc-600"
                  style={{ fontFamily: DESIGN.fonts.mono }}
                >
                  {critique.failures.length} failures ·{' '}
                  {critique.renderInfo.stereo ? 'stereo' : 'mono'} ·{' '}
                  {critique.renderInfo.samples ? 'samples' : 'synth'}
                </span>
              </div>

              {critique.failures.length > 0 && (
                <div className="space-y-2 mb-4">
                  <h3 className="text-xs uppercase tracking-wider text-zinc-500">
                    Diagnosed Failures
                  </h3>
                  {critique.failures.map((f, i) => (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: index is stable for these lists
                      key={`item-${i}`}
                      className="flex items-start gap-2 rounded border border-rose-500/20 bg-rose-500/5 p-2"
                    >
                      <span className="text-rose-400 text-xs font-mono mt-0.5 shrink-0">
                        {f.code}
                      </span>
                      <div className="min-w-0">
                        <span className="text-xs text-zinc-400">{f.diagnosis}</span>
                        <span className="text-xs text-emerald-400/70 block mt-0.5">
                          → {f.correctionHint}
                        </span>
                      </div>
                      <span className="text-xs text-rose-300 tabular-nums shrink-0 ml-auto">
                        {(f.severity * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <MetricBar label="Kick Clarity" value={critique.metrics.kickClarity} />
                <MetricBar label="Bass Clarity" value={critique.metrics.bassClarity} />
                <MetricBar label="K/B Separation" value={critique.metrics.kickBassSeparation} />
                <MetricBar label="Sub Mud" value={critique.metrics.subMud} invert />
                <MetricBar label="Punch" value={critique.metrics.punch} />
                <MetricBar label="Attack Sharp" value={critique.metrics.attackSharpness} />
                <MetricBar
                  label="Bass Decay Ovlp"
                  value={critique.metrics.bassDecayOverlap}
                  invert
                />
                <MetricBar label="Note Separation" value={critique.metrics.noteSeparation} />
                <MetricBar label="Onset Clarity" value={critique.metrics.onsetClarity} />
                <MetricBar label="K/B Lock" value={critique.metrics.kickBassLock} />
                <MetricBar label="Lead Articulation" value={critique.metrics.leadArticulation} />
                <MetricBar label="Melodic Clarity" value={critique.metrics.melodicClarity} />
                <MetricBar label="Brightness" value={critique.metrics.brightness} />
                <MetricBar label="Spectral Movement" value={critique.metrics.spectralMovement} />
                <MetricBar label="Low-Mid Mud" value={critique.metrics.lowMidMud} invert />
                <MetricBar label="Masking" value={critique.metrics.masking} invert />
                <MetricBar label="Dynamic Range" value={critique.metrics.dynamicRange} />
              </div>
            </section>
          )}

          {/* Master chain metrics */}
          {critique?.renderInfo.lufs !== undefined && (
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
                style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}
              >
                <div
                  className="text-xs uppercase tracking-wider text-zinc-500"
                  style={{ fontFamily: DESIGN.fonts.mono }}
                >
                  LUFS
                </div>
                <div
                  className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums"
                  style={{ fontFamily: DESIGN.fonts.mono }}
                >
                  {critique.renderInfo.lufs.toFixed(1)}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">target -9</div>
              </div>
              <div
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
                style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}
              >
                <div
                  className="text-xs uppercase tracking-wider text-zinc-500"
                  style={{ fontFamily: DESIGN.fonts.mono }}
                >
                  True Peak
                </div>
                <div
                  className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums"
                  style={{ fontFamily: DESIGN.fonts.mono }}
                >
                  {critique.renderInfo.truePeakDb?.toFixed(1)}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">dBTP (limit -1)</div>
              </div>
              <div
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
                style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}
              >
                <div
                  className="text-xs uppercase tracking-wider text-zinc-500"
                  style={{ fontFamily: DESIGN.fonts.mono }}
                >
                  Stereo Width
                </div>
                <div
                  className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums"
                  style={{ fontFamily: DESIGN.fonts.mono }}
                >
                  {critique.renderInfo.stereoWidth?.toFixed(2)}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">M/S ratio</div>
              </div>
              <div
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
                style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}
              >
                <div
                  className="text-xs uppercase tracking-wider text-zinc-500"
                  style={{ fontFamily: DESIGN.fonts.mono }}
                >
                  Gain Reduction
                </div>
                <div
                  className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums"
                  style={{ fontFamily: DESIGN.fonts.mono }}
                >
                  {critique.renderInfo.gainReductionDb?.toFixed(1)}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">dB (limiter)</div>
              </div>
            </section>
          )}

          {/* Render Profile + Harmony */}
          {critique?.renderProfile && (
            <section
              className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-5"
              style={{ background: DESIGN.gradients.oled, boxShadow: DESIGN.shadows.oled }}
            >
              <div className="flex items-baseline gap-3 mb-3">
                <h2
                  className="text-lg font-semibold text-cyan-300"
                  style={{ fontFamily: DESIGN.fonts.mono }}
                >
                  Render Profile
                </h2>
                <span className="text-xs text-zinc-500" style={{ fontFamily: DESIGN.fonts.mono }}>
                  measured on render output · not a real reference
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
                  <div
                    className="text-xs uppercase tracking-wider text-cyan-400"
                    style={{ fontFamily: DESIGN.fonts.mono }}
                  >
                    Centroid
                  </div>
                  <div
                    className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums"
                    style={{ fontFamily: DESIGN.fonts.mono }}
                  >
                    {critique.renderProfile.spectralCentroid}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">Hz brightness</div>
                </div>
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
                  <div
                    className="text-xs uppercase tracking-wider text-cyan-400"
                    style={{ fontFamily: DESIGN.fonts.mono }}
                  >
                    Bass Ratio
                  </div>
                  <div
                    className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums"
                    style={{ fontFamily: DESIGN.fonts.mono }}
                  >
                    {(critique.renderProfile.bassEnergy * 100).toFixed(0)}%
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">20-250Hz</div>
                </div>
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
                  <div
                    className="text-xs uppercase tracking-wider text-cyan-400"
                    style={{ fontFamily: DESIGN.fonts.mono }}
                  >
                    High Ratio
                  </div>
                  <div
                    className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums"
                    style={{ fontFamily: DESIGN.fonts.mono }}
                  >
                    {(critique.renderProfile.highEnergy * 100).toFixed(0)}%
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">2-12kHz</div>
                </div>
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
                  <div
                    className="text-xs uppercase tracking-wider text-cyan-400"
                    style={{ fontFamily: DESIGN.fonts.mono }}
                  >
                    Crest Factor
                  </div>
                  <div
                    className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums"
                    style={{ fontFamily: DESIGN.fonts.mono }}
                  >
                    {critique.renderProfile.crestFactor.toFixed(2)}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">peak/RMS</div>
                </div>
              </div>
            </section>
          )}

          {/* Harmony Info */}
          {critique?.harmony && (
            <section
              className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-4"
              style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}
            >
              <div className="flex items-center gap-3 mb-2">
                <span
                  className="text-xs uppercase tracking-wider text-violet-400"
                  style={{ fontFamily: DESIGN.fonts.mono }}
                >
                  Harmony
                </span>
                <span
                  className="text-sm text-zinc-300 font-mono"
                  style={{ fontFamily: DESIGN.fonts.mono }}
                >
                  {critique.harmony.scale}
                </span>
                <span className="text-xs text-zinc-500" style={{ fontFamily: DESIGN.fonts.mono }}>
                  root: {critique.harmony.rootNote}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {critique.harmony.progression.map((chord, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: index is stable for these lists
                    key={`item-${i}`}
                    className="px-3 py-1 rounded bg-violet-500/20 text-violet-200"
                    style={{ fontFamily: DESIGN.fonts.mono }}
                  >
                    {chord}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Voice Strip — 12 voice chips colored by DESIGN.voiceColors tokens */}
          <section
            className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5"
            style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}
          >
            <div className="flex items-baseline gap-3 mb-3">
              <h2
                className="text-lg font-semibold text-zinc-100"
                style={{ fontFamily: DESIGN.fonts.mono }}
              >
                Voice Strip
              </h2>
              <span className="text-xs text-zinc-500" style={{ fontFamily: DESIGN.fonts.mono }}>
                12 voice types · color-coded by mix role
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {(
                [
                  ['kick', 'Kick'],
                  ['bass', 'Bass'],
                  ['lead', 'Lead'],
                  ['pad', 'Pad'],
                  ['acid', 'Acid'],
                  ['texture', 'Texture'],
                  ['hat', 'Hat'],
                  ['snare', 'Snare'],
                  ['shaker', 'Shaker'],
                  ['sub', 'Sub'],
                  ['riser', 'Riser'],
                  ['impact', 'Impact'],
                ] as const
              ).map(([key, label]) => {
                const c = DESIGN.voiceColors[key]
                return (
                  <div
                    key={key}
                    className={`rounded-md border ${c.border} ${c.bg} px-2 py-2 text-center`}
                  >
                    <div
                      className={`text-xs font-semibold ${c.text}`}
                      style={{ fontFamily: DESIGN.fonts.mono }}
                    >
                      {label}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Pipeline */}
          <section>
            <h2
              className="text-lg font-semibold text-zinc-100 mb-3"
              style={{ fontFamily: DESIGN.fonts.mono }}
            >
              Pipeline (v8.5)
            </h2>
            <div
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 overflow-x-auto"
              style={{ background: DESIGN.gradients.oled, boxShadow: DESIGN.shadows.oled }}
            >
              <pre
                className="text-xs text-zinc-400 font-mono leading-relaxed whitespace-pre"
                style={{ fontFamily: DESIGN.fonts.mono }}
              >{`Foundation CompositionEngine (WHAT — frozen)
  └── RawScore Serializer
        ↓
Forensic Bridge v8.5 (HOW)
  ├── Harmony Engine (8 scales, 7 progressions, from PSYSTAR)
  ├── Humanizer (mulberry32 PRNG, velocity jitter, timing drift, from PSYSTAR)
  ├── ModulationMatrix (LFO1/2/3 + velocity + 3 macros → cutoff/fmIndex/drive/res)
  │   ticked once per sample; macros updated per-bar (SPACE/ENERGY/TENSION contour)
  ├── 13 Voice Pools with ZDF SVF (from PsySynthPro)
  │   ├── Kick (3-layer, velocity-to-timbre, from PSYDRUM)
  │   ├── Bass (3-layer, pluck/sustain, Moog body + LR4 HP@45Hz + 300Hz mid scoop)
  │   ├── Lead (5-layer: fund+octave+air+FM+8kHz harmonic, matrix-modulated)
  │   ├── Pad (5-layer: 3osc+chorus+shimmer, ZDF SVF)
  │   ├── Acid (bidirectional filter LFO, matrix-modulated)
  │   ├── Texture (granular, 4 osc + noise bed)
  │   ├── Hat (metallic 6-osc + sparkle layer @ 12kHz, choke groups, from PSYDRUM)
  │   ├── Snare (TR-808, 2 tone + filtered noise)
  │   └── Shaker, Sub, Riser, Impact, Sample
  ├── Per-Type ChannelFX (EQ shelves + mid-band peak + delay + reverb + pan + width)
  ├── Choke Groups (open hat chokes closed, from PSYDRUM)
  ├── 3-Bus Glue (drum/bass/music: HP + comp + drive)
  ├── Master Chain: HP(25Hz) → M/S(mono<120Hz, widen highs ×1.3) → Multiband(LR4) → Glue → Sat(15%) → StereoWidener(M/S) → LUFS(-11) → Limiter(0.89)
  ├── Bass Dynamic EQ Sidechain (LR4 @ 120Hz — only low band ducked on kick hits)
  ├── Stems Export (?stem=drum|bass|music — per-bus WAV for mastering workflow)
  ├── AudioCritic (8 areas, 12 failure codes, 38 metrics, pro-grade thresholds)
  ├── Render Profile Analyzer (BPM, spectral, dynamics — measured on render output)
  └── RenderDevice (PsyDevice consumer, from foundation-shim)
        ↓
Stereo PCM 44100Hz → WAV + AudioCritic + RenderProfile`}</pre>
            </div>
          </section>
        </UIErrorBoundary>
      </main>

      <ToastStack toasts={toasts} />

      <footer
        className="mt-auto border-t border-zinc-800"
        style={{ background: DESIGN.gradients.chassis }}
      >
        <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
          <span style={{ fontFamily: DESIGN.fonts.mono }} className="text-zinc-500">
            github.com/dudududi144-source/psy-foundation
          </span>
          <span>·</span>
          <span style={{ fontFamily: DESIGN.fonts.mono }}>
            v8.5 · ZDF SVF · ModulationMatrix · M/S master · dyn-EQ sidechain · stems export ·
            wavetable · granular · waveguide
          </span>
          <span className="ml-auto" style={{ fontFamily: DESIGN.fonts.mono }}>
            deterministic · 88 bars · 13 voices · PsyDevice
          </span>
        </div>
      </footer>
    </div>
  )
}

// Lazy-loaded SpectrumAnalyzer (client-only, dynamic import)
import { lazy } from 'react'
const SpectrumAnalyzerLazy = lazy(() =>
  import('@/components/spectrum-analyzer').then((m) => ({ default: m.SpectrumAnalyzer }))
)
