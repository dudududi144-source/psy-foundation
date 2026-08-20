# F18 FORENSIC FIELD-USAGE MATRIX

## Complete trace of every learned field

| Field | Source (observe) | Storage | Consumer (composition) | Decision Affected | Proof Test | Status |
|---|---|---|---|---|---|---|
| tempo.tempo | observe() | LearnedMusicalContext | NONE (Transport owns tempo) | nothing | none | NOT CONSUMED (correct) |
| tempo.tempoConfidence | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED (correct) |
| harmony.pitchClassProfile | observe() | LearnedMusicalContext | chooseHarmonicForPhrase | chord tone selection | F17 ✅ | CONSUMED + PROVEN |
| harmony.tonalCenterConfidence | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| harmony.harmonicRhythm | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| harmony.rootMovement | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| rhythm.kickGrammar | observe() | LearnedMusicalContext | composePhrase kick | original kick patterns | F17 ✅ | CONSUMED + PROVEN |
| rhythm.hatGrammar | observe() | LearnedMusicalContext | composePhrase hats | original hat patterns | F17 ✅ | CONSUMED + PROVEN |
| rhythm.bassRhythmGrammar | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| rhythm.syncopation | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| rhythm.ghostProbability | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| bass.degreePreferences | observe() | LearnedMusicalContext | composeBass chooseBassPitch | bass pitch selection | F15 ✅ | CONSUMED + PROVEN |
| bass.intervalTransitionProfile | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| bass.register | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| bass.approachToneProfile | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| bass.octaveBehavior | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| bass.phraseEndingProfile | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| melody.scaleDegreePreferences | observe() | LearnedMusicalContext | preferenceFor via kernel | motif scoring | F16 ✅ | CONSUMED + PROVEN |
| melody.contourProfile | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| melody.intervalProfile | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| melody.registerProfile | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| melody.restProfile | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| melody.cadenceProfile | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| melody.callResponseProfile | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| arrangement.energyCurve | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| arrangement.densityCurve | observe() | LearnedMusicalContext | NONE | nothing | none | NOT CONSUMED |
| timbre.brightness | observe() | LearnedMusicalContext | ComposedBar.timbreIntent | synthesis intent | F17 ✅ | CONSUMED + PROVEN |
| timbre.spectralCentroid | observe() | LearnedMusicalContext | ComposedBar.timbreIntent | synthesis intent | F17 ✅ | CONSUMED + PROVEN |
| timbre.noisiness | observe() | LearnedMusicalContext | ComposedBar.timbreIntent | synthesis intent | F17 ✅ | CONSUMED + PROVEN |

## Summary

- **CONSUMED + PROVEN**: 7 fields (harmony.pcProfile, rhythm.kickGrammar, rhythm.hatGrammar, bass.degreePrefs, melody.scaleDegreePrefs, timbre.brightness/centroid/noisiness)
- **NOT CONSUMED (correct)**: 2 fields (tempo — Transport owns this)
- **NOT CONSUMED (dead)**: 20 fields

## Interaction grammar

**NOT IMPLEMENTED.** No kick↔bass, bass↔lead, lead↔harmony relationships exist.
The `interactionQuality` metric in evaluate() is just bassKickAlignment — it measures but doesn't learn.

## Musical relationships NOT represented

- KICK ↔ BASS: bass always hits step 0 (LOCKED), but doesn't learn other kick-bass relationships
- BASS ↔ HARMONY: bass uses harmonicContext for chordPcs but doesn't learn transition tendencies
- BASS ↔ LEAD: no relationship — they're composed independently
- LEAD ↔ HARMONY: lead snaps to chord tones but doesn't learn which intervals work over which chords
- LEAD ↔ RHYTHM: no relationship — lead density doesn't respond to rhythmic density
- HATS ↔ GROOVE: hats follow groove.hatSteps, no learned interaction
- ENERGY ↔ DENSITY: no relationship — density comes from style grammar, not energy
- TENSION ↔ REGISTER: no relationship
- ARRANGEMENT ↔ MATERIAL: arrangement sets roles but doesn't change material character
- TIMBRE ↔ MUSICAL ROLE: timbreIntent is global per bar, not per-role
