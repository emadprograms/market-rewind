# Market Rewind Backend Services

This directory contains the backend services and legacy data pipelines for Market Rewind.

## Architecture Overview

```
data-harvester (Active Service on Port 8000)
   ├── data/streaming.duckdb  (42.6M+ ticks, tick-by-tick streaming)
   └── data/historical.duckdb (8.8M+ 1-min OHLCV bars)
         │
         ▼ HTTP / WebSocket Proxy
market-rewind Frontend (Port 3000)
   ├── Direct DuckDB REST Streaming Client (streamingClient.ts)
   ├── Sub-second & Tick Synthesis Engine (candleSynthesizer.ts)
   └── Modern Multi-Chart Canvas & Time & Sales Order Flow
```

## Directory Guide

### 1. `backend/streaming_service/` (Modern DuckDB Service)
- **Role**: High-performance local DuckDB streaming and WebSocket replay engine.
- **Key Modules**:
  - `duckdb_client.py`: Thread-safe, read-only DuckDB client querying `../data-harvester/data/streaming.duckdb` and `historical.duckdb`.
  - `server.py`: aiohttp REST and WebSocket server providing real-time tick streaming, sub-second candle synthesis, and session replay controls.
  - `tests/`: Automated unit and integration tests verifying DuckDB tick extraction and candle aggregation.

### 2. `backend/app_db_sync/` (Legacy Turso Sync - Deprecated)
- **Role**: Prior v1.0 sync mechanism that fetched deltas from a remote Turso (libSQL) cloud database down into a local `market_data.db` SQLite file.
- **Status**: Deprecated. No longer needed because data is read directly from `data-harvester`'s `streaming.duckdb`.

### 3. `backend/historical_archiver/` (Legacy Polygon Archiver - Deprecated)
- **Role**: Prior v1.0 background archiver that fetched 1-minute historical candles from Massive / Polygon.io and uploaded them into Turso.
- **Status**: Deprecated. Data harvesting and ingestion is now fully centralized in `../data-harvester`.
