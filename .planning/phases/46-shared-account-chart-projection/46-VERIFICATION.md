# Phase 46 Verification — Shared Account & Chart Projection

**Status:** passed
**Verified:** 2026-10-12

## Requirement evidence

| Requirement | Evidence |
|---|---|
| SIM-ACCOUNT-01 | `tests/unit/orderSimulator/accountStore.test.ts` — commands are the only mutators; repeated refreshes change nothing; refusals are inert |
| SIM-ACCOUNT-02 | `tests/integration/sharedAccountCharts.test.tsx` — two charts, one position, one total; remount/unmount/symbol-switch leave economics alone |
| SIM-ACCOUNT-03 | accountStore + hook tests — second entry opens a second position, opposite entry does not flip, larger opposite entry does not net, attachments opt-in |
| SIM-ACCOUNT-04 | `tests/unit/orderSimulator/protectiveGroup.test.ts` — activation only after fill, one claim, latch/close reservation, armed TP cannot disable the SL |
| SIM-ACCOUNT-05 | `tests/unit/orderSimulator/accountProjection.test.ts` — identity keys, deterministic ordering, grouped projection |

## Commands run

```
npx tsc --noEmit                    # clean
npx vitest run                      # 114 files, 831 passed, 2 skipped, no regressions
```

## Defects found and fixed during this phase

1. **Replacing a stop left the old one live.** `protect({stopLoss})` pointed the position at the new
   instruction while the old one stayed WORKING, so two stops could close one position. The replaced
   member is now terminated regardless of its state.
2. **Protection could be added while a close owned the position**, breaking the one-claim invariant.
   Now refused with the reservation holder named.
3. **Commands read stale render state.** `amendProtection` read the order from the render closure, so
   a stop attached in the same tick was invisible and the amendment was rejected. Command paths now
   read the store at the moment they run.
4. **Session notices never reached the user.** A freeze was recorded inside the session and dropped,
   so the account appeared to stall silently. `advanceTo`/`seekTo` now publish notices.
5. **`closingGroupFor` recursed infinitely** once it reported its own soundness; the invariant was
   extracted into a pure helper.

## Tests that changed meaning (deliberate)

`tests/hooks/useTradeManager.test.ts`, `tests/hooks/useTradeManager.stress.test.ts` and
`tests/unit/tradeExecutionBidAsk.test.ts` previously asserted netting — cumulative entry prices,
position flipping, and five rapid orders collapsing into one position of size 5. That behaviour is
what SIM-ACCOUNT-03 removes, so those tests now assert independent positions, per-position prices,
and account-derived execution prices against the tape.
