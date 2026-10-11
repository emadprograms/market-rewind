# Milestone v6.0 Requirements: Offline Order Simulator (Mock Capital.com Terminal)

## Overview

Milestone v6.0 adds an offline order terminal to Market Rewind. The user submits market, limit, and
stop orders against the replayed bid/ask tape; instructions travel to a simulated broker, and the
resulting delay **changes execution behaviour** — prices, race outcomes, and fills — rather than
merely animating a button.

Implementation is defined by `docs/research/capital-order-simulator-implementation-plan.md`. Section
1 of that plan is a correction sheet over the earlier pilot narrative: the figures 209 ms, 2499 ms,
and 816.5 ms, and the `Normal(210 ms, 20 ms)` distribution, are **not** measurements and must never
become calibration constants. Only the three POST response envelopes and the observed lifecycles are
carried forward as reference samples.

Key research findings driving these requirements: see `.planning/research/` (STACK, FEATURES,
ARCHITECTURE, PITFALLS, SUMMARY), in particular Pitfall 1 (stop vs MIT trigger inversion), Pitfall 4
(wall-clock leakage), and Pitfall 5 (frame-final-quote evaluation).

---

## Requirements

### Category 1: Engine Core & Entity Contract (SIM-ENGINE)

- [ ] **SIM-ENGINE-01**: **Identity Separation**: Model submission/command, order, fill, position, instruction outcome, event, and instrument/latency profile as distinct entities with distinct IDs. Orders and positions never share an identity, and a position close can never target a submission ID.
- [ ] **SIM-ENGINE-02**: **Order Lifecycle State Machine**: Implement `SUBMITTED → ACCEPTED → WORKING` for resting entries, `SUBMITTED → ACCEPTED → EXECUTING → FILLED` for market orders, the additional `WORKING → TRIGGERED → EXECUTING → FILLED` path for stops, limit re-entry to `WORKING` when the execution-time quote fails its constraint, and terminal `CANCELLED` / `REJECTED(reason)`.
- [ ] **SIM-ENGINE-03**: **Deterministic Deadline Scheduler**: Implement a `(fireTime, tieBreakSeq)` deadline heap on replay-market milliseconds. Time advances only by explicitly popping the next event. Documented tie-break for identical timestamps: stable tape sequence for quotes, then scheduling sequence for due commands.
- [ ] **SIM-ENGINE-04**: **Pure & Portable**: `src/lib/orderSimulator/**` contains no React, HTTP, browser storage, `Date.now`/`performance.now`, `setTimeout`/`setInterval`, or randomness. It must be importable by Vitest, the browser, and a Node analysis script without adaptation. A guard test enforces this.
- [ ] **SIM-ENGINE-05**: **Idempotent Notices**: A fill notice delivered twice, a repeated close instruction, or a chart remount can never create a second fill, position, close, or realised-PnL entry.
- [ ] **SIM-ENGINE-06**: **PnL Accounting**: Long positions valued at bid, short at ask, with quantity and configured contract multiplier/currency. Baseline spread cost is retained so an unchanged price can still show a loss. Implicit currency mixing is rejected rather than summed.

### Category 2: Quote Resolution & Execution Rules (SIM-QUOTE)

