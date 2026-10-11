# Pitfalls Research

**Domain:** Adding a deterministic order-execution simulator to an existing tick-replay app
**Researched:** 2026-10-12
**Confidence:** HIGH for P1–P7 (external evidence + repo history), MEDIUM for P8–P10
**Scope:** Mistakes specific to ADDING these features to *this* system

---

## Critical Pitfalls

### Pitfall 1: Stop/MIT trigger inversion — the highest-risk bug in this milestone

**What goes wrong.** Stops and market-if-touched orders are exact inverses, and engines really do
ship this bug.

- **Stop:** BUY when `ask >= stop`, SELL when `bid <= stop`. Placed *above* market for a buy,
  *below* for a sell — the price must move **against** you to arm it.
- **MIT/LIT:** BUY when `ask <= trigger`, SELL when `bid >= trigger`. Placed *below* market for a
  buy, *above* for a sell — the price must move **toward** you.

The two are quote-side-mirrored. Copy the wrong one and every stop silently becomes an MIT.

**Live evidence.** `nautilus_trader` issue #5079: an *activated trailing stop* was routed through
MIT validation and modified with `is_touch_triggered_with_trigger_type` (SELL when `bid >= trigger`)
instead of stop semantics (SELL when `bid <= trigger`). Result: a quantity-only amend was rejected
with "new trigger px was in the market", while a genuinely in-market modify was *accepted*. That is
this exact inversion, in a production-grade engine.

**Warning signs.** A buy stop accepted while placed below the current ask. Equality excluded
(`>` instead of `>=`). SL/TP using one side for both directions.

**Prevention.**
1. Encode the side rules as an explicit data table (one row per action, exactly as plan §6) — never
   inline conditionals scattered across the engine.
2. Property tests asserting: buy stop requires `stop > ask` at submit; sell stop requires
   `stop < bid`; equality is **inclusive**; triggering happens **once**.
3. A cross-check test that a buy-stop condition and a buy-MIT condition can never both be true for
   the same quote and level.
4. Phase: **engine phase (Task 2)**. Add the boundary/equality cases to the race suite too.

### Pitfall 2: Confusing observation time with execution time

**What goes wrong.** The pilot report's headline numbers are not latencies. If they become
calibration constants, the simulator teaches wrong intuition while claiming measurement.

| Claim | Reality |
|---|---|
| 209 ms | Mixed-clock subtraction (local receipt − server timestamp). Raw server-field difference is 52 ms; neither is verified internal latency |
| 2499 ms | A ~10 s observation gap, not submit-to-fill. The CSV marks that stop `UNTRIGGERED_RESTING` |
| 816.5 ms | Fill *observation* time; `pollConfirm()` sleeps 400 ms before querying |
| `Normal(210, 20)` | An assumption, from 3 samples, one per type, all BUY, weekend demo |

**Prevention.** Store last-seen submission quote, trigger quote, execution quote, and quote ages
**separately**. Show waiting, execution, and observation as three distinct intervals in the timeline.
Label every parameter with provenance. Phase: **audit (Task 1)** + **UI (Task 5)**.

### Pitfall 3: Conflating request / order / position identity

**What goes wrong.** The pilot's own cleanup failed exactly this way: the market close was sent with
the **submission** `dealId` (ending `7ecc`) and got a 404, leaving two live positions behind; the
working stop was cancelled by an ID that had already been consumed by triggering. The collector then
removed the IDs anyway and reported success.

**Warning signs.** A close request that reuses the ID from the entry POST. A cancel that targets an
order already `TRIGGERED`. Success messages not gated on the actual response.

**Prevention.** Distinct branded types; closes target **position** IDs only; the working stop is
consumed on trigger and cannot be cancelled afterwards; a run's success is a function of *observed
final state*, never of "no exception thrown". Phase: **engine (Task 2)** + **collector repair**.

### Pitfall 4: Wall-clock leakage into the engine

**What goes wrong.** One `setTimeout` or one `Date.now()` inside the engine, and the whole
determinism story collapses: tests become flaky, pause stops being exact, and the same command
schedule can produce different fills at different playback speeds.

The deterministic-simulation literature is unambiguous: `now()` must never advance on its own, and
"nothing in the code under test can sneak in real wall-clock behavior through the back door". The
matchbook design states the same invariant from the other direction — the timestamp "only records
when an event happened; matching never reads it".

**Prevention.** The engine receives time; it never asks. Add a guard test scanning
`src/lib/orderSimulator/**` for `Date.now|performance.now|setTimeout|setInterval|Math.random`.
Phase: **engine (Task 2)**.

### Pitfall 5: Evaluating only the frame's final quote

