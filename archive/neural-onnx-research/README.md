# Neural/ONNX Research — Honest Archive

**Archived:** 2026-09-06 (Task 13, dead-export audit follow-through)
**Source:** `apps/web/src/lib/psy4/research/neural/` (minus `latent-decoder.ts`, which stays — see below)

## What this is

The ONNX/RAVE/DDSP integration track that was scaffolded but **never wired to
anything**: no route, no test, no script, no model file ever consumed these
modules. Found by `scripts/audit-exports.mjs` during the dead-export audit —
every exported symbol in these files had zero consumers repo-wide.

| File | Was | Why it died |
|---|---|---|
| `onnx-inference.ts` | `ONNXRAVEEncoder/Decoder`, `ONNXDDSPDecoder`, `ONNXStyleTransfer` classes | Imported nobody. No `.onnx` model ever shipped in the repo; `onnxruntime` is not even a dependency. |
| `ddsp-harmonic.ts` | Harmonic (sinusoidal + filtered noise) DDSP-style synthesizer | Its only consumer was a dormant branch in `psy-voices.ts` (`setDDSP`) that had zero callers — unreachable render path, deleted with it (Task 13). |
| `ddsp-noise.ts` | Filtered-noise DDSP-style synthesizer | Imported nobody. |
| `training/` | `train_rave.py`, `train_ddsp.py`, `prepare_dataset.py` | Exist solely to train weights for the loaders above; without them the scripts train nothing consumable. |

## What shipped instead (and stays live)

**Style transfer is real and does not need neural weights:**
`apps/web/src/lib/psy4/research/neural/latent-decoder.ts` implements the
transfer as honest DSP — a 32-band bark-spaced spectral-envelope shaper with
an FFT magnitude/phase-preserving round-trip (blend=0 is bit-identical no-op).
It is consumed by `/api/style-transfer` and lock-tested
(`apps/web/tests/roast-fix.test.ts`). Its header says plainly: "this module is
NOT a neural network."

## Revival conditions

Bringing any of this back requires all of:

1. Real trained weights committed or fetchable, with provenance and license.
2. A runtime consumer (route or engine path) that loads them — wired, tested.
3. Honest naming: nothing called "neural" that is not a network (the
   latent-decoder precedent), and no parameter that is accepted but unread
   (the stereoWidth precedent).
4. The v2.0.0 honesty labels updated to describe what actually runs.

Until then this code is frozen evidence of the gap between the plan and the
product — kept for reference, not for import.
