---
quick_id: 260928-rth
slug: 1d-chart-rth-hours
status: complete
date: 2026-09-28
---

# Quick Task Summary: 1D Chart RTH Hours Filtering

## Overview
Restricted the 1D chart construction and real-time candle aggregation strictly to Regular Trading Hours (RTH, 09:30 AM to 04:00 PM Eastern Time), eliminating pre-market and after-hours/post-market price distortions from the daily chart.

## Problem & Root Cause
Previously, 1D chart building incorporated all ticks and bars across the 24h day:
1. In `src/hooks/useChartData.ts`, `filteredData` explicitly bypassed session filtering for `timeframe === '1D'`, allowing all ETH bars through even when `showEth` was false.
2. In `src/hooks/useChartData.ts`, `todayBars` for forming the daily candle aggregated bars starting from midnight (`00:00:00 ET`), taking pre-market bars as the day's open and incorporating post-market price movements and ticks into today's daily bar.
3. In `src/lib/resampling.ts`, `resampleData` bucketed all bars in the day into the 1D candle, including PRE and POST sessions.
4. In `src/lib/candleSynthesizer.ts`, `applyTickToCandles` and `buildCandlesFromTicks` incorporated non-RTH ticks into 1D candles.
5. In `backend/streaming_service/duckdb_client.py`, dynamic daily aggregation across `ticks` and `market_data` included `PRE` and `POST` sessions rather than restricting to RTH (`session = 'REG'`).

## Key Changes
1. **RTH Session Helpers (`src/lib/timezones.ts`)**:
   - Implemented `isRthBar(bar, ticker)` to test if a bar belongs to RTH (evaluating `session === 'REG'` / `session === 'RTH'` or timestamp-based session calculation).
   - Implemented `isRthTick(tick, ticker)` to test if a tick belongs to RTH.
2. **1D Resampling Isolation (`src/lib/resampling.ts`)**:
   - In `resampleData(data, '1D')`, filtered out non-RTH bars (`if (timeframe === '1D' && !isRthBar(bar)) return;`).
   - Ensured the resulting daily bar's session is explicitly `'REG'`.
3. **Tick Synthesis Guard (`src/lib/candleSynthesizer.ts`)**:
   - In `applyTickToCandles`: if `timeframe === '1D'` and `!isRthTick(tick)`, returns `candles` unmodified.
   - In `buildCandlesFromTicks`: if `timeframe === '1D'`, skips non-RTH ticks.
4. **Hook Playback & Forming Daily Candle Isolation (`src/hooks/useChartData.ts`)**:
   - In `filteredData`: For `timeframe === '1D'`, enforces RTH-only data via `isRthBar(d, ticker)` without bypassing session filtering.
   - In `chartData` forming daily candle: Restricts `todayBars` strictly to RTH boundaries (`bMs >= rthOpenMs && bMs <= Math.min(effectiveCutoff, rthCloseMs) && isRthBar(b, ticker)`).
   - Before 09:30 AM ET: No forming daily candle exists for today.
   - After 16:00 PM ET: Daily candle is frozen at 16:00 close; subsequent post-market ticks/bars do not alter the 1D candle.
5. **Backend DuckDB 1D RTH Filtering (`backend/streaming_service/duckdb_client.py` & `server.py`)**:
   - In `query_candles`: When `timeframe.lower() in ("1d", "1 day")`, appends `(upper(session) = 'REG' OR session = 'RTH')` to `where_clauses`.
   - In `_query_historical_candles`: When `timeframe.lower() in ("1d", "1 day")`, appends `(upper(session) = 'REG' OR session = 'RTH')` to `where_clauses`.
   - Supported optional `session` query param in `server.py`.
6. **Testing**:
   - Updated `tests/unit/chartIntegrity.test.ts` to assert that 1D daily resampling excludes PRE and POST bars.
   - Created `tests/unit/dailyRthChart.test.ts` with 12 comprehensive unit tests covering RTH bar/tick detection, resampling with mixed sessions, tick synthesis, and playback boundaries.
   - Added `test_service_dynamic_candles_daily_rth_only` to `backend/streaming_service/tests/test_duckdb_service.py`.

## Verification
- **Vitest Unit & Regression Tests**: 45/45 test files passed (263/263 tests passed).
- **Backend Pytest**: 11/11 tests passed in 3.05s.
- **Production Build**: `npm run build` completed cleanly in 1.01s.
