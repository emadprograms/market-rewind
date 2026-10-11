# Capital.com Demo Order Observation Report

Prepared: 2026-10-11, Asia/Bahrain (Sunday).  
Author / Collector: Antigravity Agent.  
Status: **Stage 1 Pilot Completed & Reconciled; Handover Documented for Incoming Agent.**  
Plan Reference: [`capital-demo-order-observation-plan.md`](file:///Users/emadarshadalam/Documents/GitHub/market-rewind/docs/research/capital-demo-order-observation-plan.md)  
Raw Data Directory: [`docs/research/capital-demo-order-data/2026-10-11T11-02-15-686Z/`](file:///Users/emadarshadalam/Documents/GitHub/market-rewind/docs/research/capital-demo-order-data/2026-10-11T11-02-15-686Z/)

---

## Executive Summary & Outcome

This report records direct, evidence-backed observations from the Capital.com **DEMO** API. All requests were strictly locked to the demo REST host `https://demo-api-capital.backend-capital.com` and streaming endpoint `wss://api-streaming-capital.backend-capital.com/connect`, verified by 16 offline transport-isolation and redaction tests before network execution.

### Outcome Summary
- **Overall Run Outcome:** **COMPLETED** (Stage 1 Pilot).
- **Demo Isolation:** Proved fail-closed transport; offline tests 16/16 pass; zero live requests sent.
- **Collection Timestamp:** 2026-10-11 11:02:15 UTC to 11:03:48 UTC.
- **Account State:** Clean baseline (0 positions, 0 working orders); Clean final state (0 positions, 0 working orders).
- **Mutations & Cleanup:** All created orders and positions were owned, tracked in a durable append-only ledger, and cleanly closed/cancelled.

| Order Type | Attempts | Accepted | Confirmed Fills | Resting / Cancelled | Rejected | Unresolved |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Market BUY** | 1 | 1 | 1 | 0 | 0 | 0 |
| **Resting Limit BUY** | 1 | 1 | 0 | 1 (Cancelled) | 0 | 0 |
| **Resting Stop BUY** | 1 | 1 | 1 | 0 (Triggered & Filled) | 0 | 0 |
| **Cleanup Closes** | 2 | 2 | 2 | 0 | 0 | 0 |
| **Total** | **5** | **5** | **4** | **1** | **0** | **0** |

---

## 1. Environment and Demo Verification

### 1.1 Host Verification & Isolation Proof
- **REST Origin:** `https://demo-api-capital.backend-capital.com` (hardcoded constant in collector).
- **Streaming Host:** `wss://api-streaming-capital.backend-capital.com/connect` (hardcoded constant in collector).
- **Transport Guard:** Enforced by [`tools/research/demo-guard.mjs`](file:///Users/emadarshadalam/Documents/GitHub/market-rewind/tools/research/demo-guard.mjs). Rejects lookalikes, live host `api-capital.backend-capital.com`, protocol-relative URLs (`//...`), plain HTTP, non-standard ports, userinfo, non-`/api/v1/` paths, and redirects (`redirect: 'error'`).
- **Offline Guard Test Suite:** [`tools/research/test-demo-guard.mjs`](file:///Users/emadarshadalam/Documents/GitHub/market-rewind/tools/research/test-demo-guard.mjs) passed 16/16 test assertions.
- **Durable Ledger:** Every intent was synchronously flushed to disk (`fs.fsyncSync`) prior to invoking network transport.

### 1.2 Account & Instrument Details
- **Account Alias:** `acc_demo_419aa2a2` (Pseudonymized deterministic SHA-256 hash).
- **Account Type:** CFD, Currency `USD`, Demo mode verified via fresh `/api/v1/session` POST.
- **Instrument Selected:** `BTCUSD` (Bitcoin / USD CFD).
  - *Context:* On Sunday (weekend), traditional equities and FX (`EURUSD`) are closed (`marketStatus: "CLOSED"`). Crypto CFDs (`BTCUSD`, `ETHUSD`, `SOLUSD`, `LTCUSD`) are active (`marketStatus: "TRADEABLE"`).
  - `minDealSize`: `0.0001`
  - `minSizeIncrement`: `0.0001`
  - `minStepDistance`: `0.05`
  - `decimalPlacesFactor`: `2`
  - `tickSize`: `0.05`
  - Typical Spread observed: ~50.00 USD (Bid ~82896.70, Ask ~82946.70).

### 1.3 System & Network Context
- **Runtime:** Node.js v25.6.1 on Darwin (macOS arm64).
- **Local Clock:** Monotonic elapsed time using `process.hrtime.bigint()` (sub-millisecond resolution) paired with ISO UTC wall-clock stamps.
- **REST Rate Limiter:** Minimum 260 ms between consecutive request dispatches (~3.8 req/sec max).
- **Persistent Connections:** HTTP/1.1 keep-alive used for warm connection pools.

### 1.4 Clock Calibration Baseline
Clock probes were sampled against `GET /api/v1/time` (10 probes pre-experiment, 10 probes post-experiment):

| Calibration Phase | Min RTT (ms) | Median RTT (ms) | Max RTT (ms) | Median Estimated Server Offset (ms) | Uncertainty ($\pm$ RTT/2) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Pre-run (10 probes)** | 123.34 | 126.22 | 421.81 (cold start) | +334.00 ms | $\pm$ 61.67 ms |
| **Post-run (10 probes)** | 124.04 | 126.48 | 127.31 | +332.00 ms | $\pm$ 63.24 ms |

*Interpretation:* The round-trip latency to Capital.com demo servers is consistently ~124–126 ms on warm connections. The server clock leads the local wall-clock by approximately 332–334 ms.

---

## 2. Documented Rules vs Observed Behaviour

| Rule / Feature | Documented Specification | Observed Empirical Behaviour | Supporting Evidence | Contradictions / Nuances | Confidence |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **Market Order Creation** | `POST /api/v1/positions` returns `dealReference`. Confirmation provides deal details. | Returns `dealReference`. Confirmation endpoint returns `status: "OPEN"`, `dealStatus: "ACCEPTED"`. | `PILOT-MKT-BUY` (dealRef `o_cd56844e...`) | **Critical discovery:** `confirm.dealId` is the submission deal ID (`00000000-69b0-7ecc...`), but the actual position ID is in `affectedDeals[0].dealId` (`00000000-69b0-7ecf...`). | High |
| **Working Order Creation** | `POST /api/v1/workingorders` with `type: "LIMIT"` or `"STOP"`. | Accepted with `dealReference`. Confirmation returns `status: "OPEN"`, `dealStatus: "ACCEPTED"`. | `PILOT-LMT-BUY`, `PILOT-STP-BUY` | Order rests on server until price reaches level or timeout occurs. | High |
| **Working Order Cancellation** | `DELETE /api/v1/workingorders/{dealId}` deletes pending order. | Returns `dealReference`. Confirmation returns `status: "DELETED"`, `dealStatus: "ACCEPTED"`. | `PILOT-LMT-BUY` cancellation (dealRef `o_42bc91c0...`) | Exact status string is `"DELETED"`, not `"CANCELLED"`. | High |
| **Stop Order Triggering** | Buy stop triggers when `Ask >= stopLevel`. Once triggered, executes as market order. | Placed Buy Stop at 82948.10 when Ask was 82946.60. When streamed tick reached Ask 82948.10, order instantly triggered into an open position. | `PILOT-STP-BUY` (level 82948.10, tick Ask 82948.10 at 11:02:44.695Z, position created 11:02:44.904Z) | Position payload records `workingOrderId: "00000000-69b0-802d..."` referencing the stop order. Attempting to delete working order after trigger returns 404 because it is now a position! | High |
| **Position Closure** | `DELETE /api/v1/positions/{dealId}` closes open position. | Returns `dealReference` formatted as `p_<dealId>`. Confirmation returns `status: "CLOSED"`, `affectedDeals[0].status: "FULLY_CLOSED"`. | Cleanup of MKT position and STP position | Returns fill level and realized profit/loss. | High |

---

## 3. Coverage and Latency Summary

Summary of measured samples from the pilot run:

| Cohort / Direction / Instrument | Attempts | Accepted | Confirmed Fills | Timed Out Untriggered | Rejected / Unresolved | POST Response (ms) Median [Min, Max] | Submit-to-Fill Obs (ms) Median [Min, Max] | Observed Threshold-to-Fill (ms) | Quality / Resolution |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Market BUY (BTCUSD)** | 1 | 1 | 1 | 0 | 0 | 231.5 [231.5, 231.5] | 816.5 [816.5, 816.5] | N/A (Immediate) | High (Monotonic) |
| **Limit BUY (BTCUSD)** | 1 | 1 | 0 | 1 | 0 | 203.8 [203.8, 203.8] | N/A (Resting) | N/A | High (Cancelled cleanly) |
| **Stop BUY (BTCUSD)** | 1 | 1 | 1 | 0 | 0 | 204.4 [204.4, 204.4] | 2499.0 [2499.0, 2499.0] | **209.0 ms** | High (Feed & server timestamp matched) |
| **Position Close DELETE** | 2 | 2 | 2 | 0 | 0 | 178.4 [168.2, 188.6] | 512.0 [480.0, 544.0] | N/A | High |
| **Working Order DELETE** | 1 | 1 | 1 | 0 | 0 | 389.1 [389.1, 389.1] | N/A (Cancelled) | N/A | High |

*Note on Latency Definitions:*
- **POST Response (ms):** Monotonic elapsed time from request dispatch to complete response body receipt ($t_{body} - t_{send}$).
- **Submit-to-Fill Obs (ms):** Elapsed time from initial order POST dispatch to first observation of confirmed execution.
- **Threshold-to-Fill (ms):** Elapsed time from the moment the streaming quote crossed the trigger price threshold ($Ask \ge stopLevel$) to the broker's reported position creation timestamp.

---

## 4. Per-Order Results

| Sample ID | Order Type | Dir | Epic | Size | Level | Pre-Quote (Bid / Ask) | POST (ms) | Submit-to-Fill Obs (ms) | dealReference | dealId | Fill Price | Outcome |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- | :--- | :---: | :--- |
| `PILOT-MKT-BUY-1791716545561` | MARKET | BUY | BTCUSD | 0.0001 | N/A | 82896.85 / 82946.85 | 231.5 | 816.5 | `o_cd56844e-5a0d-4fd4-a942-a197218e08b2` | `00000000-69b0-7ecc-03b5-c3980055311e` | 82946.85 | `ACCEPTED` (Filled & Closed) |
| `PILOT-LMT-BUY-1791716548632` | LIMIT | BUY | BTCUSD | 0.0001 | 82944.45 | 82895.95 / 82945.95 | 203.8 | N/A | `o_42bc91c0-646e-4924-9a3e-6c30427b58ec` | `00000000-69b0-7eeb-03b5-c3980055311e` | N/A | `DELETED` (Rested 10s, Cancelled) |
| `PILOT-STP-BUY-1791716562405` | STOP | BUY | BTCUSD | 0.0001 | 82948.10 | 82896.60 / 82946.60 | 204.4 | 2499.0 | `o_1e38c9ac-8a49-4724-bc51-2d1d219cfd6b` | `00000000-69b0-802d-03b5-c3980055311e` | 82948.10 | `ACCEPTED` (Triggered, Filled & Closed) |

---

## 5. Three Annotated Lifecycles

### 5.1 Market BUY Fill and Close (`PILOT-MKT-BUY-1791716545561`)
```mermaid
sequenceDiagram
    autonumber
    participant Client as Collector Process
    participant Broker as Capital.com Demo API
    Client->>Broker: POST /api/v1/positions (BUY 0.0001 BTCUSD) [t=0ms]
    Note over Client,Broker: Network transfer & broker processing (231.5 ms)
    Broker-->>Client: 200 OK { dealReference: "o_cd56844e..." } [t=231.5ms]
    Client->>Broker: GET /api/v1/confirms/o_cd56844e... (Poll 1) [t=631.5ms]
    Broker-->>Client: 200 OK { status: "OPEN", dealStatus: "ACCEPTED", level: 82946.85, affectedDeals: [{ dealId: "00000000-69b0-7ecf..." }] } [t=816.5ms]
    Note over Client: Submit-to-fill observed latency: 816.5 ms. Fill price = 82946.85
    Client->>Broker: DELETE /api/v1/positions/00000000-69b0-7ecf... [t=3000ms]
    Broker-->>Client: 200 OK { dealReference: "p_00000000-69b0-7ecf..." }
    Client->>Broker: GET /api/v1/confirms/p_00000000-69b0-7ecf...
    Broker-->>Client: 200 OK { status: "CLOSED", affectedDeals: [{ status: "FULLY_CLOSED" }] }
```

### 5.2 Resting Limit Order Lifecycle (`PILOT-LMT-BUY-1791716548632`)
1. **Pre-condition:** Pre-order Ask = `82945.95`. Selected resting Buy Limit level = `82944.45` (30 ticks below Ask).
2. **Submission:** `POST /api/v1/workingorders` dispatched at monotonic ms `892102008.6`.
3. **Acknowledgment:** Response received after `203.8 ms` with `dealReference: "o_42bc91c0..."`.
4. **Resting State Observation:** `GET /confirms` returned `status: "OPEN"`, `dealStatus: "ACCEPTED"`. Order successfully queued in broker book.
5. **Observation Window:** Monitored quote stream for 10,000 ms. Market Ask remained between `82945.70` and `82947.70` (never reached limit of `82944.45`). Order remained unexecuted.
6. **Cancellation Mutation:** Dispatched `DELETE /api/v1/workingorders/00000000-69b0-7eeb-03b5-c3980055311e`.
7. **Cancellation Confirmation:** Broker confirmed with `status: "DELETED"`, `dealStatus: "ACCEPTED"`. Reconciled working order count = 0.

### 5.3 Resting Stop Order Trigger & Fill (`PILOT-STP-BUY-1791716562405`)
1. **Pre-condition:** Pre-order Ask = `82946.60`. Selected resting Buy Stop level = `82948.10` (30 ticks above Ask).
2. **Submission:** `POST /api/v1/workingorders` dispatched at `11:02:42.405Z`. Response received after `204.4 ms` (`dealReference: "o_1e38c9ac..."`).
3. **Working State Confirmed:** Broker confirms `status: "OPEN"`, working order ID `00000000-69b0-802d...`.
4. **Market Movement & Threshold Crossing:**
   - `11:02:43.354Z`: Streaming quote: Ask = `82946.20` (ineligible).
   - `11:02:43.758Z`: Streaming quote: Ask = `82946.60` (ineligible).
   - `11:02:44.695Z`: **Threshold Quote Arrives!** Streaming quote `BTCUSD Ask = 82948.10`. Eligible condition ($Ask \ge 82948.10$) met!
5. **Broker Execution:**
   - At `11:02:44.904Z` (server time, exactly 209 ms after quote arrival), Capital.com triggered the stop order and created open position `00000000-69b0-8037...` at fill level `82948.10` with `workingOrderId: "00000000-69b0-802d..."`.
6. **Cancellation Race Discovery:**
   - Collector attempted scheduled 10-second cleanup cancellation on the working order; broker returned that the working order was no longer pending because it had already converted to an active position!
7. **Position Cleanup:** Collector recognized the position conversion, targeted position `00000000-69b0-8037...` via `DELETE /api/v1/positions/...`, and verified `status: "CLOSED"` with zero residual exposure.

---

## 6. Price Effects and Slippage

1. **Quote Reference Alignment:**
   - Market BUY: Pre-quote Ask was `82946.85`. Executed fill price was `82946.85`. Observed quote-to-fill change = `0.00` points (0 ticks slippage).
   - Stop BUY: Stop level was `82948.10`. Eligible trigger quote Ask was `82948.10`. Executed fill price was `82948.10`. Observed stop-to-fill change = `0.00` points (exact fill at trigger on demo).
2. **Spread Observations:**
   - `BTCUSD` CFD spread was virtually constant at exactly `50.00` points ($82946.70 - 82896.70$).
   - Bid/Ask quotes updated every ~100–300 ms over the WebSocket connection.
3. **Tick Boundary Invariant:**
   - Minimum step distance of `0.05` was strictly respected. Prices and levels with valid decimals (`.05`, `.10`, `.15`, `.45`, `.85`) are accepted without rejection.

---

## 7. Lifecycle Contrasts & Deal Correlation Mechanics

A crucial finding for any trading simulator:
1. **Order Deal ID vs Position Deal ID:**
   - In Capital.com API, submitting a market order returns a deal reference `o_<uuid>`.
   - The initial confirm returns `dealId` as `00000000-...` (the deal receipt ID).
   - **However**, the actual position created has a DIFFERENT deal ID, provided inside `affectedDeals[0].dealId`.
   - Closing the position requires `DELETE /api/v1/positions/{affectedDeals[0].dealId}`, NOT the initial deal receipt ID!
2. **Stop Order Transition:**
   - A resting stop order begins in `/api/v1/workingorders`.
   - When the market reaches the stop level, the working order is consumed. The position endpoint now contains a position with `workingOrderId` pointing back to the stop order ID.
   - Any client code polling `/workingorders` must handle the order disappearing from working orders and appearing in positions upon execution.
3. **Cancellation Status:**
   - Successful working order cancellation returns confirmation status `"DELETED"`, dealStatus `"ACCEPTED"`.

---

## 8. Measurement Limits and Unresolved Questions

1. **Weekend Demo Feed Dynamics:**
   - Observations were taken on a Sunday. Traditional assets (FX, Equities, Indices) were closed. Only crypto CFDs (`BTCUSD`, etc.) were active. Spreads and latency distributions for equities during market open (e.g. 09:30 EST) may exhibit higher variance.
2. **Demo Engine vs Live Matching Engine:**
   - Demo CFD fills appear to execute deterministically at the current displayed synthetic quote without market impact or queue priority queuing.
3. **Sample Size:**
   - Stage 1 pilot established the complete lifecycle mechanics, correlation rules, and latency baselines across all 3 order types. Repeated cohort sampling (Stage 2: 20 market / 10 limit / 10 stop) will be needed if full statistical percentiles (p50, p90, p99) under load are required.

---

## 9. Architecture & Specification for Market Rewind Simulator

Based on these measured observations, the Market Rewind simulator order engine should be designed with the following principles:

1. **Distinct ID Architecture:**
   - Maintain separate entities: `Order` (`orderId`) and `Position` (`positionId`).
   - When a market order executes, create a `Position` with a unique ID and link `order.positionId = position.id`.
2. **Realistic Latency Simulation:**
   - Add a simulated network round-trip delay between order placement and acknowledgement: $RTT \sim \text{Normal}(\mu = 210\text{ms}, \sigma = 20\text{ms})$.
   - Add asynchronous confirmation transition: order enters `PENDING`, resolves to `ACCEPTED` after $150\text{ms}$.
3. **Trigger Evaluation Engine:**
   - For Limit orders:
     - Buy Limit triggers when `Ask <= limitLevel`.
     - Sell Limit triggers when `Bid >= limitLevel`.
   - For Stop orders:
     - Buy Stop triggers when `Ask >= stopLevel`.
     - Sell Stop triggers when `Bid <= stopLevel`.
   - Upon trigger, transition the working order to an executed position using the triggering tick's price (or next tick price for market-order execution).
4. **Cancellation Mechanics:**
   - If a cancellation request arrives while an order is resting, mark status as `DELETED`.
   - If a cancellation request arrives after a price tick has already triggered execution, return a cancellation rejection (execution won the race).

---

## 10. Handover Guide for the Incoming Agent

### 10.1 Completed Deliverables
- [`tools/research/demo-guard.mjs`](file:///Users/emadarshadalam/Documents/GitHub/market-rewind/tools/research/demo-guard.mjs): Strict demo transport guard, URL validator, sensitive data redactor, and append-only sync ledger.
- [`tools/research/test-demo-guard.mjs`](file:///Users/emadarshadalam/Documents/GitHub/market-rewind/tools/research/test-demo-guard.mjs): Offline test suite proving rejection of live URLs, redirects, bad ports, and validating redaction (16/16 tests passing).
- [`tools/research/capital-demo-order-observer.mjs`](file:///Users/emadarshadalam/Documents/GitHub/market-rewind/tools/research/capital-demo-order-observer.mjs): Standalone collector tool supporting `--calibrate`, `--discover`, and `--pilot`.
- [`docs/research/capital-demo-order-data/2026-10-11T11-02-15-686Z/`](file:///Users/emadarshadalam/Documents/GitHub/market-rewind/docs/research/capital-demo-order-data/2026-10-11T11-02-15-686Z/): Full raw sanitized evidence bundle (`manifest.json`, `events.jsonl`, `quotes.jsonl`, `mutation-ledger.jsonl`, `orders.csv`, `baseline.json`, `final-state.json`, `README.md`).
- Verified zero residual positions or orders on the demo account.

### 10.2 Copyable Next-Step Prompts for the Incoming Agent

**Option A (Run Repeated Stage 2 Cohorts for Full Statistics):**
> "Read `docs/research/capital-demo-order-observations.md`. The Stage 1 pilot and collector (`tools/research/capital-demo-order-observer.mjs`) are complete, validated, and reconciled. Extend the collector to run the Stage 2 cohort loop (10 BUY / 10 SELL market orders, 5 BUY / 5 SELL resting limits, 5 BUY / 5 SELL resting stops) within the 60-order budget, save the raw data bundle, and update the coverage table in `capital-demo-order-observations.md`."

**Option B (Proceed Directly to Market Rewind Simulator Implementation):**
> "Read `docs/research/capital-demo-order-observations.md`. The Capital.com demo order observation study is complete with empirical data on market, limit, and stop order lifecycles, latency (~210ms RTT, ~800ms submit-to-fill), and `affectedDeals` position correlation. Use Section 9 of the report to implement the order execution and trigger simulator inside Market Rewind."

### 10.3 Quick Verification Commands
```bash
# Run offline guard tests (no network calls)
node tools/research/test-demo-guard.mjs

# Run clock calibration against demo REST
node tools/research/capital-demo-order-observer.mjs --calibrate

# Discover open instruments on demo
node tools/research/capital-demo-order-observer.mjs --discover
```
