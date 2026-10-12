---
status: closed
trigger: "when I skeep forward to a fture and then press play. the chart doesn't update anymore. the tests were supposed to catch this. sometimes it does but sometimes it doesn't. make test for this first and then try fixing it."
created: 2026-09-29T11:42:00.000Z
updated: 2026-09-29T12:20:00.000Z
---

# Debug Session: Chart Fails to Update After Seeking Forward and Pressing Play

## Root Cause
1. **Why it occurred "sometimes it does, sometimes it doesn't"**:
   - On dates such as `2026-09-25`, high-frequency streaming ticks in DuckDB begin in the afternoon (14:46 EDT / 18:46 UTC).
   - If the user sought forward to a time **after** 14:46 EDT (e.g. 14:50 EDT), raw ticks exist in `bufferedTicks`. `advanceSimulationTime` advances ticks and updates `latestTickBySymbol`, so the chart updated.
   - If the user sought forward to a time **before** 14:46 EDT (e.g. 10:15 EDT or 10:30 EDT) or on dates where no raw streaming ticks were recorded: `targetTimeMs < firstTickMs` (or `bufferedTicks.length === 0`). `advanceSimulationTime` previously only set `{ currentTime: targetTimeMs }` and returned without touching `latestTickBySymbol` or `currentTick`.
   - Because `useChartData` intentionally does not recompute React state while playing (`isPaused === false`) for performance, and `useChartLifecycle` drops out when `tick` is null, the chart completely froze (`updates: 0`).
2. **Missing candidate bar fallback when ticks exist later in the day**:
   - In `src/hooks/useChartData.ts`, the condition `else if (effectiveCutoff && latestTick && symbolTicks && symbolTicks.length > 0 && tickTimestampsMs.length > 0)` checked `symbolTicks.length > 0` without verifying `tickTimestampsMs[0] <= effectiveCutoff`. When seeking prior to the first raw tick, candle synthesis was skipped, dropping forming candles.

## Fixes Implemented
1. **Playback Store Tick Synthesis (`src/store/usePlaybackStore.ts`)**:
   - Added `findBarAtOrBefore(bars, targetMs)` and `getBarSynthesizedPrice(bar, targetTimeMs)`.
   - Updated `advanceSimulationTime` and `seekTickTime`: when `bufferedTicks.length === 0` or `targetTimeMs < firstTickMs`, it queries `masterData`, synthesizes an intra-bar tick matching the active bar's price path (`open -> low/high -> high/low -> close`), and updates `latestTickBySymbol` and `currentTick`.
   - Added smooth transition when advancing from synthesized bars into `bufferedTicks` (`currentTickIndex < 0 ? -1 : currentTickIndex`).
2. **Bar Symbol Preservation (`src/lib/streamingClient.ts` & `src/types/index.ts`)**:
   - Added `symbol?: string` to `RawBar` and set `symbol: sym` in `getCandles` to ensure multi-symbol playback can map candidate bars to symbols.
3. **Hook Fallback Refinement (`src/hooks/useChartData.ts`)**:
   - Updated condition to `tickTimestampsMs[0] <= effectiveCutoff` so periods prior to raw ticks fall back cleanly to 1-minute candidate bar aggregation and in-place tick updates.
4. **E2E Playwright Suite Expansion (`tests/regression/chart/chartShaking.spec.ts`)**:
   - Added Test 6: Seeking forward to 10:15 ET (historical bar period before raw ticks) and pressing play resumes playback and updates candles in-place.
   - Added Test 7: Seeking forward via playback slider UI to future time and pressing play resumes playback and updates candles in-place.

## Verification
- `tests/regression/chart/chartShaking.spec.ts`: All 7 tests passed (23.1s).
- Vitest unit tests: All 60 test suites and 328 tests passed.
- Production build: `npm run build` succeeded cleanly.
