# Market Rewind order simulator implementation plan

Prepared: 2026-10-12, Asia/Bahrain. Status: implementation handoff; this document does not execute trades or implement application code.

## Outcome

Build an offline order terminal inside Market Rewind where the user can submit market, limit, and stop orders, experience transmission and execution delays, cancel or amend pending orders, attach ordinary stop losses/take profits, and inspect why an order filled or remained pending. Use the existing replayed bid/ask tape so prices can move while an instruction travels. A delay must change execution behaviour, not merely animate a button.

Use the Capital.com pilot as evidence for lifecycle mechanics and as a reference for observed response times. Keep unmeasured internal delays configurable and visibly identified as simulation assumptions. Do not represent this as an exact reproduction of Capital.com's live execution.

This plan chooses simulator implementation as the next step. Stage 2 collection is a later calibration task, not a prerequisite for developing deterministic order mechanics. No broker access, credentials, research CLI execution, or new demo/live trades are needed to implement and test this plan. Keep the existing research bundles unchanged and cite them when deriving fixtures.

## 1. Evidence to use, and corrections to the handover

The narrative report is `docs/research/capital-demo-order-observations.md`. It is useful, but several claims do not match the saved artifacts. Use the following audit as the starting point instead of directly implementing Section 9's numerical model.

### Supported observations

| Evidence | What it supports | Implementation consequence |
| --- | --- | --- |
| Pilot REST events: one market BUY response 231.499 ms, one limit BUY response 203.837 ms, one stop BUY response 204.384 ms | Three individual POST response observations on weekend BTCUSD demo | Preserve them as reference samples, with type, direction, instrument, and sample count; do not fit a distribution |
| Market confirmation contains submission `dealId` ending `7ecc` and an `affectedDeals` position ID ending `7ecf` | Orders and positions have distinct identities | Separate request, order, fill, and position IDs; close positions explicitly by position ID |
| Buy limit at 82944.45 remained unfilled and was deleted | One resting-limit and cancellation lifecycle; no observed limit fill | Implement limit price constraints from the order specification; do not claim a measured limit execution delay |
| Stop position has `workingOrderId` ending `802d` and position ID ending `8037`, with fill 82948.10 | One stop entry became a position; the linkage can be reconciled | Consume the working stop once triggered, create a linked market-execution task, then a distinct position |
| Quote tape contains bid/ask with a 50.00 spread and instrument step 0.05 | This pilot's prices and rules | Preserve as BTCUSD fixture context; never apply this spread or tick size to other instruments |
| Successful limit-delete confirmation has `status=DELETED`, `dealStatus=ACCEPTED` | Broker cancellation vocabulary for this example | Use clear internal `CANCELLED`; map optional Capital-style display/status metadata separately |
| Later cleanup events close both actual position IDs and then report empty lists | Historical reconciliation was completed in a separate run | Retain the failed attempts and later recovery in the evidence narrative |

### Claims that must not become calibration constants

