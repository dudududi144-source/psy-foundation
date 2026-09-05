# PSY4 VST/AU Plugin — ARCHIVED PROTOTYPE

> **ARCHIVED (PLAN_V3 Phase 5, decision B — "archive honestly").**
> **This is a prototype, NOT a shippable plugin. Do not build on top of it
> without reading the audit below.**

Archived from `apps/vst/` on 2026-09-04 per the Phase 5 decision gate in
`docs/PLAN_V3_MASTER.md` (default recommendation B, ratified by the lead
engineer). The audit findings that forced this decision are REPRODUCIBLE in
`Source/`:

- **No MIDI note-off in `processBlock`** — notes never release; polyphony
  exhausts and voices latch forever.
- **8 of 11 parameters are unwired** — the UI lies about what it controls.
- **UI-thread data race** — the editor reads processor state without
  synchronization (undefined behavior per JUCE's threading contract).
- The DSP headers (`Source/DSP/*`) are a THIRD hand-maintained copy of
  primitives that now live canonically in `@psy-foundation/dsp` (One-DSP,
  DECISIONS_V3 D1-D6). Any future plugin effort must consume the canonical
  DSP (via generated C++ or an audio-graph bridge), not another port.

## Why archive instead of fix

Fixing it properly = re-deriving the plugin against the canonical DSP +
rewiring all parameters + fixing the threading contract ≈ a full rewrite of
the wrapper. The web app (apps/web) already ships the engine to real users;
the plugin added no unique capability. Honesty > a compiles-plausible lie.

## If it is ever revived

1. Consume `@psy-foundation/dsp` as the single source of DSP truth (codegen
   or IPC — NOT a C++ port).
2. Implement per-note note-off + voice stealing first.
3. Wire or delete every parameter — an unwired control is a lie.
4. Respect the JUCE threading contract (no unsynchronized editor→processor
   reads).
5. Revisit `docs/AUDIT_FORENSIC_2026-09-04.md` for the original evidence.
