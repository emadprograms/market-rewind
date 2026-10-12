# Phase 47 Verification — Ticket, Activity, Timeline & Settings

**Status:** passed
**Verified:** 2026-10-12

## Requirement evidence

| Requirement | Evidence |
|---|---|
| SIM-UI-01 | `tests/integration/tradeDeskUi.test.tsx` — Market/Limit/Stop, BUY/SELL, increment-valid quantity, pending levels, opt-in protection, live bid/ask/spread/age, estimated delay with profile label; `tests/unit/orderSimulator/uiViewModels.test.ts` — `ticketModel` validation including wrong-side stops and off-tick levels |
| SIM-UI-02 | UI tests — Sending → Filled progression, pending rows stating "Waiting for ask <= 80.00", working instructions visible beside later positions, plain-language rejections |
| SIM-UI-03 | UI tests — a lost race is acknowledged ("the stop triggered before the cancellation arrived") while the fill stays on screen; cancel/amend offered only on resting rows; an amendment applies once it arrives |
| SIM-UI-04 | UI tests — all six transitions with times; the three intervals shown as separate numbers; "not yet observable" instead of a placeholder; `uiViewModels.test.ts` asserts execution delay ≠ market waiting time |
| SIM-UI-05 | UI tests — six editable settings with notes, an observed value rendered read-only with `OBSERVED_SAMPLE` and the phrase "not editable", evidence cards in their own section marked as single samples |
| SIM-UI-06 | UI tests — "Simulated account — no broker is contacted", labels carrying units and increments, keyboard-operable tablist (Arrow keys), polite live region that announces transitions but stays silent for twenty price ticks, `fetch` never called |

## Commands run

```
npx tsc --noEmit                    # clean
npx vitest run                      # 118 files, 920 passed, 2 skipped, no regressions
npx vite build                      # succeeded
```

## Defects found and fixed during this phase

1. **A quote from the future could rewrite the past.** A quote delivered ahead of the scheduler
   advanced the engine clock, and an instruction that had not yet arrived was then judged against
   that price: a validly placed stop was refused for being on the wrong side of a price that had not
   happened yet. The broker now re-validates against the quote as of the moment it processes the
   instruction (falling back to the quote the order recorded when it was placed), and the arrival
   handler schedules acceptance from the arrival's own due time rather than the jumped clock.
   Regression-covered in `engine.test.ts`.
2. **Execution delay was the market waiting time under a different name.** Both were measured from
   eligibility, so a stop that waited 4.85 s for the market reported 4.85 s of "broker latency".
   Execution delay now runs from the trigger.
3. **A frozen account looked like a working order.** The account now exposes its freeze as current
   state and the desk says so, instead of an instruction sitting at "Sending" with no explanation.

## Notes

- `usePortfolio` is now a read-only subscription to the account; its `handlePnLUpdate` is
  deliberately inert, so a chart cannot write to the portfolio.
