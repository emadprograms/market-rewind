---
status: complete
task: 261007-nsp
date: 2026-10-07
description: Non-pause seeking/stepping, removal of live price line, and order execution at bid/ask quotes
---

# Quick Task Summary: 261007-nsp Playback Seeking Non-Pause, Live Price Line Removal, and Bid/Ask Trade Execution

## Objective
Address three core playback and execution issues:
1. Seeking forward/backward, scrubbing timeline sliders, or jumping time must not forcibly pause replay.
2. Remove the redundant "Live" price line from the chart Y-axis so only "Bid" and "Ask" lines/labels appear.
3. BUY orders must execute at the Ask price, SELL orders must execute at the Bid price, and trade closes / unrealized PnL must correctly respect Bid/Ask sides of the spread.

## Key Changes
1. **Playback Non-Pause on Seek & Step (`src/store/usePlaybackStore.ts` & `src/components/PlaybackBar.tsx`)**:
   - `seekTickTime`, `seekTickIndex`, `stepForward`, and `stepBackward` now preserve existing `isPaused` state rather than forcing `isPaused: true`. Playback only pauses automatically if reaching the end of session data (`targetMs >= maxMs`).
   - Removed `setPaused(true)` in slider `onChange`, `onMouseUp`, `onTouchEnd`, and jump submit handlers.
2. **Chart Price Lines Cleanliness (`src/hooks/useChartLifecycle.ts`)**:
   - Removed `priceLineRef` declaration and eliminated the creation, updates, and cleanup of the 'Live' price line in Subscribers 6 and 7.
   - Preserved only `bidPriceLineRef` ('Bid') and `askPriceLineRef` ('Ask') on the price scale.
3. **Bid/Ask Order Execution & Valuation (`src/hooks/useTradeManager.ts` & `src/components/ChartUnit.tsx`)**:
   - Added `getAskPrice` and `getBidPrice` helpers reading quotes from `usePlaybackStore.getState()` (`latestTickBySymbol` / `currentTick`) with synthetic $+/-0.01$ quote fallback if spread not present.
   - BUY orders execute at Ask; SELL orders execute at Bid.
   - Closing/flipping long positions realizes PnL at Bid; short positions realize PnL at Ask.
   - Added `closeTrade()` callback to `useTradeManager`.
   - Long unrealized PnL marks to current Bid; short unrealized PnL marks to current Ask.
   - Wired `ticker: data.ticker` into `useTradeManager` in `ChartUnit.tsx` and updated close button to call `trade.closeTrade()`.
4. **Tests Added & Updated**:
   - Added `tests/unit/playbackSeekingNonPause.test.tsx` (17 tests covering non-pausing seeking, stepping, jumping, and boundary behavior).
   - Added `tests/unit/tradeExecutionBidAsk.test.ts` (14 tests covering buy at ask, sell at bid, long close at bid, short close at ask, unrealized PnL marking, and quote spread fallbacks).
   - Updated `tests/unit/bidAskPriceLines.test.tsx`, `tests/unit/playbackViewportInteraction.test.ts`, `tests/unit/liveReview.test.ts`, `tests/unit/playbackBarSliderSeek.test.tsx`, and `tests/unit/seekChartBehavior.test.ts`.
