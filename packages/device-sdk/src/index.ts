export type { PsyDevice } from './device.ts'
export { DeviceHost } from './host.ts'
export type { DeviceErrorPhase, DeviceErrorEvent, DeviceErrorHandler } from './host.ts'
export type { DeviceHostOptions } from './host.ts'
export { ReferenceDevice } from './reference.ts'
export type { ReferenceDeviceOptions } from './reference.ts'

/** Device conformance suite (phase 3.4) — part of the package's public API. */
export {
  runDeviceConformance,
  CONFORMANCE_CHECKS,
  wellFormedBeatEvent,
  wellFormedNoteEvent,
} from './conformance/index.ts'
export type { ConformanceOptions, ConformanceReport } from './conformance/index.ts'
