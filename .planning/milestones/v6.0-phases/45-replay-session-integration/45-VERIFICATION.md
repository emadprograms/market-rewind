# Phase 45 Verification — Replay & Session Integration

**Status:** passed
**Verified:** 2026-10-12

## Requirement evidence

| Requirement | Evidence |
|---|---|
| SIM-REPLAY-01 | `tests/unit/orderSimulator/replay.test.ts` — typed reasons for all five movement kinds; 61 crossed ticks fed by one jump |
| SIM-REPLAY-02 | chronological merge tests: a deadline is evaluated against the quote at that instant, never the frame's final quote; one trigger per order version |
| SIM-REPLAY-03 | coarse 60 s jump === 60 one-second frames === 10 s frames; identical digests; same fill millisecond |
| SIM-REPLAY-04 | seek tests: forward evaluates the skipped path, backward truncates future instructions with exactly one notice, abandoned submissions never replay |
| SIM-REPLAY-05 | reset tests: new session id, no fabricated closing fill, no realised PnL, no leaked instructions; view changes leave exposure alone |
| SIM-REPLAY-06 | exposure tests: hidden symbols consumed, freeze on missing tape and on tape exhaustion |
| SIM-REPLAY-07 | identity tests: dedup by seq, prepend-safe, source order for equal-time quotes, index-independent |

## Commands run

```
npx tsc --noEmit                                     # clean
npx vitest run tests/unit/orderSimulator/            # 6 files, all pass
npx vitest run tests/integration/orderSimulatorPlayback.test.ts   # 13 tests driving the real store
npx vitest run                                       # 110 files, 756 passed, 2 skipped, no regressions
npx vite build                                       # succeeds
```

## Notes

- The integration suite drives the real `usePlaybackStore` (including its dense-replay paths) and
  asserts every tick still arrives; the store itself was not modified.
- The pre-existing replay/seek performance suites remain green, so criterion 4 holds.

## Defects found and fixed during this phase

1. **The opening quote at t=0 was never delivered** — the delivery cursor was inferred from the
   playhead, which starts at the session start.
2. **A late tape page rewound the engine's clock** and threw "quote is before engine time". Now
   filtered per quote and announced once.
3. **`quotesFed` counted attempts, not deliveries**, so a report could claim quotes it had skipped.
   It now reports deliveries and a separate `quotesSkipped`.
4. **The pause guard keyed off a flag rather than movement**, so a caller driving the playhead while
   the store's default `isPaused: true` was in force was silently ignored.