1. **209 ms is a mixed-clock subtraction.** The first eligible stop quote has local receipt `11:02:44.695Z`, but its server timestamp is `1791716564852`, or `11:02:44.852Z`. The position's `createdDateUTC` is `11:02:44.904Z`. Subtracting local receipt from server creation produces 209 ms. The raw server-field difference is **52 ms**, but common clock domain and event semantics are not established, so this is also not a verified internal execution latency. Preserve both raw fields and uncertainty; calibrate neither execution delay to 209 nor to 52 ms.
2. **2499 ms is not locally observed stop submit-to-fill latency.** The pilot stopped observing pending state for 10 seconds and then attempted cancellation. Its first logged position snapshot containing the stop position arrived **14272.685 ms after the stop POST dispatch**, measured on the local monotonic clock. The local eligible-quote-to-that-position-observation interval is **11989.373 ms**. These are delayed observation metrics; they are not the broker's execution duration. The CSV still marks this stop `UNTRIGGERED_RESTING` with no fill price, contradicting the later narrative.
3. **816.5 ms is market fill-observation time, not execution time.** `pollConfirm()` waits 400 ms before querying, and the confirmation GET adds its own response time. Keep the response/observation distinction in the UI and evidence fixtures. Do not implement an 816.5 ms broker fill delay.
4. **The primary run did not clean itself up.** Its market close used the submission ID and received 404; the stop cancellation also received 404 after triggering. `final-state.json` contains two positions even though `manifest.json` has empty unresolved arrays. The collector removes owned IDs without checking final success. Later recovery is what closed the positions.
5. **Recovery is recorded elsewhere.** `2026-10-11T11-03-46-166Z/events.jsonl` contains two successful closes, `FULLY_CLOSED` confirmations, and empty positions/orders at `11:03:48.937Z` / `11:03:49.208Z`. `2026-10-11T11-05-33-514Z/events.jsonl` repeats the empty-state observations. This verifies historical cleanup; it is not a check of today's account state.
6. **No confirmation stream was captured.** The primary bundle's 47 events are all `REST_REQUEST`. The collector sends `confirms.subscribe` but drops non-quote/non-confirmation messages, including subscription errors. Do not claim that real-time fill notifications or subscription support were verified.
7. **Clock offset needs re-analysis.** `calibrateClock()` captures its wall-clock send time before the client's rate-limit wait, while reported RTT begins after that wait. Those are different intervals. The published midpoint offset and uncertainty are therefore not valid calibration inputs until reconciled against actual dispatch times.
8. **There is no measured normal distribution or fixed acceptance delay.** `Normal(210 ms, 20 ms)` and an additional 150 ms acceptance transition in Section 9 are proposed assumptions. One sample per entry type, all BUY, cannot establish variance, SELL behaviour, live behaviour, depth, market impact, or matching-engine determinism. The 46 quotes have receive gaps from approximately 49 to 5960 ms, with a median around 200 ms; do not claim every quote arrives at 100–300 ms.

Relevant primary-run event IDs:

| Observation | Event ID |
| --- | --- |
| Market POST | `60f6f31c-e9cc-4dcf-9449-7d907b1443fa` |
| Market confirmation with distinct affected position ID | `56066586-7934-42f5-bbcf-b928929e14c8` |
| Incorrect market-close 404 | `422234ae-29ed-4430-98c1-b4b7b839df7f` |
| Successful limit deletion | `f5500eec-77af-476b-92e6-a4b93f864ef7` |
| Stop POST | `655c2917-22a9-4a96-a975-17409040366a` |
| Stop-cancel 404 | `3d0565ae-3ec4-4207-9656-46689de35254` |
| First logged position snapshot containing both positions | `de299e6b-3b0a-46bb-a1ac-05bad0077520` |

These facts come from offline inspection of saved data and source code. Do not rewrite the original artifacts to make the report consistent; create a derived evidence summary with source links.

## 2. Scope and product decisions

Deliver these in the first implementation:

- BUY and SELL market, resting limit, and resting stop **entry** orders.
- Pending-order cancellation and amendment, with transmission delay and visible race outcomes.
- Explicit position close, ordinary attached stop loss, and take profit, including close-side bid/ask rules and gap effects.
- An order list, position list, chart markers, and a per-order event timeline explaining submission, broker arrival, working state, trigger, fill, and when the client learns the result.
- Editable latency settings and three distinguishable profiles: illustrative training, pilot response reference, and zero-delay comparison.
- Deterministic playback, speed/step/seek behaviour, stable symbol ownership, and account-wide PnL counted once.

First-release account policy: **independent positions with explicit closes**, labeled as the training account's position mode. Each entry creates a position; an opposite entry opens another position. This is a deliberate teaching choice, not a claim that the pilot established Capital.com's hedging mode. Remove implicit counter-order netting from the realistic terminal path. A separate netting mode can follow once its rules are specified and tested.

Do not silently attach the current hook's automatic +/-1% SL/TP. Default attachments are off. Let the user opt into them and see their actual order roles. Guaranteed stops, trailing stops, stop-limit orders, margin calls, swap/funding, partial fills, exchange queues, real depth, and a precise Capital.com account replica are outside this release. Model full fills for supported orders and label this limitation in the simulator settings.

The terminal is an offline learning tool. Its main controls show “Simulated account.” Trade buttons never invoke the demo collector, trading-terminal proxy, or an external broker.

## 3. Current code and proposed ownership

