# פרומפט המשך — PSY4 לרמה מסחרית מוכחת

> המשך מ-commit `a3ca0b4` (PSY4 v4.0: VoiceSpecs unified + kick/bass/lead rewritten)
> מבוסס על ניתוח 11 repos + COMMERCIAL_AUDIO_AUDIT + PSY3_SOUND_DESIGN_RULES

---

## מצב נוכחי (v4.0)

### מה הושלם:
- ✅ **VoiceSpecs מאוחד** (`voice-specs.ts`) — מקור אמת אחד לכל פרמטרים
- ✅ **Kick** — 3-layer: sub (0.18s, dominant) + mid (triangle) + click (0.002s)
- ✅ **Bass** — 3-layer: sub + body (2 detuned saws) + character (square BP), pluck/sustain mode
- ✅ **Lead** — 4-layer: fundamental + octave + air + FM
- ✅ **Bridge** — bus gains מ-BUS_GAINS, master מ-MASTER_SPEC

### מה נשאר (לפי עדיפות):

---

## שלב 1 — השלמת שכתוב קולות (P1)

### 1.1 Pad — 5-layer עם shimmer + chorus
```
קובץ: src/lib/psy4/psy-voices.ts (PsyPad class)

שכבות נדרשות:
1. osc1: bl_saw, -7 cents detune
2. osc2: bl_saw, +7 cents detune
3. osc3: bl_triangle, octave-up, ±3 cents
4. chorus: delayed detuned copy (20ms offset, 0.3Hz LFO)
5. shimmer: pitch-shifted reverb tail (octave-up via playbackRate)

Filter: LP 600Hz, slow LFO 0.15Hz (depth 0.5)
Stereo: wide (Haas + M/S)
Envelope: attack 0.3s, release 0.4s
Reverb send: 0.4

מפרט: PAD_SPEC ב-voice-specs.ts
```

### 1.2 Acid — bidirectional filter LFO
```
קובץ: src/lib/psy4/psy-voices.ts (PsyAcid class — צור חדש)

שכבות:
1. bl_square (oscillator)
2. Moog filter עם:
   - LFO bidirectional (2Hz, depth 0.7) — NOT one-directional
   - Envelope sweep (amount 2.0, decay 0.12s)
   - Resonance 0.85 (high, for peak movement)
3. Distortion (drive 3.0, hard clip)
4. Stereo pan (±0.3, automation)

מפרט: ACID_SPEC ב-voice-specs.ts
```

### 1.3 Texture — granular + morphing
```
קובץ: src/lib/psy4/psy-voices.ts (PsyTexture class — צור חדש)

שכבות:
1. 4 detuned oscillators עם random grain positions
2. Wavetable interpolation (slow morph, 0.05Hz)
3. Pink noise → bandpass, slow sweep (0.1Hz)
4. LP filter (morph rate 0.1Hz)
5. Stereo (wide, moving)
6. Reverb send (0.6)

צריך: אין Spec מוגדר — צור TEXTURE_SPEC ב-voice-specs.ts
```

### 1.4 Per-hit variation
```
קובץ: src/lib/psy4/psy-voices.ts (PsyHat, PsySnare, PsyShaker)

הוסף ל-trigger:
- pitch: ±2% (מ-HAT_SPEC.pitchVar)
- decay: ±10%
- tone: filter cutoff ±100Hz
- pan: ±0.1 (מ-HAT_SPEC.panVar)

השתמש ב-Rng (deterministic) לא random
```

---

## שלב 2 — שרשרת מאסטר מלאה (P2)

### 2.1 הפעל multiband + glue + saturation ב-forensic-bridge
```
קובץ: src/lib/psy4/forensic-bridge.ts (שורות ~580-600)

כרגע השרשרת היא:
  multiband.processBuffer → widener → LUFS → limiter

צריך להיות (לפי MASTER_SPEC):
  sum → HP(25Hz)
  → multiband (3-band: low<180Hz, mid 180-4k, high>4k)
    low: thr 0.126, ratio 3:1, att 10ms, rel 100ms, makeup 1.2
    mid: thr 0.079, ratio 2.5:1, att 15ms, rel 120ms, makeup 1.1
    high: thr 0.1, ratio 2:1, att 5ms, rel 80ms, makeup 1.1
  → glue comp (thr 0.6, ratio 2.0, att 4ms, rel 120ms, makeup 1.3)
  → saturation (tanh, drive 1.15, mix 0.15)
  → stereo management (M/S, mono <120Hz, width 1.3)
  → true-peak limiter (4x oversampled, ceiling 0.98)
  → LUFS targeting (-9 LUFS)
  → output

חשוב: ה-MultibandCompressor כבר קיים ב-multiband.ts
       ה-StereoWidener כבר קיים ב-ms-processor.ts
       ה-TruePeakLimiter כבר קיים ב-limiter.ts
       צריך להוסיף: HP(25Hz), glue comp, saturation (15% mix)
```

