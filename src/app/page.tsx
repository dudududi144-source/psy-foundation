'use client'

import { useState, useRef } from 'react'

export default function Home() {
  const [bars, setBars] = useState(8)
  const [seed, setSeed] = useState(42)
  const [useSamples, setUseSamples] = useState(true)
  const [loading, setLoading] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const render = async () => {
    setLoading(true)
    try {
      const url = `/api/render-forensic?bars=${bars}&seed=${seed}&samples=${useSamples}`
      setAudioUrl(url)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-200">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-4">
          <h1 className="text-lg font-bold text-zinc-50">PSY4 × Foundation</h1>
          <span className="text-xs text-zinc-500">F22 · forensic bridge · Foundation→RawScore→Forensic→PCM</span>
          <span className="ml-auto text-xs text-zinc-600">333 tests · TypeScript strict</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 space-y-8">
        {/* Render controls */}
        <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base font-semibold text-emerald-200">Forensic Bridge Audio Render</span>
          </div>
          <p className="text-xs text-emerald-300/80 mb-4">
            Foundation CompositionEngine → RawScore → Forensic Engine (17 voices, 5-bus mix, sidechain, master chain) → Stereo PCM → WAV
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
              <span className="text-zinc-400">Use 909/MD samples</span>
            </label>
            <button
              onClick={render}
              disabled={loading}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Rendering...' : 'Render Audio'}
            </button>
          </div>
          {audioUrl && (
            <div className="mt-4">
              <audio ref={audioRef} controls src={audioUrl} className="w-full" />
              <p className="mt-2 text-xs text-zinc-500">
                <a href={audioUrl} download="psy4-forensic.wav" className="text-emerald-400 hover:underline">Download WAV</a>
                {' · '}
                <span>Same seed = same audio (deterministic)</span>
              </p>
            </div>
          )}
        </section>

        {/* Pipeline */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-100 mb-3">Pipeline</h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 overflow-x-auto">
            <pre className="text-xs text-zinc-400 font-mono leading-relaxed whitespace-pre">{`Foundation CompositionEngine (WHAT)
  ├── HarmonicPlan (chords, cadence)
  ├── PhraseMaterial (motif, contour, arc, 10 operators)
  ├── GroovePlan (kick skeleton, accents, syncopation)
  ├── KickPlan → BassPlan → RhythmicSpaceMap → LeadPlan
  ├── TensionDimensions (7 dimensions, all consumed)
  ├── InteractionGrammar (kick→bass, bass→lead, harmony→lead)
  └── LearnedIdentity (Source A: narrow/rolling/descending)
        ↓
RawScore Serializer (frozen — read-only)
        ↓
Forensic Bridge (HOW)
  ├── RollingBassVoice (sub+mid+Moog, SUSTAIN for rolling bass)
  ├── KickVoice (3-layer: sub sine + body tri + click noise)
  ├── LeadVoice (5-osc supersaw + Moog + LFO + Haas stereo)
  ├── HatVoice (differentiated pink noise)
  ├── 909/MD Samples (optional — real drum samples)
  ├── Sidechain (kick → bass duck, 250ms recovery)
  ├── 5-bus mix (drum/bass/music with HP + comp + drive)
  ├── SchroederReverb + StereoDelay (FX sends)
  └── MasterChain (glue comp + saturation + limiter)
        ↓
Stereo PCM (44100Hz, 16-bit WAV)`}</pre>
          </div>
        </section>

        {/* Stats */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Tests</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums">333</div>
            <div className="mt-0.5 text-xs text-zinc-500">all green · 0 fail</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Samples</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums">141</div>
            <div className="mt-0.5 text-xs text-zinc-500">909 · Machinedrum · Nord</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Voice types</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums">17</div>
            <div className="mt-0.5 text-xs text-zinc-500">forensic engine</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Render</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums">~600ms</div>
            <div className="mt-0.5 text-xs text-zinc-500">8 bars @ 145 BPM</div>
          </div>
        </section>

        {/* Contract boundary */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-100 mb-3">Foundation ↔ PSY4 contract</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
              <div className="text-sm font-semibold text-sky-300 mb-2">Foundation = WHAT</div>
              <ul className="space-y-1 text-xs text-zinc-400">
                <li>✅ notes, timing, rhythm</li>
                <li>✅ harmony, scale, chord sequence</li>
                <li>✅ phrase structure, motif, development</li>
                <li>✅ groove intent (swing, syncopation, accents)</li>
                <li>✅ tension dimensions (7)</li>
                <li>✅ learned identity (vocabulary, contour)</li>
                <li>✅ voice relationships (kick→bass, bass→lead)</li>
              </ul>
            </div>
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
              <div className="text-sm font-semibold text-rose-300 mb-2">PSY4 Forensic = HOW</div>
              <ul className="space-y-1 text-xs text-zinc-400">
                <li>🔧 oscillator type, filter topology, envelope</li>
                <li>🔧 saturation, FM, modulation, stereo</li>
                <li>🔧 sidechain (kick → bass duck)</li>
                <li>🔧 bus compression + master chain</li>
                <li>🔧 reverb + delay sends</li>
                <li>🔧 sample selection (909, Machinedrum)</li>
                <li>🔧 PCM rendering + WAV encode</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Key fixes */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-100 mb-3">Key fixes in this bridge</h2>
          <div className="space-y-2">
            <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <span className="text-emerald-400 text-xs font-mono mt-0.5">FIX</span>
              <div>
                <div className="text-sm text-zinc-200">Rolling bass envelope (sustain)</div>
                <div className="text-xs text-zinc-500">Original forensic BassVoice dies at 120ms (one-shot decay). Fixed: added sustain phase + 30ms release. Bass now rolls continuously across 16th notes.</div>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <span className="text-emerald-400 text-xs font-mono mt-0.5">ADD</span>
              <div>
                <div className="text-sm text-zinc-200">Sidechain compression</div>
                <div className="text-xs text-zinc-500">Kick triggers bass duck (0.3 depth, 250ms one-pole recovery). The defining psytrance mix technique — kick and bass no longer fight for the same spectrum.</div>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <span className="text-emerald-400 text-xs font-mono mt-0.5">ADD</span>
              <div>
                <div className="text-sm text-zinc-200">Stereo output</div>
                <div className="text-xs text-zinc-500">Lead gets 18ms Haas widening. Separate L/R bus processors and master chains. Previous renderer was mono.</div>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <span className="text-emerald-400 text-xs font-mono mt-0.5">ADD</span>
              <div>
                <div className="text-sm text-zinc-200">Real samples (909/MD/Nord)</div>
                <div className="text-xs text-zinc-500">141 professional CC0 drum samples wired into the bridge. 909 kicks + Machinedrum hats replace synthetic noise.</div>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <span className="text-emerald-400 text-xs font-mono mt-0.5">ADD</span>
              <div>
                <div className="text-sm text-zinc-200">Full mix chain</div>
                <div className="text-xs text-zinc-500">5-bus architecture (drum/bass/music) with HP + compressor + drive per bus. SchroederReverb + StereoDelay sends. MasterChain with glue comp + saturation + limiter.</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950">
        <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
          <span className="font-mono text-zinc-500">github.com/dudududi144-source/psy-foundation</span>
          <span>·</span>
          <span>F22 · forensic bridge · Foundation→RawScore→Forensic→PCM</span>
          <span className="ml-auto">333 tests · 0 fail</span>
        </div>
      </footer>
    </div>
  )
}
