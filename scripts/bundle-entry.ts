import * as analysis from '../packages/analysis/src/index.ts'
import * as deviceSdk from '../packages/device-sdk/src/index.ts'
/**
 * Bundle entry for the single-file ESM release artifact (PLAN_V3 3.2).
 *
 * Re-exports the public API of every workspace package as a namespace, so a
 * stranger repo can pin ONE file (release/psy-foundation.esm.js) and reach
 * the whole foundation without a package manager:
 *
 * ```js
 * import { dsp, transport, protocol } from './psy-foundation.esm.js'
 * ```
 *
 * NOTE: imports are RELATIVE on purpose. Bun.build's static resolver does not
 * apply workspace-package resolution to files outside a workspace member, so
 * package-specifier imports fail here even though `bun test` resolves them.
 * Relative paths also make the bundle independent of install state — a
 * release artifact should build from a clean checkout.
 *
 * Consumed ONLY by scripts/build-bundle.mjs — not part of any package's
 * runtime surface.
 */
import * as dsp from '../packages/dsp/src/index.ts'
import * as fixtures from '../packages/fixtures/src/index.ts'
import * as learning from '../packages/learning/src/index.ts'
import * as material from '../packages/material/src/index.ts'
import * as music from '../packages/music/src/index.ts'
import * as protocol from '../packages/protocol/src/index.ts'
import * as scheduler from '../packages/scheduler/src/index.ts'
import * as transport from '../packages/transport/src/index.ts'

export {
  dsp,
  music,
  transport,
  protocol,
  deviceSdk,
  analysis,
  learning,
  material,
  scheduler,
  fixtures,
}
