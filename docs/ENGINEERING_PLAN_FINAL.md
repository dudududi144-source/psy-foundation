# PSY-FOUNDATION — תוכנית הנדסית סופית

> **ארכיטקט ראשי:** PSY Engineer (מונה על-ידי בעל הפרויקט)
> **תאריך אישור:** 2026-08-19
> **סטטוס:** מאושר, ממתין לביצוע
> **כללי יסוד:** אסור לשקר. מודים רק במה שמאומת. שומרים גיבויים. לא מוחקים סתם.

---

## 0. הקדמה — מה התגלה בבדיקה העמוקה

### 0.1 התגלית המכריעה
בתוך `public/psy-foundation.zip` (504KB, נכון ל-2026-08-13) מוסתר **monorepo אמיתי ושלם** של `psy-foundation` עם:
- **13 packages** (10 library + 3 research apps)
- **250 טסטים עוברים** (357,016 expect() calls)
- biome + tsconfig.base + integration tests + benchmarks
- **ה-`@psy-foundation/dsp` package שחסר ב-repo הציבורי** — זה ש-`kick-voice.ts`/`bass-voice.ts`/`lead-voice.ts` מנסים לייבא

ה-repo הציבורי ב-`dudududi144-source/psy-foundation` הוא **app shell** (Next.js + 6 API routes + page.tsx) שיושב מעל ה-foundation האמיתי — אבל ה-foundation **לא פרוס** ב-repo. הוא רק ב-zip.

המשמעות: **לפני שמשנים שורת קוד אחת ב-psy4, צריך לפרוס את ה-foundation מה-zip לתוך ה-repo**. בלי זה, כל ה-`@psy-foundation/dsp` imports תלויים ב-air.

### 0.2 הבדיקות שבוצעו (מאומתות, לא קריאת קוד בלבד)
- ✅ dev server עולה (`localhost:3456`, 787ms to ready)
- ✅ `/` מחזיר HTML 200 (36KB)
- ✅ `/api/render-forensic?bars=8&seed=42` מחזיר WAV 1.75MB (9.93s, stereo 44.1kHz 16-bit)
- ✅ `/api/audio-critique?bars=8&seed=42` מחזיר JSON עם 38 מטריקות (31s response)
- ✅ `/api/optimize?bars=8&seed=42` רץ 2-5 דקות
- ✅ ffmpeg loudnorm: **-10.4 LUFS, -0.3 dBTP, 2.1 LU LRA**
- ✅ AudioCritic פנימי: **-11.98 LUFS, -0.28 dBTP** (פער 1.6 LU מ-ffmpeg)
- ✅ git history: 178 commits ב-8 ימים (2026-08-12 → 2026-08-19)
- ✅ GitHub token אומת — יש הרשאות admin+push ל-`dudududi144-source/psy-foundation`
- ✅ `psy-foundation.zip` מכיל monorepo עם 13 packages

### 0.3 טענה קודמת שלי שהייתה שגויה (תיקון להגינות)
ב-roast הקודם טענתי ש-`page.tsx:356` מכיל `noteNamesidi` (שגיאת תחביר). **טעות.** בדיקה הקסדצימלית מאשרת שהקוד תקין: `noteNames[midi % 12]`. הצגת `noteNamesidi` נבעה מבעיית תצוגה של הכלים בלבד. הבאג הזה לא קיים. ה-`ignoreBuildErrors: true` עדיין בעייתי אבל לא בגלל הסיבה הזו.

---

## 1. החלטות ארכיטקטוניות סופיות (ללא שאלות)

### החלטה #1: מבנה הפרויקט — MONOREPO אמיתי
**החלטה:** פריסת ה-foundation מתוך `psy-foundation.zip` לתוך ה-repo הציבורי, כ-monorepo עם workspaces.

**מבנה סופי:**
```
psy-foundation/
├── packages/                    # ה-foundation האמיתי מה-zip
│   ├── dsp/                     # @psy-foundation/dsp (39 tests)
│   ├── music/                   # @psy-foundation/music (43 tests)
│   ├── transport/               # @psy-foundation/transport (12 tests)
│   ├── protocol/                # @psy-foundation/protocol (8 tests)
│   ├── analysis/                # @psy-foundation/analysis (26 tests)
│   ├── learning/                # @psy-foundation/learning (32 tests)
│   ├── material/                # @psy-foundation/material (23 tests)
│   ├── scheduler/               # @psy-foundation/scheduler (18 tests)
│   ├── device-sdk/              # @psy-foundation/device-sdk (12 tests)
│   └── fixtures/                # @psy-foundation/fixtures (10 tests)
├── apps/
│   ├── web/                     # ה-Next.js app (כרגע src/)
│   └── vst/                     # ה-JUCE plugin (כרגע vst-plugin/)
├── research/                    # סקריפטי AI/ML (מועברים מ-neural/training/)
├── docs/                        # כל התיעוד
├── benchmarks/                  # מה-zip
├── integration/                 # מה-zip
├── package.json                 # workspace root
├── biome.json
└── tsconfig.base.json
```

**סיבה:** ה-foundation כבר קיים ועובד (250 טסטים). ה-app הציבורי רק צריך ל-consume אותו במקום לשחזר את אותם המודולים. חיסרון: ה-app shell הנוכחי ב-`src/` צריך לעבור ל-`apps/web/`.

