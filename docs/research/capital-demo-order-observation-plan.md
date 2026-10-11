# Capital.com demo order observation plan

Prepared: 2026-10-11, Asia/Bahrain. Status: handoff plan; no trades or measurements have been made for this study.

## Assignment for the collecting agent

Collect real observations from Capital.com's **DEMO** API for market, limit, and stop entry orders, then write an evidence-backed Markdown report. The purpose is to understand order acceptance, waiting, triggering, execution, slippage, cancellation, and notification delay well enough to later simulate them in Market Rewind.

This assignment authorizes the bounded demo experiments and their cleanup described below. It does not authorize any live-account request, real-money trade, changes to existing trades, or implementation of the Market Rewind simulator. Read the applicable repository instructions before starting. Keep trading-terminal read-only; write the collector and research artifacts in market-rewind.

First produce a small pilot covering all three types, inspect its evidence, then collect repeated samples if the pilot is sound. Populate the report from captured data, including failed and unfilled cases. Never substitute hypothetical numbers for observations.

## Local context already inspected

The sibling repository is `/Users/emadarshadalam/Documents/GitHub/trading-terminal`.

| File | Finding relevant to this study |
| --- | --- |
| `../trading-terminal/api/_utils.ts` | Selects demo or live from `X-Environment`; defaults to demo but supports live. Its demo API key also has a generic-key fallback. Do not use this proxy as the collector's transport. |
| `../trading-terminal/api/session.ts` | Also supports both environments and can inject credentials from environment variables. Treat it as a reference for authentication, not a safe execution entry point for this study. |
| `../trading-terminal/api/order.ts` | Routes position requests and working orders, with `LIMIT` and `STOP` validation. Useful for understanding the terminal's payloads. |
| `../trading-terminal/src/lib/ws-manager.ts` | Sends `confirms.subscribe` and handles `confirms` messages. This is local implementation evidence, not proof that the subscription is supported or delivering events. |
| `../trading-terminal/src/store/useTradeStore.ts` | Contains a 2-second watchdog and other timers. UI state changes and recovery timing must not be treated as broker execution timing. |
| `../trading-terminal/scripts/fetch-activity.ts` | Contains position-creation calls and fixed 2-second waits. Do not run an existing trade script to collect this study. |
| `src/hooks/useTradeManager.ts` | Market Rewind currently chooses a quote and creates a simulated trade synchronously. It also synthesizes a +/-0.01 spread when bid/ask is absent. These are current app behaviours, not measured Capital.com behaviour. |

Credentials have not been inspected or validated. Use existing local demo credentials securely if available; inspect configuration names without printing values. If authentication inputs are unavailable, document the blocker and request only the missing demo configuration through a secure local setup. Never ask for secrets to be pasted into the report or chat.

## Documentation to verify before collecting

Use these primary sources, record access dates, and record the Capital.com entity/account context where known. Entity-specific execution policies may differ; do not apply another entity's policy as fact about this account.

