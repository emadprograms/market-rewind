# Feature Analysis: Partitioned Parquet Tick Lake Integration

**Milestone:** v5.0
**Domain:** High-Frequency Tick Replay & Quantitative Data Pipeline
**Date:** 2026-10-06

---

## 1. Feature Landscape & Requirements

### Table Stakes (Must-Have for v5.0)

1. **Standalone Zero-Import Lake Reader (`RepoBTickReader`)**
   - Independent Python client requiring zero imports from `data-harvester`'s source code.
   - Root discovery precedence conforming to `repo_b_tick_lake_contract.md`.
   - Ephemeral in-memory DuckDB connections (`:memory:`) ensuring 100% lock-free concurrency.

2. **Partition Pruning & Canonical Symbol Encoding**
   - Filesystem resolution of `ticks/symbol=<ENCODED_SYMBOL>/date=<YYYY-MM-DD>/*.parquet`.
   - Safe set encoding `[A-Za-z0-9_-]` with uppercase percent-encoding for special characters (e.g. `BRK.B` -> `BRK%2EB`, `EUR/USD` -> `EUR%2FUSD`).
   - UTC event date filtering mapping query ISO timestamps to partition dates.
   - Immediate empty-list return when partition directories are absent (skipping DuckDB invocation).

3. **Dual Schema Support & Deterministic OHLCV Resampling**
   - Compatible with existing Schema v1 files (`timestamp`, `symbol`, `price`, `volume`, `bid`, `ask`, `source`, `session`, `ingest_id`).
   - Compatible with Schema v2 / new rows (`bid_price`, `ask_price`).
   - Deterministic tie-breaking for open and close prices using `arg_min(..., (timestamp, ingest_id))` and `arg_max(..., (timestamp, ingest_id))`.
   - Timeframe dynamic intervals (`1s`, `5s`, `15s`, `30s`, `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`).
   - Strict RTH filtering for daily (`1d`) candles (`session = 'REG'`).

4. **Reverse-Chronological Time & Sales / Order Flow Tape**
   - Dynamic reverse queries over latest active date partitions.
   - Spread calculation (`ask - bid` when both are present).
   - Bounded pagination with `limit` and `offset`.

5. **Operational Guards & Structured Error Taxonomy**
   - Inspection of `_maintenance/in_progress.json` before long-running queries; fails fast or retries gracefully with `LakeMaintenanceInProgressError`.
   - Fail-fast validation of `lake.json` raising `LakeUnavailableError`, `LakeCorruptedMetadataError`, `LakeIncompatibleSchemaError`.
   - Exclusion of non-queryable trees (`_staging/`, `_maintenance/`, `_migration/`, `_control/`).

6. **Backend Server API & Test Suite Alignment**
   - Update `backend/streaming_service/duckdb_client.py` and `backend/streaming_service/server.py` to route all queries through the lake reader.
   - Rewrite backend tests in `backend/streaming_service/tests/` to run against both synthetic test lakes and real data.
   - 100% pass rate on `npm run backend:test`.

---

### Differentiators (High Value)

1. **Snapshot Semantics & Barrier Resilience**
   - Per-request file resolution: snapshots reflect exact files resolved at query initiation.
   - Resilience against mid-query file rotation with automatic re-resolution retry on `duckdb.IOException`.
2. **Sub-50ms Query Latency**
   - Fast filesystem partition globbing + vectorized DuckDB Parquet scanner delivering sub-50ms OHLCV candle aggregation across tens of millions of ticks.
3. **Seamless Frontend Replay Compatibility**
   - Zero breaking changes to the REST `/api/candles`, `/api/ticks`, `/api/symbols`, `/api/status` contracts consumed by the React/Vite frontend.

---

### Out of Scope (Deferred to Future Milestones)

- **Parquet File Compaction**: Handled exclusively by `data-harvester`'s scheduled maintenance runner. Market Rewind is strictly read-only.
- **Provider Gap Reconciliation UI**: Visualizing provider disconnect ledger entries (`_control/gaps.json`) on the chart.
- **Direct PyArrow In-Browser WASM Scanner**: Replacing the Python backend with client-side PyArrow WASM in the browser.
