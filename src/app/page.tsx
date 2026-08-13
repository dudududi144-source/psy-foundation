'use client'

import { useState, useRef, useEffect } from 'react'

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
  }
}

function MetricBar({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
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
  const [bars, setBars] = useState(16)
  const [seed, setSeed] = useState(42)
  const [useSamples, setUseSamples] = useState(true)
  const [loading, setLoading] = useState(false)
  const [critiqueLoading, setCritiqueLoading] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [critique, setCritique] = useState<CritiqueData | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const render = async () => {
    setLoading(true)
    setCritique(null)
    setAudioUrl(null)
    try {
      const ts = Date.now()
      const url = `/api/render-forensic?bars=${bars}&seed=${seed}&samples=${useSamples}&t=${ts}`
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
        const data = await res.json() as CritiqueData
        setCritique(data)
      }
    } finally {
      setLoading(false)
      setCritiqueLoading(false)
    }
  }

  // Auto-render on first load
  useEffect(() => {
    render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scoreColor = critique
    ? critique.overallScore > 0.6 ? 'text-emerald-400'
    : critique.overallScore > 0.4 ? 'text-amber-400'
    : 'text-rose-400'
    : 'text-zinc-500'

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-200">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-4">
          <h1 className="text-lg font-bold text-zinc-50">PSY4 × Foundation</h1>
          <span className="text-xs text-zinc-500">F22 · forensic bridge · stereo PCM · sidechain · samples</span>
          <span className="ml-auto text-xs text-zinc-600">646 tests · 0 fail</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 space-y-6">
        {/* Render controls */}
        <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base font-semibold text-emerald-200">Forensic Bridge Audio Render</span>
            {critique && (
              <span className={`ml-auto text-2xl font-bold tabular-nums ${scoreColor}`}>
                {(critique.overallScore * 100).toFixed(0)}/100
              </span>
            )}
          </div>
          <p className="text-xs text-emerald-300/80 mb-4">
            Foundation CompositionEngine → RawScore → Forensic Engine (17 voices, sidechain, 5-bus mix, master chain) → Stereo PCM → WAV + AudioCritic
          </p>
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-zinc-400">Bars:</span>
              <select value={bars} onChange={e => setBars(Number(e.target.value))} className="bg-zinc-800 text-zinc-200 rounded px-2 py-1 text-sm border border-zinc-700">
                <option value={4}>4</option>
                <option value={8}>8</option>
                <option value={16}>16</option>
                <option value={32}>32</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-zinc-400">Seed:</span>
              <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} className="bg-zinc-800 text-zinc-200 rounded px-2 py-1 text-sm border border-zinc-700 w-20" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useSamples} onChange={e => setUseSamples(e.target.checked)} className="accent-emerald-500" />
              <span className="text-zinc-400">909/MD samples</span>
            </label>
            <button
              onClick={render}
              disabled={loading}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Rendering...' : 'Render + Critique'}
            </button>
          </div>
          {audioUrl && (
            <div className="mt-4">
              <audio ref={audioRef} controls src={audioUrl} className="w-full" />
              <p className="mt-2 text-xs text-zinc-500">
                <a href={audioUrl} download="psy4-forensic.wav" className="text-emerald-400 hover:underline">Download WAV</a>
                {' · '}
                <span>Stereo 44.1kHz · {critique?.renderInfo.events ?? 0} events · {critique?.renderInfo.durationSec.toFixed(1) ?? '—'}s</span>
              </p>
            </div>
          )}
        </section>

        {/* AudioCritic Results */}
        {critiqueLoading && (
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
            <p className="text-sm text-zinc-500 animate-pulse">Analyzing audio quality...</p>
          </section>
        )}

        {critique && (
          <>
            {/* Score + failures */}
            <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
              <div className="flex items-baseline gap-3 mb-4">
                <h2 className="text-lg font-semibold text-zinc-100">AudioCritic</h2>
                <span className={`text-3xl font-bold tabular-nums ${scoreColor}`}>
                  {(critique.overallScore * 100).toFixed(0)}
                </span>
                <span className="text-sm text-zinc-500">/ 100</span>
                <span className="ml-auto text-xs text-zinc-600">
                  {critique.failures.length} failures · {critique.renderInfo.stereo ? 'stereo' : 'mono'} · {critique.renderInfo.samples ? 'samples' : 'synth'}
                </span>
              </div>

              {/* Failures */}
              {critique.failures.length > 0 && (
                <div className="space-y-2 mb-4">
                  <h3 className="text-xs uppercase tracking-wider text-zinc-500">Diagnosed Failures</h3>
                  {critique.failures.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 rounded border border-rose-500/20 bg-rose-500/5 p-2">
                      <span className="text-rose-400 text-xs font-mono mt-0.5 shrink-0">{f.code}</span>
                      <div className="min-w-0">
                        <span className="text-xs text-zinc-400">{f.diagnosis}</span>
                        <span className="text-xs text-emerald-400/70 block mt-0.5">→ {f.correctionHint}</span>
                      </div>
                      <span className="text-xs text-rose-300 tabular-nums shrink-0 ml-auto">{(f.severity * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Metrics */}
              <div className="grid gap-2 sm:grid-cols-2">
                <MetricBar label="Kick Clarity" value={critique.metrics.kickClarity} />
                <MetricBar label="Bass Clarity" value={critique.metrics.bassClarity} />
                <MetricBar label="K/B Separation" value={critique.metrics.kickBassSeparation} />
                <MetricBar label="Sub Mud" value={critique.metrics.subMud} invert />
                <MetricBar label="Punch" value={critique.metrics.punch} />
                <MetricBar label="Attack Sharp" value={critique.metrics.attackSharpness} />
                <MetricBar label="Bass Decay Ovlp" value={critique.metrics.bassDecayOverlap} invert />
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
          </>
        )}

        {/* Pipeline */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-100 mb-3">Pipeline</h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 overflow-x-auto">
            <pre className="text-xs text-zinc-400 font-mono leading-relaxed whitespace-pre">{`Foundation CompositionEngine (WHAT)
  ├── HarmonicPlan · PhraseMaterial · GroovePlan
  ├── KickPlan → BassPlan → LeadPlan
  ├── TensionDimensions (7) · InteractionGrammar (5)
  └── LearnedIdentity (Source A/B)
        ↓
RawScore Serializer (frozen)
        ↓
Forensic Bridge (HOW)
  ├── RollingBassVoice (sub+mid+Moog, SUSTAIN)
  ├── KickVoice (3-layer: sub+body+click) / 909 sample
  ├── LeadVoice (5-osc supersaw+Moog+LFO+Haas)
  ├── HatVoice / MD sample
  ├── Sidechain (kick→bass duck, 250ms recovery)
  ├── 5-bus mix (drum/bass/music: HP+comp+drive)
  ├── SchroederReverb + StereoDelay
  └── MasterChain (glue+sat+limiter)
        ↓
Stereo PCM → WAV + AudioCritic`}</pre>
          </div>
        </section>

        {/* Stats */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Tests</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums">646</div>
            <div className="mt-0.5 text-xs text-zinc-500">0 fail</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Samples</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums">141</div>
            <div className="mt-0.5 text-xs text-zinc-500">909 · MD · Nord</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Voices</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums">17</div>
            <div className="mt-0.5 text-xs text-zinc-500">forensic engine</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Render</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums">~600ms</div>
            <div className="mt-0.5 text-xs text-zinc-500">8 bars @ 145 BPM</div>
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950">
        <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
          <span className="font-mono text-zinc-500">github.com/dudududi144-source/psy-foundation</span>
          <span>·</span>
          <span>F22 · forensic bridge · stereo · sidechain · samples · AudioCritic</span>
          <span className="ml-auto">646 tests · 0 fail</span>
        </div>
      </footer>
    </div>
  )
}