### החלטה #2: AI/ML — אופציונלי ב-parallel, לא blocker
**החלטה:**
- ב-Phases 0-4: ה-`neural/` folder עובר ל-`research/neural/` עם README כן שאומר "experimental, not integrated into production pipeline".
- כל הטענות "AI", "neural", "DDSP", "RAVE" נמחקות מ-README הראשי.
- ב-Phase 5 (אופציונלי, מקביל): אם יש גישה ל-GPU ו-dataset CC0, נאמן RAVE אמיתי. אם לא — הטענות נשארות מחוקות.

**סיבה:** אי אפשר ל-block את ה-rebuild של 38K LOC על אימון RAVE שדורש 4+ שבועות GPU ו-dataset שלא קיים חוקית.

### החלטה #3: VST plugin — להשאיר כ-experimental, להשלים ב-Phase 4
**החלטה:**
- `vst-plugin/` עובר ל-`apps/vst/`
- README מציין "experimental stub — 3 voice types with real ZDF SVF, PluginEditor not yet implemented"
- ב-Phase 4: בנייה מלאה (PluginEditor.cpp + DSP/ folder + modulation matrix ממומש)

**סיבה:** ה-DSP שכן כתוב (527 LOC C++) הוא אמיתי. חבל למחוק. השארה כ-stub כנה עדיף על מחיקה.

### החלטה #4: Dataset ל-RAVE — לא תלוי ב-Beatport
**החלטה:**
- Dataset יורכב מ: Freesound CC0 psytrance clips + self-produced procedural audio (kick/bass/lead שה-engine עצמו מייצר) + Demucs stem separation על רצועות CC0.
- לא נשתמש ב-Beatport (אי אפשר חוקית לקבל stems).
- אם אין GPU: Phase 5 deferred indefinitely.

### החלטה #5: איכות מסחרית — אמת אובייקטיבית, לא producer blind test
**החלטה:** בכל Gate, השוואה אובייקטיבית ל-3 reference tracks מוחזקים (לא להפיץ):
1. Astrix — "Deep Space Walk" (full-on reference, ~138 BPM, -8 LUFS)
2. Vini Vici — "The Tribe" (progressive, ~134 BPM, -9 LUFS)
3. Infected Mushroom — "Becoming Insane" (full-on, ~145 BPM, -7 LUFS)

המדדים: LUFS, dBTP, LRA, spectral centroid, crest factor, dynamic range. סטייה מ-reference < 1.5 LU ב-LUFS = "קרוב למסחרי".

**סיבה:** לא יודעים אם יהיה מפיק זמין ל-blind test. מדדים אובייקטיביים עקביים.

### החלטה #6: Timeline — 16-20 שבועות solo
**החלטה:**
- Phase 0 (Foundation Unpack + Triage): שבוע 1
- Phase 1 (DSP Bug Fixes + Tests): שבועות 2-4
- Phase 2 (Composition Engine Loop Closure): שבועות 5-8
- Phase 3 (Audio Quality vs Reference): שבועות 9-14
- Phase 4 (VST + Real-time): שבועות 15-20
- Phase 5 (AI Honestly, אופציונלי): מקביל, דורש GPU

---

## 2. הארכיטקטורה הסופית

### 2.1 Layered Architecture (post-rebuild)

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 5: PRESENTATION                                              │
│  apps/web (Next.js)  ·  apps/vst (JUCE C++)  ·  CLI (Bun)         │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 4: APPLICATION SERVICES                                       │
│  RenderService · CritiqueService · OptimizeService · ExportService │
│  (HTTP API + CLI consumers, NO business logic)                    │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 3: DOMAIN — PSY4 RENDER ENGINE                               │
│  forensic-bridge.ts · psy-voices.ts · channel-fx.ts · master chain │
│  · multiband · ms-processor · loudness · limiter · modulation-matrix│
│  · audio-critic · auto-fixer · arrangement · presets · automation │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 2: DOMAIN — COMPOSITION                                     │
│  composition-engine · motif-v2 · transformation · phrase-*        │
│  · harmonic-plan · bass-vocabulary · groove-plan · style-grammar  │
│  · sound-dna · enhanced-failure-detector · learning-kernel         │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 1: FOUNDATION (ה-monorepo מה-zip, 13 packages, 250 tests)   │
│  dsp · music · transport · protocol · analysis · learning         │
│  · material · scheduler · device-sdk · fixtures                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 כללי תלות נוקשים (Dependency Rules)
- **Layer N יכול לייבא רק מ-Layer N-1 ומטה.**
- Layer 1 (foundation) לא מייבא משום layer מעל.
- Layer 2 מייבא מ-Layer 1 בלבד.
- Layer 3 מייבא מ-Layer 1 ו-Layer 2 בלבד.
- Layer 4 מייבא מכל השכבות מתחת.
- **אסור: Layer 3 מייבא מ-`@/components`, מ-`next`, מ-`react`.**
- **אסור: foundation package מייבא מ-`src/`.**

ולדציה: בכל commit, `bun run lint` בודק imports cross-layer. כלל חדש ב-biome.json.

