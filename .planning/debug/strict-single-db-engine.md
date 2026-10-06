---
status: resolved
trigger: "I want a strict single-db engine. all data should only be loaded from streaming.db and nowhere else. fix this. fix this immediately."
created: 2026-09-30T21:55:00.000Z
updated: 2026-10-06T08:27:00.000Z
---

# Debug Session: Strict Single-DB Engine Enforcement

## 1. Symptoms & Observed Behavior
- **Expected Behavior**: Market Rewind operates strictly as a single-DuckDB engine. All historical candles, intraday candles, daily bars, ticks, and symbol inventories must be queried exclusively from `streaming.duckdb` (via `/api/streaming/candles`, `/api/streaming/symbols`, and `/api/ticks` with `source=streaming`). Under zero circumstances should the application query or fall back to `historical.duckdb`.
- **Actual Behavior**: 
  - `src/lib/streamingClient.ts:433` restricted `/api/streaming/candles` to sub-second timeframes only (`['1s', '5s', '15s', '30s']`), while all other timeframes (`1min`, `5min`, `15min`, `1H`, `1D`) called `/api/candles` without `source=streaming`.
  - On the backend server (`data-harvester/src/dashboard/server.py:266`), `/api/candles` defaulted `db_source` to `"historical"`, which loaded premarket candles starting at 04:00 AM ET from `historical.duckdb` for all dates up to September 25, 2026.
  - `getSymbols()` in `streamingClient.ts:266` queried `/api/symbols` (which returns historical symbol inventory) instead of `/api/streaming/symbols`.
- **Root Cause Confirmed**: Frontend client routing in `src/lib/streamingClient.ts` inadvertently omitted `source=streaming` and routed non-sub-second candles to `/api/candles` instead of `/api/streaming/candles`.

## 2. Resolution & Verification
- **Solution Implemented**:
  1. `src/lib/streamingClient.ts`: All candle requests across all timeframes (`1s` through `1D`) now strictly target `/api/streaming/candles` with `source=streaming` and `db=streaming`. Fallbacks also explicitly include streaming parameters.
  2. `src/lib/streamingClient.ts`: `getSymbols()` targets `/api/streaming/symbols`.
  3. `tests/unit/strictStreamingEngine.test.ts`: Added unit tests verifying strict streaming routing across all 10 timeframes and symbols.
  4. Removed all temporary debug images (`chart_tsla_1m.png`, `chart_tsla_sep8.png`, `docs/reviews/live-d1bb812/`).
  5. 100% test pass rate established: 80/80 Vitest test suites (418 passed), 69/69 Playwright journey tests (100%), and clean Vite production build.
- **Status**: RESOLVED
