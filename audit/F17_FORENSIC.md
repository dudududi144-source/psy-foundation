# F17 FORENSIC — LEARNED FIELD TRACE

## Trace table: every F16 learned field → consumer

| Learned Field | Producer | Storage | Composition Consumer | Decision Affected | Measurable Output | Test | Status |
|---|---|---|---|---|---|---|---|
| tempo.tempo | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| tempo.tempoConfidence | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| harmony.pitchClassProfile | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| harmony.tonalCenterConfidence | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| harmony.harmonicRhythm | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| rhythm.kickGrammar | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| rhythm.bassRhythmGrammar | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| rhythm.hatGrammar | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| rhythm.syncopation | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| rhythm.ghostProbability | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| **bass.degreePreferences** | observe() | LearnedMusicalContext | **composeBass()** | **bass pitch selection** | **different bass MIDI** | **F15 test ✅** | **CONSUMED + PROVEN** |
| bass.intervalTransitionProfile | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| bass.register | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| bass.approachToneProfile | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| **melody.scaleDegreePreferences** | observe() | LearnedMusicalContext | **preferenceFor via kernel** | **motif scoring** | **different motif selected** | **F16 test ✅** | **CONSUMED + PROVEN** |
| melody.contourProfile | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| melody.intervalProfile | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| melody.registerProfile | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| melody.restProfile | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| melody.cadenceProfile | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| melody.callResponseProfile | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| arrangement.energyCurve | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| arrangement.densityCurve | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| timbre.brightness | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| timbre.spectralCentroid | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |
| timbre.noisiness | observe() | LearnedMusicalContext | NONE | nothing | nothing | none | NOT CONSUMED |

## Summary

- **CONSUMED + PROVEN**: 2 of 26 fields (bass.degreePreferences, melody.scaleDegreePreferences)
- **NOT CONSUMED**: 24 of 26 fields

The F16 kernel learns many things but only 2 dimensions actually change composition output.

## P0 gaps to fix

1. **rhythm.kickGrammar** → wire into kick generation (generate original patterns from learned stats)
2. **rhythm.hatGrammar** → wire into hat generation
3. **harmony.pitchClassProfile** → wire into chooseHarmonicForPhrase
4. **melody.intervalProfile** → wire into composeLead (learned interval transitions)
5. **timbre** → wire into ComposedBar as timbre intent output
