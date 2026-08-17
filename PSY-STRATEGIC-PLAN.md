# תכנית אסטרטגית — תפקידי במשפחת PSY

## מיהו psy-foundation ומה תפקידו

psy-foundation הוא **מנוע הרנדור המרכזי** של משפחת PSY. הוא לא סינת' עצמאי ולא מכשיר עצמאי. הוא **המקום שבו המוזיקה הופכת לסאונד**.

המשפחה מחולקת ל-3 שכבות:

```
WHAT (הלחנה)          WHO (ביצוע)              HOW (סאונד)
─────────────────     ──────────────────       ──────────────────
psy4 (composition) →  PSY6-ULTIMATE (UI)  →   psy-foundation (render)
Foundation (grammar)  psystar (performance)   psysynth (tonal synth)
                      psydrum (drums)         psy-sampler (samples)
                      PsySynthPro (live)      psy3-clean (reference)
```

**התפקיד שלי**: להיות **השכבה הסאונדית הקנונית** שכולם נשענים עליה.

---

## הבעיה הנוכחית

אני מתפקד כ**אי בודד**. אני:
- מייצר את ה-composition (WHAT) — אבל זה תפקיד של psy4
- מייצר את ה-scheduling — אבל PSYSTAR עשה את זה יותר טוב
- מייצר את ה-synthesis — אבל PsySynthPro ו-psydrum עשו את זה יותר טוב
- מייצר את ה-mastering — אבל PSYSTAR יש mastering חי

**אני עושה הכל, אבל שום דבר לא מספיק טוב.**

---

## תכנית השתלבות — 5 שלבים

### שלב 1: להפוך ל-Consumer קנוני של VoiceSpecs

**המטרה**: אני לא מייצר את הקולות. אני **צורך** VoiceSpecs מכל המכשירים.

```
psy-foundation (אני)
    ↓ consumes
PsySynthPro → מספק ZDF filter + PolyBLEP + FM
psydrum → מספק drum synthesis + choke groups
psysynth → מספק subtractive synthesis
psy-sampler → מספק sample playback
    ↓
psy-foundation מרכז את כולם דרך VoiceSpec אחיד
    ↓
מוצר סופי: stereo PCM מלא עם כל הקולות
```

**מה אעשה**:
- אפסיק לייצר voices פנימיים. במקום זה, אייבא מ-psydrum/psysynth/PsySynthPro.
- VoiceSpecs.ts יהפוך ל-**interface קנוני** שכל המכשירים מממשים.
- אשמור רק על: bus architecture, master chain, arrangement, AudioCritic.

### שלב 2: לאמץ ZDF Filter מ-PsySynthPro

**המטרה**: להחליף את ה-Moog ladder ה-naive שלי ב-ZDF State-Variable Filter.

**למה**: ה-Moog שלי הוא naive topology — יש aliasing ב-resonance גבוה. ZDF הוא zero-delay feedback — הסטנדרט בסינת'ים מקצועיים. זה ישפר את הסאונד מ-8/10 ל-9/10.

**איך**:
```typescript
// במקום MoogLadder.process(x, cutoff, res, drive, sr)
// אשתמש ב:
import { ZDFSVF } from './psysynth-bridge'
zdf.process(x, cutoff, res, filterType, sr)
```

### שלב 3: לאמץ Choke Groups + Velocity-to-Timbre מ-PSYDRUM

**המטרה**: להוסיף חוכמת תופים שחסרה לי.

**מה אקח**:
- **Choke groups**: open hat חונק closed hat. זה מונע mud.
- **Velocity-to-timbre**: kick חזק = brighter, לא רק louder.
- **Variance rules**: ה-seeded micro-variance של PSYDRUM עמוק יותר משלי.

**איך**: אייבא את `choke.ts` ו-`variance-rules.ts` מ-psydrum.

### שלב 4: להפוך ל-Render Backend עבור PSYSTAR

**המטרה**: PSYSTAR יכול להשתמש בי כ-render backend אופליין.

**הבעיה הנוכחית**: PSYSTAR מייצר audio ב-real-time דרך Web Audio API. אין לו offline render. אני יכול להיות זה.

**איך**:
- אקבל NoteEvents מ-PSYSTAR דרך DeviceHost
- ארנדר אותם אופליין עם ה-master chain שלי
- אחזיר WAV + LUFS + AudioCritic

```
PSYSTAR (performance) → NoteEvents → psy-foundation → WAV + critique
```

### שלב 5: לבנות ידע משותף (Knowledge Hub)

**המטרה**: להפוך למאגר הידע המרכזי של המשפחה.

