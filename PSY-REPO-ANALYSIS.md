# בחינת תיקיות PSY — מסקנות

## סקירת כל ה-repos (13 סך הכל)

### repos חדשים שהתגלו (3):

#### 1. PSYSTAR (5.7MB, עודכן 2026-08-17)
**"מכונת התודעה" — פלטפורמת מכשיר קנונית עם 59 פיזות**

מה יש שם:
- **6 שכבות ארכיטקטורה**: Core, Domain, Protocol, Engine, Integration, UI
- **Engine** (26 מודולים): lookahead-scheduler, voice-manager, effects-rack, mastering, metering, midi-clock, tap-tempo, humanizer, recorder, stems, wav-encoder
- **Domain** (32 מודולים): pattern, transport, scene, song, euclidean, harmony, progression-gen, melody-gen, evolution, groove-template, journey, library, setlist
- **תכונות ייחודיות**:
  - P2P סנכרון בין מכשירים (WebRTC ללא שרת)
  - PWA (ניתן להתקנה, עובד אופליין)
  - MIDI דו-כיווני (in+out)
  - Song mode עם עריכת סצנות
  - יצוא stems (כל קול ל-WAV נפרד)
  - יצוא MIDI (.mid תקני)
  - חלימה אוטומטית (morphing בין פריסטים)
  - הומניזציה (סחיפת זמן, jitter, ghost notes)
  - טרנספורמציות רול (טון, אוקטבה, רטרוגרד, היפוך)
  - מחולל מהלכים הרמוניים
  - מחולל מלודיה אוטומטי
  - אוטומציית טמפו (BPM משתנה)
  - סטליסט (שמירת הופעה שלמה)
  - מקדש נייד PWA

#### 2. PSYDRUM (70KB, עודכן 2026-08-17)
**מכשיר תופים קנוני — analog-modeled drum synthesis**

מה יש שם:
- **ZDF State-Variable Filter** (zero-delay feedback)
- **Choke groups** (open hat חונק closed hat)
- **Velocity-to-timbre** mapping (louder = brighter)
- **Per-drum pitch/decay/tone envelopes**
- **Kit library** עם provenance ו-hot-swap
- **Sample layer** optional blended with synthesis
- **Variance rules** — seeded micro-variance deterministic
- **MIDI map** + MIDI-learn
- **Counters** ל-observability (event/voice/steal/choke)
- **B1 fix**: unpitched drums לא מקבלים pitch placeholder (הבאג ש-PSY4 היה לו)

#### 3. PsySynthPro (0KB → src only)
**סינת' אמיתי עם DSP מקצועי**

מה יש שם:
- **PolyBLEP** band-limited oscillators (saw/square/tri)
- **ZDF State-Variable Filter** (Simper/Zavalishin topology)
- **Analog one-pole exponential ADSR**
- **FM** via instantaneous frequency (DX7-style phase modulation)
- **Convolution reverb** + feedback delay
- **16-voice pool** עם oldest-note stealing
- **tanh soft-clip** output

### repos קיימים שנבדקו קודם:

| Repo | מה חדש/חשוב |
|------|-------------|
| **psy4** | מקור הידע (109KB worklet + 15 מסמכי ידע) |
| **PSY6-ULTIMATE** | 156KB HTML, pooled engine, grammar system |
| **psy5** | RT-safe patterns (zero GC) |
| **psy3-clean** | הסאונד הכי טוב (154KB Web Audio) |
| **psysynth** | עודכן! 124 טסטים, PolyBLEP + Moog LPF, MIDI |
| **psy-sampler** | PsyDevice interface, DeviceHost |

---

## מסקנות קריטיות

### 1. ZDF Filter — השדרוג הכי חשוב שחסר לנו

**PsySynthPro** ו-**PSYDRUM** משתמשים ב-ZDF (Zero-Delay Feedback) State-Variable Filter:
```
g = tan(π * fc / sr)
k = 2 - res
a1 = 1 / (1 + g*(g+k))
v3 = sig - ic2eq
v1 = a1*ic1eq + g*a1*v3
v2 = ic2eq + g*a1*ic1eq + g*g*a1*v3
```

ה-Moog ladder שלנו (ב-forensic/dsp.ts) הוא **naive topology** — לא zero-delay. ZDF הוא הסטנדרט בסינת'ים מקצועיים (Serum, Massive, Vital). זה מסביר למה ה-filter שלנו נשמע "צורם" ב-resonance גבוה.

