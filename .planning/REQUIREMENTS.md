# Milestone v5.0 Requirements: Partitioned Parquet Tick Lake Integration (Repo B Contract Compliance)

## Overview

Milestone v5.0 transitions Market Rewind's data access architecture from the retired disk-backed `streaming.duckdb` database to Data Harvester's **Partitioned Parquet Tick Lake** in strict compliance with the **Repo B Tick Lake Read Contract (v1.5.0)** (`docs/contracts/repo_b_tick_lake_contract.md`).

The requirements below eliminate all disk file-locking collisions, enforce zero code imports from `data-harvester`, provide vectorized in-memory DuckDB query execution with deterministic resampling, support dual-schema files, and guarantee 100% green test passes across all backend and frontend test suites.

---

## Requirements

### Category 1: Standalone Lake Reader & Partition Pruning (LAKE-READ)

- [x] **LAKE-READ-01**: **Zero-Import Lake Reader Core**: Provide a standalone `TickLakeReader` class with zero library imports from `data-harvester`, featuring root discovery precedence (`TICK_LAKE_ROOT` env var, fallback to `<repo>/data/tick_lake` symlink/relative path) and `lake.json` format verification.
- [x] **LAKE-READ-02**: **Canonical Symbol Path Encoding**: Implement uppercase percent-encoding for symbol partition path resolution (`ticks/symbol=<ENCODED_SYMBOL>/`) strictly honoring the `[A-Za-z0-9_-]` safe set (e.g. `BRK.B` -> `BRK%2EB`, `EUR/USD` -> `EUR%2FUSD`).
- [x] **LAKE-READ-03**: **Filesystem Partition Pruning**: Implement filesystem-level partition discovery resolving explicit Parquet file lists by symbol and UTC event date range (`date=<YYYY-MM-DD>`), returning an empty list immediately without DuckDB execution if no partitions match.
- [x] **LAKE-READ-04**: **Structured Error Taxonomy & Maintenance Guard**: Implement explicit exception classes (`LakeUnavailableError`, `LakeCorruptedMetadataError`, `LakeIncompatibleSchemaError`, `LakeMaintenanceInProgressError`), checking for `<lake_root>/_maintenance/in_progress.json` and failing fast or retrying before execution.

### Category 2: Resampling Engine & Dual Schema Ingestion (LAKE-RESAMPLE)

- [ ] **LAKE-RESAMPLE-01**: **Isolated In-Memory DuckDB Runner**: Execute queries via `read_parquet(?, hive_partitioning=false)` on isolated ephemeral `:memory:` DuckDB sessions with explicit concurrency bounds (`SET threads = 4`, `SET max_memory = '2GB'`, `SET TimeZone = 'UTC'`).
- [ ] **LAKE-RESAMPLE-02**: **Deterministic OHLCV Candle Aggregation**: Dynamically aggregate ticks into candles across all standard timeframes (`1s` to `1d`) using vectorized DuckDB `time_bucket()` with deterministic `arg_min(..., (timestamp, ingest_id))` for open and `arg_max(..., (timestamp, ingest_id))` for close.
- [ ] **LAKE-RESAMPLE-03**: **Dual Schema Compatibility**: Support both physical Schema v1 files (`timestamp`, `symbol`, `price`, `volume`, `bid`, `ask`, `source`, `session`, `ingest_id`) and Schema v2 rows (`bid_price`, `ask_price`), correctly coalescing quotes without column binder errors.
- [ ] **LAKE-RESAMPLE-04**: **Daily RTH Session Isolation**: Strictly enforce Regular Trading Hours filtering (`session = 'REG'`) when aggregating daily (`1d`) candles.

### Category 3: Backend API Integration & Order Flow Tape (LAKE-API)

- [ ] **LAKE-API-01**: **DuckDBService Adapter Migration**: Refactor `backend/streaming_service/duckdb_client.py` to route all queries through `TickLakeReader`, retiring direct `streaming.duckdb` file attachment while preserving existing method signatures and API contracts.
- [ ] **LAKE-API-02**: **Reverse-Chronological Order Flow Tape**: Implement reverse-chronological tape queries with spread calculation (`ask - bid`) over the latest active date partition files, exposed via `/api/ticks`.
- [ ] **LAKE-API-03**: **Server REST & WebSocket Endpoint Alignment**: Update `backend/streaming_service/server.py` endpoints (`/api/status`, `/api/symbols`, `/api/summary`, `/api/candles`, `/api/ticks`, `/ws/playback`) to return tick lake metadata, graceful 503 status during maintenance, and streaming tick playback.

### Category 4: Systematic Verification & Regression Immunity (LAKE-VERIFY)

- [ ] **LAKE-VERIFY-01**: **Backend Test Suite Green Phase**: Update backend pytest test suite in `backend/streaming_service/tests/` to run against both synthetic test fixtures and the real tick lake, achieving a 100% pass rate on `npm run backend:test`.
- [ ] **LAKE-VERIFY-02**: **Full Regression & E2E Verification**: Validate that all 80 Vitest unit test files (418+ tests) and Playwright journey test suites pass cleanly with zero regressions.

---

## Traceability Matrix

| Requirement | Phase | Status |
|-------------|-------|--------|
| LAKE-READ-01 | Phase 39 | COMPLETE |
| LAKE-READ-02 | Phase 39 | COMPLETE |
| LAKE-READ-03 | Phase 39 | COMPLETE |
| LAKE-READ-04 | Phase 39 | COMPLETE |
| LAKE-RESAMPLE-01 | Phase 40 | PENDING |
| LAKE-RESAMPLE-02 | Phase 40 | PENDING |
| LAKE-RESAMPLE-03 | Phase 40 | PENDING |
| LAKE-RESAMPLE-04 | Phase 40 | PENDING |
| LAKE-API-01  | Phase 41 | PENDING |
| LAKE-API-02  | Phase 41 | PENDING |
| LAKE-API-03  | Phase 41 | PENDING |
| LAKE-VERIFY-01 | Phase 42 | PENDING |
| LAKE-VERIFY-02 | Phase 42 | PENDING |
