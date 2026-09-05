# FAMILY MATRIX — roles, wire, and the collaboration audit (2026-09-05, Task 20)

> **Mandate.** "בחן את השיתוף… איך אנחנו עובדים, מה אפשר לייעל… לשפר את
> היכולות ואיכות המשפחה" — examine how the family collaborates, find what
> can be optimized, improve capabilities and quality. This document is the
> standing answer: who does what, what connects them, what is measured, and
> what is next. Every claim carries a number or a command.

## 0. The one-paragraph verdict

The family works because it has exactly one sound standard (psy-foundation's
DSP + PSYBUS v2 codec) and every member now reaches it through the same
three artifacts: verbatim vendored codec bytes, a thin WHAT→HOW wire, and
the same acceptance gate. As of Task 20 that is no longer a claim but a
measurement: `scripts/family-sync-check.mjs` proves 7/7 vendored files are
byte-faithful (the only delta in the whole family is anthem's documented
import-path renaming), and all four active repos pass their suites from a
fresh clone — foundation 964/0, anthem 362/0, psysampler 392/0, psy5 629/0
(2,347 tests). The biggest quality debt found this round — anthem's public
preview renderer failing the family sound contract on every version ever
measured (DC −0.27 FS, LUFS −15.5) — was root-caused and fixed: all 10
acceptance gates now pass.

## 1. Role matrix (each member plays a serious role)

| Repo | Role (WHAT it owns) | Personal capability | Feeds back into foundation | Wire status (Task 20) |
|---|---|---|---|---|
| **psy-foundation** | The sound standard: voices, FX, master chain, protocol, render endpoints | Deterministic mastered renders (LUFS/TP/LRA gated, md5-pinned), forensic route, streaming WAV, acceptance gate | IS the standard; consumes family notes and renders them faithfully | canonical codec, `/api/render-notes`, `/api/render-forensic` |
| **psy-anthem** | Composition engine: 11-intent CSP composition, voice-leading, motif engine | Composes deterministic multi-voice arrangements (0.1–0.8 ms/bar); composition-as-a-service over the wire | Proved the Tier-2 pattern (17-b): 53-claim e2e, render-notes endpoint design, FIR TP honesty for consumer renders | v2 codec vendored (7/7 sync), `anthemToWire` + 10 conformance tests; v0.3.1 |
| **psysampler** | The looper: sample playback/looping instrument | Loops + slices the family sound into performance material | Second adoption proof (18/19): shim refresh, biome-clean vendoring, 392 tests | v2 shim byte-exact (2/2), wire.js + e2e-pipeline; 392/0 |
| **psy5 (PSY6)** | The groovebox: pattern/arranger performance instrument | Live groove performance; stepEvents → wire mapping with kit probing | Third adoption proof (19): 8/8 live-HTTP e2e claims, groove-survival µs evidence | v2 vendored byte-exact (3/3 incl. deprecations), `js/family-wire.js`; 629/0 |

Non-active family repos (psy, psy3-clean, psy4/psy4new, psy-sampler,
PSY6-ULTIMATE, psystar, psysynth, PsySynthPro, psyboss, psydrum, psyreason,
DMT) are catalogued in the repo worklog and docs/CONSUMER_SUPPORT.md; they
get the same ladder the moment the owner activates them.

## 2. The three family artifacts (how members connect)

1. **Codec, verbatim.** `packages/protocol/src/v2/{types,envelope,deprecations}.ts`
   are vendored byte-exact into consumers. Measured by:
   ```bash
   node scripts/family-sync-check.mjs              # default: ../family/
   node scripts/family-sync-check.mjs --json out.json
   ```
   Current result: **7/7 in sync** (anthem's envelope differs by import-path
   renaming only — a documented, tool-normalized adaptation).
2. **Wire, thin.** Each member maps its internal notes to PSYBUS v2 in ONE
   tested place (`anthemToWire`, psysampler `wire.js`, psy5 `family-wire.js`)
   and posts to the same endpoint. The endpoint validates with the SAME
   codec — conformance enforced on both ends by one set of rules.
3. **Gate, one.** `scripts/acceptance-check.mjs` (this repo, vendored
   verbatim by consumers) is the family sound contract: LUFS [−11,−7],
   TP ≤ 0 dBTP, LRA > 0.5, DC ≤ 0.001, format/alive/stereo. Exit 0/1/2.

## 3. What Task 20 optimized (the measured improvements)

| # | Finding from the collaboration audit | Action | Evidence |
|---|---|---|---|
| 1 | Anthem's PUBLIC preview renderer (GitHub Pages) failed the family sound contract on every version ever measured: DC −0.255/−0.268, LUFS −15.5 | Root-caused by bisection (voices generate DC via SVF drift; wet loops amplify ×4; master wasted 2.4 dB headroom) → 2-pole 10 Hz DC blockers on every voice bus + master, saturate-then-normalize master (drive 1.5), TP-normalize −0.7 dBFS | anthem v13.9.2: melody 10/10 gates (−10.4 LUFS, LRA 4.8), groove 10/10 (−10.7), draft 9+1 WARN; DC ≤ 0.0007; byte-identical double render; suite 362/0 — `docs/SERVING_AUDIT_2026-09-05.md §6` |
| 2 | Vendored codec drift was the #1 systemic risk of the verbatim strategy — and nobody measured it | `scripts/family-sync-check.mjs` — permanent drift detector with documented normalization rules, JSON output for CI | 7/7 PASS this run; command in §2 |
| 3 | "Everything still works" was assumed after the environment wipe, not measured | Full fresh-clone verification of all four repos | foundation 964/0 · anthem 362/0 · psysampler 392/0 · psy5 629/0; family-sync 7/7; remote SHAs pinned in worklog Task 20 |

## 4. How we work (the standing protocol)

- **Adoption ladder for a family repo:** Tier 0 HTTP endpoint → Tier 1
  single-file bundle → Tier 2 conformance + PSYBUS v2 wire → Tier 3 git pin.
  Consumers climb only as far as they need (`docs/CONSUMER_SUPPORT.md`).
- **Per-repo change protocol:** READ → CLAIM → BASE (measure before touching)
  → DO → GATE (suite + typecheck + lint + verify/acceptance) → PROVE
  (e2e over the real boundary) → LOG (repo worklog + this matrix when roles
  change) → TAG/push. Owner authorization per repo governs writes.
- **Honesty rules:** numbers or it didn't happen; gates adjust consciously,
  never post-hoc; limits documented next to the claims they bound.

## 5. Next candidates (owner-gated, in priority order)

1. **CI on the family wire.** A GitHub Actions workflow running
   `family-sync-check.mjs` + each suite on push would turn every drift/suite
   regression into a red X within minutes. Needs owner approval to add
   workflows to consumer repos.
2. **Foundation render-notes density guidance.** Anthem e2e measured
   density-bound loudness (sparse −12.4 vs dense −10.7): publish a
   worked example in the render-notes docs so future consumers arrange
   dense enough to pass gates on the first try.
3. **Draft-path stereo WARN.** Anthem draft spreads are clamped ≤ 0.5 →
   stereo-stats WARN. Optional small fix inside anthem (raise draft spread
   floor); cosmetic, preview-only.
4. **psyreason** (pushed after this session started): next candidate for
   the same READ→…→TAG adoption, pending owner authorization.