### 2. PSYSTAR פתר בעיות שאנחנו עדיין מתמודדים איתן

PSYSTAR מכיל כבר:
- **lookahead-scheduler** — אנחנו משתמשים ב-setInterval (לא sample-accurate)
- **voice-manager עם steal** — אנחנו משתמשים ב-round-robin פשוט
- **humanizer** — סחיפת זמן + jitter + ghost notes (אנחנו התחלנו את זה)
- **mastering** — dB, סף קומפרסיה, יחס בשליטה חיה
- **metering** — RMS, peak עם peak-hold
- **stems export** — כל קול ל-WAV נפרד
- **song mode** — מסע עם סצנות (אנחנו יש לנו arrangement אבל לא song mode)
- **euclidean** — יוצר קצב אוקלידי (לא קיים אצלנו)
- **harmony engine** — 7 סולמות, אקורדים דיאטוניים, מהלכים הרמוניים

### 3. PSYDRUM פתר את בעיית ה-B1 (pitch placeholder)

PSYDRUM מזהה שתופים הם **unpitched** — ה-note field ב-NoteEvent לא משפיע על pitch. אצלנו, ה-bass ו-lead מקבלים MIDI notes, אבל ה-kick/snare/hat לא צריכים. הבאג הזה גרם ל-kicks לנגן 2 אוקטבות גבוה מדי.

### 4. Choke Groups — חסר לנו לגמרי

PSYDRUM מיישם **choke groups**: open hat חונק closed hat. אצלנו, שני hats יכולים להתנגן יחד וליצור mud. זה קריטי לתופים.

### 5. Velocity-to-timbre mapping

PSYDRUM ממפה velocity ל-timbre (louder = brighter), לא רק ל-gain. אצלנו, velocity רק משפיע על amplitude. זה גורם לתופים להישמע "שטוחים".

### 6. PSYSTAR יש P2P סנכרון

PSYSTAR מיישם סנכרון **WebRTC P2P** בין מכשירים — lead/follow, play/stop/bpm/scene/grid. אצלנו אין שום יכולת רשת.

---

## מה כדאי לשלב מכל repo

| מקור | מה לשלב | עדיפות | השפעה |
|------|---------|--------|-------|
| **PsySynthPro** | ZDF State-Variable Filter | **גבוהה** | סאונד filter מקצועי |
| **PSYDRUM** | Choke groups | **גבוהה** | ניקוי mud ב-hats |
| **PSYDRUM** | Velocity-to-timbre | **גבוהה** | תופים חיים |
| **PSYDRUM** | Variance rules (seeded) | בינונית | יש לנו, אבל פחות מפותח |
| **PSYSTAR** | Lookahead scheduler | **גבוהה** | RT timing מדויק |
| **PSYSTAR** | Voice manager עם steal | בינונית | ניהול קולות יעיל |
| **PSYSTAR** | Humanizer | בינונית | יש לנו התחלה |
| **PSYSTAR** | Harmony engine | בינונית | מהלכים הרמוניים |
| **PSYSTAR** | Song mode | בינונית | מסע מוזיקלי אמיתי |
| **PSYSTAR** | Stems export | נמוכה | יצוא ל-DAW |
| **PSYSTAR** | P2P sync | נמוכה | רשת מכשירים |
| **PSYSTAR** | Euclidean | נמוכה | קצב פוליריתמי |

---

## המסקנה העיקרית

יש לנו **3 מקורות חדשים של ידע** שלא ניצלנו:

1. **ZDF Filter** מ-PsySynthPro — שדרוג ה-DSP הכי חשוב. ה-Moog שלנו נחות.
2. **Choke groups + velocity-to-timbre** מ-PSYDRUM — שדרוג התופים.
3. **Lookahead scheduler + harmony engine + song mode** מ-PSYSTAR — שדרוג הארכיטקטורה.

הסאונד שלנו כרגע הוא 8/10 מ-VLM, אבל עם ZDF filter הוא יכול להגיע ל-9/10. התופים יותר נקיים עם choke groups. והארכיטקטורה תהיה מקצועית עם lookahead scheduler.

### המלצה לפעולה (לא ביצוע עכשיו):
1. **החלף MoogLadder ב-ZDF SVF** — העתק מ-PsySynthPro
2. **הוסף choke groups** ל-hats — העתק מ-PSYDRUM
3. **הוסף velocity-to-timbre** ל-kick/snare — העתק מ-PSYDRUM
4. **שקול lookahead scheduler** מ-PSYSTAR (ארוך טווח)
