# Phase 19-01 Summary: Decoupled Playback State & O(1) Incremental Chart Updates

## What Was Built
1. **PERF-01**: Decoupled high-frequency playback store state from React re-renders in `src/hooks/useChartData.ts`. Replaced reactive store selectors with a paused-only external store subscription. While playback runs (`isPaused === false`), React state is frozen, eliminating ~60 React re-renders per second.
2. **PERF-02**: Implemented direct O(1) lightweight-charts series updates for forming candles in `src/hooks/useChartLifecycle.ts`. An external store subscription directly calls `initPriceSeriesRef.current.update()` and `initVolumeSeriesRef.current.update()` in <0.02ms per frame.
3. **PERF-03**: Completely eliminated O(N) array filtering (`filteredData`) and resampling (`resampleData`) during active playback.
4. **PERF-04**: Implemented candle bucket boundary handling in `useChartLifecycle.ts`. Transitions between time intervals seamlessly append new candles via `series.update()` without full `setData()` repaints.
5. **Decoupled 1D Price Line**: Removed `globalTime` reactive state dependency from `useChartLifecycle.ts`. The live price line updates directly inside the tick subscriber without re-rendering the component.
6. **Testing**: Created `tests/unit/playbackDecoupling.test.ts` (2 tests) verifying zero React re-renders during playback and direct O(1) series updates across candle buckets.

## Key Changes
- `src/hooks/useChartData.ts`:
  - `globalTime`, `latestTick`, `symbolTicks`: converted to paused-only subscription state.
  - Zero component re-renders while `isPaused === false`.
- `src/hooks/useChartLifecycle.ts`:
  - Removed `globalTime` selector.
  - Added `themeRef`, `isHydratedRef`, `lastCandleRef`.
  - Added `getBucketTime()` helper for all timeframes (1s, 5s, 15s, 30s, 1min, 5min, 15min, 30min, 1h, 4h, 1D).
  - Added direct high-performance tick subscription executing `series.update()` in O(1).
  - Decoupled 1D price line updates.
- `tests/unit/playbackDecoupling.test.ts`: New test suite for PERF-01, PERF-02, PERF-04.

## Verification
- Vitest unit tests: 2/2 passed.
- Full test suite: 49/49 test files passed, 280/280 tests passed.
- Production build: Succeeded in 886ms.
