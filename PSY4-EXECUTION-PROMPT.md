# PSY4 — פרומט ביצוע מלא (Master Execution Prompt)

> **מטרה סופית:** מערכת שמייצרת מוזיקת psytrance ברמה מסחרית, עם ניקוד AudioCritic > 0.75, < 3 כשלים, 12+ ערוצים עם שרשרת אפקטים, 32+ תיבות רציפות, דטרמיניסטי, כל הטסטים עוברים, מחויב ל-Git.

---

## הקשר ומצב נוכחי (READ FIRST)

### מה קיים וקפוא
- **Foundation** (`src/foundation/music/`): קפוא. 646 טסטים עוברים. אסור לשנות.
- **סריאליזציה**: `serializeRawScore()` מייצא `RawScore` (JSON-safe, דטרמיניסטי).
- **קולות סינתזה** (`src/lib/psy4/psy-voices.ts`, 617 שורות): 11 קלאסים — PsyKick, PsyBass, PsyLead, PsyHat, PsySample, PsySnare, PsySubBass, PsyPad, PsyShaker, PsyRiser, PsyImpact.
- **רנדרר** (`src/lib/psy4/forensic-bridge.ts`, 477 שורות): ממיר RawScore → Stereo PCM 44100Hz.
- **AudioCritic** (`src/lib/psy4/audio-critic.ts`, 908 שורות): 8 תחומי ניקוד + 12 קודי כשל.
- **APIs**: `/api/render-forensic` (WAV), `/api/audio-critique` (JSON ניקוד).
- **דגימות אמיתיות** (`public/samples/real/`): 141 קבצי WAV (TR-909, Machinedrum, Nord Drum).
- **ניקוד נוכחי**: ~0.57. **יעד**: > 0.75.

### אילוצי סביבה (NON-NEGOTIABLE)
1. Next.js 16, TypeScript 5, Tailwind 4, shadcn/ui.
2. פורט 3000 בלבד. `bun run dev` ברקע.
3. `z-ai-web-dev-sdk` רק בצד שרת.
4. אסור `bun run build`. בדיקה רק דרך Agent Browser.
5. כל ה-APIs בנתיב יחסי בלבד. WebSocket דרך `?XTransformPort={Port}`.

---

## חוקי ביצוע (MANDATORY RULES)

### חוק 1 — אין דילוגים
כל שלב חייב להתבצע לפי הסדר. אסור לעבור לשלב N+1 לפני ששלב N עבר את קריטריוני הקבלה.

### חוק 2 — הוכחה בלבד
"זה מתקמפל" אינו הוכחה. כל שלב דורש ראיות קונקרטיות: ניקוד AudioCritic, פלט PCM, צילום מסך Agent Browser, לוג dev.log.

### חוק 3 — דטרמיניזם
אותו seed חייב לייצר אותו פלט עד רמת ה-bit (אחרי round-trip WAV). לפני כל commit, הרץ seed=42 פעמיים והשווה SHA-256.

### חוק 4 — Worklog חובה
כל תת-משימה שמבוצעת על ידי subagent חייבת:
1. לקרוא `/home/z/my-project/worklog.md` לפני תחילת עבודה.
2. להוסיף סעיף חדש עם `---`, Task ID, Agent, Task, Work Log, Stage Summary.

### חוק 5 — Frontend קודם
לכל פיצ'ר: כתוב UI תחילה (שהמשתמש רואה משהו), אחר כך backend.

### חוק 6 — ללא טסטים חדשים ב-Foundation
Foundation קפוא. כל הטסטים החדשים ב-`src/lib/psy4/__tests__/` או ב-`tests/`.

### חוק 7 — Git commit אחרי כל שלב
אחרי כל שלב שעבר קריטריוני קבלה: `git add -A && git commit -m "PSY4-S{N}: {description}"`. דחיפה ל-GitHub רק בסוף.

---

## שלבי הביצוע (10 STAGES)

---

### שלב 1 — שרשרת אפקטים לכל ערוץ (Per-Channel FX Chain)