| Area | Current state | Planned implementation |
| --- | --- | --- |
| `src/hooks/useTradeManager.ts` | Synchronously fills from the current quote, holds one chart-local trade, nets counter-orders, synthesizes spread, and resets SL/TP when adding size | Replace trading mutations with engine commands and selectors; preserve rendering integration through an adapter |
| `src/components/TradeControls.tsx` | BUY/SELL plus quantity only | Add order type, trigger/limit level, optional attachments, quote preview, validation, and latency access |
| `src/types/index.ts` | `ActiveTrade` has no ID or symbol; `MarketTick` can omit bid/ask | Add/import engine types; keep legacy render types only as temporary adapters |
| `src/store/usePlaybackStore.ts` | Processes many ticks per frame but publishes only latest per-symbol snapshots; `seekEpoch` also changes for steps | Supply the engine every crossed tick and a typed movement reason, not only the final snapshot |
| `src/components/PlaybackManager.tsx` | Advances market time from wall time and playback speed | Keep it as the replay clock driver; engine deadlines use replay time |
| `src/components/ChartUnit.tsx`, `ChartCanvas.tsx`, `TradeBadge.tsx`, `src/lib/TradePlugin.ts` | Chart-local trade and PnL callbacks; marker support already exists | Project shared orders/positions into matching-symbol markers and scoped controls |
| `src/hooks/usePortfolio.ts`, `src/App.tsx` | Adds PnL supplied separately by chart ID | Select unique account positions/fills from the engine so duplicate charts cannot double-count |
| `src/hooks/useSession.ts`, `useMarketSimulator.ts`, `src/App.tsx` | Several date/reset/reload paths move the cursor | Route intentional session resets and seeks through one explicit engine/replay lifecycle |
| `src/lib/streamingClient.ts` | Maps tick timestamps and quote sides; some other bar paths truncate time strings | Preserve millisecond quote times and provenance on the trading path |

Create a small pure TypeScript engine under `src/lib/orderSimulator/` (`types.ts`, `engine.ts`, `scheduler.ts`, `quotes.ts`, `profiles.ts`, and selectors as needed), a shared `src/store/useOrderSimulatorStore.ts`, and one session-level replay integration module. Proposed new UI modules: `OrderTicket.tsx`, `OrderActivityPanel.tsx`, `OrderTimeline.tsx`, and `ExecutionSettings.tsx`. Avoid building a general broker SDK or adding backend order endpoints.

## 4. Domain contract

Keep separate entities and identities:

| Entity | Essential fields |
| --- | --- |
| Submission / command | `requestId`, `sessionId`, sequence, command type, submitted replay time, captured quote ID, referenced order/position ID |
| Order | `orderId`, symbol, BUY/SELL, MARKET/LIMIT/STOP, size, optional level, purpose (`ENTRY`, `CLOSE`, `STOP_LOSS`, `TAKE_PROFIT`), position link, current version, lifecycle times |
| Fill | `fillId`, originating order ID, position ID, replay timestamp, price, quantity, quote ID, trigger level if applicable, price-change comparisons |
| Position | `positionId`, symbol, direction, size, entry fill/time/price, SL/TP references, open/closing/closed state, realized PnL |
| Instruction outcome | Accepted/rejected, reason, command version, broker-processed time, client-visible time; cancellation/amendment outcomes do not replace the fill outcome |
| Event | Monotonic session sequence, market time, event kind, related IDs, before/after state, reason, price-side evidence, measurement provenance |
| Instrument / latency profile | Tick/size rules, freshness threshold, position policy, delay parameters, source (`OBSERVED_SAMPLE`, `DOCUMENTED_RULE`, `TRAINING_ASSUMPTION`) |

Internal order states: `SUBMITTED -> ACCEPTED -> WORKING` for resting entries; `SUBMITTED -> ACCEPTED -> EXECUTING -> FILLED` for markets; a stop adds `WORKING -> TRIGGERED -> EXECUTING -> FILLED`. Limits may enter `EXECUTING`, then return to `WORKING` if the execution-time quote no longer satisfies their price constraint. Terminal outcomes include `CANCELLED` and `REJECTED`.

Track cancel/amend requests separately while an order remains economically active. Clicking Cancel does not deactivate it. Once a stop has triggered, its working instruction is consumed; cancelling that old working instruction cannot undo execution. The user can close the resulting position when available. Version amendments so stale instructions cannot overwrite a later terminal state.

Have an authoritative simulated broker state and a client-visible projection driven by scheduled notices. A fill can occur before the UI learns it; PnL, protective orders, cancellation races, and later instructions must use the appropriate state. The event inspector may reveal both clocks for teaching. Duplicate notices cannot create duplicate positions, fills, or realized PnL.

All economic changes go through the engine once. React selectors, chart primitives, badge effects, and Strict Mode remounts must not execute business transitions.

