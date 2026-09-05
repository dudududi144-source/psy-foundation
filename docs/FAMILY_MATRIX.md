# FAMILY MATRIX — roles, wire, and the collaboration audit (2026-09-05, Tasks 20–22)

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

1. ~~**CI on the family wire.**~~ **DONE (Task 21).** Foundation runs the
   full gate ladder on every push/PR (`.github/workflows/ci.yml`: frozen
   install → biome → tsc → 964 tests → family-sync-check with sibling
   repos → verify 34/34); first live run taught the ffmpeg lesson (runners
   ship no ffprobe) and now enforces `FAMILY IN SYNC` on GitHub itself.
   psysampler's CI, red-on-main for its entire recent history, was
   root-caused (a never-met per-file coverage threshold) and is green
   again (`1a9c351`).
2. ~~**Foundation render-notes density guidance.**~~ **DONE (Task 21).**
   `docs/CONSUMER_SUPPORT.md` §5b: the measured economics table
   (hats +0.5 LU/+15.5 KB; lead +1.8 LU/−7 KB; form −0.30 LU/+31.8 KB;
   gain-escalation pumps then loses) + five practical rules.
3. ~~**Draft-path stereo WARN.**~~ **DONE (Task 23, anthem `7795ce1`).**
   Gating the draft path for the first time (`scripts/draft-render-check.ts`)
   root-caused TWO defects, not one: the `draftify()` spread clamp ≤ 0.5
   that collapsed L/R statistics (the WARN), AND true-peak clipping from
   full-band noise bursts (draft+drums TP +2.6 dBTP — every burst now
   band-limited at the source, 2-pole 11 kHz, local per-burst state).
   Measured after: draft+drums 10/10 gates (I=−9.0, TP=−0.4, LRA 4.8);
   draft 0 FAIL 0 WARN; determinism byte-identical. v13.9.3.
4. **psyreason** (pushed after this session started): next candidate for
   the same READ→…→TAG adoption, pending owner authorization.
5. ~~**Coverage floors for consumer repos.**~~ **DONE (Tasks 22→24).**
   Bun's `coverageThreshold` is PER-FILE (proven 2026-09-05: psysampler
   overall 79.4% funcs / 81.6% lines still exits 1 at 0.75 because ui.js
   sits at 25%) — an overall floor needs a measuring script. Both consumer
   repos now have one AND enforce it in CI: psysampler (floor 75%,
   measured 79.41/81.63; CI coverage job fails below it, `4a065bd`) and
   anthem (floor 85%, measured 89.14/90.67; CI step after the tests,
   `a7aa120` — the bun 1.1.44 pin emits an identical All-files row, the
   suspected format drift was disproven by measurement). psy5 can copy
   the pattern when the owner authorizes writing there.

## 6. Post-Task-20 updates (the living log of this document)

- **Task 21 — honest gates.** psysampler's CI was red on main for its
  entire recent history while local runs printed green: bun printed
  392 pass / 0 fail and STILL exited 1 (per-file coverage threshold,
  never met). The lesson is codified: gate reads must include the
  PROCESS EXIT CODE, not just the assertion line. Threshold removed,
  honest overall floor added, `bun.lock` gitignored.
- **Task 21 — foundation CI.** See §5 item 1. Badge added to README.
- **Task 22 — third environment wipe recovery + re-proof.** The sandbox
  wiped `/home/z/psy-work` a third time; workspace rebuilt from GitHub
  (remote SHAs matched the expected state exactly: 947700e / f2d71f0 /
  1a9c351 / bbe81c2). Fresh-clone gates re-run: foundation 964/0,
  anthem 362/0, psysampler 392/0. Both adoption pipelines re-proven
  END-TO-END over live HTTP against foundation HEAD: psysampler 23/23
  claims, anthem 53/53 claims (incl. HTTP determinism, the 2000-note
  cap honest 400, and the halves workaround). The family wire survives
  environment loss because GitHub is the source of truth, and the e2e
  suites are the proof instrument.
- **Task 23 — draft quality joins the family gate (anthem `7795ce1`).**
  First gating of the draft path found two defects: the stereo WARN's
  root cause (`draftify()` spread clamp) and, hiding behind it, true-peak
  clipping from full-band noise bursts (+2.6 dBTP). Both fixed at the
  source; draft+drums now 10/10 gates. See §5 item 3. psysampler's
  counterpart commit (`8dd539f`) only corrected doc counts — no code.
- **Task 24 — gates become unavoidable (anthem `a7aa120`, psysampler
  `4a065bd`).** The coverage floors existed but nothing in CI called
  them: anthem's script header even deferred wiring over a suspected
  bun-1.1.44 table-format drift. Concern disproven by measurement (real
  1.1.44 binary, identical All-files row), and the floors are now CI
  steps — anthem after the test step, psysampler in the coverage job.
  Lesson refined: a gate that CI does not run is documentation, not a
  gate.
- **Task 25 — the one-codec law closes from the consumer side
  (foundation `c5235e8`, anthem `8556e40`, psysampler `8c9538d`).**
  family-sync-check gained `--only <repo>` (default unchanged: the full
  7-file matrix in foundation CI), and BOTH consumer repos now check out
  foundation and verify their own vendored codec against foundation HEAD
  on every push — until now a vendored-file edit in a consumer stayed
  green there until the NEXT foundation push. Proven before push: clean
  sims exit 0 (FAMILY IN SYNC), injected one-line drift fails both with
  DRIFT + md5 (exit 1), bogus flag exits 2; the sim also caught a real
  TDZ bug pre-push. Step-level CI verification: "Family sync check"
  success in anthem and psysampler runs. Fourth workspace wipe in this
  round too — recovery from GitHub again matched every expected SHA
  (05d0af8 / a7aa120 / 4a065bd / bbe81c2), zero loss.
