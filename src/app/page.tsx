'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Psy4Runtime, type Psy4State } from '@/lib/psy4/runtime'
import { buildRadioMusicalContext } from '@/lib/psy4/foundation-music-adapter'
import type { RadioMusicalContext } from '@/foundation/music'

const STYLES = ['full-on', 'progressive', 'dark', 'acid']
const RADIO_SCENARIOS: Record<string, () => RadioMusicalContext> = {
  none: () => buildRadioMusicalContext({
    bpm: 145, bpmConfidence: 0, key: 4, scale: 'phrygian-dominant', keyConfidence: 0,
    energy: 0, density: 0, occupancy: { kick: 0, bass: 0, lead: 0, percussion: 0, harmonic: 0 },
    style: 'full-on', styleConfidence: 0, syncopation: 0, available: false, timestamp: 0,
  }),
  sparse: () => buildRadioMusicalContext({
    bpm: 138, bpmConfidence: 0.7, key: 4, scale: 'phrygian-dominant', keyConfidence: 0.6,
    energy: 0.3, density: 0.2, occupancy: { kick: 0.1, bass: 0.1, lead: 0.1, percussion: 0.1, harmonic: 0.1 },
    style: 'full-on', styleConfidence: 0.5, syncopation: 0.2, available: true, timestamp: 0,
  }),
  'bass-heavy': () => buildRadioMusicalContext({
    bpm: 145, bpmConfidence: 0.9, key: 4, scale: 'phrygian-dominant', keyConfidence: 0.8,
    energy: 0.7, density: 0.6, occupancy: { kick: 0.5, bass: 0.8, lead: 0.3, percussion: 0.4, harmonic: 0.3 },
    style: 'full-on', styleConfidence: 0.7, syncopation: 0.3, available: true, timestamp: 0,
  }),
  'melody-heavy': () => buildRadioMusicalContext({
    bpm: 142, bpmConfidence: 0.8, key: 4, scale: 'phrygian-dominant', keyConfidence: 0.7,
    energy: 0.6, density: 0.5, occupancy: { kick: 0.4, bass: 0.4, lead: 0.8, percussion: 0.3, harmonic: 0.5 },
    style: 'progressive', styleConfidence: 0.6, syncopation: 0.4, available: true, timestamp: 0,
  }),
  dense: () => buildRadioMusicalContext({
    bpm: 148, bpmConfidence: 0.9, key: 4, scale: 'phrygian-dominant', keyConfidence: 0.8,
    energy: 0.9, density: 0.85, occupancy: { kick: 0.8, bass: 0.7, lead: 0.8, percussion: 0.7, harmonic: 0.6 },
    style: 'full-on', styleConfidence: 0.8, syncopation: 0.5, available: true, timestamp: 0,
  }),
  breakdown: () => buildRadioMusicalContext({
    bpm: 140, bpmConfidence: 0.6, key: 4, scale: 'phrygian-dominant', keyConfidence: 0.5,
    energy: 0.2, density: 0.15, occupancy: { kick: 0.05, bass: 0.1, lead: 0.2, percussion: 0.05, harmonic: 0.5 },
    style: 'dark', styleConfidence: 0.4, syncopation: 0.1, available: true, timestamp: 0,
  }),
}

