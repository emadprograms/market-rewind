---
status: complete
date: 2026-10-07
task: 261007-dqh
title: Show both Bid price and Ask price on chart y-axis
---

# Quick Task Summary: Show Bid and Ask Price Lines on Chart Y-Axis

## Overview
Added real-time Bid and Ask price lines and y-axis price scale label tags to all Lightweight Charts timeframes across active playback, paused states, time scrubbing, and initial chart hydration.

## Changes Made
1. **`src/hooks/useChartLifecycle.ts`**:
   - Added `bidPriceLineRef` and `askPriceLineRef` for tracking active `IPriceLine` instances.
   - Implemented `updateBidAskPriceLines(tick, fallbackPrice)`:
     - **Bid Price Line**: Color `#2196f3` (blue), dashed line (`lineStyle: 2`), `title: 'Bid'`, `axisLabelVisible: true`, `axisLabelColor: '#2196f3'`, `axisLabelTextColor: '#ffffff'`.
     - **Ask Price Line**: Color `#ef5350` (red), dashed line (`lineStyle: 2`), `title: 'Ask'`, `axisLabelVisible: true`, `axisLabelColor: '#ef5350'`, `axisLabelTextColor: '#ffffff'`.
     - Prioritizes explicit `tick.bid` and `tick.ask` quotes, falling back gracefully to standard nominal ±$0.01 spreads if only trade price is available or bar close fallback.
   - Updated Bid and Ask price lines during:
     - Direct high-performance tick playback (Section 6).
     - Static and paused playback, stepping, and scrubbing (Section 7).
     - Initial chart hydration / data loading (Section 3).
   - Cleaned up price lines on ticker/timeframe switches and chart unmount.
2. **`src/types/index.ts` & `src/store/usePlaybackStore.ts`**:
   - Added `isSynthesized?: boolean` to `MarketTick` type and guarded assignment in playback store.
3. **`tests/unit/bidAskPriceLines.test.tsx`**:
   - Added comprehensive unit tests verifying initial creation, live tick updates, nominal spread fallback, paused updates, and ticker switch cleanup.

## Verification
- All 83 test files passed (432 tests passed, 2 skipped, 0 failed).
- TypeScript type checking clean (`npx tsc --noEmit` exited 0).
