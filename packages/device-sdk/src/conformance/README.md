# Device Conformance Suite (phase 3.4)

`runDeviceConformance(makeDevice, opts?)` in `packages/device-sdk/src/conformance/` is the runnable replacement for the
old "shim-sync" test that skipped in CI: each PSY device repo runs the suite
**against itself**, in its own CI, and either passes or fails with named
checks. No test-framework imports — it returns a plain report object, so it
works under `bun:test`, vitest, jest, node:test, or a plain script.

## Running it — 5 lines

```ts
import { runDeviceConformance } from '@psy-foundation/device-sdk/conformance/index.ts'
import { MyDevice } from './my-device.ts'

const report = runDeviceConformance(() => new MyDevice())
console.table(report.checks) // { id, name, pass, detail } × 8
if (!report.pass) throw new Error('device is not conformance-clean')
```

Import notes:

- **From any repo that depends on the foundation**: the suite is part of the
  package's public API — `import { runDeviceConformance } from '@psy-foundation/device-sdk'`.
- **Inside the psy-foundation workspace**: import by relative path
  (`../src/conformance/index.ts` from a device-sdk test, or
  `../../device-sdk/src/conformance/index.ts` from a sibling package).
- **From an external device repo** (psy-sampler-style, dependency not yet
  published to npm): add the foundation workspace dependency, vendor the three
  files in `packages/device-sdk/src/conformance/` (`checks.ts`, `runner.ts`,
  `index.ts` — no runtime deps beyond the `PsyDevice`/protocol types you
  already mirror), or import from the release ESM bundle
  (`deviceSdk.runDeviceConformance`).

## Options

```ts
runDeviceConformance(makeDevice, {
  timeoutMs: 1000,        // wall-clock budget per C6 malformed-event probe
  statelessClones: false, // C8: accept identical ids from the factory
})
```

## The checks

Every check runs against a **fresh device instance** built by `makeDevice()`,
so no device can pass by carrying state between checks.

| id | probe | pass means |
|----|-------|------------|
| C1 | identity | `id` is a non-empty, non-blank string, identical across repeated reads |
| C2 | capabilities | `capabilities()` returns a valid `DeviceCapabilities` shape (`roles` a non-empty string array) and is side-effect free (two calls deep-equal) |
| C3 | lifecycle | one external `onStart` then one external `onStop`, in order, no throw. If both are unimplemented (optional per `PsyDevice`) the check passes with an explicit note — there is nothing to verify |
| C4 | well-formed event | a fresh device accepts a well-formed `NoteEvent` and a well-formed `BeatEvent` (built from `@psy-foundation/protocol` shapes) without throwing |
| C5 | post-dispatch safety | after `onStart`+`onStop`, further events do not throw (hosts may deliver late events) |
| C6 | malformed event | see precise semantics below |
| C7 | double stop | a second `onStop` does not throw |
| C8 | factory identity | two devices from the same factory have **different** `id`s — or, if the factory is documented as producing stateless clones, `statelessClones: true` accepts identical ids |

### C6 precise semantics

The probe sends two malformed events (an unknown `type`, and a well-typed
event carrying garbage values — `NaN` note/`at`, negative duration). For each:

- **pass `returned`** — the call completed within the wall-clock budget.
- **pass `threw`** — the call threw a real `Error` (controlled rejection).
- **fail `crash`** — the call threw a non-`Error` value (string/object/…).
  That is an uncontrolled crash, not honest failure.
- **fail `hang`** — the call blocked the thread longer than `timeoutMs`
  (default 1000ms).

Limitation stated honestly: JavaScript cannot preempt a synchronous call, so
a literal infinite loop can only be caught by a CI-level process timeout; the
wall-clock budget catches everything that eventually returns but blocks too
long. "Undefined return" (a silent swallow with no state change) is treated
as a controlled return — `onEvent` is typed `void`, so the SDK cannot observe
internal state; device repos wanting stricter policies can extend the suite
via the exported individual checks (`CONFORMANCE_CHECKS`, `checkXxx`).

## C8 semantics (chosen, documented)

Default: **unique ids**. `DeviceHost` registers by id and rejects duplicates,
so a factory that cannot produce two distinguishable instances cannot back a
real rack. The alternative reading — "stateless clones may share an id" — is
supported as an explicit, documented opt-in (`statelessClones: true`) because
the suite cannot verify statelessness of arbitrary devices from the outside;
passing the flag is a claim the device repo makes about its own factory.

## What pass/fail means

- `report.pass === true` — the device is conformance-clean on this machine,
  this run. It says nothing about audio quality, only about contract behavior.
- `report.pass === false` — at least one named check failed; the `detail`
  strings say exactly what was observed. Failures are data, not exceptions:
  the runner never throws, even against a device whose factory explodes.
- Wire it into CI as a hard gate (fail the job when `!report.pass`). A device
  repo that skips this suite is repeating the shim-sync mistake the audit
  flagged.
