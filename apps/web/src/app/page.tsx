'use client'

import { useState, useRef, useEffect } from 'react'
import { DESIGN } from '@/lib/psy4/design-system'

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
  const [bars, setBars] = useState(8)
  const [seed, setSeed] = useState(42)
  const [useSamples, setUseSamples] = useState(true)
  const [loading, setLoading] = useState(false)
  const [critiqueLoading, setCritiqueLoading] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [critique, setCritique] = useState<CritiqueData | null>(null)
  const [optReport, setOptReport] = useState<OptReport | null>(null)
  const [arrangement, setArrangement] = useState<any | null>(null)
  const [audioReady, setAudioReady] = useState(false)
  const [presets, setPresets] = useState<any[]>([])
  const [showPresets, setShowPresets] = useState(false)
  const [uploadingRef, setUploadingRef] = useState(false)
  const [referenceInfo, setReferenceInfo] = useState<any | null>(null)
  const audioEngineRef = useRef<any>(null)
  const presetMgrRef = useRef<any>(null)
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

  const runOptimize = async () => {
    setOptimizing(true)
    setOptReport(null)
    try {
      const res = await fetch(`/api/optimize?seed=${seed}&bars=8&iterations=16&target=0.75`)
      if (res.ok) {
        const data = await res.json() as OptReport
        setOptReport(data)
      }
    } finally {
      setOptimizing(false)
    }
  }

  useEffect(() => {
    // Initialize preset manager and load factory presets
    import('@/lib/psy4/preset-manager').then(({ PresetManager }) => {
      presetMgrRef.current = new PresetManager()
      setPresets(presetMgrRef.current.getAll())
    })
    render()
  }, [])

  const scoreColor = critique
    ? critique.overallScore > 0.65 ? 'text-emerald-400'
    : critique.overallScore > 0.5 ? 'text-amber-400'
    : 'text-rose-400'
    : 'text-zinc-500'

  const optScoreMax = optReport ? Math.max(...optReport.iterations.map(i => i.score), 0.7) : 1

  return (
    <div className="min-h-screen flex flex-col text-zinc-200" style={{
      background: DESIGN.gradients.background,
      fontFamily: DESIGN.fonts.sans,
    }}>
      <header className="border-b border-zinc-800/50 backdrop-blur sticky top-0 z-10" style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}>
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-4">
          <h1 className="text-lg font-bold text-zinc-50" style={{ fontFamily: DESIGN.fonts.mono }}>psy-foundation</h1>
          <span className="text-xs text-zinc-500">v8.5 · ZDF SVF · ModulationMatrix · wavetable · granular · waveguide · 5-layer lead · LR4 bass · M/S master · dyn-EQ sidechain · stems · 16 iters</span>
          {critique?.version && <span className="text-xs text-cyan-500/60" style={{ fontFamily: DESIGN.fonts.mono }}>{critique.version}</span>}
          <span className="ml-auto text-xs text-zinc-600" style={{ fontFamily: DESIGN.fonts.mono }}>{critique ? `${(critique.overallScore * 100).toFixed(0)}/100` : ''}</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 space-y-6">
        {/* Render controls */}
        <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-5" style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base font-semibold text-emerald-200" style={{ fontFamily: DESIGN.fonts.mono }}>Render Engine v8.5</span>
            {critique && (
              <span className={`ml-auto text-2xl font-bold tabular-nums ${scoreColor}`}>
                {(critique.overallScore * 100).toFixed(0)}/100
              </span>
            )}
          </div>
          <p className="text-xs text-emerald-300/80 mb-4" style={{ fontFamily: DESIGN.fonts.mono }}>
            RawScore → 14 voices × ChannelFX (EQ+delay+reverb+pan+width) → 3-bus glue → Multiband (LR4) → StereoWidener (M/S) → LUFS (-9) → TruePeakLimiter (-1 dBTP)
          </p>
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-zinc-400">Bars:</span>
              <select value={bars} onChange={e => setBars(Number(e.target.value))} className="bg-zinc-800 text-zinc-200 rounded px-2 py-1 text-sm border border-zinc-700">
                <option value={4}>4</option>
                <option value={8}>8</option>
                <option value={16}>16</option>
                <option value={32}>32</option>
                <option value={88}>88 (full)</option>
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
                <a href={`/api/render-forensic?bars=${bars}&seed=${seed}&samples=${useSamples}&format=aiff`} download="psy4-forensic.aiff" className="text-cyan-400 hover:underline">AIFF</a>
                {' · '}
                <a href={`/api/render-forensic?bars=${bars}&seed=${seed}&samples=${useSamples}&format=flac`} download="psy4-forensic.flac" className="text-violet-400 hover:underline">FLAC</a>
                {' · '}
                <span>Stereo 44.1kHz · {critique?.renderInfo.events ?? 0} events · {critique?.renderInfo.durationSec.toFixed(1) ?? '—'}s</span>
                {critique?.renderInfo.lufs !== undefined && (
                  <span> · LUFS {critique.renderInfo.lufs.toFixed(1)} · Peak {critique.renderInfo.truePeakDb?.toFixed(1)}dB · Width {critique.renderInfo.stereoWidth?.toFixed(2)}</span>
                )}
              </p>
              <p className="mt-2 text-xs text-zinc-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-zinc-400" style={{ fontFamily: DESIGN.fonts.mono }}>Stems (mastering-ready):</span>
                <a
                  href={`/api/render-forensic?bars=${bars}&seed=${seed}&samples=${useSamples}&stem=drum`}
                  download={`psy4-stem-drum-bars${bars}-seed${seed}.wav`}
                  className="text-cyan-400 hover:underline"
                  title="Download the drum bus (post-bus-glue, pre-master) as a stereo WAV"
                >Download Drum Stem</a>
                <a
                  href={`/api/render-forensic?bars=${bars}&seed=${seed}&samples=${useSamples}&stem=bass`}
                  download={`psy4-stem-bass-bars${bars}-seed${seed}.wav`}
                  className="text-cyan-400 hover:underline"
                  title="Download the bass bus (post-bus-glue, pre-master) as a stereo WAV"
                >Download Bass Stem</a>
                <a
                  href={`/api/render-forensic?bars=${bars}&seed=${seed}&samples=${useSamples}&stem=music`}
                  download={`psy4-stem-music-bars${bars}-seed${seed}.wav`}
                  className="text-cyan-400 hover:underline"
                  title="Download the music bus (post-bus-glue, pre-master) as a stereo WAV"
                >Download Music Stem</a>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-400" style={{ fontFamily: DESIGN.fonts.mono }}>Neural:</span>
                <a
                  href={`/api/style-transfer?bars=${bars}&seed=${seed}&samples=${useSamples}&blend=0.3`}
                  download={`psy4-style-transfer-bars${bars}-seed${seed}.wav`}
                  className="text-fuchsia-400 hover:underline"
                  title="Apply spectral style transfer (RAVE-style, 30% blend)"
                >Style Transfer (30%)</a>
                <a
                  href={`/api/style-transfer?bars=${bars}&seed=${seed}&samples=${useSamples}&blend=0.6`}
                  download={`psy4-style-transfer-strong-bars${bars}-seed${seed}.wav`}
                  className="text-fuchsia-400 hover:underline"
                  title="Apply spectral style transfer (RAVE-style, 60% blend)"
                >Style Transfer (60%)</a>
              </p>
            </div>
          )}
        </section>

        {/* Auto-Optimize */}
        <section className="rounded-lg border border-violet-500/40 bg-violet-500/10 p-5" style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base font-semibold text-violet-200" style={{ fontFamily: DESIGN.fonts.mono }}>Auto-Fixer v8.5 (Stage 9)</span>
            <button
              onClick={runOptimize}
              disabled={optimizing}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-violet-500 px-3 py-1.5 text-xs font-semibold text-violet-950 hover:bg-violet-400 disabled:opacity-50 transition-colors"
            >
              {optimizing ? 'Optimizing...' : 'Run Auto-Optimize (16 iters)'}
            </button>
          </div>
          <p className="text-xs text-violet-300/80 mb-3" style={{ fontFamily: DESIGN.fonts.mono }}>
            Closed-loop: render → critique → diagnose → vary DSP parameters (hatGain, leadCutoff, bassGain, duckAmount, stereoWidth...) → re-render. 16 plans + 2 adaptive passes with severity-scaled corrections.
          </p>
          {optReport && (
            <div className="space-y-3">
              <div className="flex items-baseline gap-4 text-sm">
                <span className="text-zinc-400">Initial: <span className="text-zinc-200 font-mono">{optReport.initialScore.toFixed(4)}</span></span>
                <span className="text-zinc-400">Final: <span className={`font-mono font-bold ${optReport.finalScore > optReport.initialScore ? 'text-emerald-400' : 'text-zinc-300'}`}>{optReport.finalScore.toFixed(4)}</span></span>
                <span className="text-zinc-400">Δ: <span className={optReport.improvement >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{optReport.improvement >= 0 ? '+' : ''}{optReport.improvement.toFixed(4)}</span></span>
                <span className="text-zinc-400">Verdict: <span className={`font-semibold ${optReport.verdict === 'PASS' ? 'text-emerald-400' : optReport.verdict === 'PARTIAL' ? 'text-amber-400' : 'text-rose-400'}`}>{optReport.verdict}</span></span>
                <span className="text-zinc-500 ml-auto">{(optReport.durationMs / 1000).toFixed(1)}s</span>
              </div>
              {/* Score chart */}
              <div className="flex items-end gap-1 h-24 bg-zinc-900/60 rounded p-2">
                {optReport.iterations.map(it => {
                  const h = Math.max(4, (it.score / optScoreMax) * 80)
                  const isBest = it.iteration === optReport.bestIteration
                  return (
                    <div key={it.iteration} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${it.configName}: ${it.score.toFixed(4)}`}>
                      <span className="text-[10px] tabular-nums text-zinc-500">{it.score.toFixed(3)}</span>
                      <div className={`w-full rounded-t ${isBest ? 'bg-violet-400' : 'bg-violet-600'}`} style={{ height: `${h}px` }} />
                      <span className="text-[9px] text-zinc-600 truncate w-full text-center">{it.configName}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        {/* Real-Time Playback (AudioWorklet) */}
        <section className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-5" style={{ boxShadow: DESIGN.shadows.panel }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base font-semibold text-cyan-200" style={{ fontFamily: DESIGN.fonts.mono }}>Real-Time Playback</span>
            <button
              onClick={async () => {
                try {
                  const { PSY4AudioEngine } = await import('@/lib/psy4/audio-engine')
                  if (!audioEngineRef.current) {
                    audioEngineRef.current = new PSY4AudioEngine()
                  }
                  const ok = await audioEngineRef.current.init()
                  if (ok) {
                    await audioEngineRef.current.resume()
                    setAudioReady(true)
                  }
                } catch (e) {
                  console.error('Audio init failed:', e)
                }
              }}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-cyan-950 hover:bg-cyan-400 transition-colors"
            >
              {audioReady ? 'Audio Ready' : 'Start Audio'}
            </button>
          </div>
          <p className="text-xs text-cyan-300/80 mb-3">
            AudioWorklet real-time synthesis — click a key to play. MIDI input supported.
          </p>
          {audioReady && (
            <div className="space-y-3">
              {/* Virtual Keyboard */}
              <div className="flex flex-wrap gap-1">
                {[48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72].map((midi) => {
                  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
                  const note = noteNames[midi % 12] + Math.floor(midi / 12 - 1)
                  const isBlack = noteNames[midi % 12].includes('#')
                  return (
                    <button
                      key={midi}
                      onPointerDown={() => {
                        audioEngineRef.current?.noteOn(midi, 0.8)
                      }}
                      className={`px-2 py-3 text-[10px] font-mono rounded ${
                        isBlack ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-900 hover:bg-white'
                      }`}
                      style={{ minWidth: '32px' }}
                    >
                      {note}
                    </button>
                  )
                })}
              </div>
              {/* Cutoff slider */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-cyan-300 w-20">Cutoff:</span>
                <input
                  type="range"
                  min="200"
                  max="8000"
                  defaultValue="3000"
                  onChange={(e) => audioEngineRef.current?.setCutoff(Number(e.target.value))}
                  className="flex-1 accent-cyan-500"
                />
                <span className="text-zinc-400 w-16">Hz</span>
              </div>
              {/* Resonance slider */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-cyan-300 w-20">Resonance:</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  defaultValue="0.3"
                  onChange={(e) => audioEngineRef.current?.setResonance(Number(e.target.value))}
                  className="flex-1 accent-cyan-500"
                />
              </div>
              {/* Real-time spectrum analyzer */}
              {audioReady && (
                <div className="mt-3">
                  <div className="text-xs text-cyan-300 mb-1">Spectrum Analyzer</div>
                  <SpectrumAnalyzerLazy audioEngine={audioEngineRef.current} width={560} height={120} />
                </div>
              )}
            </div>
          )}
        </section>

        {/* Preset Manager */}
        <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-5" style={{ boxShadow: DESIGN.shadows.panel }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base font-semibold text-emerald-200" style={{ fontFamily: DESIGN.fonts.mono }}>Presets</span>
            <button
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
            {presets.filter(p => p.id.startsWith('factory-')).length} factory + {presets.filter(p => !p.id.startsWith('factory-')).length} user presets. Save/load/share patches as JSON.
          </p>
          {showPresets && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {presets.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-xs rounded border border-emerald-500/20 bg-emerald-500/5 p-2">
                  <span className="text-emerald-400 font-mono w-20 shrink-0">{p.category}</span>
                  <span className="text-zinc-200 flex-1">{p.name}</span>
                  <span className="text-zinc-500 text-[10px] truncate max-w-32">{p.description}</span>
                  <button
                    onClick={() => {
                      const pm = presetMgrRef.current
                      if (pm) pm.export(p)
                    }}
                    className="text-emerald-400 hover:text-emerald-300 text-[10px]"
                  >Export</button>
                  {!p.id.startsWith('factory-') && (
                    <button
                      onClick={() => {
                        const pm = presetMgrRef.current
                        if (pm) {
                          pm.delete(p.id)
                          setPresets(pm.getAll())
                        }
                      }}
                      className="text-rose-400 hover:text-rose-300 text-[10px]"
                    >Delete</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Reference Upload */}
        <section className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 p-5" style={{ boxShadow: DESIGN.shadows.panel }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base font-semibold text-fuchsia-200" style={{ fontFamily: DESIGN.fonts.mono }}>Reference Upload</span>
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
            {uploadingRef && <span className="text-xs text-fuchsia-300 animate-pulse">Analyzing...</span>}
          </div>
          {referenceInfo && (
            <div className="mt-3 text-xs space-y-1">
              <div className="text-fuchsia-300 font-mono">{referenceInfo.name} ({(referenceInfo.size / 1024).toFixed(0)}KB)</div>
              <div className="text-zinc-400">Centroid: <span className="text-zinc-200">{referenceInfo.latent.centroid} Hz</span></div>
              <div className="text-zinc-400">Flatness: <span className="text-zinc-200">{referenceInfo.latent.flatness}</span> (0=tonal, 1=noise)</div>
              <div className="text-fuchsia-400 font-mono text-[10px]">Hash: {referenceInfo.hash}</div>
            </div>
          )}
        </section>

        {/* AI Arrangement */}
        <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-5" style={{ boxShadow: DESIGN.shadows.panel }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base font-semibold text-amber-200" style={{ fontFamily: DESIGN.fonts.mono }}>AI Arrangement (Phase 4)</span>
            <button
              onClick={async () => {
                const res = await fetch(`/api/arrangement?seed=${seed}&bars=88`)
                if (res.ok) {
                  const data = await res.json()
                  setArrangement(data)
                }
              }}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-400 transition-colors"
            >
              Generate Arrangement
            </button>
          </div>
          <p className="text-xs text-amber-300/80 mb-3">
            Markov-chain section generator — every seed produces a different structure (intro→build→drop→break→drop2→climax→outro with random durations and transitions).
          </p>
          {arrangement && (
            <div className="space-y-2">
              <div className="flex items-baseline gap-3 text-xs">
                <span className="text-zinc-400">Structure:</span>
                <span className="text-amber-200 font-mono">{arrangement.summary}</span>
                <span className="text-zinc-500 ml-auto">Hash: <span className="font-mono text-amber-400">{arrangement.structureHash}</span></span>
                <span className="text-zinc-500">Bars: {arrangement.totalBars}</span>
              </div>
              <div className="grid gap-1.5">
                {arrangement.sections.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs rounded border border-amber-500/20 bg-amber-500/5 p-2">
                    <span className="text-amber-400 font-mono w-16 shrink-0">{s.name}</span>
                    <span className="text-zinc-400 w-12">{s.bars} bars</span>
                    <span className="text-zinc-400 w-16">E: {Math.round(s.energy * 100)}%</span>
                    <span className="text-zinc-400 w-16">{s.tensionShape}</span>
                    <span className="text-zinc-500 text-[10px] flex-1 truncate">{s.voices.length} voices</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* AudioCritic Results */}
        {critiqueLoading && (
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5" style={{ background: DESIGN.gradients.oled, boxShadow: DESIGN.shadows.oled }}>
            <p className="text-sm text-zinc-500 animate-pulse" style={{ fontFamily: DESIGN.fonts.mono }}>Analyzing audio quality...</p>
          </section>
        )}

        {critique && (
          <>
            <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5" style={{ background: DESIGN.gradients.oled, boxShadow: DESIGN.shadows.oled }}>
              <div className="flex items-baseline gap-3 mb-4">
                <h2 className="text-lg font-semibold text-zinc-100" style={{ fontFamily: DESIGN.fonts.mono }}>AudioCritic</h2>
                <span className={`text-3xl font-bold tabular-nums ${scoreColor}`}>
                  {(critique.overallScore * 100).toFixed(0)}
                </span>
                <span className="text-sm text-zinc-500">/ 100</span>
                <span className="ml-auto text-xs text-zinc-600" style={{ fontFamily: DESIGN.fonts.mono }}>
                  {critique.failures.length} failures · {critique.renderInfo.stereo ? 'stereo' : 'mono'} · {critique.renderInfo.samples ? 'samples' : 'synth'}
                </span>
              </div>

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

        {/* Master chain metrics */}
        {critique?.renderInfo.lufs !== undefined && (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4" style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}>
              <div className="text-xs uppercase tracking-wider text-zinc-500" style={{ fontFamily: DESIGN.fonts.mono }}>LUFS</div>
              <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums" style={{ fontFamily: DESIGN.fonts.mono }}>{critique.renderInfo.lufs.toFixed(1)}</div>
              <div className="mt-0.5 text-xs text-zinc-500">target -9</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4" style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}>
              <div className="text-xs uppercase tracking-wider text-zinc-500" style={{ fontFamily: DESIGN.fonts.mono }}>True Peak</div>
              <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums" style={{ fontFamily: DESIGN.fonts.mono }}>{critique.renderInfo.truePeakDb?.toFixed(1)}</div>
              <div className="mt-0.5 text-xs text-zinc-500">dBTP (limit -1)</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4" style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}>
              <div className="text-xs uppercase tracking-wider text-zinc-500" style={{ fontFamily: DESIGN.fonts.mono }}>Stereo Width</div>
              <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums" style={{ fontFamily: DESIGN.fonts.mono }}>{critique.renderInfo.stereoWidth?.toFixed(2)}</div>
              <div className="mt-0.5 text-xs text-zinc-500">M/S ratio</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4" style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}>
              <div className="text-xs uppercase tracking-wider text-zinc-500" style={{ fontFamily: DESIGN.fonts.mono }}>Gain Reduction</div>
              <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums" style={{ fontFamily: DESIGN.fonts.mono }}>{critique.renderInfo.gainReductionDb?.toFixed(1)}</div>
              <div className="mt-0.5 text-xs text-zinc-500">dB (limiter)</div>
            </div>
          </section>
        )}

        {/* Render Profile + Harmony */}
        {critique?.renderProfile && (
          <section className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-5" style={{ background: DESIGN.gradients.oled, boxShadow: DESIGN.shadows.oled }}>
            <div className="flex items-baseline gap-3 mb-3">
              <h2 className="text-lg font-semibold text-cyan-300" style={{ fontFamily: DESIGN.fonts.mono }}>Render Profile</h2>
              <span className="text-xs text-zinc-500" style={{ fontFamily: DESIGN.fonts.mono }}>measured on render output · not a real reference</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
                <div className="text-xs uppercase tracking-wider text-cyan-400" style={{ fontFamily: DESIGN.fonts.mono }}>Centroid</div>
                <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums" style={{ fontFamily: DESIGN.fonts.mono }}>{critique.renderProfile.spectralCentroid}</div>
                <div className="mt-0.5 text-xs text-zinc-500">Hz brightness</div>
              </div>
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
                <div className="text-xs uppercase tracking-wider text-cyan-400" style={{ fontFamily: DESIGN.fonts.mono }}>Bass Ratio</div>
                <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums" style={{ fontFamily: DESIGN.fonts.mono }}>{(critique.renderProfile.bassEnergy * 100).toFixed(0)}%</div>
                <div className="mt-0.5 text-xs text-zinc-500">20-250Hz</div>
              </div>
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
                <div className="text-xs uppercase tracking-wider text-cyan-400" style={{ fontFamily: DESIGN.fonts.mono }}>High Ratio</div>
                <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums" style={{ fontFamily: DESIGN.fonts.mono }}>{(critique.renderProfile.highEnergy * 100).toFixed(0)}%</div>
                <div className="mt-0.5 text-xs text-zinc-500">2-12kHz</div>
              </div>
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
                <div className="text-xs uppercase tracking-wider text-cyan-400" style={{ fontFamily: DESIGN.fonts.mono }}>Crest Factor</div>
                <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums" style={{ fontFamily: DESIGN.fonts.mono }}>{critique.renderProfile.crestFactor.toFixed(2)}</div>
                <div className="mt-0.5 text-xs text-zinc-500">peak/RMS</div>
              </div>
            </div>
          </section>
        )}

        {/* Harmony Info */}
        {critique?.harmony && (
          <section className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-4" style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs uppercase tracking-wider text-violet-400" style={{ fontFamily: DESIGN.fonts.mono }}>Harmony</span>
              <span className="text-sm text-zinc-300 font-mono" style={{ fontFamily: DESIGN.fonts.mono }}>{critique.harmony.scale}</span>
              <span className="text-xs text-zinc-500" style={{ fontFamily: DESIGN.fonts.mono }}>root: {critique.harmony.rootNote}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {critique.harmony.progression.map((chord, i) => (
                <span key={i} className="px-3 py-1 rounded bg-violet-500/20 text-violet-200" style={{ fontFamily: DESIGN.fonts.mono }}>
                  {chord}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Voice Strip — 12 voice chips colored by DESIGN.voiceColors tokens */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5" style={{ background: DESIGN.gradients.chassis, boxShadow: DESIGN.shadows.panel }}>
          <div className="flex items-baseline gap-3 mb-3">
            <h2 className="text-lg font-semibold text-zinc-100" style={{ fontFamily: DESIGN.fonts.mono }}>Voice Strip</h2>
            <span className="text-xs text-zinc-500" style={{ fontFamily: DESIGN.fonts.mono }}>12 voice types · color-coded by mix role</span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {([
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
            ] as const).map(([key, label]) => {
              const c = DESIGN.voiceColors[key]
              return (
                <div key={key} className={`rounded-md border ${c.border} ${c.bg} px-2 py-2 text-center`}>
                  <div className={`text-xs font-semibold ${c.text}`} style={{ fontFamily: DESIGN.fonts.mono }}>{label}</div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Pipeline */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-100 mb-3" style={{ fontFamily: DESIGN.fonts.mono }}>Pipeline (v8.5)</h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 overflow-x-auto" style={{ background: DESIGN.gradients.oled, boxShadow: DESIGN.shadows.oled }}>
            <pre className="text-xs text-zinc-400 font-mono leading-relaxed whitespace-pre" style={{ fontFamily: DESIGN.fonts.mono }}>{`Foundation CompositionEngine (WHAT — frozen)
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
      </main>

      <footer className="mt-auto border-t border-zinc-800" style={{ background: DESIGN.gradients.chassis }}>
        <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
          <span style={{ fontFamily: DESIGN.fonts.mono }} className="text-zinc-500">github.com/dudududi144-source/psy-foundation</span>
          <span>·</span>
          <span style={{ fontFamily: DESIGN.fonts.mono }}>v8.5 · ZDF SVF · ModulationMatrix · M/S master · dyn-EQ sidechain · stems export · wavetable · granular · waveguide</span>
          <span className="ml-auto" style={{ fontFamily: DESIGN.fonts.mono }}>deterministic · 88 bars · 13 voices · PsyDevice</span>
        </div>
      </footer>
    </div>
  )
}

// Lazy-loaded SpectrumAnalyzer (client-only, dynamic import)
import { lazy, Suspense } from 'react'
const SpectrumAnalyzerLazy = lazy(() =>
  import('@/components/spectrum-analyzer').then(m => ({ default: m.SpectrumAnalyzer }))
)