**מטרה:** כל ערוץ קול עובר דרך EQ → Delay → Reverb → Pan, עם פרמטרים נפרדים.

**תתי-משימות:**

#### 1.1 — הגדרת ממשק ChannelFX
- [ ] צור קובץ `src/lib/psy4/channel-fx.ts`
- [ ] הגדר `interface ChannelFXConfig`:
  ```typescript
  {
    eq: { lowGainDb: number; lowFreqHz: number; highGainDb: number; highFreqHz: number }
    delay: { timeMs: number; feedback: number; mix: number; stereoOffsetMs: number }
    reverb: { roomSize: number; decaySec: number; damping: number; mix: number }
    pan: number  // -1 = שמאל, 0 = מרכז, +1 = ימין
    width: number  // 0 = mono, 1 = full stereo
  }
  ```
- [ ] ממש `class ChannelFX` שמקבל `ChannelFXConfig` ומעבד `Float32Array` (L, R) sample-by-sample.
- [ ] EQ: biquad high-shelf + low-shelf (תשתמש ב-`BiquadFilter` הקיים מ-`forensic/dsp.ts`).
- [ ] Delay: stereo ping-pong עם feedback, מקסימום 2 שניות buffer.
- [ ] Reverb: השתמש ב-`SchroederReverb` הקיים, עם wet/dry mix.
- [ ] Pan: equal-power pan law (`cos/sin`).

#### 1.2 — רישום פריסטים לכל ערוץ
- [ ] צור `src/lib/psy4/channel-presets.ts` עם `Record<VoiceType, ChannelFXConfig>`:
  - **PsyKick**: EQ low +2dB @ 60Hz, high -1dB @ 8kHz, delay off, reverb mix 0.03, pan 0
  - **PsyBass**: EQ low +1dB @ 80Hz, high -2dB @ 5kHz, delay off, reverb mix 0.0, pan 0
  - **PsyLead**: EQ low -2dB @ 200Hz, high +1dB @ 6kHz, delay 375ms/0.3fb/0.18mix, reverb 0.4/1.8s/0.7damp/0.22mix, pan 0
  - **PsyHat**: EQ high +2dB @ 10kHz, delay 16th/0.15fb/0.08mix, reverb 0.3/0.8s/0.9damp/0.05mix, pan ±0.3 (alternating)
  - **PsySnare**: EQ mid +1dB @ 2kHz, delay 250ms/0.2fb/0.12mix, reverb 0.5/2.0s/0.6damp/0.18mix, pan 0
  - **PsyPad**: EQ low -1dB, high +1dB, delay 500ms/0.4fb/0.25mix, reverb 0.7/3.0s/0.5damp/0.35mix, pan 0
  - **PsyShaker**: pan ±0.4, delay off, reverb 0.2/0.6s/0.9damp/0.03mix
  - **PsyRiser**: reverb 0.8/4.0s/0.4damp/0.4mix, pan 0, width 1.0
  - **PsyImpact**: reverb 0.6/2.5s/0.5damp/0.3mix, pan 0

#### 1.3 — שילוב ברנדרר
- [ ] ב-`forensic-bridge.ts`, צור `ChannelFX` instance לכל סוג קול.
- [ ] כל קול שמייצר samples, עובר דרך `channelFX.process(samplesL, samplesR)` לפני שנכנס ל-bus.
- [ ] ודא ש-bus sum קורה אחרי FX, לא לפני.

**קריטריוני קבלה:**
- [ ] AudioCritic `timbre` score עולה לפחות ב-0.05 מהנוכחי.
- [ ] סטריאו width בפלט > 0.3 (מדד: `stereoWidth = mean(|L-R|) / mean(|L+R|)`).
- [ ] אותו seed מייצר אותו PCM (SHA-256 זהה).
- [ ] אין clipping (peak < 0.98).
- [ ] Agent Browser: האזנה לפלט — נשמע רוחב סטריאו.

---