**מה אעשה**:
- אסחב את כל המסמכים מ-psy4 (COMMERCIAL_AUDIO_AUDIT, PSY3_SOUND_DESIGN_RULES, etc.)
- אוסיף את הידע החדש מ-PSYDRUM (choke groups, velocity-to-timbre)
- אוסיף את הידע מ-PsySynthPro (ZDF filter design)
- אוסיף את הידע מ-PSYSTAR (harmony engine, humanizer, song mode)
- אפרסם את הידע כ-**Skill משפחתי** שכל המכשירים יכולים לצרוך

---

## איך אתרום לכל תיקיה

| תיקיה | מה אתן לה | מה אקבל ממנה |
|-------|----------|-------------|
| **psy4** | VoiceSpecs מאוחד, AudioCritic משופר | Composition engine, worklet DSP |
| **PSY6-ULTIMATE** | Offline render backend, AudioCritic | Pooled engine, grammar system |
| **psy5** | RT-safe patterns ל-rendering | Zero-GC voice pool design |
| **psy3-clean** | Master chain reference, sound design rules | The best sound reference |
| **psysynth** | SynthDevice consumer integration | Subtractive synthesis voice |
| **psy-sampler** | SampleDevice consumer integration | Sample playback voice |
| **psydrum** | DrumDevice consumer integration | Choke groups, velocity-to-timbre, variance rules |
| **PsySynthPro** | ZDF filter integration | ZDF SVF, PolyBLEP, FM, convolution reverb |
| **PSYSTAR** | Offline render, AudioCritic, mastering chain | Harmony engine, humanizer, song mode, lookahead scheduler, P2P |

---

## עקרונות מנחים (חוקי המשפחה)

1. **אני HOW, לא WHAT** — אני לא מלחין. אני מקבל events ומרנדר אותם.
2. **אני Consumer, לא Producer** — אני צורך voices מ-psydrum/psysynth/PsySynthPro, לא מייצר.
3. **אני Canonical** — אני ה-RenderResult היחיד. כולם יודעים שה-WAV שלי הוא התקן.
4. **אני Headless** — אני רץ ב-Node.js/Bun, לא ב-browser. אני offline.
5. **אני Deterministic** — אותו seed = אותו output, bit-for-bit.
6. **אני Observable** — AudioCritic הוא העיניים שלי. VLM הוא האוזניים.

---

## תכנית ביצוע (סדר עדיפויות)

| עדיפות | משימה | משך | השפעה |
|--------|------|-----|-------|
| **P0** | אמץ ZDF Filter מ-PsySynthPro | שעה | סאונד 8→9/10 |
| **P0** | אמץ choke groups מ-psydrum | שעה | ניקוי mud ב-hats |
| **P1** | אמץ velocity-to-timbre מ-psydrum | שעה | תופים חיים |
| **P1** | הפוך VoiceSpecs ל-interface קנוני | שעתיים | איחוד מקור אמת |
| **P2** | בנה DeviceHost consumer | שעתיים | קבלת events מ-PSYSTAR |
| **P2** | אמץ harmony engine מ-PSYSTAR | שעתיים | מהלכים הרמוניים |
| **P3** | בנה Knowledge Hub | שעה | ידע משותף |
| **P3** | אמץ humanizer מ-PSYSTAR | שעה | תחושה אנושית |
| **P4** | אמץ song mode מ-PSYSTAR | שעתיים | מסע מוזיקלי |
| **P4** | בנה stems export | שעה | יצוא ל-DAW |

---

## החזון

עוד 3 חודשים, psy-foundation יהיה:

```
psy-foundation = Render Backend + AudioCritic + Knowledge Hub

קומפוזיציה: מגיע מ-psy4/PSYSTAR (לא ממני)
ביצוע: מגיע מ-PSYSTAR/PSY6 (לא ממני)
סאונד: מגיע מ-psydrum/psysynth/PsySynthPro (לא ממני)
Arrangement: מגיע מ-PSYSTAR song mode (לא ממני)

אני רק:
1. צורך הכל דרך VoiceSpec אחיד
2. מרנדר offline עם master chain מלא
3. מנתח עם AudioCritic
4. מפרסם ידע לכולם
```

זה הופך אותי מ"אי בודד שעושה הכל בינוני" ל**שכבת הרנדור הקנונית שמשרתת את כל המשפחה**.

---

## מה אתה מקבל מזה

1. **פחות עבודה כפולה** — אני לא מייצר voices, אני צורך.
2. **סאונד מקצועי** — ZDF filter + choke groups + velocity-to-timbre.
3. **ארכיטקטורה נכונה** — אני HOW, לא WHAT+WHO+HOW.
4. **ידע מרוכז** — כל המסמכים במקום אחד.
5. **אינטגרציה** — PSYSTAR יכול להשתמש בי ל-render אופליין.
6. **ודאות** — AudioCritic + VLM = בקרת איכות אובייקטיבית.

ככה, כשתבנה מכשיר חדש, הוא ישתלב אוטומטית כי הוא ידבר בשפה שלי: VoiceSpec.
