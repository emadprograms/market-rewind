---
phase: 35-unified-daily-volume-and-live-price-policy
plan: 01
status: completed
executed_at: 2026-09-30
requirements:
  - LIVE-VOL-01
  - LIVE-VOL-02
---

# Summary 35-01: Unified Daily Volume & Live Price Policy

## Implementation
1. **LIVE-VOL-01 (Unified Daily Volume)**:
   - Modified `useChartLifecycle.ts` lines 680-750 to apply the unified daily aggregation policy for all 1D playback (both real tick and synthetic fallback).
   - Utilized `evalTimeMs` (taking into account `state.currentTime`) to determine minute boundary closure and forming-minute tick aggregation, matching `useChartData.ts`'s policy.
   - Added minute boundary crossing detection so that crossing into a new minute closes previous minute volume even if new minute ticks are sparse.
   - Verified that seeking, playing across minute boundaries, and pausing yields strictly identical daily OHLCV and volume.

2. **LIVE-VOL-02 (Stable Live Price Line)**:
   - Updated `useChartLifecycle.ts` lines 890-915 so that the paused price line subscriber checks `state.latestTickBySymbol?.[sym]` and `state.currentTick` first.
   - Prevents reverting to historical completed bar close when playback is paused.
   - Verified that PROBE 1 and PROBE 4 in `tests/unit/liveReview.test.ts` pass cleanly.
