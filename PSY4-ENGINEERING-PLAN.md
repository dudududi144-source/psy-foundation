# PSY4 — תכנון הנדסי מלא לרמה מסחרית

> מבוסס על ניתוח כל 11 ה-repos ב-GitHub + מסמכי הידע הקיימים

---

## 1. מפת הנכסים הקיימים (11 repos)

### המשפחה המלאה:

| Repo | תפקיד | מה יש שם | ערך לנו |
|------|-------|----------|---------|
| **psy-foundation** | הפרויקט הנוכחי | Next.js + forensic bridge | הבסיס שעליו בונים |
| **psy4** | הפרויקט המקורי | 134MB, 17 voices, worklet 109KB, **מסמכי ידע מעמיקים** | **מקור הידע העיקרי** |
| **PSY6-ULTIMATE** | הגרסה המאוחדת | 156KB HTML אחד, pooled engine, grammar system | ארכיטקטורה לעתיד |
| **psy5** | ביצועים | PooledEngine, zero-GC, RT-safe | דפוסי RT |
| **psy3-clean** | המקור | 154KB HTML, Web Audio API | **הסאונד הכי טוב** |
| **psysynth** | סינת' מודולרי | ARCHITECTURE-STYLE.md, implementation plan | תכנון מודולרי |
| **psy-sampler** | דגימות | PsyDevice interface, DeviceHost | ארכיטקטורת plugins |
| **psy4new** | ניסוי | 128MB | גיבוי |
| **psystar** | ? | 3MB | לבדיקה |
| **psy** | גרסה ישנה | 270KB | היסטוריה |
| **psysampler** | ריק | 0KB | לא רלוונטי |

### מה למדתי מכל אחד:

#### psy4 (המקור הקריטי):
- **psy4-engine.js** (109KB): AudioWorklet עם 19 voices, Moog ladder, polyBLEP, multiband, true-peak
- **מסמכי ידע**: COMMERCIAL_AUDIO_AUDIT (30 gaps), PSY3_SOUND_DESIGN_RULES (9 כללים), PSY3_PRODUCTION_KNOWLEDGE, COMMERCIAL_ROADMAP, PSY4_DEEP_ROAST
- **הבעיה**: ה-master chain ב-worklet **מושבת** ("דלג על multiband + glue + saturation — הם הרגו את הסאונד")

#### psy3-clean (הסאונד הטוב):
- HTML אחד 154KB עם Web Audio API
- kick/bass/lead עם יחסי אנרגיה נכונים (PSY3 kick peak 1.361, PSY4 0.825)
- **הלקח**: הסאונד של PSY3 עדיף כי ה-gain staging נכון

#### PSY6-ULTIMATE (הארכיטקטורה):
- PooledEngine (20 synth + 24 drum voices, zero GC)
- Grammar system (bass/melodic/rhythm, learning)
- CandidateGenerator (5 candidates/bar, 6-axis scoring)
- **הלקח**: ארכיטקטורה מקצועית לגמרי, אבל חסר DSP עמוק

---

## 2. אבחון: למה אנחנו לא ברמה מסחרית

### 7 בעיות קריטיות (מ-PSY4_DEEP_ROAST):

#### בעיה 1: הליד הוא רק supersaw — אין layering
- **עכשיו**: 2 saws + FM + Moog filter
- **מסחרי**: fundamental + octave-up + air/noise + delay throw + filter movement
- **פער**: חסרות 3 שכבות קריטיות

#### בעיה 2: הפאד הוא אורגן, לא פאד
- **עכשיו**: 3 saws + slow LFO
- **מסחרי**: 3+ oscillators + slow filter sweep + chorus + stereo width + shimmer/air
- **פער**: חסר shimmer (PSY3 מקור), חסר chorus

#### בעיה 3: האסיד הוא באז, לא אסיד
- **עכשיו**: square + Moog, filter sweep חד-כיווני
- **מסחרי**: bidirectional cutoff LFO, resonance peak movement, heavy distortion
- **פער**: ה-envelope יורד בלבד, לא עולה-יורד

