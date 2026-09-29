---
status: resolved
trigger: "the charts are shaking when playing. only one chart loads (even when I have two charts open). the second chart is always empty and when I click play one lone candle plays (I have 1d chart open on the second chart)."
created: 2026-09-29T08:14:00.000Z
updated: 2026-09-29T08:48:00.000Z
---

# Debug Session: Chart Playback Shaking, Second Chart Empty, and 1D Lone Candle

## Root Cause Analysis
1. **Empty 1D Chart & "One Lone Candle"**:
   - `historical.duckdb` daily aggregations return composite session strings like `"POST, PRE, REG"`.
   - `isRthBar` previously checked `s.includes('PRE') || s.includes('POST')` before `s.includes('REG')`, immediately discarding all historical daily candles.
   - This left `filteredData` empty (0 bars) on 1D charts. When playback started, only today's dynamically synthesized candle (`formingDaily`) rendered, producing a lone candle with no historical context.
2. **Strict RTH Filtering Requirement**:
   - User clarified: *"the code is supposed to filter 1d bars to only use rth data and not the full day data."*
   - Intraday bars must strictly enforce RTH (09:30 - 16:00 ET, session `REG` / `RTH`).
   - Daily bars with composite session strings that include `REG` or `RTH` are preserved, while days without regular trading hours (pure `PRE`/`POST`) are discarded.
   - Premarket ticks between 9:20 AM and 9:29:59 AM ET are excluded from forming daily candle OHLCV.
3. **Chart Shaking & Viewport Fighting During Playback**:
   - In commit `480f466`, `syncViewport(isSameContext)` was called unconditionally on every data update frame, even for incremental updates (`canIncrement === true`).
   - `useEffect([isHydrated, scrollToRealTime])` fired on every hydration, repeatedly fighting user viewport position.
   - User could not freely pan or inspect historical data while playback was streaming.

## Solution Implemented
1. [`src/lib/timezones.ts`](file:///Users/emadarshadalam/Documents/GitHub/market-rewind/src/lib/timezones.ts):
   - Differentiated daily bars from intraday bars in `isRthBar`.
   - Daily bars with `REG` or `RTH` (or no explicit session) are preserved; pure `PRE`/`POST` days are rejected.
   - Intraday bars strictly enforce 09:30 - 16:00 ET.
2. [`src/hooks/useChartData.ts`](file:///Users/emadarshadalam/Documents/GitHub/market-rewind/src/hooks/useChartData.ts):
   - In replay mode, drops today's completed bar (`d.time.slice(0, 10) < selectedDate`) so today's candle forms live strictly from RTH ticks/bars between 9:30 AM and 4:00 PM ET.
3. [`src/hooks/useChartLifecycle.ts`](file:///Users/emadarshadalam/Documents/GitHub/market-rewind/src/hooks/useChartLifecycle.ts):
   - Guarded `syncViewport` with `if (!canIncrement || !isSameContext)` so incremental ticks do not reset the viewport.
   - Added `hasScrolledToRealTimeRef` to avoid repeated viewport auto-scrolling during streaming.
4. [`src/hooks/chart/useChartViewport.ts`](file:///Users/emadarshadalam/Documents/GitHub/market-rewind/src/hooks/chart/useChartViewport.ts):
   - Preserves `oldLogicalRange` when `wasAtEnd` is false so user panning is respected.
5. **New Regression & Integration Test Suites**:
   - `tests/regression/replay/premarketToRthReplay.test.ts`: Tests 9:20 AM premarket state, 9:30 AM tick flood, RTH filtering, and viewport stability.
   - `tests/integration/multiChartWorkspaceReplay.test.tsx`: Tests 2-chart workspace with 5min and 1D charts, verifying simultaneous loading at 9:20 AM and live forming at 9:30 AM without lone candles or viewport shaking.

## Verification
- `npm test`: 52 test suites, 296 tests, all 100% green.
