# Phase 40 Research — Deterministic OHLCV Aggregation & Dual Schema Ingestion

**Phase:** 40-deterministic-ohlcv-aggregation-dual-schema-ingestion
**Milestone:** v5.0 Partitioned Parquet Tick Lake Integration (Repo B Contract Compliance)
**Requirements:** LAKE-RESAMPLE-01, LAKE-RESAMPLE-02, LAKE-RESAMPLE-03, LAKE-RESAMPLE-04
**Researched:** 2026-10-06
**Sources:** `docs/contracts/repo_b_tick_lake_contract.md` v1.5.0 (§3, §4.1, §7.3), `.planning/phases/40-.../40-01-PLAN.md`,
legacy API contract in `backend/streaming_service/duckdb_client.py`, empirical probes on DuckDB 1.5.6.

---

## 1. Problem Statement

Phase 39 delivered partition resolution only. Phase 40 adds the vectorized, in-memory DuckDB
execution layer that turns pruned Parquet files into deterministic OHLCV candles and raw ticks,
supporting both physical schemas present during the deferred `quote_rewrite`.

## 2. Contract Facts

| # | Fact | Ref |
|---|------|-----|
| 1 | Queries run on **isolated ephemeral** `duckdb.connect(":memory:")` sessions with `SET threads = 4`, `SET max_memory = '2GB'`, `SET TimeZone = 'UTC'` | §4.1, LAKE-RESAMPLE-01 |
| 2 | Read via `read_parquet(?, hive_partitioning=false)` — never infer Hive partitioning (dictionary `symbol` collision) | §4.1, §5 |
| 3 | Open/close use `arg_min`/`arg_max` over the tuple `(timestamp, ingest_id)`; high/low are `max`/`min`; volume `sum(coalesce(volume, 1.0))`; plus `count(*)` | §3.4 |
| 4 | Rows inside a file are sorted by `(timestamp, ingest_id)` — but determinism must come from the SQL key, not row order | §3.3, §3.4 |
| 5 | Schema **v1** files (all files on disk today): `timestamp, symbol, price, volume, bid, ask, source, session, ingest_id` | §3.2 |
| 6 | Schema **v2** rows (after the deferred rewrite): `timestamp, symbol, bid_price, ask_price, source, session, ingest_id` — **no `price`, no `volume`** | §3, §1.5.0 notes |
| 7 | Daily (`1d`) candles strictly filter Regular Trading Hours (`session = 'REG'`) | §3.4 / plan |
| 8 | Missing file in a resolved list raises `duckdb.IOException`; reader must re-resolve and retry | §7.3.3 |
| 9 | Empty partition match → `[]` with **no DuckDB execution** | §2.3 |
| 10 | Reader must be read-only (never create files under `ticks/`, `_staging/`, `_control/`) | §6.2 |

## 3. Empirical Probes (DuckDB 1.5.6, in-sandbox)

| Probe | Result | Consequence |
|-------|--------|-------------|
| `read_parquet([v1_file, v2_file], hive_partitioning=false)` | merges and returns all 12 rows | mixed-schema lists work; `union_by_name=true` additionally guarantees NULL-fill for absent columns |
| `SELECT coalesce(price, bid_price)` on a **v1-only** list | `BinderException: Referenced column "bid_price" not found` | **the plan's literal SQL is not executable on a single-schema file set** |
| `SELECT coalesce(price, bid_price)` on a **v2-only** list | `BinderException: Referenced column "price" not found` | same |
| `coalesce(price, bid_price)` + `sum(coalesce(volume,1.0))` on a **mixed** list with `union_by_name=true` | works: min 100.0, max 204.9, volume 16.0, 12 rows | mixed sets must pass `union_by_name=true` |
| `time_bucket(INTERVAL '1 second'…'1 day')` | all 12 legacy timeframes bucket correctly (1d → UTC midnight) | interval map from the legacy service is valid |
| `ORDER BY bucket DESC LIMIT n` | returns the most recent n buckets | "latest N, then reverse to ascending" semantics are implementable |
| `arg_min(price)` single-arg | does **not exist** (Phase 39 finding) | always two-argument form with the tuple key |

## 4. Design Decisions

1. **Column-presence-driven SQL.** The reader inspects each resolved file's Parquet footer
   (`pyarrow.parquet.read_schema`, metadata only) and builds the projection from what is present:
   * common = columns present in **every** file; union = columns present in **any** file.
   * `price_expr`: both `price` and `bid_price` common → `coalesce(price, bid_price)`;
     only `price` → `price`; only `bid_price` → `bid_price`; mixed (union only) →
     `coalesce(price, bid_price)` with `union_by_name=true`.
   * `volume_expr`: `coalesce(volume, 1.0)` when available, else literal `1.0` (v2 rows have no volume).
   * `bid_expr`/`ask_expr` (ticks): `bid` → `coalesce(bid, bid_price)` when mixed → `bid_price`;
     same for ask. Absent anywhere → `NULL`.
   * `ingest_id` must be common to all files — it is the tie-break key. A file lacking it raises
     `LakeIncompatibleSchemaError` rather than silently degrading determinism.
   * `session` must be common when RTH filtering is required (`1d` or explicit `session=`).
   * `symbol`: physical column when common, else the requested literal.
