# The Simulated Order Terminal — Handover

This document explains what the simulated trading terminal in this repository is, what it is
**not**, where every number in it comes from, and how a later data-collection stage can replace the
invented ones with measurements.

It complements `docs/research/capital-order-simulator-implementation-plan.md` (the design),
`docs/research/capital-demo-pilot-evidence-audit.md` (what the demo pilot actually proved) and
`.planning/phases/4x-*/4x-VERIFICATION.md` (what each phase's tests prove).

---

## 1. What this is

A **teaching tool**. It replays recorded market data and lets you place orders against it, so you can
see delay, pending state, and lost races happen. It deliberately does not contact a broker: there is
no transport, no credential, and no configuration that would let it reach one. The ticket, the
activity list, the timeline and the settings panel all exist to make the *invisible* parts of an
order's life visible:

- the gap between pressing a button and the broker knowing about it;
- the difference between waiting for the market and waiting for the broker;
- what happens when a cancellation and a trigger race, and who wins.

**It is not a replica of any broker.** Prices come from recorded ticks, fills happen against the last
quote the engine can see, and no slippage model is fitted because none was measured.

---

## 2. What is measured, what is chosen

Every latency value in the terminal carries a provenance label. The two labels mean different things,
and the UI keeps them apart on purpose.

| Provenance | Meaning | Where it appears |
|---|---|---|
| `OBSERVED_SAMPLE` | One real observation from the demo pilot. A single data point, **not** a distribution. | The three POST response envelopes (231.5 ms MARKET, 203.8 ms LIMIT, 204.4 ms STOP), shown as read-only evidence cards, and the instrument rules (tick 0.05, size increment 0.0001) |
| `TRAINING_ASSUMPTION` | A plausible, editable placeholder chosen so the simulation can run. Not measured. | Everything else: travel, acceptance, dispatch, notification, quote freshness |

### Why the observed numbers are so thin

The pilot captured **three** demo POST responses and 46 quotes from a single weekend session. It
measured no one-way delay, no broker processing time, no dispatch time, and no confirmation timing
(the confirmation stream produced zero frames). Three samples cannot establish a variance, so no
latency distribution is presented as if it were measured. Three numbers that frequently appear in
notes about this data are specifically **not** usable, and the reason is recorded here so nobody
re-derives them later:

- **209 ms** — a subtraction across two different clock domains. The difference of two clocks is not
  a duration.
- **2499 ms** — the gap between two observations, not a latency.
- **816.5 ms** — includes a 400 ms polling wait, so it is mostly the observer's own sleep.

### The defaults

| Setting | Default | Provenance |
|---|---|---|
| Instruction travel | 100 ms | `TRAINING_ASSUMPTION` |
| Broker acceptance | 0 ms | `TRAINING_ASSUMPTION` |
| Acknowledgement envelope | 210 ms | `TRAINING_ASSUMPTION` (chosen in the region of the three observed POST responses) |
| Execution dispatch | 50 ms | `TRAINING_ASSUMPTION` |
| Fill notification | 100 ms | `TRAINING_ASSUMPTION` |
| Quote freshness limit | 2000 ms | `TRAINING_ASSUMPTION` |

Selecting the **pilot reference envelope** profile replaces the acknowledgement value with a real
observed sample (and marks it read-only), leaving the rest as assumptions. That mixture is the honest
state of knowledge: one measured envelope surrounded by chosen values.

---

## 3. How an order lives

```
submit ──travel──▶ broker arrival ──acceptance──▶ accepted
                                                      │
                                              dispatch (★)
                                                      │
                                              eligible ──▶ (limit/stop) condition met ──▶ executed
                                                                                             │
                                                                                     notification (client hears)
```

- **An order is never filled because it was submitted.** The client accepts a *command*; the broker
  decides what happens to the *order*. A position appears only after a fill is confirmed.
- **A pending order says exactly what it is waiting for** ("Waiting for ask <= 80.00 (now 100.45)").
  The sentence is generated from the same trigger matrix the engine evaluates, so the two cannot
  drift apart.
- **Stops and limits wait on specific sides.** A buy limit waits for the **ask**; a sell limit waits
  for the **bid**; a buy stop waits for the **ask**; a sell stop waits for the **bid**. Equality
  counts. This matters because the naive inverse (checking the same side for a stop as for a
  touch-triggered order) is a real, documented bug in other engines.
- **Once a stop triggers, it stays triggered.** The condition is not re-evaluated, so a price that
  returns cannot un-trigger it; the fill uses the quote that satisfied it.
- **A price gap is not a fill at the level.** If the market jumps past a stop, the fill is the next
  quote that actually exists, and the difference from the stop level is reported rather than hidden.

### ⚠️ Where `dispatch (★)` sits

In the real world the split between "the broker accepted it" and "the exchange can execute it" is
**unknown**: the pilot never measured it. This simulator places the order in the "eligible" state at
the end of the dispatch delay and only evaluates quotes from that moment. A price that crossed the
level *before* the order was eligible is therefore not treated as a trigger.

That is a choice, and it is stated rather than hidden: it is the behaviour that avoids filling
against a price that no longer exists. Both readings are pinned by tests in
`tests/regression/behaviouralMatrix.test.ts` (§10.6).

---

## 4. Independent positions, not netting

The account holds **independent positions**. Consequences you will see immediately:

- Buying twice gives you **two** positions, each with its own entry price. They are not averaged.
- Selling while long does **not** reduce or flip the long position; it opens a separate short.
- Each position has its own PnL; the account total is the sum over positions, counted **once each**.
- Closes are addressed **by position id**. Closing "the position" is always a specific position.

Netting was considered and deliberately excluded: the rules for how a broker would net, offset, or
flip were never specified or observed, so implementing one would be inventing policy.

**Protection is opt-in.** A plain entry has no stop and no take profit until you ask for one, either
on the ticket or afterwards. Default exits were removed because an entry that silently acquires a
stop teaches the wrong thing about what the user asked for.

### One close, once

A position can be closed only once. A manual close reserves the position immediately: any competing
exit (a stop, a take profit, or a second close request) is invalidated or refused rather than sharing
the size. Pressing close twice cannot double-count a realized PnL, and remounting a chart cannot
either — charts are views onto the account, not owners of it.

### Three different delays

The timeline reports them separately, because conflating them is the mistake this tool exists to
prevent:

| Interval | From | To | What it means |
|---|---|---|---|
| Market waiting | eligible | condition met | the market had not reached your price yet |
| Execution delay | condition met (or eligibility, for a market order) | fill | the broker's own execution step |
| Notification delay | fill | client learns | how long after the economics you were told |

A stop that waited 4.85 s for the market and then filled instantly has a 4.85 s **market waiting**
time and a 0 ms **execution delay** — not two 4.85 s numbers under different names.

---

## 5. Pause, step, seek, rewind

The playhead is the account's clock. Nothing happens until time moves.

- **Paused / in-flight**: submitting while paused creates an instruction and no position. No economic
  time passes until you play or step, so nothing fills behind your back.
- **Play, step, seek forward**: all three produce the *same* account result for the same tape and the
  same command schedule. Batching is invisible to the engine: one 60-second frame and sixty
  one-second frames deliver the identical quote sequence. Dividing a run into different frame sizes
  does not change any fill, price or PnL.
- **Rewind (backward seek)**: commands issued *after* the rewind point are discarded — they are
  future instructions in the new branch, and the log says how many were dropped. Commands before the
  point replay from the tape. A rewind can therefore remove a position that existed a moment ago;
  that is correct, and it is why rewinding mid-trade is disclosed rather than silent.
- **Reset**: ends the session and drops any open positions and live instructions **without inventing
  a closing fill**, so no realized PnL appears from nowhere. The notice says how many were dropped.
- **A stalled account says so.** If a symbol with a live instruction has no market data, or its data
  has run out, playback freezes and the desk displays why. It never invents a price to keep an order
  moving. Instructions simply stay pending until data exists.

---

## 6. Data requirements

- **A tape per symbol you intend to trade.** Quotes are identified by `(symbol, seq)`, never by
  position in an array, so merging pages cannot create duplicate economics.
- **Monotonic, non-decreasing replay time per symbol.** A quote older than the playhead is recorded
  as a late-tape notice and ignored; history is never replayed as live.
- **Delivery is tracked per symbol, and a tape is read when it arrives.** Quotes reach the engine
  through movement, so a tape that turns up while the playhead stands still — the ordinary case, since
  the replay starts paused and ticks load asynchronously — is read by `refreshFromTape()` at the
  instant the session is already at; no clock moves and no history is replayed. Each tape has its own
  delivery cursor, so one instrument's progress never gates another's data: a single shared cursor once
  swallowed the opening quote of every tape registered after the first, leaving the ticket unpriced and
  an accepted order waiting on a clock that could not move. The cursor also advances past quotes
  refused as history, so a late tape page is scanned once, not on every later advance.
- **Two-sided quotes.** Where only a single price is recorded, the bridge derives a bid/ask using the
  instrument's tick size and marks the quote `derived: true`. The spread you see from such data is an
  artifact of the instrument's tick size, not an observation.
- **One symbol = one set of instrument rules.** An instrument with no configured rules is refused
  rather than approximated with another symbol's tick size or step.
- **The account follows the playhead, and that is a wire, not a property of the engine.** The account
  store and the playback store are separate; `useAccountPlaybackSync` (mounted once in `App`) is what
  moves the account's clock, through the store's `syncFromPlayback`. Without it the engine is correct
  and completely inert: orders are accepted and never fill, the ticket has no quote, no badge appears.
  The unit suite cannot catch its absence, because unit tests advance the engine themselves —
  `tests/integration/accountPlaybackSync.test.tsx` is the test that does.
- **`TRADEABLE_INSTRUMENTS` is the single source of truth** for what the account can trade: the ticket,
  the activity panel, the chart controls and the account store all read it, so they cannot disagree.
  BTCUSD's rules are `OBSERVED_SAMPLE` (the pilot measured it). The equity set — SPY, QQQ, AAPL, MSFT,
  AMD, NVDA, TSLA, GOOGL, AMZN, MU — carries `TRAINING_ASSUMPTION` rules (whole-cent tick,
  whole-share size) and the desk says so on the ticket, because the pilot measured none of them.
  A symbol outside the set is refused in plain language, both on the ticket and on the chart controls.
- **Currency**: all values are single-currency. Instruments quoting in another currency are not
  converted; there is no FX model here.

---

## 7. Correcting my own numbers

Two defects were found by the phase-48 verification matrix and fixed rather than documented away:

1. **A quote from the future could rewrite the past.** The engine's clock is a high-water mark, so a
   quote delivered ahead of the scheduler advanced it — and an instruction that had not yet arrived
   was then judged against that price. A validly placed stop could be refused for being on the wrong
   side of a price that had not happened yet. The broker now re-validates against the quote **as of
   the moment it processes the instruction** (falling back to the quote the order recorded when it
   was placed), and the arrival schedules acceptance from its own due time. See `engine.ts` and the
   regression tests in `engine.test.ts`.
2. **Two fill fields were silently in ticks.** `priceChangeFromSubmit` and `stopToFillDifference`
   carry tick counts, not currency, but were documented as prices. They are now named
   `…Ticks`, so a reader cannot mistake 100 ticks for 100 dollars.

---

## 8. How Stage 2 can calibrate this

The Stage 2 data collector exists in `tools/research/capital-demo-order-observer.mjs` and is
**repaired but deliberately never executed** in this repository — its CLI defaults to `--pilot`,
which sends real trading mutations. Any calibration requires a human decision to run it, with
credentials, against a demo account.

To turn the current assumptions into measurements, Stage 2 needs to capture:

1. **One-way travel time.** Client send → broker acknowledgement of *arrival*, not of *acceptance*.
   The pilot could not separate these; it needs a request id echoed back by the broker.
2. **Broker processing time.** Arrival → working/accepted, from the confirmation stream (the pilot
   captured zero frames, so this needs a working subscription and a recorded subscription result).
3. **Dispatch delay.** Accepted → eligible, which requires an order state transition the API exposes.
4. **Fill notification delay.** Economics → the client's receipt, both timestamps recorded rather
   than inferred. Today's 100 ms is a guess and the timeline labels it as one.
5. **A distribution, not samples.** Repeated orders of the same type and side, so the profile can
   carry a median and a spread instead of a single number. Until then, one sample is one sample, and
   the UI says so.
6. **Evidence hygiene.** Persist actual outcomes to CSV, capture non-2xx responses, reconcile
   consumed working orders and clean up by affected position id (the pilot's cleanup 404'd because it
   used the wrong identifier), and gate any success message on observed final state rather than on a
   sequence of requests having been sent.

Raw artifacts under `docs/research/` are immutable: corrections live in derived documents and derived
fixtures, never by rewriting what was recorded. (One nuance worth knowing: the evidence directory
contains eleven bundle directories, six of which are pilot runs and five of which are
clock-probe-only byproducts of the collector's own test suite. §0 of the audit document catalogues
them.)

### Running the collector safely

`tools/research/capital-demo-order-observer.mjs` sends real trading mutations when run as `--pilot`.
Two controls exist so that testing the collector never becomes trading with it:

- **`CAPITAL_DEMO_OFFLINE=1`** makes the transport throw at the last moment before a socket is opened.
  `tools/research/test-observer-repairs.mjs` always sets it and always spawns from a throwaway working
  directory, so not even a bundle can be written into the repository.
- **The demo guard** (`tools/research/demo-guard.mjs`) rejects non-demo URLs and records every
  intended mutation to a ledger before it is attempted.

Run the collector's tests with `node tools/research/test-observer-repairs.mjs` (42 checks) and
`node tools/research/test-demo-guard.mjs` (16 checks); neither needs credentials and neither should
be given any.

---

## 9. Running it

```bash
npm install
npm run dev            # the replay terminal; open the "Trade desk" button
npm test               # the full Vitest suite
npm run build          # production build
npm run test:journey   # Playwright journey specs (needs a browser binary)
```

Tests that matter most for this feature:

| File | What it protects |
|---|---|
| `tests/regression/behaviouralMatrix.test.ts` | The §10 scenario matrix from the implementation plan |
| `tests/performance/replaySeek.perf.test.ts` | Dense replay and seek: no freeze, no dropped or duplicated fills |
| `tests/unit/orderSimulator/engine.test.ts` | Trigger sides, equality, latching, clock discipline |
| `tests/unit/orderSimulator/replay.test.ts` | Tape delivery: a per-symbol cursor, late history refused rather than replayed, seek and rebranch |
| `tests/unit/orderSimulator/protectiveGroup.test.ts` | One close, ever |
| `tests/integration/sharedAccountCharts.test.tsx` | Two charts, one account, no double counting |
| `tests/integration/tradeDeskUi.test.tsx` | What the terminal tells the user, and what it refuses to claim |
| `tests/verification/independentProbes.test.ts` | Eight probes whose expected values are derived by hand from the documented rules, plus a timezone-independent determinism digest — written to be re-run by an external verifier |

An external verifier brief lives at [`VERIFY-V6.0.md`](../VERIFY-V6.0.md): it re-runs the suite, the
probes, the offline tooling and the build, and deliberately breaks six engine behaviours to check that
the tests actually catch them.
