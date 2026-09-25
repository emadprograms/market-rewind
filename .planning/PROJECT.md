# Market Rewind - Tick-by-Tick Streaming Engine & Modern UI

## What This Is
Market Rewind is a high-performance local-first market replay and charting analysis tool. Milestone v2.0 upgrades the entire platform from static 1-minute SQLite candle replays to direct, live, and historical tick-by-tick streaming powered by DuckDB (`streaming.duckdb` and `historical.duckdb` in the `data-harvester` database).

## Core Value
High-fidelity, deterministic tick-by-tick market replay with sub-second timeframes, real-time candle aggregation, Time & Sales tape, and instant switching across millions of market ticks.

## Current Milestone: v2.0 Tick-by-Tick Streaming Engine & Modern UI

**Goal:** Upgrade Market Rewind to seamlessly stream, query, and replay tick-by-tick data directly from `data-harvester`'s `streaming.duckdb` and `historical.duckdb`, with live candle synthesis, Time & Sales tape, modern terminal UI, and comprehensive test coverage.

**Target features:**
- Direct DuckDB integration to `../data-harvester/data/streaming.duckdb` (37.8M+ ticks) and `historical.duckdb`
- Fast local streaming server / query API bridge
- Tick-by-Tick Replay Engine: stepping forward/backward, scrub slider, variable playback speed (0.5x to 100x), and live candle aggregation
- Sub-second timeframes (`1s`, `5s`, `15s`) and standard timeframes (`1m`, `5m`, `15m`, `1h`, `1d`)
- Time & Sales / Live Tick Tape order flow widget
- Modern dark-mode Bloomberg/TradingView terminal UI refresh
- Upgraded and updated test suites across store, replay engine, and UI components

## Requirements

### Validated
- ✓ Basic market replay engine (v1.0)
- ✓ Local-first storage (v1.0)
- ✓ Multi-chart layouts and resizable panels (v1.0)
- ✓ Viewport stabilization and infinite scroll (v1.0)
- ✓ Selection & symbol grouping synchronization (v1.0)

### Active
- [ ] **DATA-01**: Native DuckDB Integration to `data-harvester`'s `streaming.duckdb` and `historical.duckdb`.
- [ ] **DATA-02**: Fast local data bridge API for symbol inventory, tick queries, and dynamic `time_bucket()` candlestick aggregation.
- [ ] **REPLAY-01**: Millisecond-accurate Tick-by-Tick Replay Engine with pause/play, single-tick step forward/backward, and speed controls.
- [ ] **REPLAY-02**: Real-time Dynamic Candle Synthesis (live ticks update current candle HLCV in real time).
- [ ] **UI-01**: Time & Sales / Live Tick Tape component displaying real-time prints (timestamp, price, size, bid, ask).
- [ ] **UI-02**: Modern Financial Terminal UI refresh (dark theme, sub-second timeframe selectors, symbol switcher from active streaming symbols).
- [ ] **TEST-01**: Fix existing test suite (zustand storage mock) and add comprehensive unit/integration tests for streaming & tick replay.

### Out of Scope
- Direct cloud broker order execution (focus is high-fidelity replay and analysis).
- Modifying the upstream `data-harvester` ingestion process (read-only zero-copy access to `streaming.duckdb`).

## Context
`data-harvester` collects live tick data 24/7 into `data/streaming.duckdb` (>37.8M ticks) and historical 1m bars in `data/historical.duckdb`. `market-rewind` previously depended on an isolated SQLite/libSQL database. By bridging directly into the DuckDB database, users get instant access to institutional-grade tick data and sub-second replay.

## Constraints
- **Zero-Copy / Read-Only**: Connect to `streaming.duckdb` with `read_only=True` to guarantee no lock interference with active collectors in `data-harvester`.
- **Fast Response**: DuckDB queries and websocket/stream throughput must be snappy (<50ms for chunked ticks).
- **Graceful Fallbacks**: If DuckDB backend service is initializing or symbol is in historical DB, automatically resolve the right data source.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Dedicated Python DuckDB Bridge Service | DuckDB provides blazingly fast `time_bucket` queries and native Parquet/file-level concurrency with read-only locks. A lightweight FastAPI/Python backend service serves REST and SSE/WebSocket to the React app cleanly. | — Planned |
| Client-Side Tick Replay Buffer | Buffer ticks in the browser/worker to enable zero-latency stepping, scrubbing, and variable playback speeds without hammering the database. | — Planned |

## Evolution
This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-26 after milestone v2.0 initialization*