### שלב 2 — קונטרפוינט לד (Harmony / Response Lead)

**מטרה:** קול לד שני שמנגן "תשובה" ללד הראשי — יוצר דיאלוג מוזיקלי.

**תתי-משימות:**

#### 2.1 — יצירת PsyLead2
- [ ] ב-`psy-voices.ts`, צור `class PsyLead2` (או הרחב את PsyLead עם `variant: 'primary' | 'counter'`).
- [ ] PsyLead2 משתמש ב-family שונה מהלד הראשי (אם ראשי = PSY_ACID, counter = FM_PSY או ATMOSPHERIC).
- [ ] אוקטבה גבוהה יותר (+5 עד +12 חצאי-טונים מהראשי).
- [ ] עוצמה נמוכה יותר (0.5x gain).

#### 2.2 — לוגיקת תזמון קונטרפוינט
- [ ] ב-`forensic-bridge.ts`, אחרי תזמון הלד הראשי, צור תגובות:
  - אם הלד הראשי מנגן ב-step 0-3, ה-counter עונה ב-step 8-11.
  - אם הלד הראשי מנגן ב-step 8-11, ה-counter עונה ב-step 0-3 של התיבה הבאה.
  - ה-counter לא מנגן כשהראשי מנגן (no overlap).
- [ ] הפיצ'ים של ה-counter: הרמוניה שלישונית (third/fifth של האקורד) או sixth על המלודיה הראשית.

#### 2.3 — שילוב ברנדרר
- [ ] הוסף `lead2Notes` ל-RawScore parsing (גזור מ-leadNotes עם אלגוריתם ה-response).
- [ ] צור PsyLead2 instance נפרד עם FX chain משלו (delay ארוך יותר, reverb יותר wet).

**קריטריוני קבלה:**
- [ ] AudioCritic `musicality` score עולה ב-0.05 לפחות.
- [ ] AudioCritic `lead` score לא יורד.
- [ ] מוטיב call-response נשמע באזניים (Agent Browser).
- [ ] דטרמיניזם נשמר.

---

### שלב 3 — Open Hi-Hat סינקופטי

**מטרה:** hi-hat פתוח (ארוך) בעל off-beat syncopation — מוסיף groove.

**תתי-משימות:**

#### 3.1 — PsyOpenHat voice
- [ ] ב-`psy-voices.ts`, צור `class PsyOpenHat`:
  - אורך 100-200ms (לעומת closed hat 30-50ms).
  - שני רכיבים: metallic noise (6 band-pass filters בתדרים 6-12kHz) + filtered white noise decay.
  - עוצמה 0.7x מ-closed hat.

#### 3.2 — דפוס syncopated
- [ ] ב-`forensic-bridge.ts`, מקם open hats:
  - Step 6 ו-step 14 (off-beat 16th notes).
  - רק בתיבות זוגיות (כל 2 תיבות) — יוצר tension/release.
  - אקראית ב-30% מהמקרים גם step 10.

#### 3.3 — FX chain
- [ ] Open hat: delay 8th note / 0.2fb / 0.1mix, reverb 0.3/0.8s/0.9damp/0.06mix, pan ±0.25.

**קריטריוני קבלה:**
- [ ] AudioCritic `groove` score עולה ב-0.05.
- [ ] High-end energy (6-12kHz) עולה ב-10%.
- [ ] אין masking עם closed hats (בדוק: הפסקה של 50ms לפחות ביניהם).

---

### שלב 4 — סטריאו רחב (M/S Stereo Widener)

**מטרה:** רוחב סטריאו מקצועי על המאסטר, ללא פגיעה ב-mono compatibility.

**תתי-משימות:**

#### 4.1 — MSProcessor
- [ ] צור `src/lib/psy4/ms-processor.ts`:
  ```typescript
  class StereoWidener {
    process(L: Float32Array, R: Float32Array, width: number): void {
      // M = (L+R)/2, S = (L-R)/2
      // L' = M + width*S, R' = M - width*S
    }
  }
  ```
