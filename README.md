# psy-foundation

> Canonical render engine for the PSY family — offline PCM synthesis, analysis, and mastering.

## What This Is

psy-foundation is the **HOW layer** of the PSY device family. It receives musical events and renders them as professional-grade stereo PCM audio with full mastering chain.

```
WHAT (composition)     WHO (performance)        HOW (sound)
─────────────────     ──────────────────       ──────────────────
psy4 (composition) →   PSYSTAR (performance) →  psy-foundation (render)
Foundation (grammar)  PSY6 (pooled engine)     PsySynthPro (live synth)
                      psydrum (drums)           psy-sampler (samples)
```

## Architecture

```
src/lib/psy4/
├── foundation-shim/       PsyDevice contract (VERBATIM from psy-foundation)
│   ├── protocol.ts        MusicalEvent, NoteEvent, Channel
│   ├── device.ts           PsyDevice interface
│   ├── transport.ts        MusicalTransport
│   └── index.ts
├── render-device.ts        RenderDevice (PsyDevice consumer → WAV + critique)
├── voice-specs.ts          Single source of truth (9 specs: KICK, BASS, LEAD, etc.)
├── psy-voices.ts           13 voice implementations
├── forensic-bridge.ts     Main renderer (RawScore → Stereo PCM)
├── audio-critic.ts         Audio quality analysis (8 areas, 12 failure codes)
├── channel-fx.ts           Per-voice EQ + delay + reverb + pan + width
├── channel-presets.ts      Voice-type FX presets
├── multiband.ts            3-band LR4 crossover compressor
├── ms-processor.ts         M/S stereo widener (mono <120Hz)
├── loudness.ts             ITU-R BS.1770-4 LUFS measurement
├── limiter.ts              4x oversampled true-peak limiter
├── modulation-matrix.ts    Routable modulation (6 LFOs × 8 destinations)
├── auto-fixer.ts           Closed-loop render→critique→fix optimization
├── index.ts                Canonical exports
└── forensic/
    ├── dsp.ts              ZDF SVF, MoogLadder, PolyBLEP, oversampled saturation
    ├── mixing.ts           BusProcessor, MasterChain, SchroederReverb, StereoDelay
    └── prng.ts             Deterministic PRNG

src/foundation/music/       Composition engine (frozen, 60+ modules)
src/foundation/transport/   Transport layer (beat estimation, phase correction)
src/app/api/                API routes (render, critique, optimize)
```

## Key Features

- **13 voices**: kick (3-layer), bass (3-layer), lead (4-layer), pad (5-layer), acid, texture, hat (metallic), snare (TR-808), shaker, subbass, riser, impact, sample
- **ZDF State-Variable Filter** (from PsySynthPro) — the standard in professional softsynths
- **Choke groups** (from PSYDRUM) — open hat chokes closed hat
- **Velocity-to-timbre** (from PSYDRUM) — louder hits = brighter
- **Full master chain**: HP(25Hz) → multiband → glue → saturation(15%) → M/S(mono<120Hz) → LUFS → limiter
- **88-bar arrangement**: intro → build → drop → break → drop2 → climax → outro
- **Per-hit variation**: deterministic pitch/decay/tone/pan variation
- **Modulation matrix**: 6 LFOs × 8 destinations
- **AudioCritic**: 8 areas, 12 failure codes, closed-loop optimization
- **PsyDevice consumer**: receives NoteEvents, produces WAV + critique
- **Deterministic**: same seed = same output (bit-identical)

## API

```
GET /api/render-forensic?bars=32&seed=42&samples=true   → WAV
GET /api/audio-critique?bars=32&seed=42&samples=true   → JSON (score + failures)
GET /api/optimize?seed=42&bars=8&iterations=8          → Optimization report
```

## Quick Start

```bash
bun install
bun run dev          # Start dev server (port 3000)
bun run lint          # Check code quality
bun run db:push       # Push prisma schema (if needed)
```

## Family Integration

```typescript
import { createRenderDevice } from '@/lib/psy4'

// Create a PsyDevice consumer
const device = createRenderDevice({ bpm: 145, useSamples: true })

// Feed it events from PSYSTAR / PSY6 / any host
device.onEvent(noteEvent)

// Render offline
const { wav, render, critique } = await device.render(32, 42)
// wav: ArrayBuffer (WAV file)
// render: RenderResult (LUFS, stereoWidth, truePeakDb, etc.)
// critique: AudioCritique (overallScore, failures, metrics)
```

## License

MIT
