---
phase: 37-merge-boundaries-and-data-ordering
plan: 01
status: completed
executed_at: 2026-09-30
requirements:
  - LIVE-ORDER-01
  - LIVE-ORDER-02
---

# Summary 37-01: Merge Boundaries & Data Ordering

## Implementation
1. **LIVE-ORDER-01 (Strict Timestamp Ordering)**:
   - Updated `onVisibleLogicalRangeChanged` in `useChartData.ts` to merge pagination chunks using a millisecond-keyed `Map<number, RawBar>`, deduplicating duplicate entries and sorting timestamps strictly ascending (`sortedTimes.sort((a, b) => a - b)`).
   - Eliminates out-of-order chunks and lightweight-charts `Assertion failed: data must be asc ordered by time`.

2. **LIVE-ORDER-02 (Error State Handling & Generation Guard)**:
   - Added context generation guard checking `loadedTickerRef.current === reqTicker && dataTimeframeRef.current === reqTf` after history chunk fetch resolves.
   - Discards obsolete chunks from earlier symbol or timeframe contexts that resolve late.
   - Verified that `PROBE 3` in `tests/unit/liveReview.test.ts` passes cleanly.