#### בעיה 4: ה-texture פרימיטיבי
- **עכשיו**: FM פשוט או noise
- **מסחרי**: granular, wavetable morphing, evolving spectrum, multiple layers
- **פער**: אין granular, אין morphing

#### בעיה 5: הבאס חסר sustain mode
- **עכשיו**: כל באס = pluck קצר
- **מסחרי**: pluck (short) או sustain (held note)
- **פער**: אין מצב נשלף

#### בעיה 6: קיק/באס לא מחוברים
- **עכשיו**: sidechain 3dB
- **מסחרי**: sidechain 6-8dB, bass HP 40Hz
- **פער**: sidechain רדוד מדי

#### בעיה 7: מאסטר חלש
- **עכשיו**: LUFS -11, ceiling 0.89
- **מסחרי**: LUFS -9, ceiling 0.98, makeup 1.4-1.5x
- **פער**: 2dB פחות חזק

---

## 3. ה-30 gaps מ-COMMERCIAL_AUDIO_AUDIT

### MUSICAL (10):
1. **באס = root oscillator**, לא bassline מוזיקלי
2. **אין groove אמיתי** — swing רק על timing, לא velocity
3. **אין call/response** — מוזיקה חד-צדדית
4. **אין motif development** — רק mutation אחד כל 4 בארים
5. **אין tension/release אמיתי** — אותו density כל הזמן
6. **אין counter-melody** — רק lead אחד
7. **acid = random pitch picker**, אין pattern identity
8. **arrangement לא מחזיק דקות** — חוזר ל-intro
9. **אין micro-events** — דליל מדי
10. **אין repetition עם mutation** מבוקר

### SOUND DESIGN (10):
1. **כל voice = osc→filter→gain** — אין FM/ring-mod/wavetable
2. **BiquadFilter sterile** — אין Moog warmth (ב-live, ב-forensic יש)
3. **lead צורם** — aliasing מ-PeriodicWave
4. **pad חלש** — פי 3 מ-PSY3
5. **אין per-hit variation** — כל kick זהה
6. **אין voice identity** — אין preset system
7. **texture לא continuous** — יש רגעי שקט
8. **bass לא מספיק deep** — sub gain נמוך
9. **אין modulation matrix** — הכל hardcoded
10. **אין stereo movement** — pan קבוע

### PRODUCTION (10):
1. **אין multiband** ב-master (ב-forensic יש אבל לא מכוון)
2. **אין true-peak** (יש ב-forensic אבל ה-worklet מושבת)
3. **אין LUFS targeting** עקבי
4. **אין bus architecture** מלאה
5. **אין glue compression** purpose-built
6. **אין saturation on master** (15% mix)
7. **reverb אחד קבוע** — אין room/plate/hall
8. **אין delay throws** per-note
9. **אין sidechain depth variation** per section
10. **אין frequency separation** מדויקת

---

## 4. הכללים מ-PSY3_SOUND_DESIGN_RULES

### 9 כללי יסוד:

1. **Sub Over Click** — kick sub (0.18s) חייב להיות 90x יותר ארוך מ-click
2. **Bass Leaves Room** — bass filter יורד ל-150Hz, משאיר sub ל-kick
3. **Band-limited Oscillators** — אף פעם לא PeriodicWave עם harmonics קבועים
4. **Controlled Mutation** — שנה תו אחד כל 4 בארים, לא random
5. **Section-Aware FX** — kick dry, lead delay, pad reverb
6. **Tension Shapes** — arc/rise/fall לפי section
7. **Downbeat Accent** — 1.4x probability ב-downbeat
8. **Subtle Saturation** — 15% mix, לא distortion
9. **Frequency-Dependent Stereo** — mono מתחת 120Hz, wide מעל

---

## 5. התכנון ההנדסי המלא

### שלב A: איחוד מקור האמת (P0)

