# Phase 22-01 Summary: Event-Driven Playback Ingestion & Canonical Candle Aggregation

## Executive Summary
Phase 22 resolved the critical playback ingestion and candle formation defects identified in `market-rewind-diagnosis-and-plan.md` (DIAG 1, DIAG 2, DIAG 4, DIAG 5, DIAG 6, DIAG 7, DIAG 9, DIAG 10). By transitioning playback from naive tick-polling to event-aware intra-frame trade aggregation and cursor tracking, replay now faithfully reflects historical trade prints with 100% mathematical volume and OHLC accuracy.

## Key Changes Made

### 1. Multi-Tick Intra-Frame Aggregation & Volume Deduplication (`src/hooks/useChartLifecycle.ts`)
- Added `lastConsumedTickRef` and `lastConsumedTimeRef` to track the exact trade prints processed by the chart series.
- When the replay clock advances multiple ticks in a single animation frame (or across variable tick speeds), the hook queries all elapsed ticks in `state.ticksBySymbol[sym]` between the last consumed timestamp and `currentTime`.
- Aggregates all intermediate trades in the frame into `high = Math.max(...)`, `low = Math.min(...)`, `close = lastTick.price`, and sums incremental trade volume.
- Prevents volume recounting when the clock advances without new trades or when identical ticks trigger store subscriptions (resolves DIAG 1 and DIAG 2).

### 2. Immediate First-Candle Initialization (`src/hooks/useChartLifecycle.ts`)
- Added support for empty initial history (`!lastCandleRef.current`): when ticks stream in on an empty chart, `useChartLifecycle` initializes and renders the first forming candle immediately without requiring a full reload or pause transition (resolves DIAG 4).

### 3. Strict Extended Hours (ETH-off) Live Playback Filtering (`src/hooks/useChartLifecycle.ts`)
- Enforced `isRthTick(tick, ticker)` during active playback when `showEth === false`. Premarket and postmarket ticks are completely filtered out, preventing off-hours trades from distorting regular trading session charts (resolves DIAG 7).

### 4. Premarket Fallback Volume Compounding Prevention (`src/store/usePlaybackStore.ts` & `src/hooks/useChartLifecycle.ts`)
- Flagged fallback ticks with `isSynthesized: true` in `usePlaybackStore.advanceSimulationTime`.
- Guarded `useChartLifecycle` against compounding the entire minute volume repeatedly on each frame when synthetic fallback ticks are active (resolves DIAG 6).

### 5. Multi-Symbol Ingestion Cursor Stability (`src/store/usePlaybackStore.ts`)
- Updated `addSymbolTicks` to recompute `currentTickIndex` preserving the current active tick's identity and timestamp in the sorted unified buffer, preventing replay cursor jumps when new symbols are loaded (resolves DIAG 5).

### 6. Future OHLC Leak Elimination & Generalization (`src/hooks/useChartData.ts`)
- Generalized `candidateBars` in `useChartData` so all tickers (not just SPY) utilize active replay master data.
- Bounded forming multi-minute candles at `bMs === effectiveCutoff` to known elapsed open prices, preventing future high/low/close prices from leaking ahead of the replay clock (resolves DIAG 9).

## Verification Results
- `tests/unit/diagnosticReplication.test.ts`: **7/7 passed** (DIAG 1, DIAG 2, DIAG 3, DIAG 4, DIAG 5, DIAG 6, DIAG 7).
- `tests/unit/dataIntegrityReplication.test.ts`: **4/4 passed** (DIAG 8, DIAG 9, DIAG 10, DIAG 11).
- `npm test`: **62/62 test suites passed (341/341 tests)**.
- `npm run build`: Production build verified with zero errors.