## 5. Clock, scheduling, and replay integration

Use replay-market milliseconds for all simulation deadlines. No wall-clock `setTimeout` mutates order or account state. Wall time is only the existing playback driver's input and optional UI animation.

- At 1x, a 200 ms simulated delay takes approximately 200 ms wall time. At 10x, it takes approximately 20 ms. Pause freezes price progression and instruction deadlines. Show “Delays use replay time”; submitted instructions wait until play or a step advances replay time.
- Process every tick traversed by playback, including ticks skipped visually during a fast frame, forward step, or time jump. Watching `currentTick` in a React effect loses intermediate threshold crossings and is insufficient.
- Merge scheduled deadlines and quotes chronologically. Advance to each next event, process it using only the quote history available by that time, and then continue to the target. Never evaluate a deadline at the frame's final quote when later ticks exist.
- Define a deterministic tie-break for identical timestamps: stable tape sequence for quotes, then due commands/tasks by scheduling sequence. Document this simulator convention and test boundary cases; it is not measured broker ordering.
- Quotes arriving at a deadline become available before due commands under this convention. An order accepted at that instant evaluates that quote immediately; quote-driven triggers must not run a second time for the same order version.
- If no orders or positions need a symbol's quotes, skip unnecessary evaluation. With active exposure, consume its full relevant tape even when the symbol's chart is hidden or closed.
- Freeze advancement through missing/unloaded tape for active symbols. Show a data-loading state, resume from the same engine cursor, and never fill against a future or another symbol's quote. Include active orders/positions in the symbol loading registry.
- Stable quote identity must survive buffer prepends/merges. Current indices change when buffers are rebuilt; do not use index alone to deduplicate economics. Preserve source order for equal-time quotes; expose the backend's stable sequence if needed rather than inventing chronological order from price.

Add typed movement reasons such as `PLAY`, `FORWARD_STEP`, `SEEK_FORWARD`, `SEEK_BACKWARD`, `SESSION_RESET`, and `BUFFER_REPLACED`. Do not reset the engine on every `seekEpoch` change: a forward step should execute the crossed path. Coordinate with the existing chart snapshot/rebuild optimizations without making chart rendering replay each skipped tick.

### Seek and reset policy

Persist an in-memory command log plus deterministic profile settings. Reconstruct state from a checkpoint and the relevant tape/command prefix when seeking. Forward seek evaluates the skipped path. Backward seek removes future fills/PnL from the current state and starts a new branch by truncating future user commands. Notify the user once when future simulated trading actions are discarded. Forward playback after that rewind does not replay abandoned user submissions.

Reset/new date/new explicit session starts a fresh simulation session ID, clears pending deadlines and positions, and invalidates delayed callbacks or in-flight data loads from the previous session. It does not create fabricated closing fills or realized PnL. A chart timeframe change or ordinary chart symbol change is a view change and must not reset or relabel existing exposure.

For a large seek, compute engine transitions without React updates per tick; publish one final account projection, or bounded progress updates if needed. Chunk long work or use a worker only if the existing dense-tape fixtures show a main-thread stall. Do not add another animation loop or introduce the previously fixed seek/render freeze.

## 6. Quote and execution rules

Use a symbol-specific quote resolver with provenance. The realistic mode requires finite, positive, non-crossed bid/ask from recorded quote data. Do not fill from candle closes, interpolate a missing price path, use another symbol's `currentTick`, or silently manufacture +/-0.01 spread. Missing, stale, synthetic, or unsupported data returns a clear reason; a separately selected approximate-data training mode can follow later.

Provide instrument rules explicitly. BTCUSD pilot fixtures may use tick size 0.05 and minimum quantity/increment 0.0001. Other symbols need their own configured rules. Validate size, levels, finite numbers, valid tick increments, and price-distance units; use scaled decimal/tick arithmetic rather than equality on floating-point remainders. Never default every instrument to two decimals, size=1, or the pilot's spread.

Require fresh valid quotes at broker acceptance and execution. The profile's maximum quote age is a declared simulation setting. An instruction may wait for a fresh quote after a data gap; record that reason. End-of-tape leaves waiting tasks unresolved in the simulated account, without fabricated fills. Teach how to resume or reset.

