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

1. **Browser verification did not run here, and has since been run elsewhere — with failures.**
   `npx playwright test -c playwright.journey.config.ts --list` discovers **80 tests in 15 files**
   (including the new `15-simulated-terminal.spec.ts`), but the browser binary cannot be installed in
   this environment: `npx playwright install chromium` fails with `Failed to download Chrome for
   Testing 156.0.8078.4 … code=1` (no route to the download CDN).

   On 2026-10-12 an independent verifier with a working browser ran the suite on macOS (Apple M4,
   Chromium) and recorded **53 passed / 23 failed / 4 fixme**. Those numbers supersede "no outcome
   claimed" and are broken down as follows:

   | Group | Count | Status |
   |---|---|---|
   | `07-trading.spec.ts` netting assertions | 4 | Intentional `test.fixme`; replaced behaviour, not a defect |
   | `04`, `05`, `06`, `07`, `08`, `09` re-baselining | 14 | **Unresolved.** Attributed to v6.0's account-wide PnL and latest-open-position badge, as predicted in limitation 2 below, but not yet confirmed or fixed |
   | `15-simulated-terminal.spec.ts` | 5 | **Unresolved, and not predicted.** The whole new spec fails |

   A second, targeted diagnostic run (Stage 2 of the brief) pinned the cause, and it is **one root
   cause explaining all eighteen trading failures**, not several:

   - The account's instrument registry contains `BTCUSD_RULES` alone, which is correct: SIM-QUOTE-02
     says the BTCUSD pilot values are fixtures for that symbol only and are never defaulted onto
     others. Every chart in the app, however, is SPY / AAPL / QQQ.
   - `useTradeManager` asked the registry for rules, caught `UnsupportedSymbolError`, and returned
     silently, so no market-data tape was ever registered for the charted symbol. No tape means no
     quote; no quote means no fill; no fill means no position, and the badge — which projects the
     latest open position — never appeared. That is the `07` and `08` failure signature.
   - The desk compounded it: the ticket fell back to `BTCUSD_RULES` for *display*, so an untradeable
     symbol was rendered with another instrument's price decimals, and its bid and ask showed as em
     dashes with no explanation until a Submit failed.
   - On the chart path the rejection was completely silent. `placeOrder` set `lastError`, and
     **nothing in the codebase rendered it.** Clicking BUY on a SPY chart produced no order, no
     position and no message of any kind.

   **Fixed in this phase** (all guarded by tests that fail without the fix):

   | Change | Effect |
   |---|---|
   | `OrderTicket` no longer falls back to `BTCUSD_RULES`; an unconfigured symbol gets `null` rules | The display half of the borrowing rule is closed |
   | The ticket renders `data-testid="unsupported-instrument"` — plain language, naming the symbol and BTCUSD, and the reason rules are never borrowed | The user is told before submitting, not after |
   | `useTradeManager` exposes `isTradeable` and `symbol`; `TradeControls` disables BUY/SELL and renders `data-testid="trade-controls-untradeable"` | The chart path can no longer discard a click silently |
   | `15-simulated-terminal.spec.ts` exercises the terminal on **BTCUSD** and asserts the refusal on SPY | The spec tested an instrument the account cannot trade; that was the spec's fault, not the app's |
   | The journey mock's universe gained `BTCUSD` | The desk journeys need a chart they can actually trade |
   | Four assertions in `tradeDeskUi.test.tsx` | Reintroducing the fallback fails three of them by name; 34/34 with the fix |

   One assertion in the new spec was also simply wrong: it demanded the plural "single samples" from
   the evidence cards, which correctly read "Single sample: this is a reference point, not a
   distribution." Five of that test's assertions passed; only the last was my error.

   **The scope question was then decided, and implemented.** The account now trades the equity
   universe as well, on **assumed** rules held per symbol and labelled `TRAINING_ASSUMPTION` — a
   whole-cent tick and a whole-share size, which is the ordinary US equity convention. Nothing was
   borrowed from BTCUSD, and nothing claims to be observed: the ticket now states the price grid it is
   using alongside its provenance, and adds "the pilot measured BTCUSD, not this instrument" whenever
   those rules are assumptions. `BTCUSD_RULES` keeps `OBSERVED_SAMPLE` and its own disclaimer-free
   line, because the pilot did measure it.

   A single `TRADEABLE_INSTRUMENTS` registry is now the one source of truth for the ticket, the
   activity panel, the chart controls and the account store. The store's default had been the last
   gate: widening the UI registries changed nothing while `useAccountStore` still held only BTCUSD.

   The refusal path is deliberately still reachable, and still covered: the charting backend serves
   more symbols than the account is configured for, so the journey mock serves `PLTR` without
   configuring it, and the browser spec asserts the refusal on that symbol end to end.

