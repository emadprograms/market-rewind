---
phase: 40-deterministic-ohlcv-aggregation-dual-schema-ingestion
plan: 01
status: completed
executed_at: 2026-10-06
requirements:
  - LAKE-RESAMPLE-01
  - LAKE-RESAMPLE-02
  - LAKE-RESAMPLE-03
  - LAKE-RESAMPLE-04
---

# Summary 40-01: Deterministic OHLCV Aggregation & Dual Schema Ingestion

## Execution Results

1. **In-memory DuckDB runner** — `TickLakeReader._connect()` opens an isolated
   `duckdb.connect(":memory:")` session per query with `SET TimeZone = 'UTC'`,
   `SET threads = 4`, `SET max_memory = '2GB'` (both overridable via constructor, with
   validation), and always closes the connection in a `finally` block.

2. **Column-presence-driven SQL** — the reader inspects each resolved file's Parquet footer
   (metadata only, cached by `(mtime, size)`) and derives the projection from the intersection
   and union of the physical columns. This was required because probes proved the plan's
   literal `coalesce(price, bid_price)` raises a DuckDB binder error on any single-schema file
   set. `union_by_name=true` is enabled **only** when files are heterogeneous.

3. **Deterministic resampling** — `time_bucket(INTERVAL '{interval}', timestamp)` across all 12
   timeframes (1s → 1d) with `arg_min`/`arg_max` over the `(timestamp, ingest_id)` tuple key,
   `max`/`min` for high/low, `sum(coalesce(volume, 1.0))`, `count(*)`.

4. **Dual schema ingestion** — v1 files aggregate `price`; v2 rows aggregate `bid_price`; a
   mixed v1+v2 partition set coalesces both. Ticks expose `bid`/`bid_price` and `ask`/`ask_price`
   equivalently. A file lacking `ingest_id` raises `LakeIncompatibleSchemaError` instead of
   silently degrading determinism.

5. **Daily RTH isolation** — `1d` candles filter `upper(session) = 'REG'` by default (the
   empty string is treated as unspecified), while `session='ALL'` or an explicit session value
   overrides. Non-daily timeframes are never RTH-filtered.

6. **Robustness** — one re-resolve + retry on `duckdb.IOException` covering both projection
   inspection and execution (§7.3.3); empty partitions return `[]` without opening DuckDB;
   the maintenance guard blocks all queries.

7. **Legacy-compatible API** — `query_candles(symbol, timeframe, start_time, end_time, limit,
   direction, session)` and `query_ticks(symbol, start_time, end_time, limit, offset, direction)`
   mirror the retired `DuckDBService` signatures; result dictionaries match the legacy shapes
   (`time/open/high/low/close/volume/tick_count` and
   `time/symbol/price/volume/bid/ask/source/session`), so Phase 41's adapter is a thin delegate.

## Requirement → Change → Files → Tests Map

