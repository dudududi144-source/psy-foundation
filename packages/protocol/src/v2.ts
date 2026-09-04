/**
 * PSYBUS v2 — public entrypoint (task 3.6).
 *
 * Everything the canonical v2 envelope offers is reachable from this module:
 * - `./v2/types.ts`       — spec-transcribed envelope/payload/branded types (psyboss PSYBUS.md)
 * - `./v2/envelope.ts`    — build/validate/encode/decode + addressing helpers (canonical JSON)
 * - `./v2/deprecations.ts`— machine-readable deprecation map for the legacy envelope styles
 *
 * WIRING NOTE for the integrator (see docs/PSYBUS_V2_ADOPTION.md §"Package wiring"):
 * `packages/protocol/package.json` exports only `"."` today. To expose this module as
 * `@psy-foundation/protocol/v2`, add the one-line subpath export:
 *   "./v2": "./src/v2.ts"
 * This file intentionally stays self-contained so no existing file needs to change.
 */
export * from './v2/types.ts'
export * from './v2/envelope.ts'
export * from './v2/deprecations.ts'