### 2.2 Mono bass ב-stereo management
```
קובץ: src/lib/psy4/ms-processor.ts

הוסף ל-StereoWidener:
- monoBelow(freq, L, R): מאחד ל-mono מתחת ל-freq (120Hz)
- זה מונע phase issues ב-bass

קוד:
  processBuffer(L, R) {
    // M/S widen
    // ...
    // Mono below 120Hz
    for (let i = 0; i < n; i++) {
      // One-pole LP on L+R
      const mono = (L[i] + R[i]) * 0.5
      lpState += a * (mono - lpState)
      const stereoContent = L[i] - lpState // high-freq stereo
      L[i] = lpState + stereoContent * width
      R[i] = lpState - stereoContent * width
    }
  }
```

---

## שלב 3 — מוזיקליות (P3)

### 3.1 Bassline מוזיקלי
```
קובץ: src/lib/psy4/forensic-bridge.ts (באזור "Rolling 16th bass")

כרגע: 4 patterns קבועים של 16 צעדים
צריך: phrase-level development (8-bar phrases)

הוסף:
- bars 0-1: simple root pattern
- bars 2-3: add fifth movement
- bars 4-5: add octave jumps
- bars 6-7: simplify (drop anticipation)
- חזרה עם mutation (שנה תו אחד כל פעם)

השתמש ב-ARRANGEMENT_SPEC.sections לדעת איזה section מנגן
```

### 3.2 Call/Response engine
```
קובץ: src/lib/psy4/forensic-bridge.ts (באזור "Counter-lead")

כרגע: counter = harmony (midi + 4 או +7)
צריך: lead → space → response → return

הוסף:
- lead מנגן motif (bars 0-1)
- space (bar 2 — אין lead)
- acid/texture response (bar 3 — acid מנגן motif דומה)
- lead return (bar 4 — חזרה עם variation)
```

### 3.3 Motif development (AABA)
```
קובץ: src/lib/psy4/forensic-bridge.ts (באזור "Lead")

כרגע: 4 notes קבועים [64, 67, 71, 67]
צריך: AABA structure

A: [64, 67, 71, 67] — original
A: [64, 67, 71, 67] — repeat
B: [76, 74, 71, 69] — contrast (higher register, different rhythm)
A': [64, 67, 71, 72] — return with variation (last note changed)

השתמש ב-barIdx % 4 לקביעת A/A/B/A'
```

### 3.4 Arrangement 88 bars
```
קובץ: src/lib/psy4/forensic-bridge.ts

כרגע: 32 bars (4-bar phrases חוזרים)
צריך: 88 bars לפי ARRANGEMENT_SPEC

שנה את ה-render לתמוך ב-88 bars:
- intro (8): kick + bass + hats + shaker
- build1 (16): + pad + lead
- drop1 (16): + counter + snare (full energy)
- break (8): drop lead/bass, keep pad + texture + riser
- drop2 (16): + acid (full energy)
- climax (16): + impact (sustained peak)
- outro (8): fade out

השתמש ב-ARRANGEMENT_SPEC.sections לקבוע אילו קולות מנגנים
```

---

## שלב 4 — Modulation Matrix (P5)

### 4.1 ModulationMatrix class
```
קובץ: src/lib/psy4/modulation-matrix.ts (צור חדש)

interface ModRoute {
  source: 'lfo1' | 'lfo2' | 'lfo3' | 'env1' | 'velocity' | 'macro1' | 'macro2' | 'macro3'
  destination: 'pitch' | 'cutoff' | 'resonance' | 'fmIndex' | 'amp' | 'pan' | 'drive' | 'delaySend'
  amount: number  // -1..1
}

class ModulationMatrix {
  routes: ModRoute[]
  lfos: { rate: number, phase: number }[]
  
  process(sample, voiceParams) {
    // Apply all routes
    for (const route of routes) {
      const sourceValue = this.getSource(route.source)
      voiceParams[route.destination] += sourceValue * route.amount
    }
  }
}

Default routes (from PSY4_DEEP_ROAST):
  LFO1 (0.3Hz) → lead cutoff (0.3)
  LFO2 (2Hz) → acid cutoff (0.7, bidirectional)
  LFO3 (5.5Hz) → lead FM index (0.2)
  Env1 → lead filter (3.0)
  Velocity → lead brightness (0.5)
  Macro1 (SPACE) → reverb + delay + filter
  Macro2 (ENERGY) → drive + volume + filter
  Macro3 (TENSION) → filter + reso + swing
```

---

## שלב 5 — Reference Analysis (P6)

