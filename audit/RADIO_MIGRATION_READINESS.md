# RADIO MIGRATION READINESS

Assessment of PSY4 radio subsystems for future migration to foundation.
**No migration is performed in this gate.** This document identifies what
exists, what's missing, and the migration risk.

## PSY4 radio subsystems (reference)

### 1. RadioObservationLayer
- **File**: `foundation/radio/RadioObservationLayer.ts`
- **Purpose**: Single entry point for radio analysis. Processes time-domain +
  frequency-domain audio, produces signal state + beat observations + pitch.
- **Tests**: 20 observation + 12 adversarial + 12 integration = 44 tests
- **Foundation equivalent**: `packages/analysis/src/analyzer.ts` (Analyzer class)
- **Missing capability**: strict SIGNAL/FEATURES/OBSERVATION/INFERENCE separation
- **Migration risk**: HIGH — foundation Analyzer mixes layers. Restructuring
  required before migration.

### 2. BeatObservationEngine
- **File**: `foundation/radio/BeatObservationEngine.ts`
- **Purpose**: Wraps BeatPLL with real confidence calculation.
  confidence = onsetStrength×0.5 + regularityFit×0.3 + signalQuality×0.2
- **Tests**: covered by radio-observation-tests
- **Foundation equivalent**: `packages/analysis/src/onset.ts` (detectOnsets)
- **Missing capability**: real confidence (foundation uses loudness proxy)
- **Migration risk**: MEDIUM — confidence model needs rewrite

### 3. BeatPLL
- **File**: `src/lib/beatPLL.ts`
- **Purpose**: Phase-locked loop for tempo estimation. 48 tests.
- **Tests**: 48 (reality-bridge/beatpll-convergence)
- **Foundation equivalent**: `packages/transport/src/beatEstimator.ts` (v0) /
  Transport v1's internal PLL
- **Missing capability**: none — Transport v1's PLL is proven equivalent
- **Migration risk**: LOW — Transport v1 already covers this

### 4. MelodyObserver (YIN pitch detection)
- **File**: `src/lib/melodyObserver.ts`
- **Purpose**: YIN-based pitch detection. ±10 cents, 0 octave errors. 13 tests.
- **Tests**: 13
- **Foundation equivalent**: `packages/analysis/src/pitch.ts` (detectPitch)
- **Missing capability**: YIN-specific accuracy (foundation uses autocorrelation)
- **Migration risk**: MEDIUM — pitch algorithm differs

### 5. RadioStateGate
- **File**: `src/lib/radioStateGate.ts`
- **Purpose**: Gates radio state transitions. 8 tests. Wired into psyLive.
- **Tests**: 8
- **Foundation equivalent**: none (signal state is in Analyzer but not gated)
- **Missing capability**: state gate (NO_SIGNAL → SIGNAL_PRESENT → STABLE → LOST)
- **Migration risk**: MEDIUM — needs new module

## Foundation radio gaps (from CONTRACT_GAPS.md)

| Gap | Description | Risk |
| --- | --- | --- |
| GAP-R1 | signal state vs observation state separation | HIGH |
| GAP-R2 | real confidence (not loudness) | MEDIUM |
| GAP-R3 | triple timestamp model (observedAt/estimatedAt/predictedAt) | MEDIUM |
| GAP-R4 | strict transport boundary (only {time,confidence,source} crosses) | HIGH |

## Migration path (Phase C — not started)

1. Restructure `packages/analysis` into layered modules:
   - `signal.ts` — signal state detection (NO_SIGNAL, STABLE, LOST, etc.)
   - `features.ts` — spectral features (existing)
   - `observation.ts` — beat/pitch observation with real confidence
   - `inference.ts` — musical inference (existing)
2. Add triple timestamp model to observations
3. Enforce transport boundary in observation output type
4. Port psy4's 44 radio tests to foundation
5. Build `FoundationRadioAdapter` for PSY4 compatibility

## Migration risk summary

- **HIGH**: layer separation (GAP-R1, GAP-R4) — requires restructuring
- **MEDIUM**: confidence model (GAP-R2), pitch algorithm, state gate
- **LOW**: BeatPLL (already covered by Transport v1)

## Decision

**NOT READY for migration.** Phase C requires:
1. Restructure analysis package into strict layers
2. Implement real confidence model
3. Add triple timestamp model
4. Port psy4's 44 radio tests
5. Build adapter

No implementation in this gate. Radio migration is Phase C (post-P2).
