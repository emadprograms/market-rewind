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
