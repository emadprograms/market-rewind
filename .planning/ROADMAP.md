# Milestone v5.0 Roadmap: Partitioned Parquet Tick Lake Integration (Repo B Contract Compliance)

**4 phases** | **13 requirements mapped** | All covered ✓

| # | Phase | Goal | Requirements | Success Criteria | Status |
|---|-------|------|--------------|------------------|--------|
| 39 | Standalone Tick Lake Reader & Partition Pruning | Build zero-dependency `TickLakeReader` with root discovery, symbol encoding, filesystem partition pruning, and structured exceptions | LAKE-READ-01, LAKE-READ-02, LAKE-READ-03, LAKE-READ-04 | 3 | PENDING |
| 40 | Deterministic OHLCV Aggregation & Dual Schema Ingestion | Implement vectorized in-memory DuckDB candle resampling with `arg_min`/`arg_max` tie-breaking, dual schema support, and RTH filtering | LAKE-RESAMPLE-01, LAKE-RESAMPLE-02, LAKE-RESAMPLE-03, LAKE-RESAMPLE-04 | 3 | PENDING |
| 41 | Backend Service Migration & Order Flow Tape | Refactor `DuckDBService` and `server.py` to route queries to the tick lake, supporting reverse-chronological tape queries and maintenance guards | LAKE-API-01, LAKE-API-02, LAKE-API-03 | 3 | PENDING |
| 42 | Comprehensive Verification & Regression Immunity | Update backend pytest suite for 100% green pass on `npm run backend:test` and verify zero regressions across Vitest and Playwright suites | LAKE-VERIFY-01, LAKE-VERIFY-02 | 2 | PENDING |

---

### Phase Details

**Phase 39: Standalone Tick Lake Reader & Partition Pruning**
- **Goal:** Build zero-dependency `TickLakeReader` with root discovery, symbol encoding, filesystem partition pruning, and structured exceptions
- **Requirements:** LAKE-READ-01, LAKE-READ-02, LAKE-READ-03, LAKE-READ-04
- **Success criteria:**
  1. Standalone `TickLakeReader` module created in `backend/streaming_service/tick_lake_reader.py` with zero `data-harvester` library imports.
  2. Canonical symbol encoder correctly encodes `[A-Za-z0-9_-]` safe set (e.g. `BRK.B` -> `BRK%2EB`, `EUR/USD` -> `EUR%2FUSD`) and resolves matching `ticks/symbol=.../date=.../*.parquet` partitions.
  3. Structured error taxonomy implemented (`LakeUnavailableError`, `LakeCorruptedMetadataError`, `LakeIncompatibleSchemaError`, `LakeMaintenanceInProgressError`) with fail-fast validation against `lake.json` and `_maintenance/in_progress.json`.

**Phase 40: Deterministic OHLCV Aggregation & Dual Schema Ingestion**
- **Goal:** Implement vectorized in-memory DuckDB candle resampling with `arg_min`/`arg_max` tie-breaking, dual schema support, and RTH filtering
- **Requirements:** LAKE-RESAMPLE-01, LAKE-RESAMPLE-02, LAKE-RESAMPLE-03, LAKE-RESAMPLE-04
- **Success criteria:**
  1. Dynamic resampling queries execute via `read_parquet(?, hive_partitioning=false)` on isolated ephemeral `:memory:` DuckDB sessions with `threads=4` and `max_memory='2GB'`.
  2. Open and close prices use deterministic `arg_min(..., (timestamp, ingest_id))` and `arg_max(..., (timestamp, ingest_id))` tie-breaking across all timeframes (`1s` to `1d`), handling both Schema v1 (`price`, `volume`) and Schema v2 (`bid_price`, `ask_price`).
  3. Daily (`1d`) candles strictly filter for Regular Trading Hours (`session = 'REG'`).

**Phase 41: Backend Service Migration & Order Flow Tape**
- **Goal:** Refactor `DuckDBService` and `server.py` to route queries to the tick lake, supporting reverse-chronological tape queries and maintenance guards
- **Requirements:** LAKE-API-01, LAKE-API-02, LAKE-API-03
- **Success criteria:**
  1. `DuckDBService` wraps `TickLakeReader` while preserving all public method signatures (`get_status`, `get_symbols`, `get_symbol_summary`, `query_ticks`, `query_candles`) and API response structure.
  2. Reverse-chronological Time & Sales tape queries with spread calculation (`ask - bid`) are supported and exposed via `/api/ticks`.
  3. REST and WebSocket endpoints in `server.py` handle maintenance 503 responses and stream real Parquet ticks for live playback.

**Phase 42: Comprehensive Verification & Regression Immunity**
- **Goal:** Update backend pytest suite for 100% green pass on `npm run backend:test` and verify zero regressions across Vitest and Playwright suites
- **Requirements:** LAKE-VERIFY-01, LAKE-VERIFY-02
- **Success criteria:**
  1. 100% of backend tests in `backend/streaming_service/tests/` pass against the real tick lake (`npm run backend:test`).
  2. 100% of Vitest unit test files (418+ tests) and Playwright journey suites pass cleanly with zero regressions.
