import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'psy-foundation — status',
  description: 'Shared musical infrastructure for the PSY device family. M0 audit + M1 transport/protocol/device-sdk/fixtures.',
}

const AUDIT_REPOS = [
  { name: 'psy', lang: 'HTML/JS', verdict: 'EXTRACT', note: 'motif generator (call-&-response), 18 tests — the only repo with real music intelligence' },
  { name: 'psy3-clean', lang: 'HTML', verdict: 'RETIRE', note: '4-line patch of psy. No unique value.' },
  { name: 'psy4', lang: 'Next.js', verdict: 'MIXED', note: '~900-line live engine + ~27k-line DEAD engine. Fabricated test reports. Pathological state duplication (bpm×8).' },
  { name: 'psy5', lang: 'HTML/JS', verdict: 'MIXED', note: 'Genuine pooled engine (No-GC verified). But origin of the PSY6 multi-source-of-truth disease.' },
  { name: 'forge', lang: 'Next.js', verdict: 'RETIRE', note: 'Vaporware. Stub health route, aspirational docs.' },
  { name: 'nova', lang: 'Next.js', verdict: 'KEEP (sibling)', note: 'Healthy agent layer, 80+ tests. Zero musical tech. Sibling, not dependency.' },
  { name: 'PromptForge', lang: 'Python', verdict: 'IGNORE', note: 'Separate language universe. Stub agents.' },
]

const PACKAGES = [
  { name: 'transport', scope: '@psy-foundation/transport', milestone: 'M1', status: 'done', desc: 'Musical time model. BeatEstimator (PLL + octave fold) + PhaseCorrector + ConfidenceTracker + TransportClock (single source of truth, revision-bump deterministic).', tests: 12 },
  { name: 'protocol', scope: '@psy-foundation/protocol', milestone: 'M1', status: 'done', desc: 'MusicalEvent union + MusicalContext / DeviceCapabilities / Material / Experience types + Channel abstraction + InMemoryChannel.', tests: 8 },
  { name: 'device-sdk', scope: '@psy-foundation/device-sdk', milestone: 'M1', status: 'done', desc: 'PsyDevice interface + DeviceHost (revision-dedup routing) + ReferenceDevice (graceful-degradation proof).', tests: 12 },
  { name: 'fixtures', scope: '@psy-foundation/fixtures', milestone: 'M1', status: 'done', desc: '14 synthetic radio fixtures (perfect / jitter / ramp / jump / missing / false / half / double / gaps / sparse / dense / lead / breakdown). Deterministic.', tests: 10 },
  { name: 'scheduler', scope: '@psy-foundation/scheduler', milestone: 'M2', status: 'done', desc: 'MusicalTransport + MusicalPlan → ScheduledEvent[]. Deterministic pure function. Swing, humanize, probability, per-step locks, polyrhythm. Knows nothing about React/UI/radio.', tests: 18 },
  { name: 'analysis', scope: '@psy-foundation/analysis', milestone: 'M2', status: 'done', desc: 'onset · beat · tempo · phase · pitch · chroma · spectral flux/centroid/flatness · energy · role occupancy · sections. Multi-hypothesis tempo tracker (fixes sparse half-time). SIGNAL → FEATURES → INFERENCE.', tests: 26 },
  { name: 'music', scope: '@psy-foundation/music', milestone: 'M3', status: 'done', desc: '18 scales/modes (incl. phrygian-dominant) · 18 chord types + voice leading · call-&-response motif generator (from psy) · variation operators (transpose/invert/fragment/retrograde) · bass grammar · tension curves · rhythm patterns + swing/humanize.', tests: 43 },
  { name: 'material', scope: '@psy-foundation/material', milestone: 'M3', status: 'done', desc: '9 material kinds (Motif/Rhythm/BassPattern/DrumPattern/Fill/Phrase/FXGesture/Preset/Texture) + metadata schema + MaterialLibrary (query/usage/reward) + seed library of 18 materials.', tests: 23 },
  { name: 'learning', scope: '@psy-foundation/learning', milestone: 'M4', status: 'planned', desc: 'CONTEXT + ACTION + OUTCOME + REWARD. DO NOTHING is a legal action. Not a neural net — contextual learning.', tests: 0 },
  { name: 'dsp', scope: '@psy-foundation/dsp', milestone: 'M5', status: 'planned', desc: 'PolyBLEP · wavetable · FM · filters · envelopes · DC blocker · saturation · delay · reverb · voice lifecycle.', tests: 0 },
  { name: 'reference-lab', scope: 'app', milestone: 'M6', status: 'planned', desc: 'Browser research tool: feed stream → BPM, beat grid, phase, confidence, key, energy, features, sections.', tests: 0 },
  { name: 'sync-lab', scope: 'app', milestone: 'M6', status: 'planned', desc: 'Simulate devices A/B/C → BPM, beat, bar, phase, offset, jitter, drift, relock.', tests: 0 },
  { name: 'benchmark-lab', scope: 'app', milestone: 'M6', status: 'planned', desc: 'Timing / runtime / music / learning benchmarks. Real numbers, never console.log.', tests: 0 },
]