- [ ] **SIM-QUOTE-01**: **Provenance-Carrying Quote Resolver**: Resolve symbol quotes with explicit provenance, requiring finite, positive, non-crossed bid/ask. Refuse — with a clear reason — missing, stale, synthetic, or unsupported data. Never fill from candle closes, interpolated paths, another symbol's tick, or a manufactured ±0.01 spread.
- [ ] **SIM-QUOTE-02**: **Instrument Rules**: Tick size, size increment, and price-distance units are configured per instrument and validated with scaled-integer arithmetic. The BTCUSD pilot values (tick 0.05, increment 0.0001) are fixtures for that symbol only and are never defaulted onto others.
- [ ] **SIM-QUOTE-03**: **Correct Side & Trigger Semantics**: Market BUY at ask / SELL at bid; buy limit `ask <= limit`, sell limit `bid >= limit`; buy stop triggers `ask >= stop`, sell stop triggers `bid <= stop` with **inclusive** equality — i.e. stop semantics, never the MIT inverse. A data-driven rules table plus property tests prevent the inversion (see Pitfall 1).
- [ ] **SIM-QUOTE-04**: **Trigger Latch & Guarantees**: A triggered stop's working instruction is consumed and its trigger is latched (it cannot un-trigger), and the resulting market fill may land above or below the stop level. Limits never violate their boundary. No arbitrary slippage is applied to a limit price.
- [ ] **SIM-QUOTE-05**: **Entry Placement Validation**: Resting entries validate at submit (for feedback) and again at broker arrival. Buy limit below current ask, sell limit above current bid, buy stop above current ask, sell stop below current bid. An instruction rendered invalid or marketable by travel-time movement is rejected with a recorded reason.
- [ ] **SIM-QUOTE-06**: **Gap Handling & Freshness**: A maximum quote age is a declared profile setting. An instruction may wait for a fresh quote after a data gap and must record that reason. End-of-tape leaves waiting tasks unresolved without fabricating fills.

### Category 3: Latency Profiles & Provenance (SIM-LATENCY)

- [ ] **SIM-LATENCY-01**: **Separated Delay Components**: Command travel, acceptance/validation processing, acknowledgement arrival, execution dispatch, and fill notification are modelled as separate, independently editable deadlines.
- [ ] **SIM-LATENCY-02**: **Three Profiles**: Training (default: illustrative 100 ms arrival, 0 ms acceptance, 210 ms acknowledgement, 50 ms dispatch, 100 ms notification), BTCUSD BUY pilot response reference (231.499 / 203.837 / 204.384 ms envelopes for MARKET / LIMIT / STOP), and Zero-delay comparison.
- [ ] **SIM-LATENCY-03**: **Provenance Labels**: Every parameter carries `OBSERVED_SAMPLE`, `DOCUMENTED_RULE`, or `TRAINING_ASSUMPTION`, surfaced in settings and where evidence is cited. No fitted distribution is presented as measured.
- [ ] **SIM-LATENCY-04**: **Per-Command Snapshots**: The active profile is snapshotted into each command at submission. Editing settings affects future commands only; completed or already-scheduled work keeps its original values. Causal ordering is enforced so an acknowledgement cannot describe an unprocessed request.
- [ ] **SIM-LATENCY-05**: **Replay-Time Delays**: All deadlines run on replay-market time. At 1× a 200 ms delay takes ≈200 ms wall time; at 10× ≈20 ms. Pause freezes both price progression and instruction deadlines; a submitted instruction waits until play or a step advances replay time.

### Category 4: Replay & Session Integration (SIM-REPLAY)

- [ ] **SIM-REPLAY-01**: **Every Crossed Tick**: The engine consumes every tick traversed by playback — including ticks skipped visually in a fast frame, a forward step, or a time jump — with a typed movement reason (`PLAY`, `FORWARD_STEP`, `SEEK_FORWARD`, `SEEK_BACKWARD`, `SESSION_RESET`, `BUFFER_REPLACED`). Watching the latest tick in a React effect is insufficient.
- [ ] **SIM-REPLAY-02**: **Chronological Merge**: Scheduled deadlines and quotes are merged chronologically; each event is processed using only the quote history available by that time. A deadline is never evaluated against a frame's final quote when later ticks exist. Quotes arriving at a deadline become available before due commands, and a quote-driven trigger never runs twice for one order version.
- [ ] **SIM-REPLAY-03**: **Determinism Across Speed & Batching**: The same command schedule and tape produce identical fills and PnL at 1×, 10×, and large batched frames. Pause, step, seek, and reset are deterministic and do not leak actions from a previous session.
- [ ] **SIM-REPLAY-04**: **Seek & Branch Policy**: A command log plus profile settings are persisted in memory. Forward seek evaluates the skipped path; backward seek removes future fills/PnL from current state and begins a new branch by truncating future user commands, notifying the user once. Forward playback after a rewind does not replay abandoned submissions.
- [ ] **SIM-REPLAY-05**: **Session Lifecycle**: Reset, new date, and explicit session start begin a fresh simulation session ID, clear pending deadlines and positions, and invalidate in-flight callbacks and loads from the prior session — without fabricating closing fills or realised PnL. A timeframe or ordinary chart symbol change is a view change and must not reset or relabel exposure.
- [ ] **SIM-REPLAY-06**: **Exposure-Driven Data Handling**: Symbols with active orders/positions are consumed even when hidden, and their loading state is registered so advancement freezes through missing tape rather than filling against a future or foreign quote. Symbols with no exposure may be skipped.
- [ ] **SIM-REPLAY-07**: **Stable Quote Identity**: Quote identity survives buffer prepends and merges (never keyed on array index), preserving source order for equal-time quotes, so re-ordered buffers cannot duplicate or drop economics.

