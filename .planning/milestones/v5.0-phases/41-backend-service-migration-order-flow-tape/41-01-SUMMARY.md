---
phase: 41-backend-service-migration-order-flow-tape
plan: 01
status: completed
executed_at: 2026-10-06
requirements:
  - LAKE-API-01
  - LAKE-API-02
  - LAKE-API-03
---

# Summary 41-01: Backend Service Migration & Order Flow Tape

## Execution Results

1. **`DuckDBService` is now a read-only tick-lake adapter** (`duckdb_client.py`, rewritten):
   no disk database, no `ATTACH`, no read-only file handles — every query goes through
   `TickLakeReader`. The legacy `streaming_path` keyword is accepted and ignored so
   `create_app(streaming_db=…)` callers keep working; `lake_root` overrides discovery.

2. **`get_status()` never raises.** It reports `ok` / `unavailable` (missing root) /
   `degraded` (corrupt or incompatible metadata) with a `tick_lake` block
   (`path, exists, format, schema_version, compatible_versions, maintenance_in_progress,
   symbol_count, partition_count, file_count, size_bytes, tick_count`) plus a
   backward-compatible `streaming_db` block; `historical_db` is never emitted.

3. **`get_symbols()`** decodes partition names (`BRK%2EB` → `BRK.B`) and aggregates every
   symbol in a single grouped DuckDB query, sorted by tick count descending; empty symbols
   are dropped.

4. **`get_symbol_summary()`** returns aggregates plus `latest_quote` taken from the tape head,
   so the summary price and Time & Sales can never disagree; unknown symbols return `None`
   (HTTP 404).

5. **Order flow tape** (`TickLakeReader.query_tape`): newest `date=` partitions first,
   `ORDER BY timestamp DESC, ingest_id DESC`, spread `round(ask - bid, 4)` (NULL when either
   side is missing), dual-schema quotes (`bid`/`bid_price`), and a spill into older partitions
   so a thin latest partition cannot truncate the panel.

6. **`server.py`**: every data endpoint maps the structured `LakeReaderError` family to JSON
   responses — maintenance → **503** `{"error": "Lake maintenance in progress", "retry_after": 5}`,
   unavailable lake → **503** `{"error": "Tick lake unavailable", "retry_after": 10}`, other
   metadata errors → 503 with detail; malformed `limit`/`offset` → **400**. `/api/ticks?direction=desc`
   now serves the tape (with `spread`), `/ws/replay` streams real Parquet ticks, and `/ws/playback`
   is registered as an alias. The CLI gains `--lake-root`; `--streaming-db` is deprecated.

## Requirement → Change → Files → Tests Map

| Requirement | Change made | Files edited | Tests created |
|---|---|---|---|
| **LAKE-API-01** (service adapter migration) | `DuckDBService` rewritten as a thin `TickLakeReader` facade; status/symbols/summary/ticks/candles preserved; legacy keyword retained; no disk DB code (asserted via AST code-only check) | `duckdb_client.py` (rewritten), `tick_lake_reader.py` (`symbol_stats`, `lake_totals`) | `test_service_accepts_explicit_lake_root`, `test_service_discovers_lake_from_env`, `test_legacy_streaming_path_kwarg_is_accepted_and_ignored`, `test_service_never_attaches_a_disk_database`, `test_service_status_shape`, `test_service_status_reports_maintenance`, `test_service_status_when_lake_missing`, `test_service_status_when_metadata_corrupt`, `test_service_get_symbols`, `test_service_get_symbols_decodes_encoded_partitions`, `test_service_get_symbols_sorted_by_tick_count_desc`, `test_service_get_symbols_on_empty_lake_returns_empty`, `test_service_symbol_summary`, `test_service_symbol_summary_is_case_insensitive`, `test_service_symbol_summary_latest_quote_matches_tape_head`, `test_service_symbol_summary_unknown_returns_none`, `test_symbol_summary_ignores_foreign_rows_inside_the_partition`, `test_service_symbol_summary_encoded_symbol`, `test_service_query_ticks`, `test_service_query_ticks_desc`, `test_service_query_tape_has_spread`, `test_service_dynamic_candles_subsecond`, `test_service_dynamic_candles_minute`, `test_service_dynamic_candles_daily_rth_only`, `test_service_candles_unknown_symbol_returns_empty`, `test_service_against_sandbox_lake` |
| **LAKE-API-02** (reverse-chronological tape + spread) | `TickLakeReader.query_tape` with newest-partition-first resolution, `(timestamp, ingest_id) DESC`, dual-schema quote coalescing, NULL-safe spread, limit clamping and spill; exposed via `/api/ticks?direction=desc` | `tick_lake_reader.py`, `server.py` | `test_tape_is_reverse_chronological`, `test_tape_tie_break_uses_ingest_id_descending`, `test_tape_computes_spread_from_bid_ask`, `test_tape_spread_is_null_when_a_quote_side_is_missing`, `test_tape_supports_schema_v2_quotes`, `test_tape_merges_mixed_schema_partitions`, `test_tape_respects_limit`, `test_tape_spills_into_older_partitions_to_satisfy_limit`, `test_tape_coalesces_null_volume`, `test_tape_returns_contract_keys`, `test_tape_isolates_symbol_and_ignores_foreign_rows`, `test_tape_unknown_symbol_returns_empty`, `test_tape_limit_zero_returns_empty`, `test_tape_blocked_by_maintenance_guard`, `test_tape_against_rich_lake`, `test_get_ticks_desc_returns_tape_with_spread` |
| **LAKE-API-03** (REST/WS alignment + maintenance 503) | Server error mapping (`LakeReaderError` → 503, bad params → 400), tape direction routing, WS `/ws/playback` alias, real-Parquet WS playback, `--lake-root` CLI | `server.py`, `duckdb_client.py` | `test_get_status_endpoint`, `test_get_symbols_endpoint`, `test_get_symbol_summary_endpoint`, `test_get_symbol_summary_unknown_returns_404`, `test_encoded_symbol_endpoint`, `test_get_ticks_endpoint`, `test_get_ticks_missing_symbol_returns_400`, `test_get_ticks_bad_limit_returns_400`, `test_get_candles_endpoint`, `test_get_candles_daily_matches_reg_session`, `test_get_candles_missing_symbol_returns_400`, `test_unknown_symbol_candles_returns_empty_list`, `test_websocket_load_and_step`, `test_websocket_playback_alias`, `test_maintenance_returns_503_with_retry_after`, `test_unavailable_lake_returns_503` |

