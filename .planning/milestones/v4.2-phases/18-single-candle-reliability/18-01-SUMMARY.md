# Phase 18-01 Summary: Single-Candle Reliability & Initial Data Load Guards

## What Was Built
1. **DATA-01**: Eliminated the `effectiveCutoff` initialization race condition in `src/hooks/useChartData.ts`. On non-replay mount before `globalTime` is dispatched, cutoff defaults to `Infinity` so no historical bars are trimmed.
2. **DATA-02**: Implemented automatic retry guard in `load()`. If a non-daily timeframe query returns only 1 bar, a fallback query with an open boundary is immediately triggered and populated.
3. **DATA-03**: Added render suppression guard in `src/hooks/useChartLifecycle.ts`. The chart series ignores transient single-bar states while background history loading (`isLoadingHistory`) is active. When loading concludes, full data commits cleanly.
4. **DATA-04**: Added diagnostic telemetry in `useChartData.ts` to log context warnings whenever filtering reduces loaded bars to <= 1 when raw data contains multiple bars.
5. **Testing**: Created `tests/unit/singleCandleReliability.test.ts` (3 tests) and updated `tests/hooks/useChartLifecycle.test.ts` (1 new test) covering DATA-01 through DATA-04.

## Key Changes
- `src/hooks/useChartData.ts`:
  - `effectiveCutoff`: defaults to `Infinity` when not in replay mode.
  - `load()`: query retry on 1-bar response.
  - `filteredData`: telemetry warning if data reduced to <= 1 bar.
- `src/hooks/useChartLifecycle.ts`:
  - `useEffect`: loading guard `isLoadingHistory && chartData.length === 1`.
  - Added `isLoadingHistory` to effect dependency array.
- `tests/unit/singleCandleReliability.test.ts`: New unit tests for DATA-01, DATA-02, DATA-04.
- `tests/hooks/useChartLifecycle.test.ts`: Added DATA-03 suppression test.

## Verification
- Vitest unit tests pass: 8/8 tests pass.
- All 48 test suites passing.
