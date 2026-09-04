# Family Adoption Offer — psy-sampler / psysynth / psydrum (task 3.7)

**Status: OFFER ONLY.** The charter (docs/ENGINEER_CHARTER.md) forbids writes
to any family repo without the owner's explicit per-repo approval. This
document is the handoff: what each repo gains, what changes, and the exact
steps. Nothing here has been executed outside psy-foundation.

## Why adopt (the measured case)

The forensic audit found **0/16 family repos consume foundation at runtime**.
Each carries its own copy of the same logic, and each copy has diverged. The
2026-09-04 rebuild gives foundation things the family copies cannot get on
their own:

1. **One DSP build** — master chain (multiband/OTT/limiter/ITU LUFS/ZDF SVF)
   exists in exactly one implementation, shared by offline render AND the
   generated AudioWorklet. Family repos currently fork DSP by copy-paste.
2. **Proven transport v1** — epoch/source/holdover/seek/setTempo/predictBeats/
   subscribe, 10 documented gaps closed, all contract tests green.
3. **Device conformance suite** — `runDeviceConformance()` (C1–C8): a device
   proves its contract in its own CI instead of a skipping shim-sync test.
4. **PSYBUS v2** — one canonical bus envelope transcribed from psyboss's own
   spec, byte-deterministic, validated, versioned.
5. **Release artifacts** — `bun add @psy-foundation/*` (workspace), or pin the
   single-file `release/psy-foundation.esm.js` (deterministic build, versioned
   `2.0.0`, proven by a stranger-repo scratch test).

## Adoption path per repo (requires owner approval per repo)

### Step 1 — pin, don't migrate (zero risk)
Add `psy-foundation` as a git dependency, or vendor
`release/psy-foundation.esm.js`. Import ONE namespace read-only (e.g.
`dsp.measureLUFS`) behind an adapter. Behavior parity is checkable against
the repo's existing implementation before any behavior changes.

### Step 2 — conformance
Run `runDeviceConformance(() => new ExistingDevice())` in the family repo's
CI. Failing checks are the precise, named list of contract violations to fix.
No foundation code changes.

### Step 3 — transport swap
Replace the local clock with `@psy-foundation/transport` v1 behind the same
adapter. The v1 API (epoch/holdover/seek/predictBeats) is a superset of the
psy4-proven semantics; the parity matrix lives in audit/CONTRACT_GAPS.md.

### Step 4 — PSYBUS v2
Emit/consume `protocol/v2` envelopes (canonical JSON, validated). The
deprecation map in `packages/protocol/src/v2/deprecations.ts` documents the
per-type migration.

### Step 5 — delete the copy
Only after Step 4 has run green for one release cycle: delete the repo's
local DSP/transport copy. This is the step that pays — no more divergence.

## What the owner must decide

- Per-repo go/no-go (each repo's worklog records its own state).
- npm scope/publish channel (currently: git pin or vendored bundle — honest
  and works; npm publishing needs a license decision, see CHANGELOG/RELEASE).
- License: foundation is marked UNLICENSED pending the owner's choice; any
  cross-repo consumption requires a real license first.

## What foundation did NOT do (by charter)

- No family repo was modified, not even a comment.
- No shim was edited remotely; the shim-sync skip dies when the OWNER runs
  the conformance suite in each repo's CI.