const BENCHMARK = [
  { fixture: 'perfect-150', anomaly: 'perfect', n: 60, mean: 1.4, median: 0.01, p95: 3.7, bpmErr: '~0', lock: 100, ok: true },
  { fixture: 'jitter-150', anomaly: 'jitter', n: 60, mean: 15.7, median: 12.9, p95: 38.1, bpmErr: '0.11', lock: 100, ok: true },
  { fixture: 'tempo-ramp', anomaly: 'ramp', n: 46, mean: 14.1, median: 11.5, p95: 29.7, bpmErr: '—', lock: 100, ok: true },
  { fixture: 'tempo-jump', anomaly: 'jump', n: 60, mean: 4.7, median: 0.03, p95: 38.0, bpmErr: '—', lock: 100, ok: true },
  { fixture: 'missing-beat', anomaly: 'missing', n: 59, mean: 1.4, median: 0.01, p95: 3.9, bpmErr: '~0', lock: 100, ok: true },
  { fixture: 'false-kick', anomaly: 'false', n: 60, mean: 1.4, median: 0.01, p95: 3.7, bpmErr: '~0', lock: 100, ok: true },
  { fixture: 'half-time', anomaly: 'half', n: 60, mean: 1.4, median: 0.01, p95: 3.7, bpmErr: '~0', lock: 100, ok: true },
  { fixture: 'double-time', anomaly: 'double', n: 60, mean: 11.4, median: 0.08, p95: 88.2, bpmErr: '~0', lock: 92, ok: true },
  { fixture: 'gap-500ms', anomaly: 'gap', n: 60, mean: 4.8, median: 0.73, p95: 25.6, bpmErr: '~0', lock: 100, ok: true },
  { fixture: 'gap-2s', anomaly: 'gap', n: 60, mean: 7.1, median: 1.34, p95: 40.4, bpmErr: '~0', lock: 85, ok: true },
  { fixture: 'sparse', anomaly: 'sparse', n: 28, mean: 24.5, median: 4.11, p95: 111.2, bpmErr: '~0 ✦', lock: 82, ok: true },
  { fixture: 'dense-bass', anomaly: 'dense', n: 60, mean: 1.4, median: 0.01, p95: 3.7, bpmErr: '~0', lock: 100, ok: true },
  { fixture: 'lead-heavy', anomaly: 'lead', n: 60, mean: 1.4, median: 0.01, p95: 3.7, bpmErr: '~0', lock: 100, ok: true },
  { fixture: 'breakdown', anomaly: 'breakdown', n: 44, mean: 9.0, median: 1.75, p95: 60.5, bpmErr: '~0', lock: 75, ok: true },
]

