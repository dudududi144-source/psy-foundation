/** Device conformance suite (phase 3.4) — framework-agnostic entry point. */
export { runDeviceConformance } from './runner.ts'
export type { ConformanceOptions, ConformanceReport } from './runner.ts'
export {
  CONFORMANCE_CHECKS,
  checkCapabilities,
  checkDoubleStop,
  checkIdUniqueness,
  checkIdentity,
  checkLifecycle,
  checkMalformedEvent,
  checkPostStopEvent,
  checkWellFormedEvent,
  wellFormedBeatEvent,
  wellFormedNoteEvent,
} from './checks.ts'
export type { CheckContext, CheckFn, CheckSpec, ConformanceCheckResult } from './checks.ts'
