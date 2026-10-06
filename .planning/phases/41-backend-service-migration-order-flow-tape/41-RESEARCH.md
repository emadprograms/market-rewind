# Phase 41 Research — Backend Service Migration & Order Flow Tape

**Phase:** 41-backend-service-migration-order-flow-tape
**Milestone:** v5.0 Partitioned Parquet Tick Lake Integration (Repo B Contract Compliance)
**Requirements:** LAKE-API-01, LAKE-API-02, LAKE-API-03
**Researched:** 2026-10-06
**Sources:** `docs/contracts/repo_b_tick_lake_contract.md` v1.5.0 (§3, §4.2, §6, §7.1),
`41-01-PLAN.md`, `backend/streaming_service/{duckdb_client,server}.py`,
`src/lib/streamingClient.ts` + `src/types/index.ts` (the live frontend contract).

---

## 1. Problem Statement

`DuckDBService` still opens the deleted `streaming.duckdb`, so 11 backend tests fail and the UI
has no data source. Phase 41 re-points the service and HTTP layer at the tick lake, adds the
reverse-chronological Time & Sales tape with spread, and must not change a single API shape the
React client relies on.

## 2. The Frontend Contract (must not break)

| Consumer expectation | Evidence | Constraint on Phase 41 |
|---|---|---|
| `GET /api/status` → object with `status=="ok"`, `streaming_db.exists` | `streamingClient.ts:232`, `ConnectionModal.tsx:77` | keep `streaming_db` mapping; add `tick_lake` alongside |
| `GET /api/symbols` → array of `{symbol, tick_count, first_tick, last_tick}` | `streamingClient.ts:268` | array at top level (client also tolerates `{symbols:[...]}`) |
| `GET /api/symbols/{symbol}` → summary or 404 | `streamingClient.ts:295` | unchanged shape incl. `latest_quote` |
| `GET /api/ticks?symbol=&limit=&offset=&direction=` → array **or** `{ticks:[...]}` of `MarketTick` | `streamingClient.ts:308-341`, `types/index.ts:12` | `MarketTick` keys: `time,symbol,price,volume,bid,ask,source,session` |
| `GET /api/candles?symbol=&timeframe=&limit=&direction=&session=` → array **or** `{candles:[...]}` | `streamingClient.ts:465-471` | candle keys: `time,open,high,low,close,volume,tick_count` |
| `WS /ws/replay` with actions `load|play|pause|step|set_speed|seek` | `streamingClient.ts:574`, `server.py:ReplaySession` | keep the route; the plan's `/ws/playback` is added as an alias |
| Missing `symbol` → 400 with `{error: ...}` | `server.py:handle_ticks/handle_candles` | keep |

## 3. Contract Facts Driving the Tape

| # | Fact | Ref |
|---|------|-----|
| 1 | Tape is reverse-chronological: `ORDER BY timestamp DESC, ingest_id DESC` | §4.2 |
| 2 | Spread is computed, not stored: `(ask - bid)`, null when either side is null | §4.2 |
| 3 | Quote coalescing for dual schema: `coalesce(bid, bid_price)`, `coalesce(ask, ask_price)` | §3 |
| 4 | Latest data lives in the newest `date=` partition; tape reads the newest partition(s) | §4.2 |
| 5 | Maintenance guard: queries fail fast while `_maintenance/in_progress.json` exists; readers should retry 5–30s | §6.1 |
| 6 | Fail-fast validation errors are structured (`LakeUnavailableError`, `LakeMaintenanceInProgressError`, …) | §7.1 |
| 7 | Readers must not scan `_staging/`, `_migration/`, `_control/` | §2.1 |

## 4. Design Decisions

1. **Thin adapter.** `DuckDBService` becomes a wrapper: it owns a `TickLakeReader` and delegates
   every data call. The constructor keeps the legacy `streaming_path` keyword (ignored, with a
   deprecation note) so `create_app(streaming_db=...)` callers don't break, and gains `lake_root`.
2. **Status shape.**
   `{status, tick_lake:{path, exists, format, schema_version, maintenance_in_progress,
   symbol_count, partition_count, file_count, tick_count}, streaming_db:{path, exists,
   size_bytes, tick_count}}` — `historical_db` is never emitted (asserted by the existing test).
   Counts come from Parquet **footers only** (metadata read, no data scan) and `tick_count` is
   reported as `None` above a file-count threshold so a huge lake cannot stall `/api/status`.