| Action | Trigger / execution side | Execution-time constraint |
| --- | --- | --- |
| Market BUY entry | Ask at its scheduled execution time | No promised submission price |
| Market SELL entry | Bid at its scheduled execution time | No promised submission price |
| Buy limit | Ask <= limit | Fill only at ask <= limit; if price recovers above it before dispatch, keep working |
| Sell limit | Bid >= limit | Fill only at bid >= limit; if price drops below it before dispatch, keep working |
| Buy stop entry | Ask >= stop | Trigger is latched; later market execution can fill above or below the stop |
| Sell stop entry | Bid <= stop | Trigger is latched; later market execution can fill above or below the stop |
| Close long | Sell at bid | Close only its existing remaining size |
| Close short | Buy at ask | Close only its existing remaining size |
| Long SL / TP | SL: bid <= stop; TP: bid >= target | SL becomes market close; TP retains its limit boundary |
| Short SL / TP | SL: ask >= stop; TP: ask <= target | SL becomes market close; TP retains its limit boundary |

For the first ticket version, support resting entry placement: buy limit below current ask, sell limit above current bid, buy stop above current ask, sell stop below current bid. Validate at submit for feedback and again at broker arrival. If travel-time price movement makes a new resting instruction invalid/marketable, reject with a recorded reason under this explicit training rule. Already accepted working orders remain governed by their triggers. Marketable-limit support can follow after separate broker observations; do not assume it was tested by the pilot.

SL/TP become active only after their entry actually fills. They have a shared closing group with explicit one-position-size accounting. A latched SL or accepted manual market-close commitment reserves the close; competing exits for that size are invalidated so they cannot all close it or reverse the account. A TP that merely became eligible must not disable the SL while waiting for its execution-time price check: if the limit condition disappears, keep its protection group active. Commit the TP close atomically only when its price-constrained execution succeeds. Modifying a protective level is a delayed versioned amendment, not an immediate mutation on every pointer movement. Drag can preview the new line locally; commit the amendment on drop.

For fills, store last-seen submission quote, trigger quote, execution quote, and quote ages separately. Price change from submission quote is `fill - askAtSubmit` for BUY and `bidAtSubmit - fill` for SELL; positive means adverse change. Also show stop-to-fill difference. Limits must never violate their boundary. Do not add arbitrary slippage to a limit price or imply guaranteed stops; quote movement during delay already creates meaningful market/stop price change.

Compute long PnL from bid and short PnL from ask, with quantity and configured contract multiplier/currency. Unsupported currency conversion should be explicit. Reject implicit currency mixing in portfolio totals rather than summing arbitrary instruments. Retain the baseline spread cost so “price stayed unchanged” can still show a loss after entry.

## 7. Latency profiles without invented calibration

Separate these parameters and deadlines:

- Command travel to the simulated broker.
- Acceptance/validation processing.
- Reply/acknowledgement arrival at the client.
- Market or triggered execution dispatch delay.
- Fill-notification delay or an explicitly selected polling observation model.

Cancel, amend, and close instructions use the same command scheduler. A pending order is still active while those instructions travel. Enforce causal constraints on settings so acknowledgements cannot describe unprocessed requests; the engine can deliver an already-filled result before or alongside a delayed acknowledgement without regressing state.

| Profile | Definition | Evidence label |
| --- | --- | --- |
| Training (default) | Fixed illustrative arrival 100 ms, acceptance processing 0 ms, acknowledgement at 210 ms after submit, execution dispatch delay 50 ms after eligibility/acceptance, and notification 100 ms after the economic event. Each parameter is editable. | Chosen teaching values; no inferred one-way latency or fitted Capital distribution |
| BTCUSD BUY pilot response reference | Use 231.499 / 203.837 / 204.384 ms total acknowledgement envelopes for MARKET / LIMIT / STOP. Keep internal split and execution/notification delays as clearly disclosed training assumptions. | One response sample per type, BTCUSD demo BUY only; SELL/other instruments use training values |
| Zero-delay comparison | All instruction/observation delays zero while retaining exact quote-side and limit constraints | Comparison tool, not empirical broker behaviour |

Do not automatically use the 816.5 ms observation as a fill delay, 209/52 ms as a dispatch delay, or `Normal(210,20)` as a measured distribution. A seeded variable-delay mode is optional after fixed profiles work; any user-created jitter must be labeled a training scenario and sampled once per command, not once per render or tick.