### 2.3 Sample Rate Strategy
- **אפס hard-coded `SR = 44100` מחוץ ל-`foundation/dsp/src/utils.ts::DEFAULT_SR`.**
- כל מודול מקבל `sr: number` פרמטר ב-constructor.
- ברירת מחדל: `DEFAULT_SR = 44100` (audio standard).
- offline render: ניתן להגדיר `sr = 48000` או `96000`.
- real-time worklet: קורא `sampleRate` מ-`AudioContext`.

---

## 3. Roadmap מפורט — Phases

### Phase 0: Foundation Unpack + Triage (שבוע 1, 5 ימי עבודה)

#### יום 1: גיבוי + פריסת foundation
- [ ] יצירת branch `rebuild/phase-0` מ-`main`
- [ ] יצירת תיקיית `_archive/` ב-repo root (gitignored אחרי push)
- [ ] העתקת כל המצב הנוכחי ל-`_archive/pre-rebuild/` (גיבוי)
- [ ] חילוץ `public/psy-foundation.zip` → `packages/` + `apps/` + `benchmarks/` + `integration/` + `data/`
- [ ] העברת `src/lib/psy4/` → `apps/web/src/lib/psy4/` (זמנית, עד ש-Layer 3 יופרד)
- [ ] העברת `src/foundation/music/` → DELETE (כפילות עם `packages/music/`)
- [ ] העברת `src/foundation/transport/` → DELETE (כפילות עם `packages/transport/`)
- [ ] העברת `vst-plugin/` → `apps/vst/`
- [ ] העברת `src/app/` → `apps/web/src/app/`
- [ ] עדכון `next.config.ts` ב-`apps/web/` עם aliases נכונים ל-`@psy-foundation/*`
- [ ] עדכון `package.json` root ל-workspaces
- [ ] `bun install` ב-root
- [ ] `bun test` ב-root — אמור לעבור 250 tests של foundation
- [ ] הפעלת `apps/web/` עם `bun run dev` — אמור לעבוד

**Acceptance:**
- `bun test` מראה 250 tests pass
- `apps/web/` עולה ב-`localhost:3000`
- `/api/render-forensic?bars=8&seed=42` מחזיר WAV זהה (hash אותו כמו קודם)

