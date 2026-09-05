/**
 * Render worker entry (PLAN_V3 4.1) — compose + render OFF the Next.js event
 * loop, inside a node:worker_threads worker.
 *
 * Protocol: one JSON job per message → one response message. Float32Array
 * buffers are transferred back (zero-copy). All inputs are plain JSON
 * (seed/context/config are deterministic — Phase 1 guarantees the SAME
 * section composition for the same seed in-thread and in-worker; the pool
 * parity test locks the byte-identical render).
 *
 * This file is a BUILD ARTIFACT source: scripts/build-render-worker.mjs
 * bundles it to apps/web/workers/render-worker.mjs (GENERATED, committed —
 * D6 worklet precedent). The pool loads the built artifact; when it is
 * missing the route falls back to in-thread rendering with an honest header.
 */
import { parentPort } from 'node:worker_threads'
import { CompositionEngine, createIdentityA } from '../../../../packages/music/src/index.ts'
import { renderFoundationSection } from '../lib/psy4/forensic-bridge.ts'
import type { RenderConfig, RenderResult } from '../lib/psy4/forensic-bridge.ts'

export interface WorkerRenderJob {
  id: number
  bars: number
  seed: number
  useSamples: boolean
  bpm: number
  wantStems: boolean
  /** Composition context (plain JSON — see render-forensic route ctx). */
  ctx: Record<string, unknown>
  /** RenderConfig overrides (plain JSON — presets already resolved by the route). */
  config: Record<string, number>
}

export interface WorkerRenderOk {
  id: number
  ok: true
  samplesL: Float32Array
  samplesR: Float32Array
  sampleRate: number
  durationSec: number
  bars: number
  events: number
  lufs: number
  truePeakDb: number
  samplePeakDb: number
  stereoWidth: number
  monoCompatibility: number
  gainReductionDb: number
  stems: null | Record<string, Float32Array>
}

export interface WorkerRenderErr {
  id: number
  ok: false
  error: string
}

export type WorkerRenderReply = WorkerRenderOk | WorkerRenderErr

// Dual transport: parentPort when run as a worker_threads Worker, process
// IPC when run via child_process.fork (the pool's default — fork avoids
// Turbopack's static `new Worker` detection). Same protocol either way.
const port = parentPort

function send(reply: WorkerRenderReply): void {
  // Structured clone on both transports — typed arrays copy fine.
  if (port) port.postMessage(reply)
  else process.send!(reply)
}

if (!port && typeof process.send !== 'function') {
  throw new Error('render-worker must run under worker_threads parentPort or child_process IPC')
}

const onMessage = async (raw: unknown): Promise<void> => {
  const job = raw as WorkerRenderJob
  try {
    const engine = new CompositionEngine({
      seed: job.seed,
      context: job.ctx as never,
      identity: createIdentityA(),
    })
    const section = engine.composeSection({ bars: job.bars })
    const result: RenderResult = await renderFoundationSection(section, {
      useSamples: job.useSamples,
      bpm: job.bpm,
      config: job.config as Partial<RenderConfig>,
      stems: job.wantStems,
    })
    const reply: WorkerRenderOk = {
      id: job.id,
      ok: true,
      samplesL: result.samplesL,
      samplesR: result.samplesR,
      sampleRate: result.sampleRate,
      durationSec: result.durationSec,
      bars: result.bars,
      events: result.events,
      lufs: result.lufs,
      truePeakDb: result.truePeakDb,
      samplePeakDb: result.samplePeakDb,
      stereoWidth: result.stereoWidth,
      monoCompatibility: result.monoCompatibility,
      gainReductionDb: result.gainReductionDb,
      stems: result.stems
        ? {
            drumL: result.stems.drumL,
            drumR: result.stems.drumR,
            bassL: result.stems.bassL,
            bassR: result.stems.bassR,
            musicL: result.stems.musicL,
            musicR: result.stems.musicR,
          }
        : null,
    }
    send(reply)
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    send({ id: job.id, ok: false, error: message } satisfies WorkerRenderErr)
  }
}

if (port) {
  port.on('message', (raw: unknown) => {
    void onMessage(raw)
  })
} else {
  process.on('message', (raw: unknown) => {
    void onMessage(raw)
  })
}
