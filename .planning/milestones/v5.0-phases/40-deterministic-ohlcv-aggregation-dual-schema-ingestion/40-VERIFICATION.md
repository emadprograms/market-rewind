---
phase: 40-deterministic-ohlcv-aggregation-dual-schema-ingestion
status: passed
verified_at: 2026-10-06
must_haves:
  - id: LAKE-RESAMPLE-01
    status: passed
    description: Isolated in-memory DuckDB runner with threads/max_memory/UTC bounds and guaranteed connection close.
  - id: LAKE-RESAMPLE-02
    status: passed
    description: Deterministic OHLCV aggregation across 1s..1d using arg_min/arg_max on (timestamp, ingest_id).
  - id: LAKE-RESAMPLE-03
    status: passed
    description: Dual schema v1/v2 ingestion with coalesced prices and union_by_name only when heterogeneous.
  - id: LAKE-RESAMPLE-04
    status: passed
    description: Daily candles strictly filtered to session = 'REG' unless explicitly overridden.
---

# Phase 40 Verification: Deterministic OHLCV Aggregation & Dual Schema Ingestion

## Test Verification Matrix

| Suite | Passed | Total | Skipped | Duration | Status |
|---|---|---|---|---|---|
| `test_lake_resampling.py` (Phase 40) | 48 | 48 | 0 | 1.30s | PASSED (100%) |
| `test_tick_lake_reader.py` (Phase 39 regression) | 80 | 80 | 1 | 0.94s | PASSED (100%) |
| Whole backend (`npm run backend:test`) | 128 | 139 | 1 | 2.56s | PHASES 39/40 GREEN — 11 legacy failures are Phase 41 scope |
| Fresh clone at `/tmp` (portability) | 127 | 129 | 2 | 2.36s | PASSED (no failures) |
| Fresh clone with `TICK_LAKE_ROOT` set | 48 | 48 | 0 | 1.43s | PASSED |
| `MR_SANDBOX_LAKE_ROOT` → missing path | 48 | 48 | 0 | 1.45s | PASSED (graceful skip) |

Red-phase evidence: all 44 original Phase 40 tests failed before the query engine existed
(`AttributeError: 'TickLakeReader' object has no attribute 'query_candles'`) — the suite was
written test-first.

## Requirement Traceability

- **LAKE-RESAMPLE-01**: PASSED — every execution used `duckdb.connect(":memory:")` with the three
  mandatory `SET` statements (asserted via a connection spy), each connection closed after use,
  and empty partitions short-circuit before any connection is opened.
- **LAKE-RESAMPLE-02**: PASSED — 1s/5s/15s/30s/1m/5m/15m/30m/1h/4h/1d buckets verified against
  an independent reference implementation; identical microsecond timestamps resolved by
  `ingest_id` irrespective of row order; 100 file-list permutations yielded one result signature.
- **LAKE-RESAMPLE-03**: PASSED — v2-only sets resample from `bid_price`; v1-only from `price`;
  mixed sets coalesce with `union_by_name` enabled only for heterogeneous lists (asserted by SQL
  inspection); a file without `ingest_id` raises `LakeIncompatibleSchemaError`.
- **LAKE-RESAMPLE-04**: PASSED — daily candles exclude `PRE`/`POST` (volume 3.0 vs 113.0 when
  including all sessions), `session='ALL'` and explicit session filters behave as documented,
  non-daily timeframes are unaffected, and an empty-string session still enforces RTH.

## Independent Re-computation (no shared code with the implementation)

| Check | Result |
|---|---|
| 1m candles vs Python aggregation over raw Parquet — `AAPL` / `NVDA` / `BRK.B` | MATCH (exact OHLC + tick counts; volume within 1e-9 relative) |
| 1d RTH candles vs REG-only Python aggregation — `NVDA` | MATCH exactly (open 121.0, close 122.0, volume 3.0, 2 ticks; PRE 5.0 and POST 9.0 excluded) |
| 100 shuffled file-list permutations | 1 distinct result signature (deterministic) |

## Mutation Testing (8/8 killed)

| Mutation | Failing tests |
|---|---|
| Tie-break drops `ingest_id` | 1 |
| Daily RTH filter disabled | 2 |
| Volume coalesce removed | 1 |
| `union_by_name` never enabled | 2 |
| IOException retry removed | 2 |
| Price expression forced to `price` | 2 |
| Date-only end bound no longer inclusive | 3 |
| Symbol filter removed (foreign rows leak) | 1 |

## Defects found by self-review and fixed (implementation)

| # | Defect | Impact | Fix |
|---|--------|--------|-----|
| 1 | `_execute_query` performed projection/footer inspection **outside** the retry `try` block | A file vanishing between resolve and query raised before the retry could run; contract §7.3.3 violated | Build + connect + execute wrapped in the retry scope; connection closed in `finally` |
| 2 | Date-only `end_time` (`'2026-10-02'`) was cast to midnight, excluding the whole day | Daily/date-range queries silently returned `[]` | `_end_boundary()`: date-only bounds become `< next midnight` (inclusive of the whole day); explicit timestamps keep legacy `<=` |
| 3 | `session=""` skipped the automatic RTH filter for `1d` | A caller passing an empty string silently received PRE/POST candles | Empty/whitespace session normalized to "unspecified" → RTH still enforced |

## Test defects found and fixed (test-side, for the record)

1. `ConnectSpy` recursed infinitely by calling the monkeypatched `duckdb.connect` (fixed by
   holding a private reference to the real connector).
2. Precise-value tests wrote fixtures into the mini-lake's generated data, contaminating
   expected values (fixed with a hermetic empty `fresh_lake(tmp_path)`).
3. 5m/15m bucket expectations used tick times spanning multiple buckets (fixed by per-timeframe
   tick placement).
4. One test removed `ingest_id` after the factory had already required it; rewritten to emit a
   raw Parquet file without the column.
5. A "repeated queries" test asserted over an empty lake; data added.
6. A ticks-shape test passed `price=None` then patched it afterwards; corrected at construction.
7. The persistent-IO-error test assumed the retry would see a non-empty stale list; rewritten to
   model a filesystem that keeps returning the vanished file, which is the case that must raise.

## Known Nuances

1. Volume sums may differ from an independent implementation in the last ULP (floating-point
   summation order). OHLC and tick counts are exact; the contract's determinism requirement is
   satisfied for ordering/tie-breaking, and intra-DuckDB results are byte-identical across runs.
2. v1 candles aggregate `price` per contract §4.1 and the phase plan; contract §3's note that a
   v1 file's stored *quote* is `bid`/`ask` is a Phase 41 quote-policy decision.
