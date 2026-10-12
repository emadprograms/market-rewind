# Phase 44 Verification — Pure Order Engine

**Status:** passed
**Verified:** 2026-10-12

## Requirement evidence

| Requirement | Evidence |
|---|---|
| SIM-ENGINE-01..06 | `tests/unit/orderSimulator/engine.test.ts` — trigger matrix, latch, placement, tick and size validation |
| SIM-QUOTE-01..06 | engine tests: non-finite, crossed and out-of-order quotes refused; spread legs used correctly |
| SIM-LATENCY-01..05 | `tests/unit/orderSimulator/lifecycle.test.ts` — stage ordering at 0/100/100/150/150/250 ms and the visible notification delay |
| SIM-ACCOUNT-01..05 | lifecycle tests — positions, exits, closes, accounting identity |
| Determinism | `tests/unit/orderSimulator/determinism.test.ts` — identical digests, +1-day wall-clock skew, sensitivity, deterministic races |
| Pilot provenance | `tests/unit/orderSimulator/pilot-fixtures.test.ts` — fixtures agree with the engine's profiles |

## Commands run

```
npx tsc --noEmit                              # clean
npx vitest run tests/unit/orderSimulator/     # 4 files, 85 tests, all pass
npx vitest run                                # 107 files, 703 passed, 2 skipped, no regressions
```

## Defects found and fixed during this phase

1. **Exit fills never applied to their position.** `fillOrder` looked the position up only for
   `purpose === 'CLOSE'`, so a stop-loss fill realized no PnL and minted a phantom position id.
   Every non-entry purpose now resolves its position; a vanished target is cancelled, not filled.
2. **Resting orders were parked in `EXECUTING`.** This misreported their state and made
   cancel/amend impossible (both only accepted `ACCEPTED`/`WORKING`). Replaced with `armedAt`.
3. **The quote tape did not advance simulated time**, so an out-of-order quote was silently accepted.
   Accepting a quote now advances `now` to it, making the tape monotonic by construction.
4. **Minimum-size validation ran after the increment check**, so an obviously-too-small size
   reported "not a multiple of the size increment". Order corrected.
5. **Marketable limits were refused** as if they were wrong-side stops. Stops enforce placement;
   limits carry a warning and fill immediately.

## Acceptance criteria

All four roadmap criteria for Phase 44 are met and pinned by tests.
