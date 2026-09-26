---
status: resolved
trigger: "we have data for all the back till march 2025 but this graph is only showing data starting from september 1st. I'm trading tsla. for 8 september 2026"
created: 2026-09-26T13:03:00Z
updated: 2026-09-26T13:36:00Z
symptoms:
  expected: "Chart should display historical data going back to March 2025 (or allow scrolling/viewing back to March 2025) when trading TSLA on 2026-09-08."
  actual: "Graph was only showing data starting from September 1st, 2026."
  error_messages: "None reported initially; infinite scroll prepend failed silently due to timestamp format mismatch"
  timeline: "DuckDB has 7.7M ticks for TSLA dating back to 2025-03-21 and 449k 1m candles in historical.duckdb dating back to 2024-10-01."
  reproduction: "Select TSLA, set date to 2026-09-08, initialize simulator. Observe the earliest candle on chart."
root_cause: |
  1. Default hardcoded query limit: `useChartData.ts` and `streamingClient.ts` requested candles with hardcoded `limit: 5000`. On a 1-minute intraday timeframe with extended trading hours (~960 minutes/day), 5000 bars only covers 5.2 days, reaching back precisely to September 1st, 2026.
  2. Broken infinite history scroll prepend in `useChartViewport.ts`: `chartData.findIndex(d => d.time === oldFirstTime)` compared an ISO string (`d.time`, e.g. "2026-09-01 09:30:00") with a numeric epoch timestamp (`oldFirstTime` in seconds, e.g. 1757342400). It always returned -1, preventing viewport logical range shifts during history prepends.
  3. Boundary duplicate candles: `streamingClient.getCandles` with `endTime = earliestLoadedDateRef.current` included the boundary candle (`timestamp <= ?`), leading to duplicate timestamps upon prepend (`[...chunk, ...localMasterData]`).
  4. Infinite re-subscription loop: The `subscribeVisibleLogicalRangeChange` listener in `useChartData.ts` depended on `localMasterData`, causing re-subscription on every data update which triggered immediate re-firing and potential renderer crash.
fix: |
  1. Increased default candle limit to 10,000-15,000 bars across `useChartData.ts`, `useMarketSimulator.ts`, `streamingClient.ts`, `server.py`, and `duckdb_client.py`.
  2. Implemented universal `matchTime` helper in `useChartViewport.ts` to seamlessly match timestamps whether provided as ISO strings or epoch numbers (seconds/ms).
  3. Added strict deduplication in `useChartData.ts` (`cleanChunk = chunk.filter(c => c.time < currentEarliest)`).
  4. Decoupled the infinite scroll listener from `localMasterData` re-renders using `localMasterDataRef`, `lastFetchedEndTimeRef`, and `hasMoreHistoryRef`, eliminating subscription loops.
  5. Backfilled seamlessly from `historical.duckdb` when `streaming.duckdb` runs out of ticks.
verification: |
  - `tests/regression/chart/tslaHistoryData.test.ts`: 5/5 unit/integration tests passed.
  - `tests/regression/chart/tslaHistory.spec.ts`: E2E Playwright test passed, verifying >9,920 bars on 5m (dating back to March 2026 / 2025), >9,600 bars on 1m (dating back to early August 2026), and 501 bars on 1D (dating back to October 2024).
  - All 31 Vitest suites (129 tests) passed.
  - All 14 Playwright regression tests passed.
---

# Debug Session: TSLA Historical Data Range & Prepend Cutoff (RESOLVED)

## 1. Summary of Issue
When trading TSLA on September 8th, 2026, the graph appeared to only display data starting from September 1st, 2026, despite DuckDB containing continuous ticks back to March 21, 2025 and historical candles back to October 1, 2024.

## 2. Root Cause Analysis
1. **Intraday Bar Limitation (`limit: 5000`)**:
   - Extended trading hours (ETH: 04:00 to 20:00) produce ~960 1-minute bars per day.
   - 5000 bars / 960 bars per day = ~5.2 days.
   - 5.2 days prior to September 8, 2026 (accounting for Labor Day weekend on Monday, September 7) lands squarely on **Tuesday, September 1st, 2026**.
2. **Infinite Scroll Anchor Shift Failure**:
   - `useChartViewport.ts` attempted to find `oldFirstTime` using strict equality (`d.time === oldFirstTime`).
   - `oldFirstTime` was recorded as a numeric timestamp (epoch seconds: `1757342400`), while `d.time` in `chartData` was formatted as an ISO string (`"2026-09-01 09:30:00"`).
   - This comparison evaluated to `false` for every bar, returning `newFirstIndex = -1` and causing viewport alignment to fail.
3. **Boundary Duplicate Timestamps**:
   - Prepending historical chunks fetched with `endTime = earliestLoadedDateRef.current` produced a duplicate bar at the splice boundary.
4. **Subscription Churn**:
   - Recreating the range change listener on every `localMasterData` change triggered an immediate range event upon mounting, risking re-render loops.

## 3. Resolution
- Upgraded query limits to 10,000-15,000 bars across the backend and client.
- Added dual format timestamp matching in `useChartViewport.ts` (`matchTime`).
- Added strict deduplication when prepending historical chunks.
- Refactored `useChartData.ts` to use refs (`localMasterDataRef`, `lastFetchedEndTimeRef`, `hasMoreHistoryRef`), making the infinite scroll subscription completely stable.
- Verified with both unit and Playwright tests.
