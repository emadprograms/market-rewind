# Project Research Summary

**Project:** Market Rewind - Pure Streaming DuckDB Replay Engine & Global Multi-Asset Simulator
**Domain:** High-Frequency Financial Time-Series Replay & Parquet Data Lake
**Researched:** 2026-10-06
**Confidence:** HIGH

---

## Executive Summary

Data Harvester has completed its Milestone v5.0 migration to the **Partitioned Parquet Tick Lake** architecture and has permanently retired and deleted both `streaming.duckdb` and `historical.duckdb`. As a direct result, Market Rewind's legacy backend data access layer (which assumed a local `streaming.duckdb` file and suffered from DuckDB disk-level concurrency locking) is completely broken, failing 11/11 backend tests.

To restore functionality and establish an institutional-grade, lock-free architecture, Market Rewind must implement full compliance with Data Harvester's canonical **Repo B Tick Lake Read Contract (v1.5.0)** (`data-harvester/docs/contracts/repo_b_tick_lake_contract.md`). Under this contract, Market Rewind operates as an independent reader with zero code imports from `data-harvester`, executing queries against finalized, immutable Parquet micro-batches using private in-memory DuckDB connections (`:memory:`).

The integration requires a clean, four-stage phased delivery:
1. **Isolated Reader Engine & Contract Test Harness**: Construct the standalone `TickLakeReader` module with canonical symbol encoding, partition pruning, and structured exceptions, proved by contract test suites.
2. **Deterministic Resampling & Dual Schema Ingestion**: Implement robust OHLCV candle aggregation with `(timestamp, ingest_id)` tie-breaking and support for both Schema v1 (`price`, `volume`) and Schema v2 (`bid_price`, `ask_price`).
3. **Backend Service Migration & Order Flow Tape**: Transition `DuckDBService` and `server.py` to use the lake reader, supporting reverse-chronological tape queries and maintenance guards.
4. **End-to-End Verification & Full Regression Suite**: Validate 100% green pass rate across `npm run backend:test`, Vitest unit tests, and Playwright journey tests.

---

## Key Findings

### Recommended Stack

Market Rewind requires zero new external libraries; it uses standard `duckdb >= 1.0.0` and Python standard library (`pathlib`, `datetime`). Zero imports from `data-harvester`'s `src/` tree are permitted.

**Core technologies:**
- **In-Memory DuckDB (`duckdb.connect(":memory:")`)**: Ephemeral private sessions with `threads=4` and `max_memory=2GB` for vectorized Parquet scanning without disk lock contention.
- **Vectorized `read_parquet(?, hive_partitioning=false)`**: Direct scanning of pruned Parquet batch files.
- **Filesystem Partition Pruning**: Python-level directory resolution avoiding recursive scanning over root.

### Expected Features

**Must have (table stakes):**
- Standalone zero-dependency lake reader module with zero `data-harvester` imports.
- Proper uppercase percent-encoding for `[A-Za-z0-9_-]` safe set (e.g. `BRK.B` -> `BRK%2EB`).
- Partition pruning to `ticks/symbol=<ENCODED_SYMBOL>/date=<YYYY-MM-DD>/*.parquet`.
- Dual-schema compatibility for Schema v1 and Schema v2 rows.
- Deterministic OHLCV candle resampling with `arg_min` / `arg_max` tie-breakers.
- Reverse-chronological order flow tape queries with spread calculation.
- Maintenance guard detection checking `_maintenance/in_progress.json`.
- 100% pass rate on `npm run backend:test`.

**Should have (competitive):**
- Automatic query retry on `duckdb.IOException` caused by mid-query file rotation.
- Sub-50ms query response time across multi-gigabyte partitions.

**Defer (v5.1+):**
- Visualizing provider gap ledger entries (`_control/gaps.json`) directly in the UI chart timeline.

### Architecture Approach

A clean adapter pattern: `backend/streaming_service/tick_lake_reader.py` implements the pure Repo B contract, and `DuckDBService` in `backend/streaming_service/duckdb_client.py` wraps it to maintain backward compatibility with `server.py` and the frontend API.

