# Phase 48 Verification — Regression Verification & Handover

**Status:** passed (with two disclosed environment limitations, §4)
**Verified:** 2026-10-12

## 1. SIM-VERIFY-01 — the behavioural matrix

`tests/regression/behaviouralMatrix.test.ts` — **41 tests, all passing**, one describe block per row
of §10 of `docs/research/capital-order-simulator-implementation-plan.md`, in the plan's order:

| §10 row | Test(s) | Result |
|---|---|---|
| Quote changes while a market order travels | fills at the execution-time ask/bid; submitted quote retained; 100-tick adverse move reported | pass |
| Sending order and paused replay | no position, no economic time, no fill until play/step | pass |
| Buy limit touched only by the bid | stays WORKING while the ask is above the level, fills when the ask reaches it | pass |
| Equality and crossing on all sides | sell limit @bid, buy stop @ask, sell stop @bid — each triggers **once** | pass |
| Limit eligible briefly, price moves | does not fill at a price that is gone at eligibility; stays WORKING; never fills through its own limit | pass |
| Stop eligible briefly, price returns | latched trigger survives the return; and a pre-eligibility crossing is *not* treated as a trigger (interpretation stated) | pass |
| Recorded price gap | fills at the next reachable quote, reports the 110-tick slippage past the stop | pass |
| Cancel before vs after trigger | before → CANCELLED and nothing fills later; after → cancellation rejected, fill and position preserved | pass |
| Delayed amendment vs price crossing | old level active until the amendment is processed; a stale edit cannot touch a consumed order | pass |
| Long/short SL and TP | one close fill, correct side (LONG→bid, SHORT→ask), competing exit CANCELLED; opt-in protection with the entry | pass |
| Double close / repeated notice / remount | one close fill, one realization; 25 refreshes change nothing | pass |
| Request/order/position ids | fill→order→position correlated; an order id used as a close target is refused | pass |
| Sparse/missing quotes, wrong symbol | other symbols' prices never substitute; an unknown instrument is refused | pass |
| Fast playback crosses and uncrosses in one frame | the intermediate crossing is evaluated and filled | pass |
| Same-time quotes, merge, replacement | stable ordering by (time, seq); merge deduped; no duplicate economics | pass |
| Pause/speed/step/seek equivalence | one frame ≡ thirty steps ≡ forward seek, by event digest | pass |
| Rewind branching and reset with work in flight | future commands discarded and disclosed; reset drops in-flight work with no invented PnL | pass |
| Two charts of one symbol / hidden symbol | three positions counted once each; a symbol with no chart still evaluates | pass |
| Invalid size/tick/NaN/stale/unknown | refusals with reasons; STALE_QUOTE at 3 s old; no misleading aggregate PnL | pass |
| Profile changes after submission | each instruction keeps its own snapshot; new settings affect only new instructions | pass |
| Offline after data load | a full lifecycle with `fetch` throwing | pass |

## 2. SIM-VERIFY-02 — regression immunity

| Check | Command | Recorded result |
|---|---|---|
| Full test suite | `npx vitest run` | **118 files, 971 passed, 2 skipped, 0 failed** (~230 s) |
| Typecheck | `npx tsc --noEmit` | clean |
| Production build | `npx vite build` | succeeded (4.66 s); only the pre-existing chunk-size advisory |
| Dense replay/seek guards | `npx vitest run tests/performance/replaySeek.perf.test.ts` | **5 passed** — 20,000 quotes fed exactly once in one batch (< 4 s), identical digest for 1 frame vs 200, no re-delivery on a repeated advance, rewind+re-advance recovers the same digest, 3 live instructions produce 2 fills with unique fill ids and the unreachable limit still WORKING |
| Evidence analyzer (offline) | `node tools/research/analyze-capital-demo-observations.mjs` | **19/19 checks passed**, `network_calls: 0` |
| Collector repair guards | `node tools/research/test-observer-repairs.mjs` | **35 passed, 0 failed** |
| Demo-order guard | `node tools/research/test-demo-guard.mjs` | **16/16 passed** |
| Sibling suites | `tests/unit/orderSimulator/` (10 files, 243), `tests/integration/` (shared account + desk), `tests/hooks/` (3 files) | all passing inside the full run |

**Tests that asserted the old behaviour were replaced, not preserved:** `useTradeManager.test.ts`,
`useTradeManager.stress.test.ts` and `tradeExecutionBidAsk.test.ts` previously asserted netting
(cumulative entry prices, position flips, five orders collapsing into one position of size 5); they
now assert independent positions, per-position prices, and execution prices taken from the tape. Both
files carry a header explaining what changed and why.

## 3. Documentation handed over

`docs/order-simulator.md` — what the terminal is and is not; the provenance table (one observed
envelope surrounded by editable assumptions); why 209 ms / 2499 ms / 816.5 ms are not usable as
latencies; the order lifecycle with the **unknown** accepted↔eligible split called out; independent
positions and the one-close rule; the three delays; pause/step/seek/rewind/reset semantics; data
requirements (one tape per symbol, monotonic time, derived spreads, no FX); the two defects this phase
found and fixed; and a seven-point list of what Stage 2 must capture to calibrate the profiles.