| Requirement | Change made | Files edited | Tests created |
|---|---|---|---|
| **LAKE-RESAMPLE-01** (isolated in-memory DuckDB runner) | `_connect()` with mandatory `:memory:` + `TimeZone`/`threads`/`max_memory`; connection always closed; no connection for empty results | `tick_lake_reader.py` | `test_query_uses_memory_connection_with_required_settings`, `test_each_query_opens_and_closes_its_own_connection`, `test_hive_partitioning_disabled_in_every_query`, `test_empty_partition_returns_empty_without_duckdb`, `test_reader_is_read_only_during_queries` |
| **LAKE-RESAMPLE-02** (deterministic OHLCV aggregation 1s→1d) | `time_bucket` + `arg_min`/`arg_max` on `(timestamp, ingest_id)`; interval map; limit clamping; `desc`/end-time window semantics returning ascending buckets | `tick_lake_reader.py` | `test_one_minute_candle_matches_reference_formula`, `test_candles_split_across_bucket_boundaries`, `test_subsecond_timeframes` (4 params), `test_larger_timeframes_aggregate_one_bucket` (5 params), `test_tie_break_uses_ingest_id_not_row_order`, `test_reversed_file_list_produces_identical_candles`, `test_repeated_queries_are_byte_identical`, `test_candles_only_include_requested_symbol`, `test_rows_for_another_symbol_inside_the_partition_are_excluded`, `test_start_end_time_bounds_are_respected`, `test_date_only_end_time_is_inclusive_of_the_whole_day`, `test_explicit_end_timestamp_keeps_inclusive_leq_semantics`, `test_desc_direction_returns_latest_n_in_ascending_order`, `test_end_time_without_direction_returns_latest_window`, `test_limit_is_clamped_and_never_negative`, `test_unknown_timeframe_defaults_to_one_minute`, `test_timeframe_normalization_case_insensitive` |
| **LAKE-RESAMPLE-03** (dual schema compatibility) | Column-presence projection with `coalesce(price, bid_price)`, `volume` fallback to per-tick `1.0`, quote coalescing, `union_by_name` only when heterogeneous; `ingest_id` required | `tick_lake_reader.py`, `tick_lake_factory.py` (`rows_v1`/`rows_v2`/`write_rows_as`) | `test_schema_v2_only_files_resample_from_bid_price`, `test_schema_v1_and_v2_produce_identical_candles_for_identical_prices`, `test_mixed_schema_partitions_in_one_query_are_coalesced`, `test_mixed_schema_uses_union_by_name_only_when_heterogeneous`, `test_file_without_ingest_id_raises_incompatible_schema` |
| **LAKE-RESAMPLE-04** (daily RTH session isolation) | Automatic `session='REG'` filter for `1d`; explicit override incl. `ALL`; empty-string normalization | `tick_lake_reader.py` | `test_daily_candles_exclude_pre_and_post_sessions`, `test_daily_rth_filter_is_default_even_without_session_argument`, `test_daily_empty_session_string_still_enforces_rth`, `test_daily_session_override_all_includes_every_session`, `test_subsecond_timeframes_are_not_rth_filtered`, `test_explicit_pre_session_filter` |

Robustness tests (supporting the above): `test_maintenance_guard_blocks_queries`,
`test_stale_resolved_file_triggers_one_reresolve_and_retry`, `test_persistent_io_error_propagates`,
`test_query_ticks_returns_legacy_shape`, `test_query_ticks_direction_and_offset`,
`test_query_ticks_tie_break_is_deterministic`, `test_rich_lake_candles_and_ticks`,
`test_rich_lake_daily_rth_subset_of_all_sessions`.

## Verification Loop Record

- **Red:** 44/44 Phase 40 tests failed against the Phase 39 reader (no query methods).
- **Green iterations:** 3 rounds — (1) fixed a test-spy recursion defect and the retry scope;
  (2) replaced mini-lake contamination in precise tests with hermetic fresh lakes and fixed
  wrong bucket expectations; (3) implemented inclusive date-only end bounds and the
  session-empty-string edge case.
- **Final:** `48 passed` (Phase 40), `80 passed, 1 skipped` (Phase 39, no regression),
  whole backend `128 passed, 11 failed, 1 skipped` (the 11 legacy service/API failures are
  Phase 41 scope).
- **Independent recomputation:** reader candles for `AAPL`, `NVDA`, `BRK.B` match a Python
  aggregation over raw Parquet (exact OHLC + tick counts; volume within 1e-9 relative FP
  tolerance). Daily RTH candles for `NVDA` match a REG-only recomputation exactly.
  100 file-list permutations produced 1 distinct result signature (fully deterministic).
- **Mutation testing:** 8/8 injected mutations killed (tie-break, RTH filter, volume coalesce,
  `union_by_name`, retry, price expression, date-end inclusive, symbol filter).

## Notes / Deviations

- The plan's literal SQL is not executable on single-schema file sets (binder error, proven by
  probe); the column-presence projection is the compliant equivalent and is documented in
  `40-RESEARCH.md` §3–§4.
- Volume sums between DuckDB and Python differ in the last ULP due to floating-point summation
  order; OHLC/tick counts are exact. Documented rather than masked.
- v1 candle prices use `price` (matching contract §4.1's shipped example and the phase plan's
  `coalesce(price, bid_price)`); contract §3's remark that v1's stored *quote* is `bid`/`ask`
  is noted for Phase 41's quote-policy layer.