### 5.1 ReferenceAnalyzer
```
קובץ: src/lib/psy4/reference-analyzer.ts (צור חדש)

class ReferenceAnalyzer {
  analyze(audioBuffer: Float32Array): ReferenceProfile {
    return {
      bpm: this.estimateBPM(audioBuffer),        // onset autocorrelation
      key: this.estimateKey(audioBuffer),         // chroma profile
      spectralProfile: this.spectralBands(audioBuffer), // low/mid/high
      lufs: this.measureLUFS(audioBuffer),
      dynamics: this.measureDynamics(audioBuffer), // crest, range
      structure: this.detectStructure(audioBuffer), // bar-level RMS → sections
    }
  }
}

5.2 Render → Analyze → Adjust loop
class AutoTuner {
  optimize(seed, target: ReferenceProfile): RenderConfig {
    // render → analyze → compare → adjust → re-render
    // until distance < threshold
  }
}
```

---

## שלב 6 — אימות מסחרי

### 6.1 בדיקות כמותיות
```bash
# 1. LUFS בין -9 ו- -8.5
# 2. True-peak < -0.2 dBTP
# 3. Stereo width 0.7-0.9
# 4. Stereo correlation 0.5-0.8
# 5. Kick/bass ratio > 0.1
# 6. Kick punch > 0.7
# 7. Crest factor > 4.0
# 8. 0 failures ב-AudioCritic
# 9. Determinism: SHA-256 זהה
# 10. 88 bars רציף
```

### 6.2 בדיקות איכותיות (VLM)
```bash
# צור spectrogram:
ffmpeg -i psy4.wav -lavfi "showspectrumpic=s=1920x1080:legend=1:color=intensity:scale=log" -update 1 spec.png

# נתח עם VLM:
z-ai vision -p "Is this commercial-grade psytrance? Rate 1-10 for: frequency balance, stereo width, dynamic range, clarity, professionalism" -i spec.png
```

### 6.3 השוואה ל-PSY3
```bash
# השווה dry voices:
# PSY3 kick peak: 1.361, PSY4 target: > 1.0
# PSY3 bass peak: 0.559, PSY4 target: > 0.4
# PSY3 lead peak: 0.189, PSY4 target: > 0.15
# PSY3 pad peak:  0.196, PSY4 target: > 0.15
```

---

## סדר ביצוע

| סדר | משימה | קובץ | השפעה |
|-----|------|------|-------|
| 1 | Pad 5-layer + shimmer | psy-voices.ts | גבוה |
| 2 | Acid bidirectional | psy-voices.ts | גבוה |
| 3 | Texture granular | psy-voices.ts | בינוני |
| 4 | Per-hit variation | psy-voices.ts | בינוני |
| 5 | Glue comp + saturation 15% | forensic-bridge.ts | גבוה |
| 6 | Mono bass <120Hz | ms-processor.ts | גבוה |
| 7 | Bassline musical | forensic-bridge.ts | גבוה |
| 8 | Call/response AABA | forensic-bridge.ts | גבוה |
| 9 | Arrangement 88 bars | forensic-bridge.ts | גבוה |
| 10 | Modulation matrix | modulation-matrix.ts | בינוני |
| 11 | Reference analyzer | reference-analyzer.ts | נמוך |
| 12 | אימות + commit + push | — | קריטי |

---

## כללים קריטיים (מ-PSY3)

1. **Sub over click** — kick sub 90x יותר ארוך מ-click
2. **Bass leaves room** — filter יורד ל-150Hz
3. **Band-limited oscillators** — אף פעם לא PeriodicWave
4. **Controlled mutation** — תו אחד כל 4 בארים, לא random
5. **Section-aware FX** — kick dry, lead delay, pad reverb
6. **Tension shapes** — arc/rise/fall לפי section
7. **Downbeat accent** — 1.4x probability
8. **Subtle saturation** — 15% mix, לא distortion
9. **Frequency-dependent stereo** — mono <120Hz, wide מעל

---

## מטרה סופית

```
Full-spectrum psytrance מסחרי:
  - 88+ bars (2.4+ דקות)
  - 19+ voices עם identity
  - 4-layer lead, 5-layer pad, 3-layer kick
  - Full bus architecture (drum/bass/music/fx)
  - Master chain: HP → multiband → glue → sat(15%) → M/S → truepeak → LUFS(-9)
  - Modulation matrix (6 sources × 8 destinations)
  - Per-hit variation (pitch/decay/tone/pan)
  - LUFS -9, true-peak -0.2dBTP
  - Stereo width 0.7-0.9, mono <120Hz
  - Deterministic (same seed = same output)
  - VLM: "commercial-grade, professional"
```

---

**התחל משלב 1 (Pad + Acid + Texture) ועבור לפי סדר.**
