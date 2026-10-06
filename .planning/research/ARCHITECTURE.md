# Architecture Design: Partitioned Parquet Tick Lake Integration

**Milestone:** v5.0
**Domain:** High-Frequency Tick Replay & Quantitative Data Pipeline
**Date:** 2026-10-06

---

## 1. System Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Data Harvester (Tick Lake Source)                    │
│                                                                        │
│   <TICK_LAKE_ROOT>/                                                    │
│   ├── lake.json                      [schema_version: 1]               │
│   ├── _maintenance/in_progress.json  [guard file during compaction]    │
│   ├── _control/registry.json         [active symbols]                  │
│   └── ticks/                                                           │
│       ├── symbol=AAPL/date=2026-10-02/*.parquet                        │
│       └── symbol=BRK%2EB/date=2026-10-03/*.parquet                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Direct Read-Only Filesystem Access
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Market Rewind Backend Service                      │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                      TickLakeService                           │   │
│   │   - Lake Root & Metadata Validation                            │   │
│   │   - Maintenance Guard (in_progress.json)                       │   │
│   │   - Symbol Encoder (`[A-Za-z0-9_-]` safe set)                  │   │
│   │   - Partition Pruner (date range -> file path list)            │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │ explicit file paths                │
│                                   ▼                                    │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                 In-Memory DuckDB Connection                    │   │
│   │                 `duckdb.connect(":memory:")`                   │   │
│   │   - Thread & Memory Limits (`threads=4`, `max_memory=2GB`)     │   │
│   │   - `read_parquet(?, hive_partitioning=false)`                 │   │
│   │   - Deterministic `arg_min` / `arg_max` OHLCV aggregation      │   │
│   │   - Reverse-chronological Order Flow Tape queries              │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │ JSON responses                     │
│                                   ▼                                    │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                 AIOHTTP REST & WebSocket Server                │   │
│   │   - `/api/status`                                              │   │
│   │   - `/api/symbols`                                             │   │
│   │   - `/api/summary`                                             │   │
│   │   - `/api/candles`                                             │   │
│   │   - `/api/ticks`                                               │   │
│   │   - `/ws/playback`                                             │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
└───────────────────────────────────┼────────────────────────────────────┘
                                    │ HTTP / WebSocket (port 8765)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Market Rewind Frontend (React/Vite)                  │
│                                                                        │
│   - Lightweight Charts Canvas Engine                                   │
│   - Multi-Chart Synchronization & Workspace Store                      │
│   - Live Playback State Machine & Timeline Scrubber                    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Modules & Responsibilities

### 2.1 `backend/streaming_service/tick_lake_reader.py` (New Module)
- **Role:** Standalone implementation of Repo B Tick Lake Read Contract.
- **Key Functions / Classes:**
  - `encode_symbol(symbol: str) -> str`: Safe uppercase percent-encoder.
  - `decode_symbol(encoded: str) -> str`: Decodes directory symbol back to canonical ticker.
  - `class TickLakeReader`:
    - `__init__(lake_root: Optional[Union[str, Path]])`
    - `validate_lake()`: Checks root existence, `lake.json` format and compatibility.
    - `is_maintenance_in_progress() -> bool`: Checks `_maintenance/in_progress.json`.
    - `resolve_files(symbol: str, start_date: date, end_date: date) -> List[str]`: Prunes partitions at filesystem level.
    - `get_symbols() -> List[Dict[str, Any]]`: Discovers available symbols by inspecting `ticks/` and registry metadata.
    - `query_candles(...) -> List[Dict[str, Any]]`: Resamples ticks via vectorized DuckDB Parquet scanner.
    - `query_ticks(...) -> List[Dict[str, Any]]`: Extracts raw ticks with ordering, pagination, and session tags.
    - `query_tape(...) -> List[Dict[str, Any]]`: Reverse-chronological tape with spread calculation.

### 2.2 `backend/streaming_service/duckdb_client.py` (Refactored Module)
- **Role:** Adapts `DuckDBService` interface to use `TickLakeReader` under the hood.
- **Backward Compatibility:** Preserves existing method signatures (`get_status()`, `get_symbols()`, `get_symbol_summary()`, `query_ticks()`, `query_candles()`) so `server.py` and downstream tests interact smoothly without disruption.
- **Status Reporting:** Replaces `streaming_db` file status with `tick_lake` status: root path, schema version, partition count, symbol count, and total parquet file count.

### 2.3 `backend/streaming_service/server.py` (Updated Handler)
- **Role:** REST API endpoints and WebSocket replay server.
- **Error Handling:** Maps `LakeUnavailableError` and `LakeMaintenanceInProgressError` to clear 503 Service Unavailable / Retry-After HTTP status responses.
- **WebSocket Replay:** Feeds real ticks streamed from resolved date partition files without loading entire datasets into memory.

---

## 3. Data Flow & Query Execution Lifecycle

1. **Client Request:** Frontend requests `/api/candles?symbol=AAPL&timeframe=1m&start_time=2026-10-02T13:30:00Z&end_time=2026-10-02T20:00:00Z`.
2. **Maintenance Check:** Backend verifies `_maintenance/in_progress.json` does not exist.
3. **Partition Resolution:**
   - Symbol `AAPL` is encoded -> `symbol=AAPL`.
   - Date range `[2026-10-02, 2026-10-02]` resolves to `ticks/symbol=AAPL/date=2026-10-02/*.parquet`.
   - Python globs and sorts matching batch files. If list is empty, returns `[]` immediately.
4. **DuckDB In-Memory Execution:**
   - Ephemeral connection opened: `con = duckdb.connect(":memory:")`.
   - Settings configured: `SET TimeZone = 'UTC'`, `SET threads = 4`, `SET max_memory = '2GB'`.
   - Resampling query dispatched:
     ```sql
     SELECT
         time_bucket(INTERVAL '1 minute', timestamp) AS bucket_time,
         symbol,
         arg_min(price, (timestamp, ingest_id)) AS open,
         max(price) AS high,
         min(price) AS low,
         arg_max(price, (timestamp, ingest_id)) AS close,
         sum(coalesce(volume, 1.0)) AS volume,
         count(*) AS tick_count
     FROM read_parquet(?, hive_partitioning=false)
     WHERE timestamp >= ? AND timestamp <= ?
     GROUP BY bucket_time, symbol
     ORDER BY bucket_time ASC
     ```
   - Connection closed in `finally`.
5. **Response:** Clean JSON payload returned to frontend.
