# Capital.com Demo Pilot — Derived Evidence Audit

Prepared: 2026-10-12, Asia/Bahrain.
Status: **derived analysis.** This document is generated from the saved bundles by
`tools/research/analyze-capital-demo-observations.mjs` and is the authoritative summary for
simulator work.

**It supersedes Section 9's numerical model in
[`capital-demo-order-observations.md`](./capital-demo-order-observations.md) and any calibration
value derived from it.** It does **not** supersede that document's narrative, and it does not
modify it — the original report and all raw bundles are preserved unchanged, as required.

Reproduce everything below with:

```bash
node tools/research/analyze-capital-demo-observations.mjs            # human-readable report
node tools/research/analyze-capital-demo-observations.mjs --check    # assert the claims in this document
node tools/research/analyze-capital-demo-observations.mjs --write-fixtures
```

All **19** claim checks pass. No network call is made; the script reads only files under
`docs/research/capital-demo-order-data/`.

---

## 0. Provenance of the eleven bundle directories

`docs/research/capital-demo-order-data/` contains **eleven** directories, and they are not all the
same kind of thing. Being precise about which is which matters, because six of them are evidence and
five are byproducts of testing.

| Directories | Count | What they are |
|---|---|---|
| `2026-10-11T11-00-50`, `11-00-58`, `11-01-06`, `11-02-15`, `11-03-46`, `11-05-33` | 6 | **The pilot runs.** Collected by the observer against the demo account. These are the evidence this audit is derived from. Byte-identical to their state in commit `b5aaa21`. |
| `2026-10-11T23-42-28`, `23-42-34`, `23-42-52`, `23-42-57` (4) and `2026-10-12T01-00-22` (1) | 5 | **Test byproducts, not observations.** Each was written when `tools/research/test-observer-repairs.mjs` spawned the observer with `--calibrate` to pin a repair. Each contains exactly one event: a `GET /api/v1/time` clock probe that failed. |

### What the five byproducts prove, and what they do not

Each of the five contains a single `REST_REQUEST` event with `status: null`, a 0-byte body and
`error_message: "fetch failed"`, recorded 68 ms after dispatch, plus an empty `quotes.jsonl` and an
empty `mutation-ledger.jsonl`. In other words:

- **No request completed.** No HTTP response was received, so nothing was read from the demo API.
- **Nothing was mutated.** The mutation ledger — the artifact that exists specifically to record
  orders, closes and cancellations — is empty in all five, and each has no quotes.
- **No credential was present.** The test spawns with a sanitised environment containing no Capital
  variables, and `--calibrate` never calls `authenticate()`.

They are nevertheless a real defect in this project's history, and are recorded as one: the suite's
header claimed it "NEVER contacts the network" while one of its groups was issuing network requests.
The observer now has an explicit offline switch (`CAPITAL_DEMO_OFFLINE=1`) that makes the transport
throw at the last moment before a socket is opened, the suite spawns only with that switch set and
only in a throwaway working directory, and a new test fails if a probe run ever leaves a bundle
behind again. See `tools/research/test-observer-repairs.mjs` groups 1b and 1c.

**No existing artifact was modified to produce this section.** The six pilot bundles and the original
report remain byte-identical.

---

## 1. What the script verifies

| # | Claim | Result |
|---|---|---|
| 1 | MARKET POST response envelope = 231.499 ms | PASS |
| 2 | LIMIT POST response envelope = 203.837 ms | PASS |
| 3 | STOP POST response envelope = 204.384 ms | PASS |
| 4 | Submission `dealId` differs from the affected (position) `dealId` | PASS |
| 5 | The failed market close targeted the **submission** id, not the position id | PASS |
| 6 | That close returned `404 error.not-found.dealId` | PASS |
| 7 | The limit deletion succeeded (HTTP 200) | PASS |
| 8 | The stop cancellation returned 404 (working order already consumed) | PASS |
| 9 | The stop produced a position distinct from its working order | PASS |
| 10 | The stop position's `workingOrderId` is the stop submission id | PASS |
| 11 | Mixed-clock subtraction reproduces 209 ms | PASS |
| 12 | Server-domain subtraction reproduces 52 ms | PASS |
| 13 | The mixed-clock metric is labelled **not** a latency | PASS |
| 14 | The observation metric is labelled **not** a latency | PASS |
| 15 | The primary run left positions open | PASS |
| 16 | The manifest contradicted the observed end state | PASS |
| 17 | Cleanup succeeded only in a later run | PASS |
| 18 | No confirmation-stream frames were captured | PASS |
| 19 | `orders.csv` still marks the stop `UNTRIGGERED_RESTING` | PASS |