Keep evidence reference cards separate from simulated output: “In one demo BUY, the POST response took 231.5 ms; the collector observed its fill after 816.5 ms, including polling.” Realized simulation results describe their own profile and quotes. Stage 2 can later replace parameter provenance when measurements genuinely constrain them, without requiring engine rewrites.

## 8. User interface and learning behaviour

Adapt the current compact trade controls rather than rebuilding the entire Capital.com site. Preserve chart navigation and theme behaviour.

- Ticket: Market / Limit / Stop selector; BUY / SELL; quantity with valid increments; level for pending types; optional SL/TP; current bid/ask and spread; estimated delay and profile label. Never show a position merely because the submit button was clicked.
- Order activity: “Sending”, “Working”, “Triggered”, “Executing”, “Filled”, “Cancelled”, or a rejection reason. Pending rows show the exact relevant price side and condition, such as “Waiting for ask <= 100.00”. Keep sending/working orders visible alongside their later positions.
- Position activity: explicit position identity, side, size, entry, current close-side quote, PnL, protective orders, and Close. Closing remains a pending instruction until confirmed in simulated client state.
- Cancel/amend: show pending instruction state and acknowledge a lost race plainly, such as “The stop triggered before the cancellation arrived.” Do not hide a fill when a cancel button was pressed.
- Timeline: submitted, simulated broker arrival, accepted/working, quote eligible, executed, notice received. Display execution delay, market waiting time, and notification delay as different intervals; show the quote side and reason at each relevant transition.
- Chart: use existing marker support for working levels, positions, SL/TP, and fill arrows. Bind badges by ID and symbol. Multiple charts showing the same symbol reflect the same account entities without multiplying them.
- Settings: change delay values and inspect provenance. Snapshot the profile into each order's intent so editing settings affects future commands, not completed or already scheduled ones.
- Short contextual copy: Market asks to execute promptly with uncertain price; Limit controls price and may remain unfilled; Stop activates after a threshold, then executes at market. Make the consequences visible in the timeline rather than showing implementation details in the primary ticket.
- Accessibility: labeled fields and units, keyboard-operable buttons, focus-preserving updates, numeric input errors, and a live status region for meaningful transitions; do not announce every price tick.

## 9. Execution tasks and dependencies

Execute sequentially unless an implementing workflow explicitly authorizes delegation. Each task has a concrete verification gate before the next integration step.

### Task 1 — Normalize pilot evidence into offline fixtures

Owned files: new `tools/research/analyze-capital-demo-observations.mjs`, derived `docs/research/capital-demo-pilot-evidence-audit.md`, and small fixtures under `tests/fixtures/orderSimulator/`.

- Parse all relevant run bundles and join submission, affected position, stop linkage, failed cleanup, and later successful recovery.
- Recompute response times and local observation intervals; retain raw clock-domain fields and unsupported metrics as unavailable.
- Validate event-ID and price/size linkage, final cleanup across runs, and the CSV/report discrepancies. Produce sanitized derived fixtures with stable local aliases, not credentials or full account snapshots.
- Keep original report/data intact. State how the audit supersedes unsupported numerical assumptions in Section 9.

Gate: offline analysis produces the three observed order lifecycles, two failed cleanup attempts, later closed/empty evidence, and the timing distinctions in Section 1. No network call occurs.

### Task 2 — Implement pure engine, scheduler, and profiles

Owned files: `src/lib/orderSimulator/*`, types integration, and focused unit tests.

- Implement identity separation, validation, state transitions, deterministic deadlines, internal/client projections, exact quote-side lookup, full fills, limits/stops, instruction races, explicit close, SL/TP, and PnL.
- Add fixed profiles with provenance and profile snapshots. Keep functions independently testable without React, HTTP, browser storage, or wall-clock timers.
- Ensure same input tape/commands/profile always produces the same events and results.

Gate: the business cases in Section 10 pass, including a price excursion that returns before the frame ends, late cancellation, and a delayed limit that cannot fill worse than its boundary.

### Task 3 — Integrate one engine with replay and session lifecycle

Owned files: `src/store/useOrderSimulatorStore.ts`, replay adapter, `usePlaybackStore.ts`, `PlaybackManager.tsx` only if needed, and session/date/buffer integration in `App.tsx`, `useSession.ts`, `useMarketSimulator.ts`.

- Feed ordered tick batches and clock events through the interval processor. Add movement reasons and session generations. Handle gaps, exposure symbol loading, duplicate buffers, resets, forward paths, backward reconstruction/branching, and stale async responses.
- Keep normal chart snapshot/bulk-seek logic intact. Register the engine once at session scope, not per chart.

