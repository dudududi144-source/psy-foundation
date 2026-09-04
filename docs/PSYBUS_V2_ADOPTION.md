# PSYBUS v2 Adoption — the canonical protocol envelope (task 3.6)

> **Status:** delivered on branch `zai/6d-psybus-v2` (base: main @ 63ea4d9).
> **Spec source of truth:** `/home/z/psy-work/family/psyboss/docs/PSYBUS.md` (the psyboss
> family repo's proven PSYBUS spec), cross-checked against `ARCHITECTURE.md`. The family repo
> is **read-only** for foundation engineers; nothing under `/family/**` was modified.
> **Scope:** new module `packages/protocol/src/v2.ts` (+ `src/v2/**`). Zero edits to existing
> files; legacy code keeps working untouched.

---

## 1. What was adopted (spec section → code map)

| PSYBUS.md section | v2 export(s) |
|---|---|
| §"Design principles" (#3 typed end-to-end, #4 determinism, #6 provenance or nothing) | validation strictness (`unknown-payload-kind`), `rev`/`seed` on every frame, required `sampleRef.provenance` |
| §"The message envelope" | `BusEnvelope<T>` — fields `rev`, `seed`, `src`, `dst`, `ts`, `payload` in spec order |
| §"The payload discriminated union" | `BusPayload` = 15 kinds: `transport`, `transport.seek`, `transport.start`, `transport.stop`, `context`, `note`, `note.off`, `trig`, `sidechain.duck`, `choke`, `param.lock`, `param.set`, `latency`, `voice.count`, `error` — each as `<Kind>Payload` with **verbatim spec field names** (`vel`, `durBeats`, `reportLatencyMs`, …) |
| §"The branded types" | `DeviceId`, `TrackId`, `SceneId`, `ParamId`, `ChokeGroupId`, `SampleRef`, `Provenance` (license enum kept letter-exact, **including the spec's `'psboss-dsp'` spelling**) |
| §"The host interface" | `Unsubscribe` (type only); addressing helpers `isBroadcast` / `addressedTo` implement the "route by dst (unicast) or broadcast" rule (ARCHITECTURE.md §L2) |
| §"Transport tiers (same types, different wire)" | the reason the envelope has no transport-specific fields and the codec is JSON-canonical (see §2) |
| ARCHITECTURE.md §L2 (trig path, host stamps `rev`/`seed`), §L3 (`dsp:<id>:<seed>` fingerprints) | `buildEnvelope` (no auto-`rev` — the host stamps it), provenance validation |

Every field in `src/v2/types.ts` carries a `@provenance` TSDoc tag pointing at its spec
section. **Nothing was invented**: if a field/type is not in the spec, it is not in the code.

### Honestly absent from the spec (and therefore from v2)

- **No heartbeat, no ack, no nack.** The spec's telemetry group is exactly `latency`,
  `voice.count`, `error`. Tests assert that `heartbeat`/`ack`/`nack` frames are *rejected* —
  do not expect them on the wire.
- **No version field inside the envelope.** Versioning is codec-level:
  `PSYBUS_PROTOCOL_VERSION = 2`; `decodeEnvelope(json, { protocolVersion })` rejects any other
  version (`unsupported-version`).
- **Referenced-but-undefined spec types** (`MusicalKey`, `Scale`, `Section`, `Unsubscribe`,
  `DeviceCapabilities`): the first four are declared with honesty notes (plain, validated
  strings / `() => void`). `DeviceCapabilities` is **not** invented — it stays deferred with
  the `PsyBus` host runtime (see §6).

## 2. Wire format decision: canonical JSON

PSYBUS.md defines the JSON/TS **shape** but no binary wire format; §"Transport tiers" keeps
types identical across in-process / postMessage / BroadcastChannel / WebRTC. Foundation
therefore ships a **canonical JSON** codec (`encodeEnvelope` / `decodeEnvelope`):

- Key order is fixed: envelope fields and per-kind payload fields follow the **spec declaration
  order**; unknown (forward-compat) payload fields are appended in **code-unit-sorted** order.
- `-0` normalizes to `0`; numbers use the ECMAScript-specified shortest-round-trip form;
  strings use the fully-specified `JSON.stringify` escaping.
- Same envelope ⇒ **byte-identical** output, always (`encode∘decode∘encode === encode`,
  property-tested over 500 seeded random envelopes + golden-string test).

### Bounds the spec leaves open (foundation-side, documented — charter law: no unbounded inputs)

| Bound | Value | Rationale |
|---|---|---|
| `MAX_ENVELOPE_JSON_BYTES` | 64 KiB (UTF-8) | sample bytes are never inlined (`SampleRef` by design), so this is generous for control traffic and closes the DoS surface |
| `MAX_ID_LENGTH` | 128 chars | device/track/scene/param/choke-group/code identifiers |
| string fields | `source` ≤ 512, `fingerprint` ≤ 256, `message` ≤ 2048, `key`/`scale`/`section` ≤ 128 | sanity caps, below the envelope bound |
| `seed` | any safe integer | psyboss default `0x9e3779b9` = 2654435769 > 2³¹−1, so uint31 would wrongly reject it |
| `rev`, `beat`, `bar`, `step`, `channel`, `active`, `stolen` | safe integers ≥ 0 | monotonic/index semantics |
| `ts`, `phase`, `durBeats`, `releaseMs`, `reportLatencyMs` | finite ≥ 0 | audio-context seconds / non-negative quantities |
| `bpm` | 1…1000 | sanity; spec UI range is 120–160 (PSYBOSS) |
| `note` | 0…127 | MIDI range |
| `vel`, `energy`, `depth` | 0…1 | family convention |
| `license` | exact spec enum | `CC0`, `CC-BY`, `CC-BY-SA`, `CC-BY-NC`, `commercial-licensed`, `psboss-dsp` |

**Strictness stance:** the envelope *frame* is exactly the 6 spec fields (unknown frame fields
rejected). Payload objects with a known `kind` tolerate unknown extra fields (forward compat)
and the canonical writer preserves them in sorted order. Unknown `kind`s are always rejected.

**Error style:** every public function returns `Result<T, PsybusError>` (`{ ok, error }` with
`code`/`message`/dot-`path`). No v2 function throws on bad input.

## 3. Deprecation / migration table

Machine-readable source: `packages/protocol/src/v2/deprecations.ts` (`DEPRECATIONS`,
`LegacyTypeWitness`, `LEGACY_TYPE_BINDINGS`). The map is **behavior-locked**: every legacy
name is bound via a type-only import, so renaming a legacy type breaks `tsc`; every entry is
runtime-checked against the bindings, so a careless map edit breaks `bun test`. Every binding
is referenced by ≥ 1 entry (no dead witnesses).

| Legacy (packages/protocol) | Superseded by (v2) | Migration |
|---|---|---|
| `channel.Channel` | `BusEnvelope`, `BusPayload`, `buildEnvelope` | bare-event fan-out → envelope with `dst:'broadcast'`; host stamps `rev`/`seed`/`ts` |
| `channel.ChannelListener` | `BusEnvelope`, `payloadOf` | receive envelopes, unwrap, switch on `payload.kind` |
| `channel.InMemoryChannel` | `BusEnvelope`, `isBroadcast`, `addressedTo` | Tier-0 transport stays valid (spec §"Transport tiers") but carries envelopes through the v2 codec |
| `events.MusicalEvent` | `BusPayload` | `type` → `kind`; per-kind mapping below |
| `events.BeatEvent` | `TransportPayload` | `{beat,bar,transport,at}` → `transport` payload + envelope `ts:at`; rich `MusicalTransport` has no spec fields (see `state.TransportState`) |
| `events.SectionEvent` | `ContextPayload` | `section` → context; **honest gap:** spec context has no `bar` — correlate via envelope `rev`/`ts` |
| `events.EnergyEvent` | `ContextPayload` | `energy` (0..1) → context energy |
| `events.DropEvent` | `ContextPayload`, `ParamSetPayload` | **no 1:1 spec kind** — emit context-energy transition or a per-track `param.set`; do not invent a `drop` kind |
| `events.NoteEvent` | `NotePayload`, `NoteOffPayload`, `TrackId` | `velocity`→`vel`; `duration` (seconds) → `durBeats` (beats — unit change); `channel: string` → `track: TrackId` + numeric `channel`; note-off is now explicit |
| `events.PatternEvent` | `TrigPayload`, `SampleRef` | `patternId`→`scene`; provenance REQUIRED if a sample is referenced |
| `events.EventTime` | `BusEnvelope` | bare `at` number → `ts` with spec semantics (audio-context seconds) |
| `state.TransportState` | `TransportPayload`, `BusEnvelope` | `revision` → envelope `rev`; `locked`/`confidence` have no spec fields — out-of-band or dropped |
| `state.MusicalContext` | `ContextPayload` | `rootPc` folds into `key`; `style`/`beatsPerBar` have no spec fields — host config |
| `state.DeviceState` | `LatencyPayload`, `VoiceCountPayload`, `ErrorPayload` | polling snapshot → device→host telemetry events; presence derived by the host |
| `state.SessionState` | `LatencyPayload`, `VoiceCountPayload` | snapshot → telemetry + host `register`/`unregister` (§"The host interface") |

**Intentionally NOT deprecated** (scope honesty, `NOT_DEPRECATED_NOTE`):
`channel.Unsubscribe` (identical to v2), `state.DeviceCapabilities` (spec references it but
never defines it — deferred with the `PsyBus` runtime), `state.Material` / `MaterialType` /
`MusicalAction` / `MusicalOutcome` / `Experience` (learning-domain records, not envelope
styles).

## 4. Package wiring (APPLIED by the integrator)

Both wiring steps are now applied:

```jsonc
// packages/protocol/package.json → "exports"
"exports": { ".": "./src/index.ts", "./v2": "./src/v2.ts" }
```

```ts
// packages/protocol/src/index.ts (appended) — root entry namespace
export * as v2 from './v2.ts'
```

So consumers can `import { v2 } from '@psy-foundation/protocol'` or
`import { buildEnvelope } from '@psy-foundation/protocol/v2'`.
The v2 module is self-contained (no other file edits were needed).

## 5. Verification (measured)

- `bun test packages/protocol` — **54 pass, 0 fail** (7 legacy untouched + 47 new v2:
  20 round-trip/coverage, 13 rejection, 6 canonical-stability, 2 seeded property (500
  envelopes), 6 deprecation-map honesty).
- Round-trip matrix covers **all 15 spec payload kinds** across host→device, device→device,
  device→host, plus broadcast.
- Canonical JSON: golden byte-exact string test + key-shuffle + provenance-shuffle +
  `encode∘decode∘encode` identity + `-0` normalization + extras sorted.
- Property: 500 seeded (mulberry32, seed `0x9e3779b9`) random envelopes round-trip deep-equal
  and byte-identical; generator reproducibility asserted (zero `Math.random` — charter law 4).
- Repo gates at commit time: `bun run typecheck` 0 errors (17 workspaces), `bun run lint`
  0 errors, full `bun test` 0 failures (see worklog for the measured session numbers).

## 6. Adoption path for family repos (3.7 — out of scope here)

Family repos (psy-sampler, psysynth, psydrum, psyboss itself) adopt protocol/v2 **per repo,
with that repo owner's explicit approval** (charter: family repos are read-only for the
foundation engineer). The intended path once approved:

1. `bun add @psy-foundation/protocol` (or pin the single-file ESM bundle from plan item 3.2).
2. Replace envelope construction with `buildEnvelope` + `payloadOf`; keep the psyboss field
   names — they are already 1:1, no translation layer needed.
3. Route via `addressedTo`/`isBroadcast`; negotiate with `PSYBUS_PROTOCOL_VERSION` /
   `decodeEnvelope(…, { protocolVersion })`.
4. Migrate legacy event types per the §3 table; retire the three divergent envelope styles.

**Deferred from the spec (not silently dropped):** the `PsyBus` host *runtime*
(`subscribe`/`publish`/`register`/`unregister`/`route`/`assertProvenance`) and a
spec-defined `DeviceCapabilities` — the spec references them without defining the latter, and
a runtime bus is integrator/plan scope beyond 3.6's envelope deliverable.