#### A1: VoiceSpecs משותף
```
src/lib/psy4/voiceSpecs.ts
  ├── KickSpec { subDecay, midDecay, clickDecay, subLevel, midLevel, clickLevel, startMult, pitchDecay, saturation }
  ├── BassSpec { subLevel, bodyLevel, characterLevel, cutoffStart, cutoffEnd, res, decay, mode: 'pluck'|'sustain' }
  ├── LeadSpec { oscCount, detune, octaveLayer, airLevel, cutoff, res, filterEnvAmount, lfoRate, lfoDepth, delaySend }
  ├── PadSpec { oscCount, detune, filterSweepRate, chorusDepth, shimmerLevel, reverbSend }
  ├── AcidSpec { waveType, cutoffLfoRate, cutoffLfoDepth, resonance, distortion, bidirectional: boolean }
  ├── TextureSpec { layers, morphRate, grainSize, stereoWidth, reverbSend }
  └── DrumSpec { sample, pitchVar, decayVar, toneVar, panVar }
```

#### A2: שימוש ב-forensic bridge + worklet
- forensic bridge = offline rendering (מה שיש עכשיו)
- worklet = real-time (צריך להפעיל מחדש)
- **שניהם קוראים מ-VoiceSpecs**

### שלב B: שכתוב קולות (P1)

#### B1: Kick — 3-layer עם sub dominance
```
Layer 1 (sub):    sine 40Hz, decay 0.18s, gain 0.9  ← 90x יותר ארוך מ-click
Layer 2 (mid):    triangle 150Hz, decay 0.05s, gain 0.5, tanh sat
Layer 3 (click):  noise → HP, decay 0.002s, gain 0.35
→ saturate (drive 1.8)
→ HP 30Hz
→ sidechain trigger
```

#### B2: Bass — pluck/sustain mode
```
Mode 'pluck':   attack 1ms, decay 60ms, no sustain
Mode 'sustain': attack 1ms, decay 20ms, sustain 0.7, release 5ms

Layer 1 (sub):    sine at f/2, gain 0.5, mono
Layer 2 (body):   bl_saw → Moog (cutoff 1500→150Hz env), gain 0.7
Layer 3 (char):   square → BP 400Hz, gain 0.2, stereo detune
→ saturate (drive = world.drive + aggression)
→ HP 40Hz
→ sidechain (depth 6-8dB, section-dependent)
```

#### B3: Lead — 4-layer עם identity
```
Layer 1 (fund):    2 bl_saws, ±12 cents detune
Layer 2 (octave):  2 bl_saws octave-up, ±7 cents, gain 0.4
Layer 3 (air):     noise → HP 8kHz, gain 0.05, env 100ms
Layer 4 (FM):      carrier + modulator (2:1 ratio, index 150)
→ Moog filter (cutoff env + LFO + velocity)
→ saturate (drive 1.5, 85/15 mix)
→ stereo (per-osc panner, width = macro)
→ delay send (per-note throws, 375ms, feedback 0.3)
→ reverb send (0.25)
→ HP 80Hz, gain -7dB
```

#### B4: Pad — 5-layer עם movement
```
Layer 1 (osc1):    bl_saw, -7 cents
Layer 2 (osc2):    bl_saw, +7 cents
Layer 3 (osc3):    bl_triangle, octave-up, ±3 cents
Layer 4 (chorus):  delayed detuned copy, 20ms offset
Layer 5 (shimmer): pitch-shifted reverb tail (octave-up)
→ LP filter (cutoff = macro, slow LFO 0.1Hz)
→ chorus (rate 0.3Hz, depth 0.5)
→ reverb send (0.4)
→ stereo (wide, Haas + M/S)
→ HP 80Hz, gain -8dB
```

#### B5: Acid — bidirectional filter
```
Layer 1 (osc):     bl_square
→ Moog filter (cutoff: LFO bidirectional, rate 2Hz, depth 0.7)
→ resonance peak movement (env + LFO)
→ distortion (drive 3.0, hard clip)
→ stereo (pan ±0.3, automation)
→ HP 100Hz, gain -10dB
```

