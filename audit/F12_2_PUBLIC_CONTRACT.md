# F12.2 PUBLIC CONTRACT

## FOUNDATION_CONTRACT_VERSION = 1

## v1 guarantees

### Composition
- `CompositionEngine.composeSection({ bars, seed, context })` → `ComposedSection`
- Deterministic: same seed + context = identical output (proven 100 runs)
- Serializable: JSON.stringify/parse round-trip preserves all data
- No browser/DOM/AudioContext dependencies

### Adaptation
- `CompositionAdaptation.adapt({ baseContext, radio, opportunities, currentBar, phraseBar })` → `AdaptedCompositionIntent`
- Radio is INPUT only (never bypasses composition)
- Mid-phrase stability: phraseBar < 4 = NEUTRAL intent
- Identity preservation: same seed = same form regardless of radio

### Failure detection
- `detectMusicalFailures({ kickNotes, bassNotes, leadNotes, hatNotes, arrangement, groove, bars, stepsPerBar })` → `EnhancedFailureReport`
- 20 failure types, each with deliberate valid + invalid fixtures
- Level: OK / WARNING / FAIL

### Serialization
- ComposedSection: fully serializable (no functions, no undefined, no DOM)
- AdaptedCompositionIntent: fully serializable
- RadioMusicalContext: fully serializable

## Consumer responsibilities (WHEN / HOW)
- Convert step indices → AudioContext time (using Transport)
- Choose synthesis parameters (waveform, filter, FX)
- Apply volume/mute/solo per bus
- Schedule events to AudioContext
- Build radio analyser → RadioMusicalContext

## Foundation responsibilities (WHAT)
- Compose all musical content (form, harmony, groove, bass, lead, arrangement)
- Adapt to radio context
- Detect musical failures
- Provide deterministic, serializable output

## What is NOT in v1
- No AudioContext
- No Transport (Transport is a separate package, already canonical)
- No scheduler
- No synthesis
- No UI
- No real radio analyser (synthetic scenarios only)

## Consumer fixture

The consumer fixture at `integration/psy4-consumer-fixture/` proves:
1. ComposedSection is consumable without musical knowledge
2. All events self-contained (midi, step, duration, velocity)
3. Rest = empty array (unambiguous)
4. Role activation prevents wrong playback
5. No browser dependency
6. 100-run determinism
7. 64/128-bar stability
8. Performance < 100ms

## PSY4 integration status

**NOT INTEGRATED / CONTRACT READY**

The contract is frozen at v1. PSY4 has NOT independently consumed it.