### Category 5: Shared Account & Chart Projection (SIM-ACCOUNT)

- [ ] **SIM-ACCOUNT-01**: **Engine-Authoritative Trading**: BUY, SELL, Close, and drag-to-amend are routed through engine commands. Economic state is mutated only by the engine — never by React selectors, chart primitives, badge effects, or Strict Mode remounts.
- [ ] **SIM-ACCOUNT-02**: **Single Source of PnL**: Realised and unrealised PnL are counted once per account entity regardless of how many charts display the symbol. Duplicate charts cannot double-count, and switching a chart's symbol cannot change a position's symbol or execution price.
- [ ] **SIM-ACCOUNT-03**: **Independent Positions**: Each entry creates a position; an opposite entry opens another. Implicit counter-order netting is removed from the realistic path. Default SL/TP attachments are **off** and opt-in.
- [ ] **SIM-ACCOUNT-04**: **Shared Protective Group**: SL/TP activate only after their entry fills and share a closing group with explicit one-position-size accounting. A latched SL or an accepted manual close reserves the close and invalidates competing exits. A TP that is merely eligible must not disable the SL while awaiting its execution-time price check.
- [ ] **SIM-ACCOUNT-05**: **Chart Markers by Identity**: Working levels, positions, SL/TP, and fill arrows are projected into existing marker/badge primitives bound by ID and symbol, so detaching or remounting a chart changes only the view.

### Category 6: Ticket, Activity, Timeline & Settings (SIM-UI)

- [ ] **SIM-UI-01**: **Order Ticket**: Market / Limit / Stop selector, BUY / SELL, quantity with valid increments, level for pending types, optional SL/TP, live bid/ask and spread, estimated delay, and profile label. A position is never displayed merely because submit was clicked.
- [ ] **SIM-UI-02**: **Order & Position Activity**: Statuses `Sending`, `Working`, `Triggered`, `Executing`, `Filled`, `Cancelled`, or a rejection reason, with pending rows stating the exact price side and condition (e.g. "Waiting for ask <= 100.00"). Sending/working orders remain visible alongside later positions.
- [ ] **SIM-UI-03**: **Cancel/Amend Race Disclosure**: Pending instruction state is visible and a lost race is acknowledged plainly (e.g. "The stop triggered before the cancellation arrived"). A fill is never hidden because a cancel button was pressed.
- [ ] **SIM-UI-04**: **Order Timeline**: Submitted, simulated broker arrival, accepted/working, quote eligible, executed, and notice received are shown as distinct transitions; execution delay, market waiting time, and notification delay are shown as different intervals with the quote side and reason at each transition.
- [ ] **SIM-UI-05**: **Execution Settings & Provenance UI**: Delay values are editable and their provenance inspectable; evidence reference cards ("in one demo BUY the POST response took 231.5 ms…") are kept separate from simulated output.
- [ ] **SIM-UI-06**: **Learning Copy & Accessibility**: Short contextual copy explains Market vs Limit vs Stop consequences; fields have labels and units; controls are keyboard-operable; a live status region announces meaningful transitions but not every price tick. The honest "Simulated account" labelling is preserved and trade buttons never invoke any broker transport.

### Category 7: Evidence Audit & Collector Repair (SIM-EVIDENCE)