#### B6: Texture — granular + morphing
```
Layer 1 (grain):   4 detuned oscs, random grain positions
Layer 2 (morph):   wavetable interpolation (slow, 0.05Hz)
Layer 3 (noise):   pink noise → BP, slow sweep
→ LP filter (morph rate 0.1Hz)
→ stereo (wide, moving)
→ reverb send (0.6)
→ HP 200Hz, gain -12dB
```

### שלב C: שרשרת מאסטר (P2)

#### C1: Bus architecture מלאה
```
DRUM BUS:  kick + hat + clap + perc + shaker
           → saturation (drive 1.2)
           → comp (thr 0.5, ratio 3, att 2ms, rel 80ms)
           → stereo (M/S, mono <120Hz)
           → gain -2dB

BASS BUS:  bass + sub
           → mono sum
           → sidechain (from kick, depth 6-8dB)
           → saturation (drive 1.3)
           → gain -3dB

MUSIC BUS: lead + acid + pad + texture
           → EQ (HP 180Hz, -2dB @ 300Hz)
           → comp (thr 0.4, ratio 2, att 10ms, rel 150ms)
           → stereo (M/S, wide)
           → gain -4dB

FX BUS:    riser + impact + sweep + zap + blip
           → delay (375ms, feedback 0.3)
           → reverb (room 1.5s)
           → stereo (wide)
           → gain -8dB
```

#### C2: Master chain מלא (PSY3 style)
```
sum → HP(25Hz) → DC block
     → multiband comp (3-band: low<180, mid 180-4k, high>4k)
       low: thr -18dB, ratio 3:1, att 10ms, rel 100ms, makeup 1.2
       mid: thr -22dB, ratio 2.5:1, att 15ms, rel 120ms, makeup 1.1
       high: thr -20dB, ratio 2:1, att 5ms, rel 80ms, makeup 1.1
     → glue comp (thr 0.6, ratio 2.0, att 4ms, rel 120ms, makeup 1.3)
     → saturation (tanh, drive 1.15, mix 0.15)
     → stereo management (M/S, mono <120Hz, width 1.3)
     → true-peak limiter (4x oversampled, ceiling 0.98)
     → LUFS targeting (-9 LUFS, measure → adjust gain)
     → output
```

### שלב D: מוזיקליות (P3)

#### D1: Bassline מוזיקלי
- phrase-level development (8-bar phrases, not 1-bar loops)
- rests, ghost notes, walking passages
- drop anticipation (simplify before drop)

#### D2: Call/Response engine
- lead → space → acid/texture response → lead return
- counter-melody that dialogues with lead

#### D3: Motif development (AABA)
- A: original motif (4 notes)
- A: repeat
- B: contrast (register/rhythm shift)
- A': return with variation

#### D4: Tension/release shapes
- build = rise (energy increases)
- break = fall (energy decreases)
- drop = arc (peak in middle)
- climax = sustained peak

#### D5: Arrangement לדקות
- intro (8 bars) → build (16) → drop (16) → break (8) → drop2 (16) → climax (16) → outro (8)
- = 88 bars = ~2.4 minutes at 145 BPM

### שלב E: דגימות והקלטות (P4)

#### E1: שימוש ב-psy-sampler
- אינטגרציה עם PsyDevice interface
- 19 דגימות procedural + 141 דגימות real (909/MD/Nord)

#### E2: Per-hit variation
- pitch: ±2% per hit
- decay: ±10% per hit
- tone: filter cutoff ±100Hz per hit
- pan: ±0.1 per hit (for hats/shakers)

### שלב F: Modulation Matrix (P5)

```
Sources: LFO (6 rates), env (ADSR), velocity, macro (4), random
Destinations: pitch, cutoff, resonance, FM index, amp, pan, drive, delay send

Routes:
  LFO1 (0.3Hz) → lead cutoff (depth 0.3)
  LFO2 (2Hz) → acid cutoff (depth 0.7, bidirectional)
  LFO3 (5.5Hz) → lead FM index (depth 0.2)
  Env1 → lead filter (amount 3.0)
  Velocity → lead brightness (0.5)
  Macro1 (SPACE) → reverb send + delay send + filter
  Macro2 (ENERGY) → drive + volume + filter
  Macro3 (TENSION) → filter + reso + swing
```