**What goes wrong.** A price crosses a trigger and returns *within one rendered frame*. Final-tick-only
logic never sees the crossing, so the stop silently never fires — at high playback speeds, exactly
when the user is watching.

**This repo has already been bitten twice.** `seek-forward-play-stall` (resolved) and
`seek-while-playing-freeze` (cause C: work proportional to ticks × *future* ticks, 4.5–8.2 s stalls)
were both about per-tick work along a jumped path. The freeze fix introduced `seekEpoch`, and note
that `seekEpoch` **also changes for ordinary steps** — so treating every `seekEpoch` change as
"reset the engine" would discard state on a normal forward step.

**Prevention.** Feed the engine every crossed tick with a typed movement reason
(`PLAY`, `FORWARD_STEP`, `SEEK_FORWARD`, `SEEK_BACKWARD`, `SESSION_RESET`, `BUFFER_REPLACED`). A
required test: price exceeds a threshold and returns inside one frame — must trigger. Phase:
**integration (Task 3)**.

### Pitfall 6: Non-idempotent notices and remounts

**What goes wrong.** A fill notice is applied twice (React Strict Mode remount, duplicate notice,
double-click on Close, chart remount) → two positions, or realised PnL counted twice, or a position
closed twice.

**Prevention.** All economic mutation happens once, in the engine. Notices carry idempotency keys.
Selectors and render effects are read-only. Tests: Close pressed twice; notice delivered twice;
chart remounted. Phase: **account replacement (Task 4)**.

### Pitfall 7: Violating the trigger latch

**What goes wrong.** A stop triggers, the market ticks back, and the engine "un-triggers" it. Or a
TP becomes merely *eligible*, and the engine disables the SL while waiting for the TP's
execution-time price check — removing protection that should still be live.

Retail platforms are explicit that a trigger is consumed: "After the MIT order is triggered, whether
it is filled or not, the trigger conditions will not be effective again."

**Prevention.** The trigger is **latched**; the resulting market execution can fill above or below
the stop level. A latched SL or an accepted manual close *reserves* the close; competing exits for
that size are invalidated. A TP commits atomically only when its price-constrained execution
succeeds. Phase: **engine (Task 2)**, verified in the race suite.

### Pitfall 8: Identity by buffer index

**What goes wrong.** Quote identity is taken from an array position. When the buffer is prepended or
merged (an existing app behaviour), indices shift and deduplication fails → duplicate economics.

**Prevention.** Never key economics on array index. Preserve source order for equal-time quotes and
expose the backend's stable sequence if needed. Phase: **integration (Task 3)**.

---

## Technical Debt Patterns

| Shortcut | Immediate benefit | Long-term cost | Acceptable when |
|---|---|---|---|
| Reusing `ActiveTrade` render types | No type churn | Ambiguous identity; no symbol/ID on a trade | Only as a temporary adapter, clearly marked |
| Fixed profiles instead of a fitted model | Honest and testable | Less "realistic" feel | **Always**, this milestone — better honest labels than invented distributions |
| Full fills only | Simple, testable boundaries | No queue position or partials | Stated limitation, surfaced in settings |
| Retaining the legacy instant-fill path behind a flag | Old tests stay green | Two sources of economic truth | Never — the plan requires replacing incorrect tests, not preserving them |

---

## Integration Gotchas

| Integration point | Gotcha | Correct handling |
|---|---|---|
| `usePlaybackStore` | Processes many ticks/frame but publishes only the latest snapshot per symbol | Supply every crossed tick + a typed movement reason |
| `seekEpoch` | Bumps for steps *and* seeks | Do not reset on change; execute the crossed path |
| `useChartData` / `useChartLifecycle` | Playback path deliberately skips React state for performance | Keep the snapshot/rebuild optimization; do not make chart rendering replay every tick |
| `usePortfolio` | Today adds PnL supplied per chart ID | Select unique account entities so duplicate charts cannot double-count |
| Session/date/reset paths | Several code paths move the cursor | Route intentional resets through one explicit lifecycle; a session reset starts a new simulation ID and **fabricates no closing fills** |
| Timeframe/symbol change | Looks like a lifecycle event | It is a *view* change — must not reset or relabel existing exposure |
| Missing bid/ask | Existing code synthesises ±0.01 spread | Realistic mode must refuse and explain; never invent a price |
| Currency | PnL across instruments | Reject implicit currency mixing rather than summing arbitrary instruments |

---

## Performance Traps