2. **Dual-schema price policy.** v1 candles aggregate `price`; v2 candles aggregate `bid_price`;
   mixed sets coalesce. This follows the phase plan (`COALESCE(price, bid_price)`) and contract
   §4.1's shipped example. *Documented tension:* §3 warns that on v1 files the stored quote is
   `bid`/`ask` and `price` is "not the stored quote"; the deferred rewrite is what introduces
   `bid_price`. Phase 41 can layer a quote-policy switch without touching this projection logic.
3. **`union_by_name=true` only for heterogeneous file sets** — never on homogeneous sets, so the
   contract's canonical `read_parquet(?, hive_partitioning=false)` path is preserved verbatim in the
   common case.
4. **Retry once on `duckdb.IOException`** (contract §7.3.3): re-resolve partitions, rebuild the
   projection, re-execute. A second failure propagates the original `duckdb.IOException`.
5. **API-shaped for Phase 41.** `query_candles(symbol, timeframe, start_time, end_time, limit,
   direction, session)` and `query_ticks(symbol, start_time, end_time, limit, offset, direction)`
   mirror the retired `DuckDBService` signatures; returned dict keys match the legacy shapes
   (`time/open/high/low/close/volume/tick_count` and `time/symbol/price/volume/bid/ask/source/session`)
   so the Phase 41 adapter is a thin delegate. Legacy `direction` semantics preserved: explicit
   `desc`, else "latest N before `end_time`" when `start_time` is absent; rows always returned ascending.
6. **Time inputs** are normalized in Python to naive UTC datetimes (accepting ISO strings with or
   without `Z`, `date`, naive and tz-aware datetimes) before binding — no reliance on DuckDB string
   casting.
7. **Guard discipline**: every query calls `ensure_ready()` first (validation + maintenance), and
   returns `[]` before opening a connection when no files resolve (§2.3, §6.1).

## 5. Test Strategy (test-first, red before implementation)

`backend/streaming_service/tests/test_lake_resampling.py`, over the Phase 39 factory (extended with
explicit-row writers and a v2 generator):

* **Config/isolation (LAKE-RESAMPLE-01):** spy on `duckdb.connect` to assert `:memory:` usage,
  exactly one `SET TimeZone/threads/max_memory` per connection, connection closed after each call,
  and no connection at all for empty results.
* **Determinism (LAKE-RESAMPLE-02):** identical results when files are reversed in the list; file row
  order deliberately unsorted; duplicate microsecond timestamps decided by `ingest_id`; expected
  OHLCV computed independently in Python; all timeframes `1s→1d` produce correct bucket boundaries.
* **Dual schema (LAKE-RESAMPLE-03):** v1-only, v2-only, and mixed-schema sets produce identical
  candles for identical prices; v2 sets never reference `price`; volume defaults to per-tick 1.0 on
  v2; a file missing `ingest_id` raises `LakeIncompatibleSchemaError`.
* **RTH (LAKE-RESAMPLE-04):** `1d` excludes `PRE`/`POST` ticks by default; explicit `session='ALL'`
  overrides; `session='PRE'` filters; 1m candles are unaffected by RTH policy.
* **Robustness:** empty/no-match → `[]` without DuckDB; maintenance guard blocks; `duckdb.IOException`
  from a deleted file triggers exactly one re-resolve + retry; persistent failure propagates; limit
  clamping; `desc` returns most recent N ascending; `query_ticks` ordering/offset/tie-break.

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Projection built for the wrong schema after a mid-rewrite compaction | Columns re-inspected on every execution *and* on retry re-resolution |
| Silent non-determinism if `ingest_id` absent | Hard `LakeIncompatibleSchemaError`; covered by a test |
| v1/v2 price-policy drift between phases | Policy centralized in one `_price_expr()` helper used by candles and ticks |
| `union_by_name` accidentally enabled on homogeneous sets | Enabled only when common ≠ union; asserted by a spy test |

## 7. Deliverables

- `backend/streaming_service/tick_lake_reader.py` (extended: DuckDB runner, projections, candles, ticks)
- `backend/streaming_service/tests/test_lake_resampling.py` (new)
- `backend/streaming_service/tests/tick_lake_factory.py` (extended: explicit-row + v2 helpers)