### שלב G: Reference Analysis (P6)

#### G1: ReferenceAnalyzer (מ-PSY3 style_clone)
- BPM: onset autocorrelation
- Key/scale: chroma profile
- Spectral profile: low/mid/high bands
- Transient profile: onset density
- Stereo profile: correlation, width
- Loudness: LUFS
- Dynamics: crest, range
- Structure: bar-level RMS → sections

#### G2: Render → Analyze → Adjust loop
- render → measure distance → adjust band gains + LUFS → re-render
- until distance < threshold

---

## 6. מה חוסם אותנו עכשיו

### חסם 1: שני engines מנותקים
- forensic bridge (offline) vs worklet (real-time)
- **פתרון**: אחד VoiceSpecs, שני backends

### חסם 2: worklet master chain מושבת
- המולטיבנד+glue+sat "הרגו את הסאונד" כי לא כיוונו נכון
- **פתרון**: כיוון נכון עם פרמטרים מ-PSY3

### חסם 3: אין modulation matrix
- הכל hardcoded
- **פתרון**: ModulationMatrix class

### חסם 4: אין reference analysis
- לא יודעים למה לשאוף
- **פתרון**: ReferenceAnalyzer

### חסם 5: arrangement קצר מדי
- 32 bars = ~52s, לא מספיק
- **פתרון**: 88+ bars עם structure אמיתי

---

## 7. סדר עדיפויות

| עדיפות | משימה | השפעה | מאמץ |
|--------|------|-------|------|
| **P0** | אחד VoiceSpecs | גבוהה | בינוני |
| **P0** | הפעל master chain ב-worklet | גבוהה | נמוך |
| **P1** | שכתוב kick (sub dominance) | גבוהה | נמוך |
| **P1** | שכתוב bass (pluck/sustain) | גבוהה | בינוני |
| **P1** | שכתוב lead (4-layer) | גבוהה | גבוה |
| **P1** | שכתוב pad (5-layer + shimmer) | בינונית | גבוה |
| **P2** | Bus architecture מלאה | גבוהה | בינוני |
| **P2** | Master chain (multiband+glue+truepeak+LUFS) | גבוהה | בינוני |
| **P3** | Bassline מוזיקלי | גבוהה | גבוה |
| **P3** | Call/response + motif development | בינונית | גבוה |
| **P3** | Arrangement 88+ bars | בינונית | בינוני |
| **P4** | Per-hit variation | בינונית | נמוך |
| **P5** | Modulation matrix | בינונית | גבוה |
| **P6** | Reference analysis | נמוכה | גבוה |

---

## 8. המטרה הסופית

```
Full-spectrum psytrance:
  - 88+ bars (2+ minutes)
  - 19+ voices with identity
  - 4-layer lead, 5-layer pad, 3-layer kick
  - Full bus architecture
  - Master chain: multiband → glue → sat → truepeak → LUFS
  - Modulation matrix (6 sources × 8 destinations)
  - Reference analysis (learn from commercial tracks)
  - Render → analyze → adjust loop
  - LUFS -9, true-peak -0.2dBTP
  - Stereo width 0.7-0.9, mono <120Hz
  - Per-hit variation, human feel
  - Deterministic (same seed = same output)
```

---

## 9. מה לא לעשות

1. **אל תוסיף עוד קולות בלי לתקן את הקיימים** — קודם איכות, אחר כך כמות
2. **אל תשחק עם gain staging לפני שה-DSP נכון** — קודם synthesis, אחר כך mix
3. **אל תדחוף עוד מסמכים** — יש מספיק ידע, צריך לבצע
4. **אל תבנה עוד engines** — אחד VoiceSpecs, שני backends
5. **אל תשכח את PSY3** — הסאונד שלו עדיף, למד ממנו