- [ ] פרמטר `width` בין 0 (mono) ל-2.0 (extra wide). ברירת מחדל 1.3.
- [ ] בדוק mono compatibility: כש-width=1.3, `|L'+R'| / |L+R|` לא נופל מתחת 0.85 (no phase cancellation).

#### 4.2 — שילוב ב-master chain
- [ ] ב-`forensic-bridge.ts`, הכנס StereoWidener אחרי bus sum, לפני master limiter.
- [ ] יישם width=1.3 על כל הסטריאו, חוץ מ-kick/bass (שנשארים mono/center).

**קריטריוני קבלה:**
- [ ] stereoWidth metric > 0.4.
- [ ] Mono compatibility: sum ל-mono לא מאבד יותר מ-2dB.
- [ ] ללא phase issues (correlation > 0.3).

---

### שלב 5 — יעד LUFS (-9 LUFS)

**מטרה:** עוצמת מאסטר מקצועית: -9 LUFS integrated, true-peak < -1 dBTP.

**תתי-משימות:**

#### 5.1 — מדד LUFS
- [ ] צור `src/lib/psy4/loudness.ts`:
  - K-weighting filter (pre-filter + RLB filter).
  - ממוצע נע של 400ms blocks.
  - Integrated LUFS = mean over 10s+ with relative gate (-10 LU below absolute gate).
- [ ] ממש `function measureLUFS(L: Float32Array, R: Float32Array, sampleRate: number): number`.

#### 5.2 — True-peak limiter
- [ ] צור `class TruePeakLimiter` ב-`src/lib/psy4/limiter.ts`:
  - 4x oversampling (לחישוב inter-sample peaks).
  - Threshold: -1.0 dBTP.
  - Attack: 1ms, release: 100ms.
  - Lookahead: 5ms.

#### 5.3 — אינטגרציה
- [ ] אחרי master gain, מדוד LUFS.
- [ ] חשב gain adjustment: `gainDelta = targetLUFS - measuredLUFS`.
- [ ] החל gain נוסף, עבור דרך TruePeakLimiter.
- [ ] מדוד שוב. אם > -8.8 LUFS, הפחת והגבל.

**קריטריוני קבלה:**
- [ ] LUFS integrated בין -9.2 ו- -8.8.
- [ ] True-peak < -1.0 dBTP.
- [ ] אין pumping audible (limit gain reduction < 6dB).

---

### שלב 6 — דחיסה מרובת פסים (Multiband Compressor)

**מטרה:** שליטה בדינמיקה לכל פס תדרים — low/mid/high.

**תתי-משימות:**

#### 6.1 — MultibandCompressor
- [ ] צור `src/lib/psy4/multiband.ts`:
  - 3 פסים: low (0-200Hz), mid (200-2000Hz), high (2000-20000Hz).
  - Linkwitz-Riley crossover (4th order, 24dB/oct).
  - כל פס: compressor עם threshold/ratio/attack/release.
- [ ] פריסט: low (-18dB threshold, 3:1 ratio, 10ms att, 100ms rel), mid (-22dB, 2.5:1, 15ms, 120ms), high (-20dB, 2:1, 5ms, 80ms).

#### 6.2 — סדר בשרשרת
- [ ] סדר: Bus Sum → Multiband → StereoWidener → LUFS Gain → TruePeakLimiter.

**קריטריוני קבלה:**
- [ ] Dynamic range (crest factor) בין 6dB ו-10dB.
- [ ] low band crest factor > 8dB (kick/bass punch נשמר).
- [ ] אין pumping.

---

### שלב 7 — Snare Fills

**מטרה:** סנרים שממלאים סוף בית / מעברים — יוצרים עניין ריתמי.

**תתי-משימות:**

#### 7.1 — דפוס fills
- [ ] ב-`forensic-bridge.ts`, זהה "fill bars" (כל 8 תיבות, לפני שינוי section).
- [ ] ב-4 ה-steps האחרונים של fill bar: snare roll.
  - Pattern: step 12 = single snare, step 13 = flam, step 14 = double, step 15 = burst (3 snares עם microtiming 16th triplets).

