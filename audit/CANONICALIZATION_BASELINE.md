# CANONICALIZATION BASELINE

Baseline captured at the start of GATE B — Foundation Canonicalization.

## State

| Field | Value |
| --- | --- |
| HEAD | `063e553d147e16b97d23cb3d10a35a7124daaca2` |
| remote HEAD (origin/main) | `063e553d147e16b97d23cb3d10a35a7124daaca2` |
| Branch | `main` |
| Worktree | clean |
| Tests | 252 pass / 14 skip / 0 fail (266 total, 14 files) |
| Typecheck | clean (14 packages) |
| Lint | clean (115 files) |

## Gate A deliverables (already in repo)

- `FOUNDATION_FREEZE.md`
- `audit/FOUNDATION_RECONCILIATION.md` — 10-domain comparison
- `audit/CONTRACT_GAPS.md` — 17 critical + 7 low-risk gaps
- `audit/MIGRATION_PLAN.md` — 5 phases (A-E)
- `apps/consumer-contract/` — 14 skipped gap-tests + 2 passing
- `FOUNDATION_API.md` — versioned API reference
- `FOUNDATION_STATUS.md` — final report

## Gate B goal

Bring foundation **Transport** to capability parity with PSY4's proven
MusicalTransport, WITHOUT touching PSY4's runtime. The 10 critical transport
gaps (CONTRACT_GAPS.md GAP-T1..T10) must be closed:

1. epoch (increments on disruptions)
2. source ('internal'|'radio'|'external'|'manual')
3. holdover / loseSource()
4. AudioContext nowFn integration
5. predictBeats(horizonSec)
6. subscribe(listener)
7. seek(beatIndex)
8. setTempo(bpm, source) without phase reset
9. out-of-order observation rejection
10. stale event policy

## Rule 0 compliance

- PSY4 runtime will NOT be touched.
- No migration performed — only foundation-side implementation.
- Foundation tests must stay green throughout.
- New tests are additive (contract + adversarial + drift + regression).

## Stop condition

If baseline is green (it is), proceed. If at any point tests go red in a way
that isn't a documented gap-test, stop and fix before continuing.