Test counts: `test_order_flow_tape.py` 15 · `test_duckdb_service.py` 26 · `test_server.py` 17 = **58 Phase 41 tests** (all test-first).

## Verification Loop Record

- **Red:** 57 Phase 41 tests failed/errored against the Phase 40 code (no `query_tape`, service still on the retired database, 11 legacy failures still present before rewrite).
- **Green iterations:** 3 rounds — (1) tape layer implemented and green; (2) service adapter green after reworking the AST-based "no disk DB" assertion (docstring stripping) and fixing the test factory to emit RTH-default ticks (generated data previously all sat in `PRE`, so daily RTH correctly returned nothing); (3) server layer green with the 503/400 mapping.
- **Final:** whole backend suite **186 passed, 0 failed, 1 skipped** (`npm run backend:test`) — the first fully green backend run in this milestone; the 11 legacy failures are resolved.
- **Mutation testing (8/8 killed):** tape ordering, spread NULL handling, bid-vs-price quote expression, `symbol_stats` symbol filter, server DESC→tape routing, 503 mapping, tape spill, summary quote source. Two mutations initially did not apply (anchor mismatch) and one survived, exposing a **missing test** for foreign rows in `symbol_stats`; that test was added and the mutation then died.
- **Independent verification over real HTTP + WebSocket:** status counts equal filesystem/Parquet-footer truth (5 symbols, 14 files, 2046 ticks); tape equals an independent PyArrow ordering (timestamps, prices, spreads); ticks/candles equal direct reader output; summary quote equals tape head; WS `load`/`step` round-trip works; maintenance returns real 503 with `retry_after: 5`.
- **Portability:** fresh clone 185 passed / 2 skipped; clone with `TICK_LAKE_ROOT` 186/1; clone-local lake 186/1; `MR_SANDBOX_LAKE_ROOT` override clean.

## Notes / Deviations

- The plan mentions `/ws/playback`; the live frontend is pinned to `/ws/replay`. Both routes are
  registered (alias), so neither the plan nor the client is broken.
- WS cannot return an HTTP 503 mid-socket: load failures (including maintenance) are delivered as
  `{"type": "error"}` messages while REST endpoints return 503 — documented behavior.
- `tick_count` in `/api/status` is `None` above 2000 files (footers are not scanned) to keep the
  status probe fast on a large production lake; the sandbox lake reports exact counts.
- `docs/contracts/repo_b_tick_lake_contract.md` (vendored in Phase 39) remains the reference;
  this phase added no new contract surface.

## Re-Verification Round 2 (post-audit hardening)

Independent audit of the pushed commit found and fixed two defects, plus three test gaps:

* **Defect A (high):** `query_tape` and `/api/ticks?direction=desc` ignored
  `start_time`/`end_time`, so a bounded Time & Sales request silently returned an unbounded
  tape. Bounds are now normalized, applied in SQL, and used to prune partitions; the server
  forwards them.
* **Defect B (low):** a lake with zero files reported `tick_count: null` in `/api/status`;
  it now reports `0`.
* **Test gaps closed:** the date-only end-bound predicate was uncovered for *tape*, *ticks*
  and *candles* (three separate survivors across two mutation rounds), and partition-range
  pruning had no assertion. Regression guards were added for `/api/streaming/candles`
  (the React client's primary endpoint) and encoded-slash symbol routes.

Final backend state: **197 passed, 1 skipped, 0 failed.** Mutation round 2: 6/6 killed after
gap closing (plus 2 shared-predicate survivors found by auditing sibling code paths).
