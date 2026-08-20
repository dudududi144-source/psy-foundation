# F17 LEARNING WIRING — every learned field traced to consumer

## Wiring summary (after F17)

| Learned Field | Consumer | Decision Affected | Status |
|---|---|---|---|
| rhythm.kickGrammar | composePhrase (kick generation) | Original kick patterns from learned probabilities | CONSUMED + PROVEN ✅ |
| rhythm.hatGrammar | composePhrase (hat generation) | Original hat patterns from learned probabilities | CONSUMED + PROVEN ✅ |
| harmony.pitchClassProfile | chooseHarmonicForPhrase | Chord tone selection biased by learned profile | CONSUMED + PROVEN ✅ |
| bass.degreePreferences | composeBass (chooseBassPitch) | Weighted bass pitch selection | CONSUMED + PROVEN ✅ |
| melody.scaleDegreePreferences | preferenceFor via kernel | Motif candidate scoring | CONSUMED + PROVEN ✅ |
| timbre.brightness/centroid/noisiness | ComposedBar.timbreIntent | Synthesis intent for PSY4 | CONSUMED + PROVEN ✅ |
| tempo.tempo | LearnedMusicalContext (stored) | Not directly consumed by composition (Transport owns tempo) | NOT CONSUMED (correct — Transport owns tempo) |
| bass.register | LearnedMusicalContext (stored) | Not yet wired into composeBass register selection | PARTIAL |
| melody.registerProfile | LearnedMusicalContext (stored) | Not yet wired into composeLead register center | PARTIAL |
| melody.intervalProfile | LearnedMusicalContext (stored) | Not yet wired into lead interval generation | NOT CONSUMED |
| melody.contourProfile | LearnedMusicalContext (stored) | Not yet wired into lead contour | NOT CONSUMED |
| arrangement.energyCurve | LearnedMusicalContext (stored) | Not yet wired into arrangement | NOT CONSUMED |
| arrangement.densityCurve | LearnedMusicalContext (stored) | Not yet wired into arrangement | NOT CONSUMED |

## What changed in F17

### P0: RHYTHM LEARNING WIRED
- `composePhrase` now reads `learned.rhythm.kickGrammar` (16-step probabilities)
- When confidence > 0.3 and kickGrammar has data, generates ORIGINAL kick patterns:
  - Blends 60% learned probability + 40% style groove
  - Always keeps beat 1 (LOCKED invariant)
  - Uses deterministic RNG (seeded per bar)
- Same wiring for `learned.rhythm.hatGrammar`
- PROVEN: different kick observations → different kick output ✅

### P0: HARMONY LEARNING WIRED
- `chooseHarmonicForPhrase` now reads `learned.harmony.pitchClassProfile`
- When confidence > 0.3 and profile has data:
  - Finds high-weight pitch classes that are in the scale but not in the base chord
  - Replaces the third chord tone with the learned-preferred pc
  - Preserves the progression structure (tonic/subdominant/dominant rotation)
- PROVEN: different pitch class observations → different harmonic context ✅

### P0: TIMBRE LEARNING WIRED
- `ComposedBar` now has optional `timbreIntent` field
- When `learned.meta.confidence > 0.3`, each bar carries:
  - brightness, harmonicity, noisiness, attack, subEnergy
- PSY4 can read this to configure synthesis
- PROVEN: timbre observations → timbreIntent in output ✅