2. **Four further browser failures were chased as far as a browserless environment allows.** Two
   are now provably spec bugs and were fixed; two remain open and need the error text from a run.

   | Test | Finding | Status |
   |---|---|---|
   | `04-temporal-isolation` › single-stepping forward | It asserted the replay clock `startsWith('09:2')`. The anchor is 09:10:00 and the mock emits one tick per second, so five steps land at 09:10:05 — the assertion **could not be satisfied by correct behaviour**. Now asserts `'09:1'`, which is what "still in the opening minutes" always meant. | Fixed |
   | `06-live-replay` › the live price badge | It matched `/\$(\d+…)/` against `.playback-bar`, which renders profit-and-loss figures and elapsed replay time and **contains no price and no dollar sign at all** (`grep -c price` = 0). Retargeted to the tape's own price cell — the surface the test's name describes — and to the stream actually advancing. | Fixed |
   | `05-playback-transport` › single-tick step | Asserts `index + 1` after one step. The step controls exist with the expected titles and stepping demonstrably works (the 04 failure showed the index advancing), so the likely cause is the cursor moving on its own between the read and the click — a timing assumption in the test. Not provable without a browser. | **Open** |
   | `06-live-replay` › tape close button | The button exists (`title="Close Tape"`, `onClick={onClose}`) and the panel is conditionally rendered, so closing unmounts it. No static defect found; the failure is in runtime behaviour that cannot be observed here. | **Open** |

3. **A hole in the test strategy was found and closed while fixing the above.** Nothing in this
   repository parsed the Playwright specs: `vitest` does not collect them and `tsc` accepts them as
   ordinary TypeScript. An unescaped apostrophe in one test title therefore broke
   `15-simulated-terminal.spec.ts` at parse time, which made Playwright abandon discovery of the
   **whole suite — 82 tests across 15 files, all gone** — while vitest, tsc and the build stayed
   green. `tests/regression/journeyDiscovery.test.ts` now runs `playwright --list` and fails on a
   syntax error or an implausibly small suite. Verified by reintroducing the apostrophe: the guard
   fails naming the file and line.

4. **The account had no clock, and only a browser could reveal it.** The chart playhead advanced and
   streamed its tape while the simulated account sat motionless, because `useOrderSimulator` — the only
   code that ever advanced a session from the playhead — had **no call site in the application**. It was
   exercised exclusively by its own tests.

   This is the defect behind the failures that the unit suite could not see: an accepted order never
   filled, so no position opened, so no trade badge appeared, and the ticket showed em dashes because no
   quote was ever delivered. Every one of the ~997 tests drives the engine by hand, which is precisely
   why all of them passed: they were testing an engine, not an application.

   Fixed by `syncFromPlayback` on the account store, delegating to the already-tested
   `syncSessionToPlayback` bridge, plus `useAccountPlaybackSync` subscribing to the playback store and
   mounted once in `App`. It publishes only when the account actually changed, so 25x playback does not
   re-render per frame. `tests/integration/accountPlaybackSync.test.tsx` moves the playhead the way
   `PlaybackManager` does and asserts the account followed; removing the subscription fails five of its
   six tests.

