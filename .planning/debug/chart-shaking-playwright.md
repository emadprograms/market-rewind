---
status: resolved
trigger: "make playwright test for this as well because the graph is still shaking a lot. first make the test and only then start working on it. the charts are still shaking a lot."
created: 2026-09-29T11:17:30.000Z
updated: 2026-09-29T11:35:00.000Z
---

# Debug Session: Chart Shaking During Playback and Timeline Interaction (Playwright E2E)

## Current Focus
- status: Resolved and verified with comprehensive Playwright E2E test suite and Vitest suite.

## Evidence & Root Cause Analysis
1. **Canvas Width Jitter (The 8px Horizontal Shaking Bug):**
   - **Root Cause**: `rightPriceScale` in `useChartInit.ts` was initialized without a `minimumWidth` (defaulted to 0). As prices updated and tick labels fluctuated across decimal formats and digit widths, Lightweight Charts dynamically recalculated the price scale width between 56px and 64px (an 8px shift). Because the chart container flexes, this forced the main chart canvas to oscillate between `width` and `width - 8px`. The `ResizeObserver` caught each 8px resize and triggered `chart.applyOptions({ width, height })`, redrawing the entire canvas and creating a violent horizontal shaking effect.
   - **Fix**: Added `rightPriceScale: { minimumWidth: 80 }` in `createChart` options and `chart.priceScale('right').applyOptions({ minimumWidth: 80 })` in `src/hooks/chart/useChartInit.ts`. The price axis width remains rock-solid, completely eliminating the 8px canvas oscillation.

2. **Candle Preservation During Timeline Jumping/Seeking:**
   - **Root Cause Analysis**: Before simulator session initialization, `effectiveCutoff` was `Infinity`, loading all 1376 bars for the entire day (including future bars). Once initialized at 09:30 AM, replay mode properly anchors `effectiveCutoff` to 09:30 AM (964 bars). When jumping to 10:15 AM, 9 bars are added (964 -> 973 bars). All historical bars (from Sep 18 onward) are preserved, and today's elapsed bars (09:30 to 10:15) are strictly retained. Backward seeking to 09:45 properly prunes future bars (13 bars at 10:30 down to 4 bars at 09:45) without blanking or dropping history.
   - **Test**: `tests/regression/chart/chartShaking.spec.ts` verifies:
     - 0 `setData` calls during active playback (smooth in-place updates).
     - Timeline jumping to 10:15 preserves all elapsed candles today + historical bars.
     - Canvas dimensions remain rock-solid (< 5px change) across rapid timeline scrubbing.
     - Backward seeking accurately adjusts today's elapsed candles without errors.

## Verification
- **Playwright E2E**: 4/4 tests passed in `tests/regression/chart/chartShaking.spec.ts` (11.3s).
- **Vitest Suite**: 60/60 test files passed, 328/328 tests passed (28.3s).
- **Production Build**: `npm run build` completed cleanly with 0 TypeScript/Vite errors.