| Trap | Symptom | Prevention |
|---|---|---|
| Per-tick React updates on large seek | Main-thread stall (this repo's known freeze) | Compute transitions with no per-tick React updates; publish one projection |
| Re-simulating from session start on every seek | Slow seeks on long sessions | Checkpoint + command-log prefix |
| Evaluating quotes for symbols with no exposure | Wasted work on wide layouts | Skip unexposed symbols; **do not** skip hidden-but-exposed ones |
| Unbounded per-frame catch-up | Frame gap grows with speed | Existing dense-tape perf tests are the gate; add engine batch checks |

---

## UX Pitfalls

| Pitfall | Better approach |
|---|---|
| Hiding a fill because Cancel was pressed | Acknowledge the lost race plainly: "the stop triggered before the cancellation arrived" |
| Showing a position immediately on submit | Only confirmed simulated fills create displayed positions |
| Animating a delay without changing the outcome | The delay must change fill prices or race outcomes — that is the milestone's headline property |
| Announcing every tick to screen readers | A live region for meaningful transitions only |
| Enabling ±1% SL/TP by default | Default attachments **off**; let the user opt in and see the real order roles |
| "Price stayed the same, so no loss" | Retain baseline spread cost so the round trip can still show a loss |

---

## "Looks Done But Isn't" Checklist

- [ ] Buy/sell **stops** verified at equality and crossing on the correct quote side (P1)
- [ ] A price excursion that crosses and returns **inside one frame** still triggers (P5)
- [ ] Cancel sent *before* trigger cancels; cancel sent *after* trigger is rejected and the fill survives (P7)
- [ ] SL and TP cannot both close the same size; a triggered stop cannot be un-triggered
- [ ] Same command schedule yields identical fills/PnL at 1×, 10×, and large batches (P4)
- [ ] Backward seek discards future actions and notifies once; no ghost position, no future PnL
- [ ] Two charts of one symbol show one order/position set and one portfolio total (P6)
- [ ] Missing/stale quotes produce an explicit wait/rejection reason — no candle-derived or cross-symbol fill
- [ ] Editing latency settings mid-session does not retroactively change scheduled/completed orders
- [ ] No broker transport, no credentials, and the observer is never executed

---

## Recovery Strategies

| Pitfall | Recovery cost | Recovery steps |
|---|---|---|
| P1 trigger inversion | HIGH | Rewrite the rules table; re-run the equality/crossing suite; audit every already-written condition |
| P2 mislabelled latency | MEDIUM | Re-derive provenance from raw bundles; the raw artifacts are intentionally preserved and must not be rewritten |
| P3 identity conflation | MEDIUM | Introduce distinct ID types; add a linkage test per lifecycle |
| P4 wall-clock leak | LOW–HIGH | Guard test catches it at review; if it leaked into shipped scheduling, re-baseline determinism tests |
| P5 missed crossing | LOW | Interval processor + one failing-first test |
| P6 double-apply | LOW | Idempotency keys + one remount test |

---

## Pitfall-to-Phase Mapping

| Phase (this milestone) | Pitfalls to address |
|---|---|
| Task 1 — Evidence audit & fixtures | P2, P3 (evidence side) |
| Task 1b — Collector repair | P3 |
| Task 2 — Pure engine, scheduler, profiles | P1, P4, P7, P2 (provenance) |
| Task 3 — Replay/session integration | P5, P8, P5-related `seekEpoch` handling |
| Task 4 — Account replacement / selectors | P6, integration gotchas |
| Task 5 — Ticket, panels, timeline, settings | P2 (UI copy), UX pitfalls |
| Task 6 — Regression verification | All — the checklist above is the gate |

---

## Sources

- Trigger inversion in a real engine: https://github.com/nautechsystems/nautilus_trader/issues/5079
- Stop orders dormant until triggered; trigger checked when a trade prints: https://dev.to/iwtxokhtd83/adding-ioc-fok-and-stop-orders-to-a-matching-engine-na1
- Trigger latch / not re-armed: https://www.futuhk.com/en/support/topic2_354 , https://www.webull.hk/en/help/faq/1695-Market-if-Touched-order
- MIT vs stop placement and purpose: https://www.investopedia.com.cach3.com/terms/m/marketiftouched.asp.html , https://www.tradovate.com
- Determinism and wall-clock independence: https://www.thegreenreport.blog/articles/deterministic-simulation-testing-a-practical-guide-for-qa-engineers/deterministic-simulation-testing-a-practical-guide-for-qa-engineers.html , https://github.com/golgimed/mimic/issues/27
- Forcing a race deterministically: https://adhdecode.com/distributed-systems/testing-distributed-systems/deterministic-simulation/
- Repo-internal: `docs/research/capital-order-simulator-implementation-plan.md` §1 (evidence corrections), §5 (clock/replay), §6 (quote rules), §10 (required behaviours), §12 (collector repairs); `.planning/debug/resolved/seek-forward-play-stall.md`; `.planning/debug/resolved/seek-while-playing-freeze.md`