- [Official API documentation](https://open-api.capital.com/): authentication, endpoints, market rules, confirmations, rate limits, streaming.
- [Pending-order bid/ask trigger guidance](https://help.capital.com/hc/en-us/articles/360016556400-My-pending-order-has-not-been-executed-why): buy instructions use ask; sell instructions use bid, including closing positions.
- [Capital.com limit/stop explanation](https://capital.com/en-int/learn/risk-management/limit-order): price control for limits, market execution after an ordinary stop triggers.
- [Capital.com order execution policy](https://img.capital.com/docs/Copy-of-Order-Execution-Policy.pdf): check its entity and version before relying on it.

The API documentation checked on the preparation date identifies:

| Purpose | API path, relative to `/api/v1` |
| --- | --- |
| Clock/connectivity baseline | `GET /time` |
| Authenticate / inspect session | `POST /session`, `GET /session` |
| Account state | `GET /accounts`, `GET /accounts/preferences` |
| Instrument discovery/rules | `GET /markets`, `GET /markets/{epic}` |
| Market entry / position state / close | `POST /positions`, `GET /positions`, `GET /positions/{dealId}`, `DELETE /positions/{dealId}` |
| Limit/stop entry / state / amend / cancel | `POST /workingorders`, `GET /workingorders`, `PUT /workingorders/{dealId}`, `DELETE /workingorders/{dealId}` |
| Request confirmation | `GET /confirms/{dealReference}` |
| Lifecycle reconciliation | `GET /history/activity?detailed=true`, `GET /history/transactions` |

The documented demo REST origin is `https://demo-api-capital.backend-capital.com`. Streaming uses `wss://api-streaming-capital.backend-capital.com/connect`; authenticate it only with the new demo session's tokens and use it for observation. A successful order POST is not itself fill proof. Check confirmations and affected deals. `accountType=CFD` and flags saying demo accounts exist do not identify the active environment. The documented limits include 10 REST requests/second/user, session creation at 1/second, and 1,000 demo position/working-order creations/hour. Recheck them before running. [Source: official API documentation](https://open-api.capital.com/)

## Demo isolation requirements

Implement these before sending any authenticated request:

1. Create a standalone collector with the demo REST origin as a constant. It must have no live mode, generic base-URL override, or fallback to the live service. Accept API paths only and validate the fully resolved URL before every request, including retries, authentication, read operations, amendments, and cleanup.
2. Require HTTPS, the exact hostname `demo-api-capital.backend-capital.com`, the normal HTTPS port, and an `/api/v1/` path. Reject URL userinfo, alternative hosts, absolute external paths, and redirects. Disable automatic redirects. Log the resolved host and path, without credentials, for each request.
3. Load explicitly selected demo credentials into a small configuration object. Do not import application startup code, execute/shell-source a credentials file, reuse browser/localStorage tokens, or inherit a generic/live credential fallback. An explicitly identified existing demo key can be mapped to the collector's configuration without copying secrets into tracked files.
4. Start a fresh session on the demo origin. Record sanitized session/account metadata, active account identity, and the actual request host. Confirm that subsequent state belongs to that session/account. Pseudonymize account identity in shareable artifacts. If selecting a demo financial account is necessary, do it only through this demo session before the baseline and streaming connection.
5. Use the documented shared streaming host only for quote/confirmation observations with demo tokens. Do not invent a separate demo streaming URL. Reject unapproved streaming redirects/hosts; send no trading command over streaming.
6. Before network access, run offline transport tests proving rejection of the live host, lookalike hosts, protocol-relative URLs, redirects, and wrong schemes/ports; prove rejection happens before sending credentials. Also test that auth tokens/passwords cannot enter persisted logs.
7. Persist each intended mutation to a durable ledger **before** sending it. Count failed and uncertain mutations against the run budget. Any unexpected host, identity change, unresolved mutation, or cleanup failure stops new trading experiments.

The proof of demo execution is the fail-closed transport plus the fresh demo-host session and logged request destinations. Do not rely on a UI label, account name, or existence of a demo account as the proof.

## Collection bounds and preflight

Use these defaults so this remains an initial study:

| Constraint | Default |
| --- | --- |
| Total run | At most 90 minutes, reserving the last 15 minutes for cleanup/reporting |
| New market/working-order POSTs | At most 60 across all attempts |
| Total trading mutations | At most 150, including entries, edits, cancels, and closes; reserve cleanup capacity before opening each order |
| Concurrent experimental entries | One pending order or open experimental position at a time |
| Size | Smallest valid size from the selected instrument's rules |
| Waiting per pending order | Up to 180 seconds, then cancel and reconcile |
| Collection cadence | One sequential sample, cleanup, then next sample; do not stress test |

Before starting:

- Snapshot positions, working orders, balances, account preferences, and instrument rules. Do not change leverage, hedging mode, account funding, or unrelated orders.
- Select an actively tradeable CFD with fresh bid/ask updates and valid market-order support. Prefer an instrument the user actually practices in the terminal. Avoid an epic with any pre-existing position or working order so netting or fills cannot modify an existing trade.
- The preparation date is a Sunday. At execution time, discover open instruments rather than assuming equities/FX are open. A crypto CFD may be available depending on the account/entity; verify it. If using a different asset class, explicitly limit conclusions to that instrument/session. If nothing suitable is open, produce a blocked/partial report and stop; do not silently switch to live or claim closed-market rejections as normal execution samples.
- Capture currency, market status, tick size, quantity increment, minimum size, relevant distance rules and their units, spread, streaming availability, and observed quote cadence. Convert percentage/point rules explicitly; do not hardcode prices, size=1, pip scales, or rounding to two decimals.
- Treat reported quote quantities as quote metadata, not proof of accessible depth, exchange queue priority, or available fill liquidity.
- Record host location if known, network type, runtime/version, connection reuse, time synchronization status, and collector version/hash. Run with persistent HTTP connections for the primary cohort. Separate cold-start requests if present.
- Use a shared REST limiter with at least 250 ms between request starts (no more than 4/second overall), including polls and cleanup. Only one in-flight REST request by default. Back off on throttling and record it rather than testing the service's limit.
- Keep REST/streaming sessions alive during observation; label reconnects/reauthentication and revalidate account identity before any further mutations.

If credentials, suitable instruments, or safe sizing are unavailable, populate the report with verified prerequisites and the precise blocker. Successful fills for all three types are the target, but an order not triggering is valid evidence rather than a reason to fabricate a result or run indefinitely.

## Collector and data artifacts

Suggested implementation: `tools/research/capital-demo-order-observer.mjs` (or a Python equivalent if existing dependencies fit better). Prefer a direct HTTP client and streaming client with explicit timeouts, monotonic timestamps, redaction, and no hidden retries. Do not add or refactor production trading code for this task.

Write each run under `docs/research/capital-demo-order-data/<UTC-run-id>/`:

- `manifest.json`: demo transport proof, pseudonymous account, runtime/network context, budgets, cohort settings, instrument rules, observation window, poll schedules, clock calibration, and outcome.
- `events.jsonl`: append-only, sanitized REST lifecycle and streaming messages, including all non-success statuses and errors. Record request start, response headers, full-body receipt, and JSON-parsed times separately where supported.
- `quotes.jsonl`: full observed bid/ask quote stream with local receipt times and original server timestamps. Retain duplicate, out-of-order, and discontinuous messages with labels; do not silently discard them.
- `mutation-ledger.jsonl`: intent, attempt, request reference, affected IDs, outcome, ownership, reconciliation, and cleanup. Flush it before sending writes.
- `orders.csv`: one row per attempted experimental entry with derived metrics and links/IDs for its events. Keep cleanup closes in their own cohort; do not count them as independent entry samples.
- `baseline.json` and `final-state.json`: sanitized account/order snapshots and the ownership-based state diff.
- `README.md`: exact reproducible commands using credential variable names only, artifact schema, redaction rules, and analysis method.

Store account identities as stable run-local aliases; preserve consistent order/deal aliases so evidence can be joined. Never persist session tokens, API keys, passwords, authorization headers, login identifiers, cookies, or entire exception/request objects that might contain them. Redact before serialization. If real IDs are needed for crash recovery, keep that mapping in a private ignored local state file; supply a sanitized ledger in the research bundle.

Write the main result to `docs/research/capital-demo-order-observations.md`. This plan remains a plan; put actual measurements in that report.

## Timing model and required fields

Use a monotonic clock for local elapsed times (`performance.now()` or `perf_counter_ns()`). Pair it with UTC wall-clock timestamps for joining and display. Keep one process clock domain and a sequence number per event. Millisecond precision in a timestamp does not prove millisecond accuracy.

For every attempted order collect:

| Field | Meaning |
| --- | --- |
| `run_id`, `sample_id`, `cohort`, `order_type`, `direction`, `epic`, `size`, `level` | Experiment identity and original intent; `level` is null for market entry |
| `t_intent`, `t_send`, `t_headers`, `t_body`, `t_parsed` | Local intent/request/response milestones; `t_send` is invocation of transport, not proven arrival at the broker |
| `t_first_confirmation`, `t_working_seen`, `t_position_seen` | First local observations, with event IDs and observed statuses |
| `dealReference`, `affectedDeals`, broker status/reason | Correlation and lifecycle evidence; do not assume the entry order ID is the position ID |
| `broker_time_raw`, `broker_time_kind`, `precision`, `timezone_evidence` | Original server fields and what they demonstrably describe; leave uncertain semantics unresolved |
| Last pre-send bid/ask quote and its receipt/server times | Quote available to the submitting process, including its age |
| `t_first_eligible_quote`, prior ineligible quote, and event IDs | First **observed** eligible quote while the order may be active, with acceptance/activation uncertainty and the bracket around it |
| `fill_price`, `filled_size`, `remaining_size`, position IDs | Confirmed execution details; null if unavailable, partial, or unresolved |
| Poll request/response intervals and counts | Detection resolution and any observer overhead |
| Cancel/edit/close timings and results | Separate mutations, not part of entry acknowledgement latency |
| `final_outcome`, `measurement_quality`, `cleanup_status` | Filled, rejected, untriggered-at-timeout, cancelled, expired, partial, or unresolved |

Keep these metrics separate:

1. **Intent-to-send:** local collector overhead, `t_send - t_intent`.
2. **POST response time:** `t_body - t_send`; also report headers time where available. This includes network/service/response transfer and is not isolated broker processing latency.
3. **Submit-to-acceptance observation:** first evidence that the request/order was accepted, minus `t_send`. A working-order acceptance is not a fill.
4. **Submit-to-fill observation:** first confirmed fill/position evidence, minus `t_send`. For market orders this includes notification/polling delay. For pending orders it additionally includes waiting for the market and must not be compared directly with market execution delay.
5. **Working-order waiting time:** from first confirmed working state to first observed eligible quote. Label it observation-based; eligibility may have occurred before that state was observed.
6. **Observed trigger-to-fill notification interval:** first fill observation minus first observed eligible quote receipt. This is a feed/order-observation comparison, not proven internal trigger-to-execution latency. It may be negative if streams arrive in a different order; retain and explain such cases.
7. **Broker event-time difference:** only derive it when both timestamps are known to be in the same server clock domain and their semantics are established. Otherwise report raw fields and `not measurable`.
8. **Cancellation/amendment response and outcome observation:** measure separately, including cases where execution wins the race.

Do not assume acknowledgement arrives before execution, or that the first streamed eligible quote was the first quote evaluated internally. Preserve eligible quotes received before the acceptance response; flag uncertain activation instead of discarding them or inventing a trigger timestamp. Do not assign an acceptance timestamp to fill execution just because it is the only timestamp returned.

Sample the demo `/time` endpoint 10 times before and 10 after the run. Record send/receive times, server time, round-trip duration, and midpoint offset estimate with at least +/-half-RTT uncertainty, plus any timestamp-resolution/drift limitations. Compare minimum-RTT estimates. This is approximate clock calibration, not a way to calculate exact one-way latency or broker execution time.

## Price and trigger observations

Use the broker's bid/ask, not the candle close or mid-price. The following are hypotheses/rules to test against the account's behaviour:

| Instruction | Eligible quote condition |
| --- | --- |
| Buy limit entry | Ask <= limit |
| Sell limit entry | Bid >= limit |
| Buy stop entry | Ask >= stop |
| Sell stop entry | Bid <= stop |
| Stop loss closing a long | Bid <= stop loss |
| Stop loss closing a short | Ask >= stop loss |

For buy entries the pre-send reference is ask; for sell entries it is bid. Calculate adverse quote-to-fill change as `fill - reference` for buys and `reference - fill` for sells. Report price units and ticks. Call this comparison **change from the last observed quote**, because stale/feed-delayed quotes can differ from the executable quote at broker receipt.

For stop entries also compare the fill with the stop level using that direction convention. For limit entries test the price boundary: buys should fill at or below the limit, sells at or above it. A surprising result requires correlation/units checks before drawing a broker conclusion. Preserve evidence for price improvement, rejection, partial execution, or any apparent boundary violation.

Capture quotes continuously from at least 30 seconds before the first experiment through final reconciliation. Index quote windows around submission, trigger, cancellation, and fill. Label stale quotes, feed gaps, and clock uncertainty. Do not reconstruct subsecond paths from candles.

## Observing order state

1. Establish quotes before the first trade. The existing terminal's `confirms.subscribe` is worth testing, but it is not established by the public streaming sections reviewed for this plan. Require an explicit subscription result and actual correlated messages from a pilot trade before treating it as an event source. Record errors/unsupported responses and use REST if necessary. A successful subscription response alone is insufficient proof of usable fill events.
2. Always inspect `/confirms/{dealReference}` after a write; follow `affectedDeals` and confirm the corresponding state. For a working-order creation, distinguish order acceptance from later position creation.
3. For immediate confirmations, poll on the shared limiter at approximately 500 ms intervals for up to 10 seconds, then slow to 1 second. Record actual scheduled and achieved intervals. A missing confirmation is initially unknown, not a reason to repeat the write.
4. For pending orders, reconcile working orders and positions approximately once per second per endpoint, staggering them through the same limiter. Use a validated confirmation stream to improve observation resolution where available. Reserve limiter capacity for necessary confirmation and cleanup requests.
5. Fetch detailed activity after each completed sample and at final reconciliation; fetch transaction history where useful. Respect history windows and pagination actually supported. Correlate with IDs, direction, size, time, and affected deals. An order disappearing from the pending list is not proof of a fill: it may have been cancelled, expired, rejected, or changed.
6. If a poll last showed pending and the next showed filled, report the local detection window and polling uncertainty. Without server timing semantics, this is not a strict bound on when the broker executed.
7. Preserve API status names verbatim and maintain a separate research outcome. Never collapse `ACCEPTED`, `CREATED`, `EXECUTED`, and `OPENED` into one generic success without the payload context.

## Experiment sequence

### Stage 1: preflight and pilot

Validate isolation/redaction offline, authenticate demo, snapshot state, select rules/size, calibrate time, warm the connection with reads, and start quotes. Submit one minimum-size market entry, one resting limit, and one resting stop sequentially, reconciling and cleaning up after each. Pilot samples count toward the totals and budgets.

Choose pending levels on the correct side of the current executable quote, respecting valid tick increments and minimum distances. During the pilot inspect state mapping and whether pending fills can be attributed reliably. If that is not possible, fix observation/correlation before collecting more samples; do not build a dataset of guessed fills.

### Stage 2: repeat the three entry types

| Cohort | Target | Required observations |
| --- | --- | --- |
| Market entries | 20 entries: 10 BUY, 10 SELL | POST timing, acceptance/fill observations, affected deals, quote age, fill price/size, close result |
| Resting limit entries | 10 accepted attempts: 5 BUY, 5 SELL | Working state, correct price-side eligibility, fill/nonfill/cancel outcome, fill price boundary, waiting and detection timing |
| Resting stop entries | 10 accepted attempts: 5 BUY, 5 SELL | Working state, threshold observation, later market execution evidence, stop-to-fill price change, waiting and detection timing |

Alternate BUY and SELL within each cohort. For limits/stops, select levels using the freshest quote, valid tick rounding, and actual distance rules. Choose a nearby valid level to make a trigger plausible; record the distance in ticks/spreads and the selection method. Do not change it invisibly to make a sample fill. If the price moves while the request travels, capture immediate execution or rejection as an outcome.

An accepted limit/stop attempt may never trigger. Report accepted attempts, actual trigger observations, and confirmed fills as separate counts. Continue only within the fixed time/order budget. Do not keep submitting orders until every row fills. If feasible within the budget, spread repetitions across two separated blocks; report session variation, not universal broker behaviour.

Close each created position explicitly by its owned position ID and reconcile the close. Do not send an opposite entry as a substitute for a close: hedging/netting can create another position or alter existing exposure. A partial fill leaves both a position and possibly an order remainder to reconcile.

### Stage 3: a few lifecycle contrasts within remaining budget

Prioritize complete primary evidence. If time and reserved cleanup capacity remain, add these explicitly labeled probes:

- One far-away valid limit and one far-away valid stop: observe working acceptance, wait 10 seconds, request cancellation, and verify the final outcome. Record whether a fill raced the cancellation.
- One safely resting limit and one safely resting stop: amend the level once to another valid resting level, confirm the amendment, then cancel. Treat the edit as a separate mutation and record old/new values and any concurrent trigger.
- Ordinary attached stop loss: one minimum-size long and one short, each with a valid nearby stop loss. Observe the opposite closing side, stop-to-fill price change, and bounded cleanup if the stop does not trigger. Keep this cohort separate from stop **entry** orders.

These optional probes add at most six entries. Do not assume ordinary stops are guaranteed stops. Guaranteed-stop and trailing-stop behaviour, intentional gaps, partial fills, rejection stress tests, and deliberately disconnected sessions are follow-up studies unless naturally observed during this run. Record naturally occurring cases without trying to manufacture them.

## Unknown outcomes, interruption, and cleanup

Disable automatic retries for mutations. A timeout means the request may have succeeded. Read the ledger, confirmations if a reference exists, positions, pending orders, and activity to reconcile before doing anything else. If the creation has no returned reference, use baseline diffs and precise intent/time/epic/direction/size evidence; do not claim ownership when attribution is ambiguous. Stop new entries and report an unresolved outcome instead of sending a duplicate.

The collector must have a finally/termination cleanup path and a resume-cleanup mode driven by its private ownership ledger. The run-wide deadline stops new samples but leaves the reserved cleanup window available. Revalidate the demo session and host before cleanup after any reconnect.

Cancel only owned pending orders/remainders, then close only owned positions. Reconcile cancellation-versus-fill races and follow affected deal IDs. Never cancel or flatten the whole account. Final snapshots must show that all study-owned pending orders/positions are gone and pre-existing trades were untouched; unrelated market movements may change their valuations.

If attribution, authentication, or networking prevents cleanup, retain recoverable private state, write the exact owned/unresolved items to the sanitized report, and notify the user. Mark the run partial and do not state that it finished cleanly. No live fallback is allowed for recovery.

## Analysis and Markdown report to populate

The report must open with the actual outcome: completed, partial, or blocked; demo proof; collection dates; and numbers attempted/accepted/filled/unfilled/rejected/unresolved for each type. Include links to the sanitized raw artifacts. Use `not measured` or `not observable` for unavailable metrics, with reasons.

Populate these sections:

1. **Environment and demo verification:** exact REST host, streaming host, pseudonymous account, instrument, entity if known, smallest size, account mode, market/session conditions, network/runtime, quote cadence, polling resolution, clock calibration, and collection bounds actually used.
2. **Documented rules versus observed behaviour:** table with rule, source/date, supporting sample IDs, contradictions, and confidence. Distinguish documentation, direct observations, and inferences.
3. **Coverage and latency summary:** use the table below; count each entry once. Include failures in outcome counts, but summarize their response times separately from successful requests. Keep cleanup closes, polling-based versus event-based observations, and cold/warm requests in separate cohorts rather than pooling unlike samples.
4. **Per-order results:** one row per attempted entry, including unfilled/rejected/unknown entries; link to its event and quote windows.
5. **Three annotated timelines:** at least one market fill, one limit lifecycle, and one stop lifecycle. Show submit, response, working state, observed quote threshold, confirmed fill/position, and cleanup. If no fill exists for a type, show its real nonfill timeline and say so.
6. **Price effects:** last-observed-quote comparisons, spread/quote age, stop-level differences, limit boundaries, and how these vary with direction and conditions. Do not infer liquidity/queue mechanics from price alone.
7. **Lifecycle contrasts:** cancellation, amendment, ordinary stop-loss versus stop-entry findings where tested. Explain what each lets a learner experience.
8. **Measurement limits and unresolved questions:** demo versus live, one instrument/session, feed delay, poll resolution, timestamp semantics, low sample counts, missing triggers, and any unknown fills/cleanup.
9. **Implications for a later Market Rewind mock:** supported order states/trigger rules and distributions that can be reproduced; behaviours that must remain configurable/unknown. Include replay-clock versus wall-clock handling as a future design question, not an implementation in this study.
10. **Cleanup and reproducibility:** before/after ownership diff, residual items if any, collector version, exact safe rerun and analysis commands, and results of offline guards/redaction checks.

Summary table template (all cells are to be filled from evidence):

| Cohort / direction / instrument / observation source | Attempts | Accepted | Confirmed fills | Timed out untriggered | Rejected / unresolved | POST response ms median [min,max] | Submit-to-fill observation ms median [min,max] | Observed threshold-to-fill-notification ms | Quality / resolution |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |
| Market BUY | not measured | | | | | | | n/a | |
| Market SELL | not measured | | | | | | | n/a | |
| Limit BUY | not measured | | | | | | | | |
| Limit SELL | not measured | | | | | | | | |
| Stop BUY | not measured | | | | | | | | |
| Stop SELL | not measured | | | | | | | | |

Define the percentile method and include the sample count for every metric. Prioritize median/range for this small study. An empirical p90 may be shown with at least 10 comparable samples, clearly labeled exploratory; do not present p95/p99 as reliable tail estimates from this initial sample. Pending waiting time is not a market-execution latency statistic. Retain outliers and excluded sample IDs/reasons; do not silently discard difficult cases.

## Completion criteria

- The collector can only reach the demo REST host, with offline rejection/redaction tests passing and request destinations recorded.
- Market, limit, and stop entry experiments have actual captured attempts and reconciled outcomes, or a precise partial/blocked reason for missing coverage. Successful fills for all three are required before claiming a complete fill comparison.
- Raw sanitized events, quotes, per-order data, manifest, and ledger support every numerical claim. Missing fields remain null, not zero.
- The report separates request response, acceptance, market waiting, fill observation, feed timing, and any demonstrably meaningful broker timestamps.
- Buy/sell quote sides and real fill-price comparisons appear in the examples. Stop entry and stop loss are identified separately.
- All experiment-owned orders and positions are cleaned up, or the report explicitly identifies unresolved exposure and recovery steps.
- No live requests, production simulator changes, unrelated-account cleanup, or unreported demo mutations occurred.

## Copyable prompt for the other agent

> Execute `docs/research/capital-demo-order-observation-plan.md` in the market-rewind repository. Build an isolated collector, prove its transport is locked to Capital.com's DEMO REST host before any authenticated request, and collect bounded market, limit, and stop order observations using only demo credentials. Read the sibling trading-terminal code as a reference without running its trade scripts or changing it. Save sanitized raw events/quotes and per-order data, populate `docs/research/capital-demo-order-observations.md` with measured findings and uncertainty, and clean up only the orders/positions your study created. Keep production simulator implementation out of this task. If credentials, open instruments, correlation, or cleanup block progress, report the verified partial result and precise blocker; never use live endpoints or invent measurements.