---

## 2. The three observed lifecycles

`dealId` values are shortened to their distinguishing UUID segment — every id in these bundles ends
in `…c3980055311e`, so a trailing-character suffix is meaningless as a label.

| Lifecycle | POST envelope | Submission id | Position id | Terminating instruction |
|---|---|---|---|---|
| MARKET BUY 0.0001 BTCUSD | **231.499 ms** | `…7ecc` | `…7ecf` | DELETE `/positions/…7ecc` → **404** |
| LIMIT BUY 0.0001 @ 82944.45 | **203.837 ms** | `…7eeb` | *none* | DELETE `/workingorders/…7eeb` → 200 |
| STOP BUY 0.0001 @ 82948.10 | **204.384 ms** | `…802d` | `…8037` | DELETE `/workingorders/…802d` → **404** |

**Three response envelopes are all that was measured.** One sample per order type, all BUY, on a
weekend demo account. This establishes no variance, no SELL behaviour, and no live behaviour. The
fixture records `sample_count: 1` for each.

### What each row proves

- **Identity is split.** For the MARKET entry, the confirmation's `dealId` (`…7ecc`) and the
  `affectedDeals[].dealId` (`…7ecf`) are *different values*. Orders and positions are separate
  entities. The stop shows the same split: working order `…802d`, position `…8037`.
- **Cleanup failed on identity.** The market close was sent to `/positions/…7ecc` — the *submission*
  id — and returned `error.not-found.dealId`. The correct target was the position `…7ecf`.
- **A triggered stop consumes its working order.** The cancellation of `/workingorders/…802d`
  returned 404 because `…802d` had already triggered and become position `…8037`. Cancelling a
  consumed working order cannot undo the execution.
- **One limit lifecycle, no limit fill.** The only limit order placed never filled; it was deleted
  while resting. No limit execution behaviour was observed at all.

---

## 3. Timing corrections

### 3.1 The 209 ms figure is a mixed-clock subtraction

| Quantity | Value |
|---|---|
| First eligible stop quote — **local** receipt | `11:02:44.695Z` |
| Same quote — **server** timestamp | `1791716564852` = `11:02:44.852Z` |
| Stop position — server `createdDateUTC` | `11:02:44.904Z` |
| **Mixed-clock subtraction** (server creation − local receipt) | **209 ms** |
| **Server-domain subtraction** (server creation − server quote) | **52 ms** |

The 209 ms value crosses clock domains whose offset was never validated. The collector's own
`calibrateClock()` is itself suspect (see §6), so neither 209 nor 52 ms is a verified internal
execution latency. Both are retained as raw fields; **neither is a calibration input.**

### 3.2 The 2499 ms figure is not submit-to-fill time

The collector stopped observing pending state for roughly 10 seconds and then attempted
cancellation. The first position snapshot containing the stop position arrived **14272.685 ms after
the stop POST dispatch**, measured on the local monotonic clock. That is a delayed-observation
interval, not the broker's execution duration.

`orders.csv` still records this stop as `UNTRIGGERED_RESTING` with no fill price — contradicting the
later narrative that it triggered and filled. The bundle's own `final-state.json`, however, does
show the resulting position (`…8037`, level 82948.10, created `11:02:44.904Z`). The CSV and the final
state disagree; the final state is the stronger evidence, and the CSV was never back-filled from
actual outcomes. That is exactly the collector defect repaired in
`tools/research/capital-demo-order-observations.md` §12 and in the collector itself.

### 3.3 The 816.5 ms figure is fill *observation* time

`pollConfirm()` waits 400 ms before its first query, and the confirmation GET then adds its own
response time. The 816.5 ms recorded against the market order therefore describes how long the
*collector* took to learn the outcome. It is not a broker fill delay.

### 3.4 The quote tape