- [ ] **SIM-EVIDENCE-01**: **Offline Evidence Audit**: A new offline analysis script parses all saved pilot run bundles, joins submission → affected position → stop linkage → failed cleanup → later recovery, recomputes response times and observation intervals, and retains raw clock-domain fields. It runs with **no network calls** and produces derived fixtures with stable local aliases under `tests/fixtures/orderSimulator/`.
- [ ] **SIM-EVIDENCE-02**: **Corrections Documented**: A derived audit document states how unsupported numerical assumptions are superseded, including that 209 ms is a mixed-clock subtraction, 2499 ms is an observation gap, 816.5 ms includes a 400 ms polling wait, and no measured distribution exists. Original raw artifacts are never rewritten.
- [ ] **SIM-EVIDENCE-03**: **Collector Repairs (no execution)**: The demo observer is repaired without ever being run: prefer affected position IDs for cleanup, reconcile non-2xx cleanup and consumed working orders, derive unresolved state from snapshots, persist actual outcomes to CSV, record streaming subscription results/errors, remove generic credential fallback, bound requests/timeouts/order counts, correct dispatch-aligned clock probes, and gate its success message on observed final state.

### Category 8: Verification (SIM-VERIFY)

- [ ] **SIM-VERIFY-01**: **Behavioural Matrix**: The scenario matrix in plan §10 passes, including: quote movement during travel; paused-replay submission; limit touched only by bid; equality and crossing on all sides; brief limit eligibility without boundary violation; brief stop eligibility with a latched trigger; recorded price gaps; cancel before vs after trigger; delayed amendment vs price crossing; SL/TP single close; double close and repeated notices; ID correlation; sparse/missing quotes; intra-frame cross-and-return; same-time quotes and buffer replacement; pause/speed/step/seek equivalence; rewind branching and reset during pending delay; two charts of one symbol; hidden exposure symbol; invalid size/tick/NaN/stale/unsupported currency; profile changes after submission; and offline operation after data load.
- [ ] **SIM-VERIFY-02**: **Regression Immunity**: The focused engine/account suites, the existing frontend suite, the production build, and the available browser verification pass with results recorded. Existing tests that assert instant fills, fabricated quote sides, or implicit netting in the realistic path are replaced rather than preserved. Dense replay/seek performance tests confirm no revived freeze, dropped events, or duplicate fills.

---

## Out of Scope

Explicitly excluded from this milestone (with rationale):

| Excluded | Reason |
|---|---|
| Guaranteed stops, trailing stops, stop-limit orders | Separate trigger-semantics surfaces; trailing stops are where the reference engine bug lived |
| Partial fills, exchange queues, real depth | The recorded tape has no size information; a partial-fill model would be invented, not simulated |
| Margin calls, swap/funding, commissions | Requires an account model that does not exist and was not observed |
| Netting mode | Rules unspecified; independent positions with explicit closes chosen deliberately |
| Exact Capital.com replication | Teaching tool, not a replica; the plan says so explicitly |
| Any broker transport, credentials, or research CLI execution | Safety boundary; the observer's CLI defaults to `--pilot`, which sends real trading mutations |
| A fitted latency distribution | Three BUY samples cannot establish variance; presenting one as measured is a false-evidence claim |
| Stage 2 data collection | Collector repairs are in scope; execution is deferred to a later milestone |

---

## Traceability

| Requirement | Phase | Status |
|---|---|---|
| SIM-EVIDENCE-01, SIM-EVIDENCE-02, SIM-EVIDENCE-03 | 43 | Pending |
| SIM-ENGINE-01..06, SIM-QUOTE-01..06, SIM-LATENCY-01..05 | 44 | Pending |
| SIM-REPLAY-01..07 | 45 | Pending |
| SIM-ACCOUNT-01..05 | 46 | Pending |
| SIM-UI-01..06 | 47 | Pending |
| SIM-VERIFY-01, SIM-VERIFY-02 | 48 | Pending |

**Total:** 40 requirements across 8 categories, mapped to 6 phases (43–48).