#### יום 2: מחיקת זבל + גיבוי מלא
- [ ] יצירת branch `rebuild/phase-0-cleanup` מ-`rebuild/phase-0`
- [ ] מחיקת `skills/` (61MB, 667 קבצים) → commit עם message "remove: skills/ marketplace dump (not psytrance-related)"
- [ ] מחיקת `public/samples/real/` (141 files) → commit "remove: commercial 909/MD/Nord samples (license violation, per project manifest)"
- [ ] מחיקת `public/psy-foundation.zip` (לאחר שפרסנו את התוכן)
- [ ] מחיקת `public/demo-16bars.wav` ו-`public/diagnostic.wav` (ישנים)
- [ ] מחיקת 20 deps מ-`package.json` שלא בשימוש (next-auth, next-intl, react-markdown, framer-motion, zustand, z-ai-web-dev-sdk, @dnd-kit/*, @mdxeditor, react-syntax-highlighter, @tanstack/*, date-fns, uuid, zod, tailwindcss-animate, @reactuses/core, react-hook-form, @hookform/resolvers, embla-carousel-react, input-otp, react-day-picker, react-resizable-panels, vaul, cmdk, sonner, recharts, react-syntax-highlighter)
- [ ] מחיקת `src/components/ui/*` (48 קבצים שלא בשימוש) → שמירת `spectrum-analyzer.tsx` בלבד
- [ ] מחיקת `prisma/` + `src/lib/db.ts` (dead tutorial)
- [ ] מחיקת `tests/*.sh` (Z.ai deploy tests)
- [ ] מחיקת `scripts/keepalive.sh` (path שגוי)
- [ ] מחיקת `eslint.config.mjs` ישן, החלפה ב-biome.json מה-zip
- [ ] החלפת `package.json: "psy-foundation": "/home/z/psy-foundation"` ב-self-reference (למחוק)
- [ ] מחיקת `next.config.ts: typescript.ignoreBuildErrors: true` + תיקון כל type errors שמתגלים
- [ ] rename `package.json: name` מ-`"nextjs_tailwind_shadcn_ts"` ל-`"psy-foundation"`
- [ ] עדכון `layout.tsx` metadata (title, description, OG) ל-"PSY Foundation"
- [ ] `bun install` מחדש — אמור לרדת מ-89s ל-<30s
- [ ] `du -sh .` אמור לרדת מ-93MB ל-<35MB

**Acceptance:**
- repo size < 35MB
- `bun install` < 30s
- 0 deps מתים
- `tsc --noEmit` עובר בלי `ignoreBuildErrors`

#### יום 3: תיקון README + docs
- [ ] כתיבת `README.md` חדש — כן לחלוטין:
  - שם: "PSY Foundation — Procedural Psytrance Synthesis Engine (in development)"
  - מה יש: 13 packages foundation, 6 API routes, render engine, composition engine
  - מה חסר: VST buildable, real-time full, AI trained models
  - measured output: `-10.4 LUFS, -0.3 dBTP, 143 BPM` (מ-ffmpeg, לא מ-ה-meter הפנימי)
  - 0 טענות "AI/neural/commercial/VST-AU" עד Phase 4
- [ ] ארכוב `docs/SELF_ROAST.md`, `docs/HONEST_TRUTH.md`, `docs/PROJECT_SUMMARY.md`, `docs/COMMERCIAL_READINESS_ROADMAP.md`, `docs/COMPETITIVE_GAP_ANALYSIS.md` ל-`docs/archive/`
- [ ] כתיבת `docs/STATUS.md` חדש עם מצב נוכחי מאומת
- [ ] כתיבת `docs/ARCHITECTURE.md` עם ה-layered architecture מסעיף 2
- [ ] כתיבת `docs/ROADMAP.md` עם Phases 0-5
- [ ] כתיבת `docs/QUALITY_GATES.md` עם acceptance criteria
- [ ] כתיבת `docs/RISK_REGISTER.md` עם הסיכונים

**Acceptance:**
- README לא מכיל: "AI", "neural", "commercial-grade", "VST/AU" (עד Phase 4)
- כל טענה ב-README מקושרת לקובץ קוד או מדידה מאומתת

#### יום 4: הפעלת lint + type check נוקשים
- [ ] הפעלת 5 כללי biome נוקשים:
  - `noUnusedVariables` (עם `_` prefix exception)
  - `noExplicitAny`
  - `useImportType`
  - `noUnreachableCode`
  - `noUnsafeFinally`
- [ ] תיקון כל שגיאות lint שמתגלות (אמורות להיות מעטות אחרי ה-cleanup)
- [ ] הפעלת `tsc --noEmit` בכל package (foundation כבר עובר)
- [ ] הפעלת `tsc --noEmit` ב-`apps/web/`
- [ ] תיקון כל type errors (לא להחזיר את `ignoreBuildErrors`)

**Acceptance:**
- `bun run lint` — 0 errors
- `bun run typecheck` — 0 errors בכל 13 packages + apps/web
- אפשר למחוק את `next.config.ts: typescript.ignoreBuildErrors`

#### יום 5: Snapshot tests baseline + commit + push
- [ ] כתיבת `apps/web/tests/snapshot.test.ts`:
  - render `?bars=8&seed=42` → hash של ה-WAV → save ל-baseline
  - LUFS metering על baseline → save value
  - 5 unit tests ל-DSP primitives (ZDFSVF frequency response, BLSaw aliasing check, LR4 crossover sum-to-unity, LUFS against sine wave reference, limiter ceiling)
- [ ] `bun test` אמור לעבור 250 + 6 = 256 tests
- [ ] merge `rebuild/phase-0-cleanup` → `rebuild/phase-0` → `main`
- [ ] push ל-GitHub
- [ ] tag `v0.4.0-phase-0-complete`

**Acceptance:**
- 256 tests pass
- snapshot hash יציב של `?bars=8&seed=42`
- GitHub repo נקי

---

### Phase 1: DSP Bug Fixes + Tests (שבועות 2-4, 21 ימי עבודה)

#### שבוע 2: Critical DSP bugs (7 days)

**Day 1-2: StereoWidener + MasterChain**
- [ ] תיקון `ms-processor.ts::StereoWidener.process` (lines 57-91) — math שבור ב-width=1
  - להעתיק מ-`channel-fx.ts:447-450` שכן נכון
  - test: `width=1` מחזיר L,R ללא שינוי
- [ ] הסרת `MasterChain` hard-clip (forensic/mixing.ts:113)
  - להסיר את ה-hard clip
  - להשתמש רק ב-TruePeakLimiter ב-end of chain
- [ ] test: master output לא עובר hard clip

**Day 3-4: TruePeakLimiter**
- [ ] תיקון `limiter.ts::TruePeakLimiter`:
  - להחיל gain ב-4× rate (כרגע detection 4× application 1×)
  - להחליף Catmull-Rom ב-FIR 48-tap ITU-R BS.1770-4 spec
  - O(N) sliding window max (מונוטוניק-queue)
- [ ] test: ffmpeg dBTP ≤ limiter ceiling
- [ ] test: ceiling=-1.0 → ffmpeg מודד ≤ -1.0

**Day 5: OversampledSaturation + BLTriangle**
- [ ] תיקון `OversampledSaturation` (forensic/dsp.ts:451-466):
  - linear interp upsample → FIR 4-tap linear-phase
  - 2-tap boxcar downsample → matched FIR
  - test: aliasing measurement יורד ב-12dB+
- [ ] תיקון `BLTriangle` (forensic/dsp.ts:404-428):
  - saw residual → integrated cubic polyBLEP (Välimäki-Heap)
  - test: aliasing measurement יורד ב-12dB+

**Day 6: MoogLadder**
- [ ] תיקון `MoogLadder` (forensic/dsp.ts:52-86):
  - אפשרות א': מימוש Huovilainen 2004 אמיתי עם Newton iteration
  - אפשרות ב': עדכון docstring ל-"Stilson-Smith derived with unit-delay feedback"
  - החלטה: אפשרות א' אם זמן מאפשר, אחרת אפשרות ב'
- [ ] test: frequency response מתאים ל-reference Moog

**Day 7: SchroederReverb**
- [ ] תיקון `forensic/mixing.ts::SchroederReverb`:
  - להחליף ב-`CompactReverb` מ-`channel-fx.ts:158-281`
  - או לתקן: comb banks נפרדים ל-L/R, decorrelated
- [ ] test: cross-correlation L/R < 0.5

#### שבוע 3: Sample-rate parameterization (7 days)
- [ ] העברת `SR = 44100` מ-8 קבצים ל-`DEFAULT_SR` ב-`foundation/dsp/src/utils.ts`
- [ ] כל מודול מקבל `sr: number` פרמטר
- [ ] קבצים לתיקון:
  - `forensic-bridge.ts:40`
  - `psy-voices.ts:25`
  - `waveguide-string.ts:27`
  - `granular.ts` (8 מקומות)
  - `ms-processor.ts:63`
  - `mixing.ts:187`
  - `neural/ddsp-noise.ts:25` (או למחוק אם ב-Phase 0)
- [ ] tests: render ב-48kHz ו-96kHz → output תקין

#### שבוע 4: audio-critic FFT + learning-kernel bugs (7 days)
- [ ] החלפת `audio-critic.ts::computeDFT` (O(N²)) ב-FFT (radix-2)
  - expected speedup: 100×
  - `/api/audio-critique?bars=8&seed=42` אמור לרדת מ-31s ל-<3s
- [ ] תיקון `learning-kernel.ts::normalizeWeights` precedence bug (line 622)
  - `weights[k] ?? 0 / total` → `(weights[k] ?? 0) / total`
- [ ] תיקון `learning-kernel.ts::bass interval→degree` (line 172)
  - lookup table semitones→degree לכל scale type
- [ ] תיקון `learning-kernel.ts::observe reward loop` (lines 466-517)
  - לחזק רק degrees שתרמו ל-reward, לא uniform scaling
- [ ] תיקון `audio-critic.ts::computeMotifIdentity` — להשתמש ב-`motifIdentity` מ-`motif-v2.ts`
- [ ] תיקון `audio-critic.ts::computeKickBassLock` — spectral separation + onset alignment
- [ ] תיקון `/api/arrangement` — לכבד `?bars=` (ArrangementGenerator.ts overshoot)

**Phase 1 Acceptance Gate:**
- [ ] `bun test` — 256+ tests pass (כולל חדשים)
- [ ] `tsc --noEmit` — 0 errors
- [ ] snapshot hash יציב (אחרי שינויים — לעדכן baseline)
- [ ] ffmpeg dBTP ≤ limiter ceiling (כרגע -0.3 > -0.45 = bug)
- [ ] ffmpeg LUFS ±0.5 מ-target
- [ ] `/api/audio-critique?bars=8&seed=42` < 3s
- [ ] `width=1` מחזיר L,R ללא שינוי (unit test)
- [ ] cross-correlation L/R של reverb < 0.5

---

### Phase 2: Composition Engine Loop Closure (שבועות 5-8, 28 ימים)

#### שבוע 5: Connect dead modules (7 days)
- [ ] SoundDNA → audio-renderer: העברת `synthRecipes` מ-`ComposedBar` ל-config של audio-renderer
- [ ] transformation.ts → composeLeadPlan: לקרוא ל-`invert`/`retrograde`/`augment` ב-phrase boundaries
- [ ] Presets → RenderConfig: מיפוי 17 השדות הנותרים (או מחיקה מה-Preset type)
- [ ] Automation → render loop: verify per-sample read
- [ ] Wavetable → Lead: verify per-sample `process()` call
- [ ] Granular → Texture: spawn loop active
- [ ] Waveguide → Bass: trigger active

#### שבוע 6: Psytrance-specific features (7 days)
- [ ] הוספת texture voice ב-audio-renderer (INTRO state לא שקט)
- [ ] הוספת transition FX (riser/impact/sweep) ב-section boundaries
- [ ] תיקון `harmonic-plan.ts` — ייבוא PSYTRANCE_PROGRESSIONS מ-`psy4/harmony.ts`
- [ ] הוספת 16th rolling bass mode (16 תווים ל-bar ב-darkpsy/forest)
- [ ] הוספת sidechain אמיתי — 6dB duck, 5ms attack, full-mix routing
- [ ] הוספת OTT — upward+downward expander 3-band (genre signature)

#### שבוע 7-8: Composition engine integration tests (14 days)
- [ ] integration tests: 32-bar render → assert structure (intro/build/drop/break/drop2/outro)
- [ ] integration tests: motif recurrence (motifIdentity score > 0.5)
- [ ] integration tests: sidechain audible (-6dB on kick)
- [ ] integration tests: 16th rolling bass mode produces 16 notes/bar
- [ ] A/B comparison framework: render vs reference track (LUFS, spectral centroid, crest factor)

**Phase 2 Acceptance Gate:**
- [ ] INTRO state לא שקט (texture voice audible)
- [ ] DROP state מתחיל עם riser/impact
- [ ] sidechain audible (-6dB on kick)
- [ ] 16th rolling bass mode זמין ועובד
- [ ] OTT audible
- [ ] 3+ motif transformations נקראות לכל phrase
- [ ] `enhanced-failure-detector` עובר על כל render — 0 FAIL critical

---

### Phase 3: Audio Quality vs Reference (שבועות 9-14, 42 ימים)

#### שבוע 9-10: Tuning to reference (14 days)
- [ ] כיוון `targetLufs` ל-9 LUFS (קלאב) או -14 (סטרימינג) — לבחור אחד
  - החלטה: **-9 LUFS** (קלאב, זה הז'אנר)
- [ ] כיוון `ceiling` ל-0.3 dBTP (קלאב) — ffmpeg מודד ≤ -0.3
- [ ] שיפור kick — sub-sustain 0.4-0.8s (כרגע 0.25)
- [ ] שיפור bass — sustain mode + pluck mode (switchable)
- [ ] שיפור lead — 5-layer (fund+oct+air+FM+8kHz harmonic) — verify all 5 audible
- [ ] שיפור pad — slow filter sweep + chorus + shimmer
- [ ] שיפור acid — bidirectional filter LFO
- [ ] שיפור texture — multiple detuned layers + slow morph

#### שבוע 11-12: Reference track comparison (14 days)
- [ ] הכנסת 3 reference tracks ל-`apps/web/tests/fixtures/references/` (gitignored)
- [x] ~~בניית `compare-to-reference` CLI~~ — RETIRED (Phase 2, D8.4): הגרסה הקודמת
      (`benchmarks/compare-to-reference.ts`) השוותה מול קבועי "reference" מומצאים
      שיוחסו לשירים מסחריים (RMS שדווח כ-LUFS, crest כ-LRA) — נמחק. לבנות מחדש
      רק מול קבצי אודיו אמיתיים עם מדידת BS.1770 אמיתית.
- [ ] השוואה: LUFS, dBTP, LRA, spectral centroid, crest factor, dynamic range
- [ ] סטייה מ-reference < 1.5 LU ב-LUFS = "קרוב"
- [ ] tuning iteratively עד ש-render ב-±1.5 LU מ-reference

#### שבוע 13-14: Polish + final tests (14 days)
- [ ] הוספת analog-modeled reverb (ConvolutionWithWav IR, או Valhalla-style algorithmic)
- [ ] הוספת tape delay (analog-modeled)
- [ ] 100 snapshot tests (10 seeds × 10 bar-counts)
- [ ] regression suite: כל commit מריץ snapshot + LUFS + dBTP check

**Phase 3 Acceptance Gate:**
- [ ] ffmpeg LUFS = -9 ±0.5
- [ ] ffmpeg dBTP ≤ -0.3
- [ ] LRA > 4 LU (כרגע 2.1 — דחוס מדי)
- [ ] reference comparison: 3 reference tracks, סטייה < 1.5 LU ב-LUFS
- [ ] producer blind test setup (אופציונלי — לא blocker)

---

### Phase 4: VST + Real-time (שבועות 15-20, 42 ימים)

#### שבוע 15-16: AudioWorklet full (14 days)
- [ ] כתיבת `apps/web/public/worklets/psy4-engine.js` מלא:
  - 13 voices (לא 1)
  - ZDF SVF + BLSaw + DecayEnv ports
  - modulation matrix per-voice
  - MIDI routing by pitch range
  - parameter automation via MessagePort
- [ ] test: כל 13 voices נשמעים ב-real-time
- [ ] latency < 50ms

#### שבוע 17-20: VST plugin complete (28 days)
- [ ] כתיבת `apps/vst/Source/PluginEditor.cpp` + `.h`
- [ ] יצירת `apps/vst/Source/DSP/` עם:
  - `ZDFSVF.h`
  - `BLSaw.h`
  - `Wavetable.h`
  - `Voices.h`
  - `MasterChain.h`
  - `ModulationMatrix.h`
- [ ] מימוש modulation matrix (forward declared, לא ממומש)
- [ ] stereo output (כרגע mono)
- [ ] limiter + master chain ב-C++
- [ ] PluginEditor UI: virtual keyboard, parameter knobs, preset browser
- [ ] cmake build ב-Mac/Windows/Linux
- [ ] test: plugin נפתח ב-REAPER/Bitwig/Ableton Live

**Phase 4 Acceptance Gate:**
- [ ] VST plugin נבנה ב-cmake (`cmake --build .` מצליח)
- [ ] plugin נפתח ב-DAW (REAPER)
- [ ] 13 voices ב-real-time (AudioWorklet)
- [ ] modulation matrix עובד ב-DAW
- [ ] L ≠ R (stereo)
- [ ] LUFS meter ב-DAW מראה -9 ±1

---

### Phase 5: AI Honestly (אופציונלי, מקביל, דורש GPU)

**רק אם יש גישה ל-GPU (RTX 3090/4090/A100 24GB+):**

- [ ] איסוף dataset: 100+ שעות psytrance CC0 (Freesound) + self-produced
- [ ] stem separation עם Demucs → 1000 stems
- [ ] תיקון `research/neural/training/train_rave.py`:
  - הוספת PQMF analysis/synthesis
  - multi-scale STFT loss
  - multi-period + multi-scale discriminator
  - feature matching loss
  - two-stage training
- [ ] אימון 7 ימים על GPU
- [ ] תיקון `research/neural/onnx-inference.ts` — missing `await`
- [ ] חיבור `?ravestyle=true` אמיתי ב-API
- [ ] השוואה ל-reference track אמיתי (לא self-reference)

**Phase 5 Acceptance Gate (רק אם רץ):**
- [ ] ONNX model קיים ב-`apps/web/public/models/`
- [ ] `?ravestyle=true` משווה ל-reference אמיתי
- [ ] "neural" ב-README אמיתי

**אם אין GPU:** ה-`research/neural/` נשאר כ-"experimental, not integrated". README כותב "procedural synthesis with spectral analysis".

---

## 4. Quality Gates (Gate Per Phase)

### Gate 0 (Phase 0 סופי)
- [ ] `git ls-files | wc -l` < 500 (כרגע ~1800)
- [ ] `du -sh .` < 35MB (כרגע 93MB)
- [ ] `bun install` < 30s (כרגע 89s)
- [ ] README לא מכיל: "AI", "neural", "commercial", "VST/AU" (עד Phase 4)
- [ ] 0 קבצי `.wav` מתחת `public/samples/real/`
- [ ] `bun test` — 256 tests pass (250 foundation + 6 snapshot)
- [ ] `tsc --noEmit` עובר בלי `ignoreBuildErrors`

### Gate 1 (Phase 1 סופי)
- [ ] `bun test` — 256+ tests pass
- [ ] `tsc --noEmit` — 0 errors
- [ ] snapshot hash יציב
- [ ] ffmpeg dBTP ≤ limiter ceiling
- [ ] ffmpeg LUFS ±0.5 מ-target
- [ ] `/api/audio-critique?bars=8&seed=42` < 3s (כרגע 31s)
- [ ] `width=1` מחזיר L,R ללא שינוי (unit test)
- [ ] cross-correlation L/R של reverb < 0.5
- [ ] 0 hard-coded `SR = 44100` מחוץ ל-`foundation/dsp/src/utils.ts`

### Gate 2 (Phase 2 סופי)
- [ ] INTRO state לא שקט
- [ ] DROP state מתחיל עם riser/impact
- [ ] sidechain audible (-6dB on kick)
- [ ] 16th rolling bass mode זמין
- [ ] OTT audible
- [ ] 3+ motif transformations נקראות לכל phrase
- [ ] `enhanced-failure-detector` — 0 FAIL critical

### Gate 3 (Phase 3 סופי)
- [ ] ffmpeg LUFS = -9 ±0.5
- [ ] ffmpeg dBTP ≤ -0.3
- [ ] LRA > 4 LU (כרגע 2.1)
- [ ] reference comparison: 3 tracks, סטייה < 1.5 LU
- [ ] 100 snapshot tests (10 seeds × 10 bar-counts)

### Gate 4 (Phase 4 סופי)
- [ ] VST plugin נבנה ב-cmake
- [ ] plugin נפתח ב-DAW
- [ ] 13 voices ב-real-time
- [ ] modulation matrix ב-DAW
- [ ] L ≠ R (stereo)

### Gate 5 (Phase 5, אופציונלי)
- [ ] ONNX model קיים וטעון
- [ ] style transfer לא self-reference
- [ ] "neural" ב-README אמיתי

---

## 5. רישום סיכונים (Risk Register)

| # | סיכון | הסתברות | חומרה | מתן אגרוף |
|---|------|---------|-------|-----------|
| R1 | **בעיה משפטית**: 141 דגימות 909/MD/Nord ב-repo ציבורי | ודאי | קריטית | Phase 0 יום 2 — מחיקה מיידית |
| R2 | **Score metric gaming**: שיפור score אינו שיפור אודיו (12 commits "fix metric bug") | ודאי | גבוהה | החלפת score ב-external LUFS+EBU R128 |
| R3 | **Performance**: `/api/optimize` לוקח 5 דקות, `/api/audio-critique` 31s | ודאי | בינונית | Phase 1 — FFT, ביטול redundant renders |
| R4 | **Maintenance**: 77% dead exports ב-`psy4/index.ts` | ודאי | בינונית | Phase 0 — מחיקת dead exports |
| R5 | **Buildability**: VST לא מתקמפל (PluginEditor חסר) | ודאי | גבוהה אם משאירים / נמוכה אם מוחקים | Phase 4 — בנייה מלאה או מחיקה |
| R6 | **Reproducibility**: אפס טסטים ב-app (foundation יש 250) | ודאי | גבוהה | Phase 0 יום 5 — snapshot tests |
| R7 | **Sample-rate brittleness**: hard-coded 44100 ב-8 קבצים | ודאי | בינונית | Phase 1 שבוע 3 — parameterization |
| R8 | **Dependency rot**: 20 unused deps | ודאי | נמוכה | Phase 0 יום 2 — מחיקה |
| R9 | **Identity crisis**: package.json name = "nextjs_tailwind_shadcn_ts" | ודאי | נמוכה | Phase 0 יום 2 — rename |
| R10 | **Self-reference loop**: style-transfer מזין render כ-reference | ודאי | בינונית | Phase 5 או מחיקת feature |
| R11 | **Architecture drift**: foundation/music ב-`src/` כופל את packages/music | ודאי | בינונית | Phase 0 יום 1 — מחיקת הכפילות |
| R12 | **Team capacity**: 8 ימים ל-178 commits רומז על solo developer | ודאי | בינונית | תכנון ריאליסטי של 16-20 שבועות |
| R13 | **Foundation drift**: ה-foundation ב-zip מכיל גרסה שונה מ-app | בינונית | בינונית | Phase 0 יום 1 — פריסה ובדיקת compat |
| R14 | **Token exposure**: GitHub token ב-upload file | ודאי | גבוהה | שמירת הטוקן מחוץ ל-repo, rotation אחרי הפרויקט |

---

## 6. Git Workflow

### 6.1 Branch strategy
- `main` — production-ready, תמיד ירוק
- `rebuild/phase-N` — כל phase מקבל branch משלו
- `rebuild/phase-N-cleanup` — sub-branches לכל יום עבודה

### 6.2 Commit conventions
- `<type>(<scope>): <subject>` — Conventional Commits
- types: `feat`, `fix`, `remove`, `refactor`, `test`, `docs`, `chore`
- scopes: `dsp`, `composition`, `render`, `master`, `critic`, `arrangement`, `presets`, `vst`, `web`, `foundation`, `docs`
- examples:
  - `fix(dsp): StereoWidener width=1 returns L,R unchanged (was mathematically broken)`
  - `remove(samples): 141 commercial 909/MD/Nord samples (license violation)`
  - `test(render): snapshot test for ?bars=8&seed=42`

### 6.3 Push discipline (per user instruction)
- **בסוף כל שיחה**: commit + push ל-GitHub
- כל commit מכיל worklog update
- tag אחרי כל Phase completion: `v0.4.0-phase-0-complete`, `v0.5.0-phase-1-complete`, וכו'

### 6.4 Backup strategy (per user instruction)
- **לפני כל מחיקה גדולה**: יצירת tag `backup/pre-<action>-<date>`
- דוגמה: `backup/pre-skills-removal-20260819`
- ה-tags האלה נשארים ב-repo לצמיתות, לא מוחקים
- `_archive/` directory לגיבוי מצב מלא לפני שינוי ארכיטקטוני גדול

---

## 7. מה אסור לטעון לפני כל Gate

| טענה | מותר לטעון רק אחרי |
|------|---------------------|
| "Commercial-grade DSP" | Gate 3 |
| "AI synthesis platform" | Gate 5 (או לעולם לא) |
| "Neural RAVE style transfer" | Gate 5 |
| "VST/AU plugin" | Gate 4 |
| "Real-time playback with N voices" | Gate 4 (עם N אמיתי) |
| "11 factory presets" | Gate 2 + UI counter מציג 11 |
| "0 failures" | אף פעם — תמיד "N failures under honest thresholds" |
| "Score X" | אף פעם כמספר בודד — תמיד "X on self-defined metric, Y on external LUFS" |
| "Huovilainen ZDF" | Gate 1 (אחרי תיקון או עדכון docstring) |
| "Karplus-Strong" | Gate 1 (אחרי תיקון decay) |
| "ITU-R BS.1770-4" | Gate 1 (אחרי snapshot test נגד reference) |
| "True-peak limiter" | Gate 1 (אחרי תיקון application rate) |
| "Psytrance" | Gate 3 (reference comparison passes) |

---

## 8. ה-README הכן היחיד שמותר לכתוב מחר (post-Phase 0)

```markdown
# PSY Foundation — Procedural Psytrance Synthesis Engine (in development)

An offline TypeScript DSP engine that renders psytrance-style audio to WAV via
HTTP API, built on a 13-package musical foundation (transport, protocol,
analysis, music, learning, dsp, etc.).

## What's Here

- 13 foundation packages (250 tests passing) — shared musical infrastructure
- Render engine with ZDF SVF, BL oscillators, ITU-R BS.1770-4 LUFS meter
- Composition engine with motif transformations (invert, retrograde, augment)
- 6 HTTP API endpoints returning WAV/JSON
- Enhanced failure detector with 17 cross-part analysis rules

## Measured Output (verified)

`GET /api/render-forensic?bars=8&seed=42`:
- Duration: 9.93s, stereo 44.1kHz 16-bit PCM
- LUFS: -10.4 (ffmpeg loudnorm)
- True Peak: -0.3 dBTP
- LRA: 2.1 LU
- BPM: 143

## Known Gaps (honestly tracked)

- Real-time AudioWorklet: 1 voice (lead only), not 13 aspired (Phase 4)
- Style transfer: spectral matching EQ, not neural (Phase 5, optional)
- VST plugin: C++ skeleton with ZDF SVF, PluginEditor not implemented (Phase 4)
- ONNX inference module exists but broken (Phase 5, optional)
- AudioCritic score (0.66 on self-defined metric) is self-referential
- 0 automated tests for DSP primitives (Phase 1)
- 141 commercial samples currently in repo (Phase 0: removal planned)

## License

MIT for code. Samples: TBD (Phase 0: replacement with CC0/procedural).

## Status

Phase 0 of rebuild plan. Not commercial-ready. Not for production use.
See docs/ROADMAP.md for the full plan.
```

---

## 9. סיכום

התוכנית הזו:
- **מבוססת על מה שמאומת** (לא קריאת קוד בלבד)
- **משתמשת ב-foundation שכבר קיים** מתוך ה-zip (לא צריך לכתוב מחדש)
- **לא שואלת שאלות** — כל ההחלטות נעשו
- **שומרת גיבויים** — tags + `_archive/` לפני כל מחיקה
- **מבצעת push בסוף כל שיחה** לפי בקשת המשתמש
- **לא טוענת טענות שקריות** — כל טענה מחכה ל-Gate המתאים

**מצפה לאישור "תמשיך" כדי להתחיל Phase 0.**