3. **`get_symbols`** lists decoded partition names and aggregates per symbol in a single grouped
   query (one scan for all symbols, not N queries), sorted by `tick_count DESC` (legacy order).
   Symbols with zero rows are dropped to preserve the legacy "only real data" behavior.
4. **`get_symbol_summary`** aggregates one symbol (`tick_count`, `min/max timestamp`,
   `min/max price` over the same price expression used for candles) plus `latest_quote` taken
   from `query_tape(limit=1)` so the summary's price and the tape can never disagree.
5. **Tape**: `query_tape(symbol, limit)` on the reader; newest partition first, spilling into
   older partitions only when the newest ones cannot satisfy `limit` — the contract shows the
   simple form, but a Time & Sales panel with `limit>partition size` must not silently truncate.
   SQL keeps `ORDER BY timestamp DESC, ingest_id DESC` and `round(ask-bid, 4)`.
6. **HTTP error mapping** (single helper, no duplicated try/except):
   * `LakeMaintenanceInProgressError` → **503** `{"error": "Lake maintenance in progress", "retry_after": 5}`
   * `LakeUnavailableError` → **503** `{"error": "Tick lake unavailable", "retry_after": 10}`
   * other `LakeReaderError` (corrupt/incompatible metadata) → **503** with the message
   * malformed query parameters (`limit=abc`) → **400** instead of a 500 stack trace
7. **`/api/ticks?direction=desc`** returns the tape (with `spread`) — the frontend's Time & Sales
   path. `offset` is applied to the tape window so pagination still works.
8. **WebSocket** keeps `/ws/replay` and adds `/ws/playback`; `ReplaySession.load_ticks` already
   calls `db.query_ticks(...)`, which now streams real Parquet ticks. `load` failures surface as
   `{"type":"error"}` messages rather than closing the socket.

## 5. Test Strategy (test-first; all must be red before implementation)

* `tests/test_order_flow_tape.py` (new): ordering, tie-break, spread math incl. nulls, dual
  schema (v2 bid_price/ask_price), symbol isolation, limit/spill behavior, maintenance guard,
  empty symbol → `[]`.
* `tests/test_duckdb_service.py` (rewrite): status/tick_lake shape, `historical_db` absent,
  symbols decoded (`BRK.B`) + sorted, summary fields + latest quote equal to tape head,
  ticks/candles delegation incl. daily RTH == explicit REG, unknown symbol → `None`, lake
  missing → status `unavailable` without raising, maintenance flag surfaced.
* `tests/test_server.py` (rewrite on `IsolatedAsyncioTestCase` + `TestClient`): every endpoint
  200 + shape, 400 for missing symbol/bad limit, 404 unknown symbol, 503 maintenance + 503
  unavailable, `direction=desc` tape with spread, and a WebSocket `load/step` round-trip.

The 11 previously failing legacy tests are replaced by these (same file names, same intent,
tick-lake data source) — that is exactly `LAKE-VERIFY-01`'s "update the suite" work, executed
here because Phase 42 only re-verifies.

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Footer-based counts slow on a huge real lake | File-count threshold → `tick_count: None` instead of blocking |
| Tape returns nothing when the newest partition is empty | Spill to older partitions until `limit` is met |
| Metadata errors leak as 500s to the UI | Single `LakeReaderError` → 503 mapping + tests |
| Removing `streaming_path` breaks `create_app(streaming_db=…)` callers | Legacy keyword retained and documented as ignored |
| WS regression (frontend pinned to `/ws/replay`) | Route kept, alias added, round-trip test |

## 7. Deliverables

- `backend/streaming_service/tick_lake_reader.py` (+ `query_tape`, `symbol_stats`, `lake_totals`)
- `backend/streaming_service/duckdb_client.py` (rewritten as a tick-lake adapter)
- `backend/streaming_service/server.py` (error mapping, tape direction, WS alias)
- `backend/streaming_service/tests/{test_order_flow_tape.py, test_duckdb_service.py, test_server.py}`