## 3b. Independent verification pack (added after the first hand-off)

`VERIFY-V6.0.md` is a self-contained brief for an external agent to re-run and falsify this milestone
with real numbers. It has been executed once here, by its author:

| Section | Result |
|---|---|
| Full suite (re-run) | 119 files, 982 total = **980 passed, 2 skipped, 0 failed** (~155–230 s) |
| Independent probes (`tests/verification/independentProbes.test.ts`) | **9/9**, every value matched its hand-derivation; `TZ`-independent digest `536e096d` for both the one-frame and 39-frame runs |
| Mutation testing | All six deliberate defects caught: M1 trigger side → 8 tests, M2 equality dropped → 10, M3 notification delay zeroed → 3, M4 out-of-order quote accepted → 1, M5 future-quote validation (the phase-48 bug) → 1, M6 no-quote fill → 3. Each reverted cleanly, tree empty afterwards. |
| Performance | 20,000 quotes in a single batch **16.7 ms** (~1.2 M quotes/s); rewind + re-advance **5.5 ms**; 20,000-quote run with three live instructions **21.3 ms**, 2 fills |
| Offline tooling | analyzer 19/19, repair suite **42/42**, demo guard 16/16; bundle count unchanged by the repair suite; `CAPITAL_DEMO_OFFLINE=1` refuses the probe |

The mutation patches are not kept in the repository: they exist only inside the verification brief, and
each is applied and reverted within a single command block.

## 4. Disclosed limitations

1. **Browser verification did not run.** `npx playwright test -c playwright.journey.config.ts --list`
   discovers **80 tests in 15 files** (including the new `15-simulated-terminal.spec.ts`), but the
   browser binary cannot be installed in this environment: `npx playwright install chromium` fails
   with `Failed to download Chrome for Testing 156.0.8078.4 … code=1` (no route to the download CDN).
   No browser outcome is claimed. The journey suite is offline-mocked (no DuckDB backend needed), so
   it should run in CI with browsers present.
2. **Four browser trading tests are known-stale and marked `test.fixme`** rather than left failing:
   `07-trading.spec.ts` asserted that buying twice accumulates one position, that an opposite order
   closes or flips it, and that a partial opposite order reduces it. v6.0 replaced that behaviour, and
   a replacement assertion cannot be verified without a browser. They point at this section.
   The remaining browser trading assertions (badge visibility, PnL surfaced in the playback bar) may
   also need re-baselining on the first CI run, because the badge now projects the latest open
   position and PnL is account-wide rather than per chart.
3. **Two defects found by writing this matrix** were fixed rather than documented away:
   - a quote from the future could be used to judge an instruction that had not yet arrived — a
     validly placed stop was refused for being on the wrong side of a price that had not happened
     yet (`engine.ts`; regression tests in `engine.test.ts`);
   - `Fill.priceChangeFromSubmit` / `Fill.stopToFillDifference` were tick counts documented as
     prices, and are now named `…Ticks` so the units cannot be misread.
4. **The stale-quote test is time-based, not tape-exhausted**: an exposed symbol freezes when its
   tape ends, so the freshness limit is exercised by advancing within a tape whose quotes are old.

## 5. Acceptance conditions (§11)

| # | Condition | Evidence |
|---|---|---|
| 1 | All three entry types as BUY/SELL; visible pending/execution states; only confirmed fills create positions | matrix §10.1–§10.4, §10.11; `tradeDeskUi.test.tsx` ("never shows a position merely because submit was clicked") |
| 2 | Delay changes can change fill prices and cancel/amend outcomes; limits stay price-constrained | `pilot-fixtures.test.ts`; matrix §10.8/§10.9; ticket validation tests |
| 3 | The timeline separates waiting, execution and observation, with source labels | `uiViewModels.test.ts` (three intervals asserted distinct), `tradeDeskUi.test.tsx` |
| 4 | SL/TP/manual close use the correct side and cannot double-close; totals correct across charts | matrix §10.10/§10.11; `protectiveGroup.test.ts` (21); `sharedAccountCharts.test.tsx` (8) |
| 5 | Batching, pause, steps, seeks, resets, symbol changes and reloads miss no trigger, use no future quote, leak no session action | matrix §10.14–§10.17; `replay.test.ts` (35); `replaySeek.perf.test.ts` |
| 6 | The evidence audit explains the timing/recovery discrepancies without touching raw artifacts | analyzer 19/19; `capital-demo-pilot-evidence-audit.md`; raw bundles untouched |
| 7 | No broker transport or credential dependency; offline flows demonstrated | matrix §10.21; `tradeDeskUi.test.tsx` fetch assertion; `test-demo-guard.mjs` 16/16 |
| 8 | Targeted tests, existing regressions, production build and *available* browser verification | §2 above, with §4.1 disclosing that browser verification was not available |
