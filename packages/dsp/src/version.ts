/**
 * Single source of truth for the psy-foundation RELEASE version (PLAN_V3 3.1).
 *
 * Contract:
 * - Root package.json "version" MUST equal this constant (behavior-locked by
 *   packages/dsp/tests/version-integrity.test.ts and by the
 *   'release-version-integrity' claim in scripts/verify.mjs).
 * - The generated worklet artifact carries the same string
 *   (`scripts/build-worklet.mjs` injects it; verify greps it back).
 * - The ESM release bundle (release/psy-foundation.esm.js) re-exports it so
 *   stranger repos can report which build they run.
 *
 * Versioning policy: foundation releases as ONE version (monorepo-wide),
 * tagged `foundation-v<major>.<minor>.<patch>`. See CHANGELOG.md.
 */
export const FOUNDATION_VERSION = '2.0.0'