**Major components:**
1. `TickLakeReader`: Contract parser, partition resolver, in-memory DuckDB executor.
2. `DuckDBService` adapter: Preserves existing API signatures (`get_symbols`, `query_candles`, `query_ticks`, `get_status`).
3. `server.py`: REST and WebSocket API endpoints serving Market Rewind UI.

### Critical Pitfalls

1. **Recursive root globbing**: Scanning `<TICK_LAKE_ROOT>/**/*.parquet` touches `_staging/` (partial files) and causes crashes. *Mitigation: Prune strictly within `ticks/`*.
2. **Symbol unescaped paths**: Looking for `symbol=BRK.B/` matches nothing. *Mitigation: Uppercase percent-encode `[^A-Za-z0-9_-]`*.
3. **Hive partition collision**: Physical dictionary-encoded `symbol` column collides with Hive inference. *Mitigation: Use `hive_partitioning=false`*.
4. **Snapshot race**: File deleted mid-query by compaction. *Mitigation: Check maintenance guard, retry on `duckdb.IOException`*.

---

## Implications for Roadmap

Suggested phase structure for Milestone v5.0:

### Phase 39: Standalone Tick Lake Reader & Symbol Partition Pruning
- **Rationale:** Foundational data access layer must be verified before connecting to server or resampling logic.
- **Delivers:** `TickLakeReader` class with root discovery, symbol encoding, partition pruning, and structured exception taxonomy (`LakeUnavailableError`, `LakeMaintenanceInProgressError`).
- **Addresses:** Safe partition resolution and contract isolation.
- **Avoids:** Unescaped symbol lookup failures and recursive root globbing.

### Phase 40: Deterministic OHLCV Aggregation & Dual Schema Support
- **Rationale:** Core analytical capability of Market Rewind is dynamic candle aggregation across multiple timeframes.
- **Delivers:** Vectorized `read_parquet` resampling queries with `arg_min`/`arg_max` tie-breaking, timeframe intervals (`1s` to `1d`), RTH filtering for daily bars, and compatibility with Schema v1 and v2.
- **Addresses:** Dual schema support and deterministic bar calculations.
- **Avoids:** Column missing errors on `bid_price` vs `price` and non-deterministic candle edges.

### Phase 41: Backend Service Migration & Order Flow Tape
- **Rationale:** Connects the validated reader and resampling queries to the live HTTP and WebSocket backend.
- **Delivers:** Refactored `DuckDBService` and `server.py` routing all `/api/status`, `/api/symbols`, `/api/summary`, `/api/candles`, `/api/ticks`, and `/ws/playback` queries to the tick lake. Reverse-chronological tape queries with spread.
- **Addresses:** API compatibility and real-time playback streaming.
- **Avoids:** Disk database lock collisions and stale server status.

### Phase 42: Comprehensive Verification & Regression Immunity
- **Rationale:** Prove that all backend, unit, and end-to-end tests pass cleanly with zero regressions.
- **Delivers:** 100% green test results across `npm run backend:test` (11+ tests), Vitest unit suites (418+ tests), and Playwright journey suites.
- **Addresses:** Complete milestone validation.

---

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack | HIGH | Tested directly against Data Harvester's real lake and contract test suite. |
| Features | HIGH | Explicitly documented in `repo_b_tick_lake_contract.md` v1.5.0. |
| Architecture | HIGH | Proven patterns matching Data Harvester's Phase 33 contract assertions. |
| Pitfalls | HIGH | Pitfalls observed and documented during Data Harvester's v4.2/v5.0 audits. |

**Overall confidence:** HIGH

---

## Sources

### Primary (HIGH confidence)
- `data-harvester/docs/contracts/repo_b_tick_lake_contract.md` (v1.5.0)
- `data-harvester/docs/operations/tick_lake_operations_guide.md` (v2.1.0)
- `data-harvester/docs/contracts/durability_boundary_contract.md`
- `data-harvester/tests/contract/test_repo_b_contract.py`
- Real tick lake on disk at `/Users/emadarshadalam/Documents/GitHub/data-harvester/data/tick_lake`

---
*Research completed: 2026-10-06*
*Ready for roadmap: yes*
