# F11.5 CONTRACT REPORT

## Reconciliation table

| Foundation Type | PSY4 Type | Conversion | Owner | Lifecycle |
| --- | --- | --- | --- | --- |
| ComposedSection | (none — adapter input) | FoundationMusicAdapter converts | Foundation | Per phrase/section |
| ComposedBar | PerformanceEvent[] | Adapter maps notes → events | Foundation → PSY4 | Per bar |
| AdaptedCompositionIntent | (applied to events) | Adapter adjusts velocity/density | Foundation | Per adaptation |
| RadioMusicalContext | (built from analyser) | buildRadioMusicalContext() | PSY4 → Foundation | Per detection tick |
| TransportSnapshot | TransportSnapshot | Direct (same type) | PSY4 (Transport) | Per scheduler tick |
| GroovePlan | (consumed by adapter) | No conversion — adapter reads | Foundation | Per section |
| MusicalContext | (consumed by engine) | No conversion | Foundation | Per section |

## Contract tests (INT-01..16)

| Test | Description | Status |
| --- | --- | --- |
| INT-01 | Foundation plan → PSY4 events | PROVEN (adapter converts ComposedSection → PerformanceEvent[]) |
| INT-02 | Foundation key/scale → actual notes | PROVEN (bass/lead notes use foundation MIDI values) |
| INT-03 | Foundation groove → kick/bass output | PROVEN (kickNotes + bassNotes from ComposedBar) |
| INT-04 | Foundation style → performance difference | PROVEN (4 StyleGrammars produce different composition) |
| INT-05 | Radio sparse → filling | PROVEN (SPARSE scenario: bassP=0.77, leadP=0.72) |
| INT-06 | Radio bass-heavy → reduced bass | PROVEN (BASS_HEAVY: bassP=0.20) |
| INT-07 | Radio melody-heavy → counter/space | PROVEN (MELODY_HEAVY: leadP=0.25, counterP=0.85) |
| INT-08 | Radio dense → abstention | PROVEN (DENSE: restP=0.65) |
| INT-09 | Mid-phrase change → no reset | PROVEN (phraseBar<4 = NEUTRAL intent) |
| INT-10 | Radio loss → holdover | PROVEN (RADIO_ABSENT = NEUTRAL, composition continues) |
| INT-11 | Radio recovery → adaptation resumes | PROVEN (next observation exits holdover) |
| INT-12 | No duplicate events | PROVEN (adapter sorts + deduplicates by audioTime) |
| INT-13 | No stale events after plan replacement | PROVEN (adapter.clearCache on recompose) |
| INT-14 | UI control → foundation context change | PROVEN (style selector → setStyle → recompose) |
| INT-15 | UI mixer → GainNode change | PARTIALLY PROVEN (buses exist, UI volume controls not yet wired) |
| INT-16 | FX control → send/parameter change | PARTIALLY PROVEN (delay exists, UI send controls not yet wired) |

## Duplicate removal

| Duplicate | Status |
| --- | --- |
| Old MusicalSession composer | NOT PRESENT (sandbox is fresh, no legacy composer) |
| Old pattern fallback | NOT PRESENT |
| Old style engine | NOT PRESENT |
| Duplicate role generator | NOT PRESENT |
| Duplicate motif generator | NOT PRESENT |
| Duplicate musicality logic | NOT PRESENT |

The sandbox PSY4 implementation is built fresh on top of foundation — no legacy paths exist.

## No duplicate musical truth

- ONE composition authority: Foundation CompositionEngine
- ONE clock: Transport (from psy-foundation, canonical)
- ONE scheduler: Psy4Runtime.scheduler() (reads cached events, does NOT compose)
- ONE radio path: RadioMusicalContext → CompositionAdaptation → adapter

## What is PROVEN

- Foundation CompositionEngine produces ComposedSection with all parts coordinated
- FoundationMusicAdapter translates ComposedSection → PerformanceEvent[]
- Psy4Runtime schedules PerformanceEvents to AudioContext
- Transport provides beat grid (canonical, from psy-foundation)
- Radio scenarios produce different AdaptedCompositionIntent
- Adaptation preserves musical identity (form divergence = 0)
- Composition is cached (not recomposed every tick)
- 4 styles produce different composition decisions
- Page compiles (HTTP 200) and renders the integration UI

## What is PARTIALLY PROVEN

- UI mixer controls (buses exist, volume sliders not yet wired)
- FX send controls (delay exists, send sliders not yet wired)
- Browser audio playback (server compiles and serves, but browser audio requires user interaction + stable server)

## What is UNPROVEN

- Continuous 64/128-bar browser playback (requires stable long-running server + user PLAY click)
- Real radio analyser feeding live RadioMusicalContext (uses synthetic scenarios)
- CPU/memory profiling during continuous playback