export default function Home() {
  const runtimeRef = useRef<Psy4Runtime | null>(null)
  const [state, setState] = useState<Psy4State | null>(null)
  const [style, setStyle] = useState('full-on')
  const [radioScenario, setRadioScenario] = useState('none')
  const [seed, setSeed] = useState(42)
  const [log, setLog] = useState<string[]>([])

  useEffect(() => {
    const runtime = new Psy4Runtime()
    runtime.onStateChange(setState)
    runtimeRef.current = runtime
    return () => runtime.dispose()
  }, [])

  const handlePlay = useCallback(async () => {
    if (!runtimeRef.current) return
    await runtimeRef.current.play()
    setLog(l => [...l, `[${new Date().toISOString().slice(11, 19)}] PLAY — Transport started, foundation composing`])
  }, [])

  const handleStop = useCallback(() => {
    runtimeRef.current?.stop()
    setLog(l => [...l, `[${new Date().toISOString().slice(11, 19)}] STOP`])
  }, [])

  const handleStyle = useCallback((s: string) => {
    setStyle(s)
    runtimeRef.current?.setStyle(s)
    setLog(l => [...l, `[${new Date().toISOString().slice(11, 19)}] Style → ${s}`])
  }, [])

  const handleRadio = useCallback((scenario: string) => {
    setRadioScenario(scenario)
    const ctx = RADIO_SCENARIOS[scenario]?.() ?? null
    runtimeRef.current?.updateRadio(ctx)
    setLog(l => [...l, `[${new Date().toISOString().slice(11, 19)}] Radio → ${scenario}${ctx.available ? ` (bass=${ctx.bassOccupancy}, lead=${ctx.leadOccupancy})` : ' (absent)'}`])
  }, [])

  const handleSeed = useCallback((s: number) => {
    setSeed(s)
    runtimeRef.current?.setSeed(s)
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-200">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-4">
          <h1 className="text-lg font-bold text-zinc-50">PSY4 × Foundation</h1>
          <span className="text-xs text-zinc-500">integration runtime — foundation owns WHAT, psy4 owns WHEN/HOW</span>
          <span className={`ml-auto text-xs px-2 py-1 rounded ${state?.playing ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
            {state?.playing ? '● PLAYING' : '○ STOPPED'}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 space-y-6">
        {/* Transport controls */}
        <section className="flex gap-3">
          <button
            onClick={handlePlay}
            disabled={state?.playing}
            className="px-6 py-3 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-500 disabled:opacity-40 transition"
          >
            ▶ PLAY
          </button>
          <button
            onClick={handleStop}
            disabled={!state?.playing}
            className="px-6 py-3 rounded-lg bg-zinc-800 text-zinc-200 font-semibold hover:bg-zinc-700 disabled:opacity-40 transition"
          >
            ■ STOP
          </button>
        </section>

        {/* Musical state */}
        {state && (
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="BPM" value={state.bpm.toFixed(1)} />
            <Stat label="Beat / Bar" value={`${state.beat} / ${state.bar}`} />
            <Stat label="Epoch" value={state.epoch.toString()} />
            <Stat label="Style" value={state.style} />
            <Stat label="Section" value={state.arrangementState} />
            <Stat label="Active Roles" value={state.activeRoles.join(', ') || '—'} />
            <Stat label="Radio" value={state.radioConnected ? 'CONNECTED' : 'absent'} />
            <Stat label="Adaptation" value={state.radioInfluence} />
          </section>
        )}

        {/* Style selector */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 mb-2">Style (Foundation Grammar)</h2>
          <div className="flex gap-2 flex-wrap">
            {STYLES.map(s => (
              <button
                key={s}
                onClick={() => handleStyle(s)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                  style === s ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        {/* Radio scenarios */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 mb-2">Radio Context (Adaptation Input)</h2>
          <div className="flex gap-2 flex-wrap">
            {Object.keys(RADIO_SCENARIOS).map(s => (
              <button
                key={s}
                onClick={() => handleRadio(s)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                  radioScenario === s ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-600 mt-2">
            Radio is EVIDENCE, not AUTHORITY. The composition adapts at phrase boundaries — never mid-phrase.
          </p>
        </section>

        {/* Seed */}
        <section className="flex items-center gap-3">
          <label className="text-sm text-zinc-400">Seed:</label>
          <input
            type="number"
            value={seed}
            onChange={e => handleSeed(Number(e.target.value))}
            className="w-24 px-3 py-2 rounded-md bg-zinc-800 text-zinc-200 text-sm border border-zinc-700"
          />
          <span className="text-xs text-zinc-600">Same seed + context = same composition (deterministic)</span>
        </section>

        {/* Event log */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 mb-2">Integration Log</h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 max-h-48 overflow-y-auto font-mono text-xs space-y-1">
            {log.length === 0 ? (
              <p className="text-zinc-600">Press PLAY to start. Foundation will compose, adapter will translate, scheduler will play.</p>
            ) : (
              log.slice(-20).map((line, i) => (
                <div key={i} className="text-zinc-400">{line}</div>
              ))
            )}
          </div>
        </section>

        {/* Architecture */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-semibold text-zinc-400 mb-3">Architecture</h2>
          <pre className="text-xs text-zinc-500 leading-relaxed">{`FOUNDATION (WHAT)                    PSY4 (WHEN/HOW)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CompositionEngine                    Transport (clock)
  → GroovePlan                       Scheduler (lookahead)
  → HarmonyPlan                      Synthesis (kick/bass/lead/hat)
  → Bass (LOCKED to kick)            Mixer (buses → master)
  → Lead (tessitura enforced)        FX (delay/reverb)
  → Arrangement (roles ON/OFF)
  → AdaptationLayer
    ← RadioMusicalContext
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FoundationMusicAdapter (SINGLE boundary)
  ComposedSection → PerformanceEvent[]
  beat-grid → AudioContext time
  intent → velocity/density adjustment`}</pre>
        </section>
      </main>

      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950">
        <div className="mx-auto max-w-5xl px-4 py-3 text-xs text-zinc-600 flex justify-between">
          <span>PSY4 × psy-foundation integration — F11.5</span>
          <span>{state ? `${state.eventsPlayed} / ${state.eventsScheduled} events played` : ''}</span>
        </div>
      </footer>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="text-xs uppercase tracking-wider text-zinc-600">{label}</div>
      <div className="mt-1 text-sm font-medium text-zinc-200 tabular-nums truncate">{value}</div>
    </div>
  )
}