#### 7.2 — PsySnare enhancement
- [ ] ודא ש-PsySnare תומך ב-velocity ramp (כל snare ב-fill עולה ב-velocity מ-0.6 ל-1.0).
- [ ] הוסף "rimshot" variant (מצב שני ב-PsySnare עם פחות body, יותר crack).

**קריטריוני קבלה:**
- [ ] AudioCritic `groove` score עולה ב-0.03.
- [ ] Fills נשמעים כל 8 תיבות (Agent Browser).
- [ ] אין masking עם kick באותם steps.

---

### שלב 8 — רנדור 60 שניות (32 תיבות)

**מטרה:** רנדור רציף של 32 תיבות @ 145 BPM ≈ 52.9s (קרוב ל-60s).

**תתי-משימות:**

#### 8.1 — הרחבת הרכב
- [ ] ב-`forensic-bridge.ts`, העבר `bars=32` ל-CompositionEngine.
- [ ] ודא ש-arrangement רץ: INTRO(4) → BUILD(8) → DROP(12) → BREAK(4) → DROP2(4). כל התיבות עם kick+bass חוץ מ-INTRO(2 bars fade-in) ו-BREAK.
- [ ] ודא שאין דממה מיותרת — כל תיבה שלא מנגנת נחתכת.

#### 8.2 — ביצועים
- [ ] מדוד זמן רנדור: חייב להיות < 30 שניות ל-32 תיבות.
- [ ] אם לא, אופטים: pre-allocate buffers, צמצם allocations בלולאה.

#### 8.3 — API
- [ ] עדכן `/api/render-forensic` לתמיכה ב-`bars=32` (ברירת מחדל).
- [ ] החזר WAV + metadata (duration, lufs, peak).

**קריטריוני קבלה:**
- [ ] 32 תיבות נטענות ב-Agent Browser תוך < 30s.
- [ ] אין דממה > 1 שנייה רצופה (חוץ מ-BREAK bar).
- [ ] Energy consistency: RMS של כל 4 תיבות לא נופל מתחת 60% מהממוצע.

---

### שלב 9 — לולאת אופטימיזציה סגורה (Render → Critique → Fix → Re-render)

**מטרה:** לולאה אוטונומית שמשפרת את הניקוד עד ליעד.

**תתי-משימות:**

#### 9.1 — AutoFixer
- [ ] צור `src/lib/psy4/auto-fixer.ts`:
  ```typescript
  async function optimizeRender(
    seed: number,
    maxIterations: number = 8,
    targetScore: number = 0.75
  ): Promise<OptimizationReport>
  ```
- [ ] כל איטרציה: render → critique → קרא failures → החל תיקון ל-config → re-render.
- [ ] מפת תיקונים (הרחב את הקיים מ-`audio-quality-iterator.ts`):
  - `BASS_DECAY_TOO_LONG` → bassDecay *= 0.8
  - `KICK_TRANSIENT_MASKED` → kickClickAmount *= 1.3, kickClickBrightness *= 1.2
  - `WEAK_PUNCH` → kickBodyDecay *= 0.85, kickPitchDropTime *= 0.9
  - `LOW_MID_MUD` → bassMidCutoff *= 0.9, leadCutoff *= 1.1
  - `NO_TIMBRAL_MOVEMENT` → switch lead family (rotate through 6 families)
  - `LEAD_TOO_BRIGHT` → leadCutoff *= 0.85
  - `HIGH_END_TOO_WEAK` → hatGain *= 1.3
  - `RHYTHMIC_PATTERN_TOO_UNIFORM` → add 15% randomization to hat steps
  - `KICK_BASS_PHASE_RISK` → shift bass start by +1 sample
  - `LEAD_TOO_STATIC` → increase filter env amount
  - `LEAD_MASKING_BASS` → lead low-cut to 250Hz
  - `WEAK_MOTIF_IDENTITY` → boost lead velocity 1.2x

