---
quick_id: 260926-ki3
slug: playback-perf-tests-and-fixes
status: complete
date: 2026-09-26
---

# Quick Task Summary: Playback Performance Tests & Fixes

## Overview
Investigated and resolved performance bottlenecks in the replay pipeline that caused updates to feel sluggish and update at ~1-second intervals instead of matching the authentic tick arrival rate.

## Root Cause Analysis
1. **O(n) Date Parsing in `filteredData`**: Every 16ms animation frame, `filteredData` re-evaluated and ran `new Date()` on 10,000+ historical bars.
2. **O(n) Linear Scan in `chartData`**: For each frame, `chartData` scanned up to 20,000+ `symbolTicks` with `isoToMs()` to locate bucket ticks.
3. **Full Dataset Re-mapping in `useChartLifecycle`**: Even when `canIncrement` was true during incremental replay steps, `useChartLifecycle` re-mapped, sorted, and deduplicated all 10,000–33,000 bars on every frame before calling `priceSeries.update()` on the last bar.
4. **Frame Drop Cascade**: The resulting 10–50ms JavaScript execution time per frame caused dropped animation frames, inflating `dtWallMs` and batching ticks into coarse visual updates.

## Changes Made
1. **`tests/unit/playbackPerformance.test.ts`**:
   - Added 12 unit tests benchmarking `resampleData`, Date parsing hot-path costs, tick batching, microsecond tick handling, binary search performance, and frame budgets.
2. **`src/hooks/useChartData.ts`**:
   - Pre-cached bar timestamps (`barTimestampsMs`) on `localMasterData` change.
   - Pre-cached tick timestamps (`tickTimestampsMs`) on `symbolTicks` change.
   - Replaced linear scan of ticks with `O(log N)` binary search for the current candle bucket start.
3. **`src/hooks/useChartLifecycle.ts`**:
   - During incremental playback updates (`canIncrement === true`), bypassed full array `map()`/`sort()` of 33,000 bars.
   - Formatted only the updated/new candle bar(s) directly and called `priceSeries.update()` in `O(1)` time (<0.05ms).
   - Only executed full formatting, sorting, and `setData()` on context/ticker/timeframe switches or history prepends.

## Verification
- **Unit Tests**: All 141 Vitest tests in 32 files passed (`32/32 passed`).
- **E2E Tests**: All 14 Playwright tests passed cleanly in 32.2 seconds (`14/14 passed`).
- **Build**: Vite production build completed with 0 errors in 874ms.