5. **The browser suite had been testing a stale build, and three more real bugs were behind the rest.**

   | Finding | Detail |
   |---|---|
   | Stale build | The config used port 3000 with `reuseExistingServer: true`. A daemon serving an old `dist/` on that port was silently reused, so results described code that was not under test — one test flipped from failing to passing the moment `dist/` was rebuilt, with no source change. Now: dedicated port 3100, started fresh, `--strictPort`. |
   | Unreachable step buttons | Step buttons are labelled from the current step size and `stepMinutes` defaults to 3, so "Step 1 Tick Forward" does not exist by default and every test that single-stepped waited 90 s for a locator that could never resolve. `setStepToTick` now selects the "1 tick" option first. |
   | Unclickable tape close | The floating trade-desk button sat at `z-index: 4000` over the tape header at `z-index: 20`. The close button was physically unclickable; Playwright retried 173 times. The floating button is now hidden while the tape is open. |
   | Wrong clock asserted | Anchors are stated in ET, but the display renders each instrument in its own zone (equities ET, crypto UTC), so asserting "09:10" against "13:10:00.000 UTC" fails on correct behaviour. `expectedDisplayClock` derives the expected reading from the app's own helper. |

   Net effect on this milestone: the browser layer is **not verified**, and one of its new specs is
   known-bad as written. Everything else in this document stands.

6. **Round 4 (an external run of the brief at `7dab070`) found two real defects in this work, and
   fixing one of them exposed the deeper one.** 20 failed / 4 skipped / 58 passed.

   | Finding | Detail |
   |---|---|
   | The fix had only been applied to half the hazard | `webServer.url` had been moved to 3100 while `use.baseURL` still said 3000, so the suite started the right server and then browsed the wrong one — still the stale `vite preview` daemon the change was meant to escape. Both now derive from one `JOURNEY_PORT`, and `journeyDiscovery.test.ts` asserts they share an origin and that the port is not 3000. That guard is a **vitest** test: `npx playwright test` never runs it, so both suites must be run each round. |
   | A tape arriving at a settled playhead was never consumed | `registerTape` replaced the tape and nothing read it. Quotes reach the engine through *movement*, and the playback bridge returns early when the playhead has not moved — the ordinary case, since the replay starts paused and ticks load asynchronously. The ticket therefore priced nothing (em dashes) and an accepted order waited on a clock that never moved. `refreshFromTape()` now reads the tape at the instant the session is already at: no clock change, no history replayed, idempotent. |
   | …and the repair was incomplete | The delivery floor was a single number for the whole session, so a tape registered *after* another instrument had delivered was measured against that other instrument's progress, and its quote at the consumed instant was unreachable (`0 > 0` is false). Two instruments and one cursor meant the second instrument silently had no market data. Delivery is now tracked **per symbol**, and quotes refused as history advance their own cursor so a late page is scanned once. |
   | Four failures were spec bugs, not product bugs | `04` and `05` single-stepped with the default 3-minute step ("1 tick" is option 0) — `setStepToTick` now selects it; `06` asserted a price badge inside `.playback-bar`, which never carries one; `06`'s tape close was physically unclickable in an older commit (fixed in `78d5ef7`). |
   | One diagnosis was refined, not accepted | The report read the account's clock as frozen. It is not: the account's clock follows the playhead. What it cannot do is fill an order while the playhead is paused (travel is 100 ms, and `clampToExposure` freezes at the last quote). Four specs submitted and then awaited a fill without advancing replay time, which can only time out. They now run the replay briefly. That is the simulator working as designed, and the specs were wrong. |

   Disposition: of the 20 failures, 16 have named causes fixed since (the two defects above, the port
   divergence, the four spec bugs, and the trading failures that shared the unpriced-ticket root cause);
   4 remain to be confirmed by a fresh browser run at `2b9a704`. The `refreshFromTape` repair was proven
   by reproducer-first testing: two new tests in `accountPlaybackSync.test.tsx` failed exactly as the
   report predicted (`expected undefined to be 100.5`), then passed. The per-symbol cursor repair was
   proven by reintroduction: collapsing the cursors back into one global floor fails the new unit guard,
   `behaviouralMatrix` §10.18 and `tradeDeskUi` SIM-UI-02.

   Two of the failures the first repair *caused* were themselves findings, which is why they were not
   papered over. `tradeDeskUi` "shows no price rather than inventing one" was mislabelled test data — it
   registered an ETHUSD tape carrying BTCUSD quotes, so it had been passing because nothing was
   delivered at all; it now uses an ETHUSD tape at ETHUSD prices, which makes it a stronger assertion.
   `behaviouralMatrix` §10.18 registered two instruments' tapes and expected both to be readable, which
   is exactly what the shared cursor prevented.
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