| Statistic | Value |
|---|---|
| Quotes captured (BTCUSD) | 46 |
| Receive-gap min / median / max | **48.965 / 200.213 / 5959.886 ms** |
| Spread min / max / mode | 50.00 / 50.00 / 50.00 |
| Observed price-step candidate | 0.05 |

Quotes did **not** arrive at a uniform 100–300 ms cadence; the observed range spans roughly 49 ms to
5.96 s. The 50.00 spread and 0.05 step are BTCUSD-pilot context **only** and must never be applied
to another instrument.

---

## 4. Cleanup reconciliation

The primary run did not clean itself up.

- It issued **two** cleanup instructions, both of which failed: the market close (wrong id, 404) and
  the stop cancellation (consumed working order, 404).
- `final-state.json` at `11:02:56.958Z` still lists **two open positions**: `…7ecf` (level 82946.85,
  created `11:02:26.040`) and `…8037` (level 82948.10, created `11:02:44.904`).
- `manifest.json` nevertheless declares `unresolved_positions: []` and
  `unresolved_working_orders: []`. **The manifest's claim is contradicted by the data it was
  written alongside.** The collector removes owned ids from its tracking sets without checking
  whether the cleanup actually succeeded, and prints an unconditional success message.
- Cleanup genuinely completed later, in `2026-10-11T11-03-46-166Z`: both positions were closed by
  their **position** ids (`…7ecf`, `…8037`), each returning `status: CLOSED` /
  `dealStatus: ACCEPTED`, followed by empty `positions` and `workingOrders` lists at
  `11:03:48.937Z` / `11:03:49.208Z`. `2026-10-11T11-05-33-514Z` repeats the empty-state observation.

This sequence is retained as evidence rather than tidied up. It is the primary behavioural precedent
for the simulator's identity separation and for gating success on observed final state.

---

## 5. No confirmation stream was captured

Every captured event is a `REST_REQUEST`. The collector sends `confirms.subscribe` but drops
non-quote/non-confirmation messages, including subscription errors, so the capture contains **no**
confirmation-stream frames. Real-time fill notification was therefore never verified; fills were
learned by polling. The simulator must not present streaming notifications as observed behaviour.

---

## 6. Metrics that do not exist

These are recorded as `UNAVAILABLE` in the fixtures so no downstream consumer can mistake them for
measurements.

| Metric | Why unavailable |
|---|---|
| Execution dispatch delay | No one-way or dispatch-aligned measurement exists |
| Fill notification delay | No confirmation stream was captured; fills were polled |
| Acceptance / processing time | A POST response envelope cannot be split into transit / processing / return |
| Latency distribution | One sample per order type, all BUY, weekend demo |
| Limit fill behaviour | The only limit placed never filled; it was deleted while resting |
| SELL-side behaviour | All three observed entries were BUY |
| Real-time fill notifications | No confirmation frames captured (§5) |

The collector's `calibrateClock()` is additionally not a valid calibration source: it captures its
wall-clock send time *before* the client's rate-limit wait, while the reported RTT begins *after*
that wait. Those are different intervals, so the published midpoint offset and uncertainty do not
describe the probe that was supposedly measured. This is recorded as a defect to repair, not as a
number to reuse.

---

## 7. What the simulator may and may not take from this

**May take:**

- Three POST response envelopes as *reference samples*, with `sample_count: 1` and a BUY-only label.
- The lifecycle shapes: market fills immediately; a resting limit may stay unfilled; a stop becomes a
  working order, triggers, and produces a distinct position.
- The identity model: submission ≠ order ≠ position, and closes target positions.
- BTCUSD-specific context: 0.05 step, 50.00 spread, 0.0001 size increment.
- The failure precedents: consumed working orders cannot be cancelled; cleanup must be judged by
  observed final state.

**May not take:**

- 209 ms, 52 ms, or 2499 ms as any kind of execution latency.
- 816.5 ms as a fill delay.
- Any fitted distribution, including the previously proposed `Normal(210 ms, 20 ms)`.
- The 50.00 spread or 0.05 step as defaults for other instruments.
- Any claim that fill notifications were observed in real time.

Everything the simulator does with latency beyond the three reference envelopes is a **labelled
training assumption**, never a measurement. See `.planning/research/STACK.md` and
`.planning/research/PITFALLS.md` (Pitfall 2) for how this is enforced in the engine and the UI.