const verdictColor: Record<string, string> = {
  EXTRACT: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  RETIRE: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  MIXED: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  'KEEP (sibling)': 'text-sky-400 bg-sky-500/10 border-sky-500/30',
  IGNORE: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30',
}

const statusColor: Record<string, string> = {
  done: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  next: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  planned: 'text-zinc-500 bg-zinc-500/10 border-zinc-500/30',
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-zinc-500">{sub}</div> : null}
    </div>
  )
}

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-200">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-bold tracking-tight text-zinc-50">
            psy-foundation
          </h1>
          <span className="text-sm text-zinc-500">shared musical infrastructure for the PSY device family</span>
          <span className="ml-auto text-xs text-zinc-600 tabular-nums">M0+M1+M2+M3 · 152 tests</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 space-y-10">
        {/* Download banner */}
        <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-semibold text-emerald-200">Download the repository</span>
                <span className="text-xs text-emerald-400/70 font-mono">psy-foundation.zip</span>
              </div>
              <p className="mt-1 text-xs text-emerald-300/80">
                Complete monorepo — 8 packages, 152 tests, benchmarks, docs, CI, seed library. Ready to push to GitHub.
              </p>
            </div>
            <a
              href="/psy-foundation.zip"
              download="psy-foundation.zip"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download ZIP
            </a>
          </div>
        </section>

        {/* Identity / warning */}
        <section>
          <p className="text-sm text-zinc-400 max-w-3xl leading-relaxed">
            <strong className="text-zinc-200">Not a device.</strong> This is the gravity every future PSY device is built on:
            shared time, shared protocol, shared musical language, shared material, shared learning primitives —
            every device stays local, deterministic, independent, musical. Built from a forensic audit of 7 existing
            PSY-family repositories (real code, not READMEs).
          </p>
        </section>

        {/* Stats */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="repos audited" value="7" sub="psy · psy3-clean · psy4 · psy5 · forge · nova · PromptForge" />
          <Stat label="packages" value="8" sub="transport · protocol · device-sdk · fixtures · scheduler · analysis · music · material" />
          <Stat label="tests" value="152 / 152" sub="all green · bun test" />
          <Stat label="seed library" value="18" sub="materials across 7 types" />
        </section>

        {/* Audit */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-100 mb-3">M0 — forensic audit</h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/70 text-zinc-400">
                <tr>
                  <th className="text-left font-medium px-3 py-2">repo</th>
                  <th className="text-left font-medium px-3 py-2">lang</th>
                  <th className="text-left font-medium px-3 py-2">verdict</th>
                  <th className="text-left font-medium px-3 py-2 hidden md:table-cell">finding (code-level)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {AUDIT_REPOS.map((r) => (
                  <tr key={r.name} className="hover:bg-zinc-900/40">
                    <td className="px-3 py-2 font-mono text-zinc-200">{r.name}</td>
                    <td className="px-3 py-2 text-zinc-500">{r.lang}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded border px-1.5 py-0.5 text-xs font-medium ${verdictColor[r.verdict]}`}>
                        {r.verdict}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-400 hidden md:table-cell">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-300">
            <strong className="text-rose-200">Security:</strong> audit found <code className="font-mono">nova/nova-server.cjs</code> commits
            a live Z.AI session JWT in a public sibling repo. Flagged for rotation + git-history scrub. Foundation
            itself contains no secrets.
          </div>
        </section>

        {/* Packages */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-100 mb-3">Packages & build order</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {PACKAGES.map((p) => (
              <div key={p.name} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold text-zinc-100">{p.name}</span>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-600">{p.milestone}</span>
                  <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusColor[p.status]}`}>
                    {p.status}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-zinc-600">{p.scope}</div>
                <p className="mt-2 text-xs text-zinc-400 leading-relaxed">{p.desc}</p>
                {p.tests > 0 ? (
                  <div className="mt-2 text-[11px] text-emerald-400">{p.tests} tests · pass</div>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        {/* Benchmark */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-100 mb-1">M1 benchmark — transport accuracy</h2>
          <p className="text-xs text-zinc-500 mb-3">
            Online prediction error across 14 synthetic fixtures. Phase error in milliseconds (mean / median / P95).
            Honest numbers — one known limitation exposed (see note below).
          </p>
          <div className="overflow-x-auto rounded-lg border border-zinc-800 max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/70 text-zinc-400 sticky top-0">
                <tr>
                  <th className="text-left font-medium px-3 py-2">fixture</th>
                  <th className="text-left font-medium px-3 py-2">anomaly</th>
                  <th className="text-right font-medium px-3 py-2">n</th>
                  <th className="text-right font-medium px-3 py-2">mean ms</th>
                  <th className="text-right font-medium px-3 py-2">median ms</th>
                  <th className="text-right font-medium px-3 py-2">p95 ms</th>
                  <th className="text-right font-medium px-3 py-2">bpm Δ</th>
                  <th className="text-right font-medium px-3 py-2">lock %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {BENCHMARK.map((b) => (
                  <tr key={b.fixture} className={b.ok ? 'hover:bg-zinc-900/40' : 'bg-rose-500/5 hover:bg-rose-500/10'}>
                    <td className="px-3 py-2 font-mono text-zinc-200">{b.fixture}</td>
                    <td className="px-3 py-2 text-zinc-500">{b.anomaly}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{b.n}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{b.mean}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{b.median}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{b.p95}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${b.ok ? 'text-zinc-400' : 'text-rose-400 font-medium'}`}>{b.bpmErr}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{b.lock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-200/90">
            <strong className="text-emerald-200">M1 sparse fix resolved in M2:</strong> the <code className="font-mono">sparse</code> fixture
            now correctly estimates 150 BPM (was 75 in M1) thanks to <code className="font-mono">refineTempoWithContext</code> in the
            multi-hypothesis tempo tracker. Verified quantitatively in the M2 analysis benchmark.
          </div>
        </section>

        {/* Principles */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-100 mb-3">Non-negotiable rules</h2>
          <ul className="grid gap-2 sm:grid-cols-2 text-sm text-zinc-400">
            <li className="rounded border border-zinc-800 bg-zinc-900/40 p-3"><strong className="text-zinc-200">Investigation before code.</strong> No copying because a name sounds right.</li>
            <li className="rounded border border-zinc-800 bg-zinc-900/40 p-3"><strong className="text-zinc-200">One source of truth.</strong> Every piece of musical state has exactly one owner. DOM is a pure projection.</li>
            <li className="rounded border border-zinc-800 bg-zinc-900/40 p-3"><strong className="text-zinc-200">Radio is observer, not clock.</strong> Radio → observation → estimation → transport → scheduler → audio.</li>
            <li className="rounded border border-zinc-800 bg-zinc-900/40 p-3"><strong className="text-zinc-200">Transport ≠ renderer ≠ radio ≠ UI.</strong> Transport is the musical time model, nothing else.</li>
            <li className="rounded border border-zinc-800 bg-zinc-900/40 p-3"><strong className="text-zinc-200">No device policy.</strong> If it looks like another device, it doesn&apos;t belong here.</li>
            <li className="rounded border border-zinc-800 bg-zinc-900/40 p-3"><strong className="text-zinc-200">Every claim has evidence.</strong> real-time⇒benchmark · AI⇒context/action/reward · production-ready⇒tests.</li>
          </ul>
        </section>
      </main>

      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
          <span className="font-mono text-zinc-500">/home/z/psy-foundation</span>
          <span>·</span>
          <span>NOT a device — the foundation beneath all PSY devices</span>
          <span className="ml-auto">M0 audit ✓ · M1 transport+protocol+device-sdk+fixtures ✓ · M2 next</span>
        </div>
      </footer>
    </div>
  )
}
