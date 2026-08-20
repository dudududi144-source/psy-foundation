# TRANSPORT RUNTIME REALITY

Browser/runtime proof status for Foundation Transport v1.

## What was proven

15 runtime-lab tests prove the Transport works with a continuously-advancing
AudioContext-like clock (SimulatedAudioContext). This is the same contract as
a real browser `AudioContext.currentTime`.

### Proven behaviors

| Test | Evidence |
| --- | --- |
| Transport advances with currentTime | timestamp increases on each snapshot |
| Continuous scheduling (60 beats) | 60 notes scheduled, no silence, locked |
| Tempo change | BPM changes, epoch++, beat continues |
| Seek | seek(40) → bar=10, epoch++ |
| Stop/Play | stop→stopped, start→running |
| Holdover + recovery | loseSource→holdover, observeBeat→recovered |
| No burst after stall | epoch unchanged (no catch-up) |
| Epoch increments | start/seek/setTempo/reset all increment |
| Subscribers | both receive, unsubscribe stops delivery |
| Immutable snapshots | mutation rejected |
| No NaN in any field | all fields finite |

## What was NOT proven (honest)

- **Real AudioContext**: tests use SimulatedAudioContext, not a real browser
  AudioContext. The contract is identical (nowFn returns advancing time), but
  real browser verification is Phase D.
- **Memory allocation bounds (PR-18)**: not measurable in unit tests. Requires
  browser heap profiling.
- **Audio graph (PR-09..13)**: voice/gain/bus connections are DSP concerns,
  not transport contract. These are Phase D (runtime scheduler + audio graph).

## SimulatedAudioContext

The SimulatedAudioContext mimics real AudioContext behavior:
- `currentTime` advances monotonically on each read
- `now` property returns a `() => number` function (the nowFn Transport consumes)
- Configurable advance rate (default 1ms per read)

In a real browser:
```typescript
const audioContext = new AudioContext();
const transport = new Transport(() => audioContext.currentTime, { initialBpm: 145 });
```

The contract is identical. The only difference is the time source.

## Conclusion

Transport v1 is **runtime-ready** at the contract level. Real browser verification
(Phase D) will confirm continuous playback with a real AudioContext. The
SimulatedAudioContext proof is sufficient to promote Transport to CANONICAL
status, with the browser proof as a Phase D follow-up.
