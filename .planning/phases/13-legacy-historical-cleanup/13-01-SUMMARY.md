---
phase: 13
plan: 01
status: complete
requirements_completed: [CLEAN-01, CLEAN-02, CLEAN-03]
---

# Phase 13: Plan 13-01 Summary — Legacy SQLite, Vercel & Historical DuckDB Removal

## Work Completed
1. **Removed SQLite / sql.js**:
   - Removed `sql.js` and `@types/sql.js` from `package.json`.
   - Removed `postinstall` script copying `sql-wasm.wasm`.
   - Deleted `public/sql-wasm.wasm` (659KB).
   - Deleted `src/lib/workers/db.worker.ts` and directory `src/lib/workers`.
   - Deleted `src/lib/db.ts` (replaced all calls with `streamingClient.getCandles`).
   - Removed `optimizeDeps.exclude: ['sql.js']` from `vite.config.ts`.
   - Removed `tests/regression/global-setup.ts`, `tests/unit/seed-fixture.test.ts`, and `tests/regression/fixtures/seed.db`.
2. **Removed `historical.duckdb` Dependency**:
   - Re-routed all candlestick fetching in `src/lib/streamingClient.ts` directly to `streaming.duckdb` via `/api/streaming/candles` for all timeframes (sub-second through 1D).
   - Eliminated historical/streaming candle blending map that caused anomalies.
   - Removed tape fallback in `streamingClient.getTicks()` so it never leaks future ticks when a date/time range is queried.
   - Added clean `getLiveTape()` for Time & Sales order flow.
3. **Refactored Data Access Hooks**:
   - Refactored `useDatabase.ts` to check only `streamingClient.checkStatus()` and retrieve symbols from DuckDB streaming service.
   - Refactored `useMarketSimulator.ts` and `useChartData.ts` to fetch candles solely from `streamingClient.getCandles()`.

## Verification
- `npm run build`: Succeeded in 976ms with 0 errors.
- `npm test`: 26 files passed, 112/112 tests green.
