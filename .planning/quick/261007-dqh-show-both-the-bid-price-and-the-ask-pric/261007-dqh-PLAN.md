# Quick Task 261007-dqh: Show Bid and Ask Price Lines on Chart Y-Axis

## Goal
Display both Bid price and Ask price lines and y-axis labels on the Lightweight Charts price scale across all chart timeframes during live playback, pausing, stepping, and scrubbing.

## Tasks

### Task 1: Implement Bid & Ask Price Lines in `src/hooks/useChartLifecycle.ts`
- Maintain `bidPriceLineRef` and `askPriceLineRef` references to `IPriceLine`.
- Implement `updateBidAskPriceLines(tick, fallbackPrice)` helper:
  - Bid line: `#2196f3` (blue), dashed (`lineStyle: 2`), `title: 'Bid'`, `axisLabelVisible: true`, `axisLabelColor: '#2196f3'`, `axisLabelTextColor: '#ffffff'`.
  - Ask line: `#ef5350` (red), dashed (`lineStyle: 2`), `title: 'Ask'`, `axisLabelVisible: true`, `axisLabelColor: '#ef5350'`, `axisLabelTextColor: '#ffffff'`.
  - Prefer `tick.bid` / `tick.ask`; if missing but `tick.price` exists, use standard ±$0.01 quote spread fallback. If no tick exists, derive fallback quote from latest bar close.
- Update Bid and Ask lines during direct tick playback in subscriber 6.
- Update Bid and Ask lines during paused/seeking state in subscriber 7.
- Initialize Bid and Ask lines upon chart hydration / master data availability.
- Clean up price lines when ticker or timeframe changes or when chart unmounts.

### Task 2: Add Unit & Integration Tests in `tests/unit/bidAskPriceLines.test.tsx`
- Test that both Bid and Ask price lines are created with `title: 'Bid'` and `title: 'Ask'` and `axisLabelVisible: true`.
- Test that Bid and Ask price lines update with latest quotes on ticks.
- Test that Bid and Ask price lines update when seeking or paused.
- Test that Bid and Ask price lines are cleaned up upon ticker switch or unmount.
