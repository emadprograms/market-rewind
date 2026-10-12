# Quick Task 261007-nsp: Playback Non-Pause Seeking, Single Bid/Ask Price Lines, and Order Execution at Bid/Ask

## Goals
1. **Playback Non-Pause on Seek & Step**: Ensure stepping, slider seeking, and time jumping preserve the active playback state rather than forcibly pausing replay.
2. **Remove Live Price Line**: Remove the redundant 'Live' price line on the Y-axis so only the Bid and Ask price lines and labels appear.
3. **Execute Orders at Bid/Ask Quotes**:
   - BUY orders execute at the Ask price (`tick.ask` or synthetic fallback `price + 0.01`).
   - SELL orders execute at the Bid price (`tick.bid` or synthetic fallback `price - 0.01`).
   - Closing a Long calculates PnL at the Bid price; closing a Short calculates PnL at the Ask price.
   - Unrealized PnL evaluates Longs against Bid and Shorts against Ask.

## Implementation Details
1. **`src/store/usePlaybackStore.ts` & `src/components/PlaybackBar.tsx`**:
   - `seekTickTime`, `seekTickIndex`, `stepForward`, `stepBackward` maintain `isPaused` state instead of forcing `isPaused: true`.
   - Removed `setPaused(true)` in slider onChange, onMouseUp, onTouchEnd, and jump submit handlers.
2. **`src/hooks/useChartLifecycle.ts`**:
   - Removed `priceLineRef` declaration and eliminated the creation/updating of the `Live` price line in Subscribers 6 and 7.
   - Only `bidPriceLineRef` ('Bid') and `askPriceLineRef` ('Ask') are rendered on the price scale.
3. **`src/hooks/useTradeManager.ts` & `src/components/ChartUnit.tsx`**:
   - Added `getAskPrice` and `getBidPrice` helpers reading from `usePlaybackStore`'s `latestTickBySymbol` / `currentTick`.
   - BUY orders open and flip at Ask price; SELL orders open and flip at Bid price.
   - Position closes and flips calculate realized PnL using the appropriate side of the spread.
   - Unrealized PnL marks Longs to Bid and Shorts to Ask.