#### 9.2 — API
- [ ] צור `/api/optimize?seed=42&maxIterations=8` שמחזיר OptimizationReport.
- [ ] החזר: iterations[], initialScore, finalScore, improvement, verdict, finalWavUrl.

#### 9.3 — UI
- [ ] בעמוד הראשי, הוסף כפתור "Auto-Optimize".
- [ ] לחיצה → קריאה ל-API → הצגת התקדמות איטרציה-איטרציה.
- [ ] הצגת גרף ניקוד לאורך איטרציות (Chart.js או גרף SVG פשוט).

**קריטריוני קבלה:**
- [ ] לולאה מגיעה לניקוד > 0.75 תוך 8 איטרציות (או מצביעה על צוואר בקבוק).
- [ ] כל איטרציה מייצרת PCM שונה.
- [ ] UI מציג התקדמות בזמן אמת.

---

### שלב 10 — אימות סופי ושחרור

**מטרה:** אימות מלא שכל קריטריוני העצירה מתקיימים.

**תתי-משימות:**

#### 10.1 — בדיקת דטרמיניזם
- [ ] הרץ `seed=42` פעמיים, חשב SHA-256 של שני ה-WAVs.
- [ ] **חייב** להיות זהה. אם לא — debug עד שכן.

#### 10.2 — בדיקת ניקוד
- [ ] הרץ `/api/audio-critique?bars=32&seed=42` 5 פעמים עם seeds שונים (42, 100, 200, 300, 400).
- [ ] ממוצע overallScore חייב להיות > 0.75.
- [ ] אף ריצה לא מייצרת יותר מ-3 failures.

#### 10.3 — בדיקת ערוצים
- [ ] ספור ערוצים פעילים ברנדור: חייבים להיות 12+ (kick, bass, sub-bass, lead, lead2, snare, hat, openhat, shaker, pad, riser, impact).
- [ ] כל ערוץ חייב לעבור דרך FX chain מוגדר.

#### 10.4 — בדיקת רציפות
- [ ] 32 תיבות רצופות, אין דממה > 1s (חוץ מ-BREAK).
- [ ] Energy flow עקבי.

#### 10.5 — בדיקות טכניות
- [ ] `bun run lint` — 0 errors, 0 warnings.
- [ ] כל הטסטים ב-`src/lib/psy4/__tests__/` עוברים.
- [ ] Foundation: 646 טסטים עוברים (ללא שינוי).

#### 10.6 — Agent Browser (MANDATORY)
- [ ] פתח את `/` ב-Agent Browser.
- [ ] ודא שהעמוד נטען (no white screen).
- [ ] לחץ "Render" — ודא ש-WAV מתנגן.
- [ ] ודא שניקוד מוצג.
- [ ] בדוק responsive: mobile (375px) + desktop (1440px).
- [ ] ודא footer sticky למטה.
- [ ] צלם מסך.

#### 10.7 — Git
- [ ] `git add -A && git commit -m "PSY4-FINAL: score>0.75, 32 bars, 12 channels, deterministic"`
- [ ] דחוף ל-GitHub:
  ```bash
  GIT_TOKEN=$(sed -n '4p' "/home/z/my-project/upload/push and i will revove.env" | tr -d '[:space:]') && \
  export GIT_TOKEN && \
  cd /home/psy-foundation && \
  git -c credential.helper='!f() { echo "username=x-access-token"; echo "password=$GIT_TOKEN"; }; f' push origin HEAD && \
  unset GIT_TOKEN
  ```

**קריטריוני עצירה (STOP CONDITIONS):**
- [ ] AudioCritic overallScore > 0.75 (ממוצע 5 seeds)
- [ ] < 3 failures בכל ריצה
- [ ] 12+ ערוצים עם FX
- [ ] 32+ תיבות רצופות
- [ ] דטרמיניסטי (SHA-256 זהה)
- [ ] כל הטסטים עוברים
- [ ] Agent Browser מאשר: עמוד נטען, ניגון עובד, responsive, footer sticky
- [ ] Git commit + push הושלמו