Gate: the same command schedule gives identical fills/PnL at 1x, 10x, and large frame batches; pause/step/seek/reset are deterministic and do not leak old-session actions.

### Task 4 — Replace chart-local trading and portfolio accounting

Owned files: `useTradeManager.ts`, `usePortfolio.ts`, `ChartUnit.tsx`, `ChartCanvas.tsx`, `TradeBadge.tsx`, `TradePlugin.ts`, relevant account selectors and App wiring.

- Route BUY/SELL/Close/drag-drop through engine commands. Select account entities by symbol and ID; remove immediate economic mutation and direct `setActiveTrade(null)` close fallbacks.
- Reuse `ChartMarker`/badge primitives for multiple positions and working orders. Detaching/remounting a chart only changes its view.
- Count realized/unrealized PnL once per account entity, regardless of chart duplication. Replace tests that intentionally require instant fills, fabricated quote sides, and implicit netting in the realistic path; retain useful bid/ask/PnL assertions.

Gate: two charts displaying the same symbol show one order/position set and one portfolio result; switching a chart symbol cannot change a position's symbol or execution price.

### Task 5 — Deliver ticket, status panels, timeline, and settings

Owned files: `TradeControls.tsx` / new ticket/activity/settings components, `ChartWorkspace.tsx` or selected existing panel placement, and `src/index.css` where needed.

- Implement Section 8's flows using existing visual conventions. Make delay/pending/trigger status inspectable and the bid/ask condition unambiguous.
- Add local synthetic teaching tapes as test fixtures for market movement, missed limit, stop gap, and cancellation race; do not present them as collected market evidence.

Gate: browser tests demonstrate each order type from submission through fill/nonfill/cancel, both quote sides, a protective exit, and a lost cancellation race; users can change delay settings and see a changed outcome on the same scenario.

### Task 6 — Regression verification and implementation handover

Owned files: targeted tests, regression/journey scenarios, relevant README/user documentation, implementation verification document.

- Run focused suites during development, then the frontend suite, build, and replay journey once integration is complete. Run backend tests only if backend quote schema/sequence changes were required.
- Use the existing dense replay/seek performance tests and new engine-specific batch checks to detect dropped events, duplicate fills, and a revived seek stall. Report actual checks and limitations; do not claim browsers/tests ran if unavailable.
- Document defaults/provenance, independent-position mode, pause/seek behaviour, unknown broker timing, data requirements, and how later Stage 2 results can calibrate profiles.

Gate: Section 11's acceptance conditions are demonstrated with reproducible tests and recorded browser outcomes.

## 10. Required behavioural tests

Use independent tapes and explicit commands, not tests that merely mirror reducer branches.

| Scenario | Expected result |
| --- | --- |
| Quote changes while market BUY/SELL travels | Fill uses execution-time ask/bid; submitted quote is retained for comparison |
| Sending order and paused replay | No immediate position; no economic time advances until play/step |
| Buy limit touched only by bid | Remains working until ask satisfies it |
| Sell limit / buy stop / sell stop, equality and crossing | Uses correct side and includes equality; each trigger happens once |
| Limit eligible briefly, then price moves before dispatch | No price-boundary violation; order remains/returns working |
| Stop eligible briefly, then price returns before dispatch | Trigger stays latched; resulting market fill uses its due-time quote |
| Market/stop crosses a recorded price gap | Next valid execution quote determines fill; ordinary stop need not fill at its level |
| Cancel reaches broker before trigger versus after trigger | First case cancels; second case rejects cancellation and preserves the fill/position |
| Delayed amendment versus price crossing | Old level remains active until amendment processing; stale edits cannot change consumed orders |
| Long/short stop loss and take profit | Uses closing bid/ask, creates one close only, and invalidates competing exit instructions |
| Close button twice / repeated notice / chart remount | At most one close fill/PnL realization for the same remaining position size |
| Different request/order/position IDs | Correlation is correct; request/order identity cannot be used as a position close target |
| Sparse or missing quotes, wrong symbol, synthetic tick | Explicit wait/rejection reason; no candle or cross-symbol fill |
| Fast playback crosses and uncrosses threshold in one frame | Intermediate crossing is evaluated; final-tick-only logic cannot pass this test |
| Same-time quotes, merges, and buffer replacement | Stable ordering and deduplication; no accidental duplicate economics |
| Pause, speed change, forward step, forward seek | Same replay-time command/tape schedule produces the same account result |
| Rewind/new branch and session reset during pending delay | Future commands discarded as specified; no ghost position, stale notification, or future PnL |
| Two charts of one symbol / hidden exposure symbol | Shared state stays correct; account totals do not double-count; hidden orders still evaluate |
| Invalid size/tick, NaN/Infinity, stale quotes, unsupported currency | Clear validation result; no unintended fill or misleading aggregate PnL |
| Profile changes after submission | Existing deadlines keep their snapshot; only new commands use the changed settings |
| Browser offline after replay data loaded | Ticket/engine/order flows work without broker connectivity or credentials |

