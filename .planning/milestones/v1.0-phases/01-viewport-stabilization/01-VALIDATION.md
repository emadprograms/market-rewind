# Phase 01: Viewport Stabilization - Validation Map

This document maps the stability requirements to their automated verification methods.

## Requirements Mapping

| Req ID | Requirement | Test File | Test Case | Verification Method |
|--------|-------------|-----------|-----------|---------------------|
| STAB-01 | Ticker change $ightarrow$ No single candle snap | `tests/integration/viewport.test.ts` | `should not snap to single candle on symbol change` | Mock LWC `setData` and `scrollToRealTime`. Assert `scrollToRealTime` is called AFTER `setData` completes and a render cycle occurs. |
| STAB-02 | Data prepend $ightarrow$ Visual anchor preserved | `tests/integration/viewport.test.ts` | `should preserve visual anchor during history prepending` | Simulate data prepend. Assert that `setVisibleLogicalRange` is called with the correctly offset indices. |
| STAB-03 | `scrollToRealTime` $ightarrow$ After hydration lock | `tests/hooks/useChartLifecycle.test.ts` | `should only trigger scrollToRealTime when isHydrated is true` | Unit test the `useChartLifecycle` hook. Assert `isHydrated` state transitions and that the scroll trigger depends on this state. |
| STAB-04 | Replay tick $ightarrow$ Viewport stable | `tests/integration/viewport.test.ts` | `should remain stationary during replay unless at right edge` | Simulate replay ticks. Assert no `setVisibleLogicalRange` or `scrollToRealTime` calls occur when the viewport is not at the `AUTO_REVEAL_THRESHOLD`. |

## Validation Gate

The phase is considered verified when all tests in `tests/integration/viewport.test.ts` and `tests/hooks/useChartLifecycle.test.ts` pass.
