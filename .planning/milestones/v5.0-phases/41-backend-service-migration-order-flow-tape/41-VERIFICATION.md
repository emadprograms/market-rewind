---
phase: 41-backend-service-migration-order-flow-tape
status: passed
verified_at: 2026-10-06
must_haves:
  - id: LAKE-API-01
    status: passed
    description: DuckDBService routes every query through TickLakeReader with unchanged signatures and response shapes.
  - id: LAKE-API-02
    status: passed
    description: Reverse-chronological order flow tape with computed spread, newest-partition-first resolution and spill.
  - id: LAKE-API-03
    status: passed
    description: REST/WS endpoints aligned, maintenance and unavailable lakes return 503, real Parquet ticks stream over WebSocket.
---

# Phase 41 Verification: Backend Service Migration & Order Flow Tape

## Test Verification Matrix

| Suite | Passed | Total | Skipped | Duration | Status |
|---|---|---|---|---|---|
| `test_order_flow_tape.py` (Phase 41 tape) | 15 | 15 | 0 | 0.71s | PASSED (100%) |
| `test_duckdb_service.py` (Phase 41 service) | 26 | 26 | 0 | 1.29s | PASSED (100%) |
| `test_server.py` (Phase 41 HTTP/WS) | 17 | 17 | 0 | 0.92s | PASSED (100%) |
| `test_tick_lake_reader.py` (Phase 39 regression) | 80 | 80 | 1 | 1.37s | PASSED (100%) |
| `test_lake_resampling.py` (Phase 40 regression) | 48 | 48 | 0 | 2.10s | PASSED (100%) |
| `npm run backend:test` (whole backend) | 186 | 186 | 1 | 5.62s | **PASSED — zero failures, legacy suite retired** |
| Fresh clone, whole backend | 185 | — | 2 | 6.18s | PASSED |
| Fresh clone + `TICK_LAKE_ROOT` (sandbox / clone-local) | 186 | — | 1 | 5.80s | PASSED (both) |
| `MR_SANDBOX_LAKE_ROOT` → missing path | 185 | — | 2 | 5.87s | PASSED (graceful skip) |

Red-phase evidence: the 11 previously failing legacy tests plus 47 new assertions failed before
implementation; the suite was written test-first.

## Requirement Traceability

- **LAKE-API-01**: PASSED — `DuckDBService` has no disk-database code path (AST code-only check
  rejects `ATTACH`/`read_only`/`STREAMING_DB_PATH`/path-`connect`), preserves all five public
  methods, keeps the legacy `streaming_path` keyword working, decodes encoded partitions, ranks
  symbols by tick count, and never raises from `get_status()` (missing lake → `unavailable`,
  corrupt metadata → `degraded` with `error`).
- **LAKE-API-02**: PASSED — tape ordering and `(timestamp, ingest_id)` tie-break verified;
  spread matches `ask - bid` rounded to 4dp including NULL-quote rows; v2 (`bid_price`/`ask_price`)
  and mixed v1+v2 partitions coalesce; foreign rows are excluded; limit is clamped; older
  partitions are spilled into when needed; `/api/ticks?direction=desc` exposes it.
- **LAKE-API-03**: PASSED — `/api/status|symbols|symbols/{symbol}|ticks|candles` return 200 with
  schema-valid payloads (400 on missing symbol/bad limit, 404 on unknown symbol), maintenance
  returns 503 + `retry_after: 5` on every data endpoint, a missing lake returns 503
  `Tick lake unavailable`, `/ws/replay` and `/ws/playback` stream real Parquet ticks, and
  `historical_db` is absent from the status payload.

## Independent Verification (real HTTP + WebSocket, separate script)

| Check | Result |
|---|---|
| `/api/status` counts vs filesystem + Parquet footers | MATCH (5 symbols, 14 files, 2,046 ticks) |
| `/api/ticks?direction=desc` vs independent PyArrow ordering | MATCH (timestamps, prices, spreads) |
| `/api/ticks` (asc) vs `reader.query_ticks` | MATCH |
| `/api/candles` 1m vs reader; 1d RTH subset of ALL sessions | MATCH / True |
| `/api/symbols/NVDA` latest quote vs tape head | MATCH |
| WebSocket `/ws/replay` load + step | OK (50 ticks buffered, tick delivered) |
| Maintenance marker → REST response | 503 `{"error": "Lake maintenance in progress", "retry_after": 5}` |

## Mutation Testing (8/8 killed, after closing one test gap)

| Mutation | Failing tests |
|---|---|
| Tape ordered ascending | 9 |
| Spread ignores NULL quote sides | 21 |
| Bid expression resolves to `price` | 3 |
| `symbol_stats` drops the symbol filter | 1 (after adding the missing foreign-row test) |
| Server DESC path uses `query_ticks` instead of the tape | 1 |
| 503 mapped to 500 | 2 |
| Tape stops spilling after the newest partition | 1 |
| Summary quote built without the tape | 3 |

**Test gap found and closed:** the first `symbol_stats` mutation survived, proving no test covered
foreign rows leaking into the stats path. `test_symbol_summary_ignores_foreign_rows_inside_the_partition`
was added (test-first), failed against the mutant, passes against the real code.

## Defects Found During Self-Review

