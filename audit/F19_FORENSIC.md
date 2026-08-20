# F19 FORENSIC — CURRENT STATE DIAGNOSIS

## Architecture diagnosis

### What works (CONSUMED + PROVEN)
1. Learned bass degree preferences → weighted pitch selection (composeBass)
2. Learned melody degree preferences → preferenceFor motif scoring (choosePhraseMotif)
3. Learned kick grammar → original kick patterns (composePhrase)
4. Learned hat grammar → original hat patterns (composePhrase)
5. Learned harmony pitch class profile → chord tone replacement (chooseHarmonicForPhrase)
6. Learned timbre → timbreIntent in ComposedBar (composePhrase)
7. Interaction grammar → learned and stored (5 relationship types)
8. Reward → updates bass/melody weights (updateFromEvaluation)
9. PhraseState → survives between compose calls
10. Serialization → round-trip proven

### What is DEAD (stored but not consumed by composition)
1. bass.register — learned but composeBass always uses BASS_OCTAVE=2
2. bass.intervalTransitionProfile — learned but composeBass doesn't use transitions
3. bass.approachToneProfile — learned but composeBass doesn't vary approach probability
4. bass.octaveBehavior — learned but composeBass doesn't use it
5. bass.phraseEndingProfile — learned but composeBass always uses same cadence
6. melody.contourProfile — learned but composeLead doesn't use contour stats
7. melody.intervalProfile — learned but composeLead doesn't use interval transitions
8. melody.registerProfile — learned but composeLead always uses LEAD_MIN/MAX
9. melody.restProfile — learned but composeLead doesn't use rest probability
10. melody.cadenceProfile — learned but composeLead doesn't use cadence behavior
11. melody.callResponseProfile — learned but composeLead uses fixed 50% split
12. arrangement.energyCurve — learned but not wired
13. arrangement.densityCurve — learned but not wired
14. rhythm.bassRhythmGrammar — learned but composeBass uses groove.kickSteps
15. rhythm.syncopation — learned but not used to modify patterns
16. rhythm.ghostProbability — learned but not used
17. harmony.rootMovement — learned but not used
18. harmony.harmonicRhythm — learned but not used
19. InteractionGrammar (all 5 relationships) — learned but NOT consumed by composition
20. tempo — correctly not consumed (Transport owns this)

### Hardcoded musical templates
1. BASS_OCTAVE = 2 (always) — should use learned.bass.register
2. LEAD_MIN_MIDI = 60, LEAD_MAX_MIDI = 84 (always) — should use learned.melody.registerProfile
3. Bass cadence: always fifth→root on last 2 steps — should use learned.bass.phraseEndingProfile
4. Lead variation: fixed 5-pattern cycle (transpose/invert/retrograde/fragment/none) — should use learned development operators
5. Harmony: fixed 4-phrase rotation (tonic/subdominant/tonic/dominant) — should use learned.rootMovement

### Phrase resets
1. Engine is rebuilt on every observe() call — this is correct (picks up new learned context)
2. composeSection creates a fresh section each time — PhraseState carries forward
3. No reset of learned state between phrases — correct
4. BUT: the engine doesn't consume PhraseState in composePhrase — it's stored but not used

### Critical missing pieces
1. **Interaction grammar not consumed**: 5 relationship types are learned but don't influence composition
2. **No phrase development operators**: CONTINUE/DEVELOP/ANSWER/CONTRAST/RESOLVE not implemented
3. **No multi-candidate generation**: only 1 phrase generated, no alternatives evaluated
4. **Lead generator doesn't use learned intervals**: still picks from motif notes, not from learned interval transitions
5. **Bass generator doesn't use learned transitions**: still uses fixed degree set
6. **Harmony doesn't learn progression**: fixed rotation, not learned root movement
7. **No StyleDNA**: style is a label, not a learned profile
8. **No ContinuousMusicalState**: state is scattered across PhraseState + LearnedMusicalContext