Suggested new tests: `tests/unit/orderSimulator.test.ts`, `orderSimulatorRaces.test.ts`, `orderSimulatorReplay.test.ts`, `tests/integration/orderSimulatorAccount.test.tsx`, and a journey spec for the simulated terminal. Update existing `tradeExecutionBidAsk.test.ts` meaningfully; do not preserve incorrect behaviours just to keep old tests green.

## 11. Acceptance and verification commands

The implementation is complete when:

1. All three entry types can be placed as BUY/SELL; pending and execution states are visible; only confirmed simulated fills create displayed positions.
2. Delay changes can change market/stop fill prices and cancel/amend outcomes. Limits remain price-constrained.
3. The timeline distinguishes price waiting, economic execution, and client observation, with source labels for the pilot samples and training parameters.
4. Ordinary SL/TP/manual close use the correct side and cannot double-close a position. Portfolio totals are correct across multiple charts.
5. Replay batching, pause, steps, seeks, resets, symbol changes, and data reloads do not miss triggers, use future quotes, or leak session actions.
6. The pilot evidence audit explains timing and recovery discrepancies without modifying original raw artifacts. No unsupported fitted distribution is presented as measured.
7. The terminal contains no broker trade transport or credential dependency; offline scenarios demonstrate the learning flows.
8. Targeted behavioural tests, relevant existing regressions, production build, and available browser verification pass with results recorded.

Commands for the implementing agent after adding the proposed files:

```bash
# Offline evidence analysis only
node tools/research/analyze-capital-demo-observations.mjs

# Focused engine and account verification
npx vitest run tests/unit/orderSimulator.test.ts tests/unit/orderSimulatorRaces.test.ts tests/unit/orderSimulatorReplay.test.ts tests/integration/orderSimulatorAccount.test.tsx

# Integrated frontend verification
npm test
npm run build
npm run test:journey

# Only if backend quote schema/ordering was changed
npm run backend:test
```

Record missing runtime/browser prerequisites explicitly. Do not run the existing observer without an action: its current CLI defaults to `--pilot`, which sends trading mutations.

## 12. Later calibration work

If Stage 2 is requested later, repair the collector first: prefer affected position IDs, reconcile non-2xx cleanup and consumed working orders, derive unresolved state from snapshots, persist actual outcomes back to CSV, record streaming subscription results/errors, remove generic credential fallback, bound requests/timeouts/order counts, correct dispatch-aligned clock probes, and add interrupted-run recovery. Its current success message is unconditional and does not prove a clean run.

Then collect both directions, actual limit fills, multiple sessions/instruments, and real fill-observation resolution using the original demo-only collection constraints. Retain small-sample uncertainty; Stage 2's planned counts still do not establish reliable p99 tail latency. Feed new evidence into profile provenance and measured response/observation parameters. Internal one-way/dispatch components remain assumptions unless the new timestamps genuinely constrain them.

## Copyable implementation prompt

> Implement `docs/research/capital-order-simulator-implementation-plan.md` in Market Rewind. Start with its pilot evidence audit; do not directly implement the unsupported normal distribution or 209 ms execution latency proposed in the earlier report. Build a pure deterministic offline order engine, integrate every crossed quote and replay-time deadline, replace chart-local instant fills with shared account orders/positions, and deliver market/limit/stop tickets, cancellation/amendment races, ordinary SL/TP, latency settings, and explanatory timelines. Keep training assumptions labeled, preserve the raw research artifacts, and make account PnL and reset/seek behaviour correct across multiple charts. Execute the specified behavioural and regression checks and document their results. Do not run broker research tooling, use credentials, or place demo/live trades during simulator implementation.