---

## מבנה קבצים סופי (TARGET FILE STRUCTURE)

```
src/lib/psy4/
├── psy-voices.ts          (קיים, יורחב — PsyLead2, PsyOpenHat)
├── forensic-bridge.ts     (קיים, יורחב — FX integration, 32 bars)
├── audio-critic.ts        (קיים, ללא שינוי)
├── channel-fx.ts          (חדש — ChannelFX class)
├── channel-presets.ts     (חדש — per-voice FX presets)
├── ms-processor.ts        (חדש — StereoWidener)
├── loudness.ts            (חדש — LUFS measurement)
├── limiter.ts             (חדש — TruePeakLimiter)
├── multiband.ts           (חדש — MultibandCompressor)
├── auto-fixer.ts          (חדש — render→critique→fix loop)
└── __tests__/
    ├── channel-fx.test.ts
    ├── ms-processor.test.ts
    ├── loudness.test.ts
    ├── limiter.test.ts
    └── auto-fixer.test.ts

src/app/api/
├── render-forensic/route.ts  (קיים, יעודכן — bars=32 default)
├── audio-critique/route.ts   (קיים, ללא שינוי)
└── optimize/route.ts         (חדש — auto-optimization loop)

src/app/page.tsx  (קיים, יורחב — Auto-Optimize button + score chart)
```

---

## פקודות ביצוע (EXECUTION COMMANDS)

### הפעלת שרת
```bash
cd /home/z/my-project && nohup bash keepalive.sh > /dev/null 2>&1 &
```

### בדיקת lint
```bash
cd /home/z/my-project && bun run lint
```

### בדיקת ניקוד
```bash
curl -s "http://localhost:3000/api/audio-critique?bars=32&seed=42" | jq '.overallScore'
```

### בדיקת דטרמיניזם
```bash
curl -s "http://localhost:3000/api/render-forensic?bars=32&seed=42" -o /tmp/a.wav
curl -s "http://localhost:3000/api/render-forensic?bars=32&seed=42" -o /tmp/b.wav
sha256sum /tmp/a.wav /tmp/b.wav  # חייב להיות זהה
```

### Agent Browser
```bash
# פתח את / וצלם מסך, בדוק אינטראקציה
```

---

## פורמט דיווח (REPORTING FORMAT)

בסוף כל שלב, דווח:

```markdown
## שלב {N} — {שם}

### הושלם
- [ ] תת-משימה 1
- [ ] תת-משימה 2

### ראיות
- AudioCritic score: {לפני} → {אחרי}
- SHA-256 (seed=42): {hash}
- צילום מסך Agent Browser: {path}
- dev.log: {no errors}

### בעיות שהתגלו
- {בעיה}: {פתרון}

### Commit
- hash: {git hash}
- message: "PSY4-S{N}: {description}"
```

---

## סדר עדיפויות ל-Subagents (PARALLELIZATION)

| Task ID | שלב | Agent | יכול לרוץ במקביל ל- |
|---------|-----|-------|---------------------|
| 1 | FX Chain | full-stack-developer | — |
| 2-a | MS Processor | general-purpose | 2-b, 2-c |
| 2-b | LUFS Meter | general-purpose | 2-a, 2-c |
| 2-c | TruePeakLimiter | general-purpose | 2-a, 2-b |
| 3 | Multiband | general-purpose | (אחרי 2-a/b/c) |
| 4 | Integration | full-stack-developer | (אחרי 1, 3) |
| 5 | Counter Lead | general-purpose | 4 |
| 6 | Open Hat | general-purpose | 4 |
| 7 | Snare Fills | general-purpose | 4 |
| 8 | 32 Bars | full-stack-developer | 5, 6, 7 |
| 9 | Auto-Fixer | full-stack-developer | 8 |
| 10 | Final Verify | (self) | 9 |

---

**END OF PROMPT — התחל ביצוע משלב 1.**
