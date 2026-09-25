---
status: resolved
trigger: "I don't see any candles on the chart. Just one huge candle and that is it. just one huge candle. make proper tests for this. diagnose the issue and fix it."
created: "2026-09-25T21:55:00Z"
updated: "2026-09-25T22:00:00Z"
root_cause: "streamingClient.getCandles prioritized /api/streaming/candles exclusively (which holds only 133 minutes of 2026-09-25) without querying historical.duckdb (/api/candles), causing all bars to share a single day and resample into exactly 1 candle; useChartData filtered out daily bars with composite sessions ('POST, PRE, REG'); isoToMs threw TypeError on numeric timestamps."
fix: "Blended historical DuckDB candles with today's live streaming candles in streamingClient.ts; corrected timeframe query parameter mapping (tf=1d, 5m, etc.); fixed session filtering in useChartData.ts to preserve composite and daily bars; updated useMarketSimulator.ts to load master data via streamingClient; updated isoToMs to handle numeric timestamps and ISO strings; sorted tick streams in ascending order."
verification: "All 25 test suites (104 tests) pass with 100% green status, including new regression tests in tests/regression/chart/candleRendering.test.ts; production build succeeds in 1.23s."
files_changed:
  - src/lib/streamingClient.ts
  - src/hooks/useChartData.ts
  - src/hooks/useMarketSimulator.ts
  - src/store/usePlaybackStore.ts
  - tests/regression/chart/candleRendering.test.ts
---

# Debug Session: One Huge Candle on Chart (RESOLVED)

## Symptoms
1. **Expected Behavior**: Chart displays hundreds of candlestick bars across historical dates and live streaming sessions according to the selected timeframe (1D, 1H, 15m, 5m, 1m, 1s).
2. **Actual Behavior**: Chart displays only a single huge candlestick spanning the entire width of the screen.
3. **Error Messages**: None visible in UI; underlying type error in `isoToMs` when numeric timestamps are processed.
4. **Timeline**: Observed when reading data directly from DuckDB streaming service.

## Root Cause Analysis
1. **`streamingClient.getCandles` prioritized `/api/streaming/candles` exclusively**:
   - `streaming.duckdb` holds only the live streaming buffer for today (`2026-09-25`, ~133 one-minute bars).
   - `historical.duckdb` holds the full historical archive (8.8M rows, 530 days of market data).
   - Because `/api/streaming/candles` returned the 133 bars of today, `streamingClient.getCandles` never queried `/api/candles` (which queries `historical.duckdb`).
   - All 133 bars shared the exact same date (`2026-09-25`).
   - When the chart rendered in `1D` (Daily) or resampled data, `resampleData(..., '1D')` merged all 133 bars of that single date into **exactly 1 candle**.
   - Lightweight Charts stretched that single candle across the full chart viewport, creating **"one huge candle"**.
2. **Parameter Mismatch**:
   - `streamingClient.getCandles` passed `interval=${tf}` and timeframes like `5min`, `1D`, `1H`.
   - `data-harvester`'s `analytics.py` and `server.py` expect `tf` or `timeframe` with values `1m`, `5m`, `15m`, `30m`, `1h`, `1d`. Because `tf` didn't match, `data-harvester` silently defaulted to `1m`.
3. **Session Filtering Bug**:
   - `historical.duckdb` returns daily bars with composite session strings (`"POST, PRE, REG"`).
   - `useChartData.ts` used `d.session === 'REG'`, which evaluated to `false` for every historical daily bar, leaving only the 1 single bar from `streaming.duckdb`.
4. **`useMarketSimulator.ts` was still querying obsolete SQLite DB**:
   - `useMarketSimulator.ts` was calling `fetchMarketData` (which queried the deprecated SQLite worker). SQLite was empty, causing `currentTime` to be `null`.
5. **`isoToMs` in `usePlaybackStore.ts` failed on numeric timestamps**:
   - `MarketTick.time` is a number (epoch timestamp). `isoToMs(firstTick.time)` called `.includes('T')`, throwing `iso.includes is not a function`.
6. **Tick Ordering in `/api/stream/tape`**:
   - `/api/stream/tape` returns ticks descending (newest first). Replay requires chronological ascending order.

## Fix Implementation
1. **`src/lib/streamingClient.ts`**:
   - Implemented `TIMEFRAME_TO_API` mapping (`1D` -> `1d`, `1H` -> `1h`, `5min` -> `5m`, `1min` -> `1m`, etc.).
   - Blended `historical.duckdb` candles (`/api/candles`) with today's live streaming candles (`/api/streaming/candles`) across all standard timeframes, deduplicated and sorted chronologically.
   - Preserved sub-second queries exclusively to `streaming.duckdb`.
   - Sorted `getTicks` chronologically ascending by timestamp so replay steps forward in time.
2. **`src/hooks/useChartData.ts`**:
   - Fixed session filter so `1D` daily bars and bars with composite session strings (`d.session?.includes('REG')`) are preserved.
   - For `1D` timeframe in replay mode, preserved all previous historical days up to the replay date.
3. **`src/hooks/useMarketSimulator.ts`**:
   - Pointed simulation master data loader to `streamingClient.getCandles` with fallback to `fetchMarketData`.
4. **`src/store/usePlaybackStore.ts`**:
   - Updated `isoToMs` to support numeric epoch timestamps (seconds & milliseconds) as well as ISO strings.
5. **`tests/regression/chart/candleRendering.test.ts`**:
   - Created comprehensive regression suite testing timestamp parsing, multi-day candle merging, timeframe query mapping, ascending tick ordering, and session filtering integrity.

## Verification
- **All 25 Vitest Test Suites**: 104 tests passed (100% green).
- **Production Build**: `npm run build` completed cleanly in 1.23s.
