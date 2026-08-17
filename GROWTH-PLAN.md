# מסקנות ותכנית צמיחה — psy-foundation

## מצב נוכחי (v6.2)

### מה בנינו:
- **16 קבצים נקיים**, 6,064 שורות (הסרנו 47% dead code)
- **13 קולות**: kick (3-layer), bass (3-layer), lead (4-layer), pad (5-layer), acid, texture, hat (metallic), snare (TR-808), shaker, subbass, riser, impact, sample
- **ZDF SVF** — הסטנדרט המקצועי (מ-PsySynthPro)
- **Choke groups** — open hat חונק closed hat (מ-PSYDRUM)
- **Velocity-to-timbre** — kick brighter ב-velocity גבוה (מ-PSYDRUM)
- **Master chain מלא**: HP → multiband → glue → saturation 15% → M/S (mono<120Hz) → LUFS → limiter
- **88-bar arrangement**: intro → build → drop → break → drop2 → climax → outro
- **VLM**: 9/10 על filter quality, clarity, professionalism

### מה התפקיד שלנו:
אנחנו **מנוע הרנדור הקנוני** של משפחת PSY. לא composer, לא UI, לא מכשיר עצמאי. אנחנו הופכים NoteEvents לסאונד.

---

## הבעיות שמחזיקות אותנו

### 1. אנחנו עדיין מייצרים voices במקום לצרוך
הקולות שלנו (PsyKick, PsyBass, PsyLead) הם יפים אבל **לא הטובים במשפחה**:
- PsySynthPro יש ZDF + PolyBLEP + FM + convolution reverb
- psydrum יש analog-modeled drum synthesis + choke groups + velocity-to-timbre
- psysynth יש 124 טסטים ו-contract קנוני

**פתרון**: להפוך ל-consumer של PsyDevice interface

### 2. אין לנו contract עם המשפחה
PSYSTAR, psydrum, psysynth משתמשים ב-PsyDevice interface. אנחנו לא.

**פתרון**: לייבא את ה-shim ולקבל NoteEvents

### 3. ה-AudioCritic הוא יחיד
אין מי שמשווה אותנו ל-reference tracks.

**פתרון**: ReferenceAnalyzer (מ-PSYSTAR style_clone)

### 4. אין real-time engine
אנחנו offline only. PSY6-ULTIMATE ו-PSYSTAR צריכים real-time.

**פתרון**: הפעל את ה-worklet הקיים (psy4-engine.js, 109KB)

---

## תכנית צמיחה — 5 שלבים

### שלב 1: PsyDevice Consumer (שבוע 1)
```
מטרה: קבלת NoteEvents מכל מכשיר במשפחה

מה לעשות:
1. ייבא את foundation shim מ-psydrum/psysynth
2. צור PsyFoundationDevice שמממש PsyDevice
3. קבל NoteEvents → רנדר → WAV + AudioCritic
4. פרסם /api/render-events endpoint

תוצאה: PSYSTAR יכול לשלוח events ולקבל WAV בחזרה
```

### שלב 2: Voice Bridge (שבוע 2)
```
מטרה: צריכת voices מ-psydrum/psysynth/PsySynthPro

מה לעשות:
1. צור VoiceBridge interface
2. PsySynthPro → bridge לסינת' (ZDF + FM + PolyBLEP)
3. psydrum → bridge לתופים (choke + velocity-to-timbre)
4. psysynth → bridge ל-subtractive
5. החלף את ה-voices הפנימיים ב-bridges

תוצאה: הסאונד מגיע מהמקורות הטובים ביותר
```

### שלב 3: Reference Analyzer (שבוע 3)
```
מטרה: למידה מרצועות מסחריות

מה לעשות:
1. צור ReferenceAnalyzer (מ-PSYSTAR style_clone)
2. נתח: BPM, key, spectral, dynamics, structure
3. צור TargetProfile
4. השווה render → reference → distance → adjust

תוצאה: המערכת יודעת למה לשאוף
```

### שלב 4: Real-time Engine (שבוע 4)
```
מטרה: הפעלת ה-worklet הקיים (psy4-engine.js, 109KB)

מה לעשות:
1. שכתב את ה-worklet להשתמש ב-ZDF SVF
2. חבר את ה-master chain החדש
3. פרסם /api/stream endpoint (WebSocket)
4. אפשר real-time playback ב-PSYSTAR

תוצאה: real-time + offline, אותו סאונד
```

### שלב 5: Knowledge Hub (שבוע 5)
```
מטרה: מאגר ידע מרכזי לכל המשפחה

מה לעשות:
1. אסוף את כל המסמכים מ-psy4 (15 מסמכים)
2. הוסף ידע מ-PSYDRUM (choke, velocity-to-timbre)
3. הוסף ידע מ-PsySynthPro (ZDF, FM, PolyBLEP)
4. הוסף ידע מ-PSYSTAR (harmony, humanizer, song mode)
5. פרסם כ-/docs/knowledge-hub

תוצאה: כל מכשיר חדש נשען על הידע שלנו
```

---

## איך אוביל את המשפחה

### כללי מנהיגות:
1. **אני המקור הקנוני** — VoiceSpecs, AudioCritic, RenderResult
2. **אני לא מתחרה** — אני צורך מכולם, לא מייצר
3. **אני מפרסם ידע** — כולם נשענים עלי
4. **אני מודד איכות** — AudioCritic + VLM = אובייקטיביות
5. **אני deterministic** — אותו seed = אותו output

### איך אתרום לכל תיקיה:

| תיקיה | מה אתן | מה אקבל |
|-------|--------|---------|
| PSYSTAR | render backend + AudioCritic + mastering | harmony, humanizer, song mode, P2P |
| PsySynthPro | consumer integration | ZDF SVF, PolyBLEP, FM, convolution |
| psydrum | consumer integration | choke groups, velocity-to-timbre, variance |
| psysynth | consumer integration | subtractive synthesis, MIDI |
| psy4 | VoiceSpecs, AudioCritic | composition engine |
| PSY6 | render + critique | pooled engine, grammar |
| psy5 | RT-safe patterns | zero-GC voice pool |
| psy3-clean | sound reference | the best sound |

### עקרונות הנדסיים:
1. **One source of truth** — VoiceSpecs.ts
2. **Pure functions** — אני צורך, לא מייצר
3. **Deterministic** — אותו seed = אותו output
4. **Observable** — AudioCritic + VLM
5. **Clean** — 0 dead code, 0 secrets
6. **Tested** — כל שינוי עם בדיקה
7. **Documented** — index.ts עם architecture

---

## יעדים ל-3 חודשים

| חודש | יעד |
|------|-----|
| **חודש 1** | PsyDevice consumer + Voice bridges |
| **חודש 2** | Reference analyzer + real-time engine |
| **חודש 3** | Knowledge hub + stems export + P2P |

בסוף התקופה:
- PSYSTAR ישלח events ויקבל WAV בחזרה
- PsySynthPro יספק את ה-filter
- psydrum יספק את התופים
- אנחנו נהיה **השכבה הסאונדית הקנונית**