| # | Defect | Impact | Fix |
|---|--------|--------|-----|
| 1 | Test-side: "no disk DB" assertion matched documentation prose (`ATTACH` in the module docstring) | False failure that would tempt future contributors to delete the historical context | Assertion now parses the module with `ast`, strips docstrings, and checks behavior-bearing code only |
| 2 | Test-side: generated fixture ticks all sat at 12:00 UTC (`PRE`), so the daily RTH query legitimately returned `[]` | The service-level daily-RTH test was asserting on an unrealistic lake | Factory default start moved to 13:30 UTC (`REG`); the sandbox lake was rebuilt |
| 3 | Test-side: mutation harness reported "passed" when a mutation failed to apply | Misleading verification signal | Anchors asserted before applying; both affected mutations re-run and confirmed killed |
| 4 | Test-side: foreign-row stats test used string timestamps | `ArrowTypeError` instead of a meaningful assertion | Uses `datetime` objects |

## Known Nuances

1. `tick_count` in `/api/status` is `None` above 2,000 files (footer scan skipped) to keep the
   probe fast; the payload still reports file/partition/symbol counts.
2. WebSocket load failures during maintenance are `{"type":"error"}` messages, not HTTP 503 —
   a socket has no status line. REST endpoints return 503 as specified.
3. The tape reads at most 31 date partitions per request (newest first, spill-on-demand); a
   `limit` larger than that window returns what the window holds rather than scanning the lake.

---

# Re-Verification Round 2 (2026-10-06) — independent audit

Method: fresh clone of the pushed commit (`1b8d6b0`), full-suite run with no file copying,
real-HTTP edge probes shaped like the React client's requests, and a second mutation battery
targeting the newly audited paths.

## Defects found and fixed

| # | Defect | Severity | Impact | Fix | Tests added |
|---|--------|----------|--------|-----|-------------|
| A | `query_tape` (and the server's `direction=desc` path) **ignored `start_time`/`end_time`** | High (silent wrong data) | A client requesting a bounded Time & Sales window received an unbounded tape — verified live: `bounded=100` identical to `unbounded=100` | `query_tape` now normalizes and applies both bounds (inclusive timestamps, date-only end = whole UTC day), filters partitions to the range, and the server forwards the bounds | `test_tape_respects_start_and_end_bounds`, `test_tape_date_only_end_bound_is_inclusive`, `test_tape_bounds_span_partitions_and_still_spill`, `test_get_ticks_desc_respects_time_bounds` (HTTP) |
| B | A lake with **zero files** reported `tick_count: null` in `/api/status` | Low (cosmetic/contract) | Monitoring clients could read "unknown" instead of "empty lake" | `lake_totals` returns `0` when no files exist (still `None` above the 2,000-file footer-scan threshold) | `test_service_status_with_no_ticks_directory_reports_zero_not_none` |

Both were fixed test-first: the new tests failed against the committed code and pass after the fix.

## Regression guards added for previously untested frontend surfaces

| Surface | Why | Test |
|---|---|---|
| `/api/streaming/candles` | This is the React client's **primary** candle endpoint (`streamingClient.ts:436`), yet no test covered it | `test_streaming_candles_alias_endpoint` (params `tf`, `start`, `end`, `session`) |
| `/api/symbols/EUR%2FUSD` | Encoded-slash symbols reach the summary route only in percent-encoded form | `test_encoded_slash_symbol_endpoint` |

## Mutation testing round 2 (6 injected, all killed after closing 3 gaps)

| Mutation | First run | After gap-closing tests |
|---|---|---|
| Tape ignores `start_time` | killed (2) | killed |
| Tape ignores explicit `end_time` | killed (1) | killed |
| Tape drops the date-only `< next midnight` predicate | **survived** | killed (1) — `test_tape_excludes_rows_beyond_a_date_only_end_bound` |
| Tape skips partition-range pruning | **survived** (equivalent-by-result, optimization only) | killed (1) — `test_tape_prunes_partitions_outside_the_time_bounds` |
| Zero-file lake reports `null` tick count | killed (1) | killed |
| Server `desc` drops the bounds | killed (1) | killed |

**Two further survivors were found by auditing the *other* copies of the same shared predicate**
(an earlier run mis-targeted its anchor and mutated `query_candles`, which exposed the gap):

| Mutation | Result | Gap-closing test |
|---|---|---|
| `query_candles` drops the end-exclusive predicate | survived → killed | `test_candles_exclude_rows_beyond_a_date_only_end_bound` |
| `query_ticks` drops the end-exclusive predicate | survived → killed | `test_ticks_exclude_rows_beyond_a_date_only_end_bound` |

## Post-fix verification matrix

| Scenario | Result |
|---|---|
| `npm run backend:test` (whole backend, in-repo) | **197 passed, 1 skipped, 0 failed** |
| Fresh clone of the pushed commit, whole backend (no file copying) | 185 passed, 2 skipped, 0 failed (pre-fix commit; re-confirmed post-fix below) |
| Independent real-HTTP/WS checks (status vs filesystem, tape vs PyArrow, summary vs tape head, WS round-trip, maintenance 503) | ALL PASSED |
| Edge probes: frontend params (`source`/`db`), alias endpoint, encoded slash, limit 0 / negative / huge, non-integer params, unknown symbols, WS bad-symbol load | All behaved as documented; only defect A was wrong |

## Issues explicitly accepted (documented, not fixed)

1. `/api/symbols/EUR/USD` (raw slash, unencoded) returns 404 — a URL path cannot carry a raw
   slash; the client always percent-encodes it (verified working), so this is correct HTTP routing.
2. A WS `load` of an unknown symbol answers `{"type":"status","totalBuffered":0}` rather than an
   error message. Deliberate: the client's load path treats an empty buffer as "no data" and an
   error frame could abort the session. Documented so operators can distinguish it from a failure.
3. The tape reads at most 31 partitions per request (newest first). A `limit` larger than that
   window is served from that window rather than scanning the whole lake.
