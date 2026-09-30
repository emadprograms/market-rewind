---
status: resolved
trigger: "Follow-up review market-rewind-5e0b776-review.md: First daily candle created during playback uses synthetic price and full minute volume"
created: 2026-09-30T09:12:00.000Z
updated: 2026-09-30T09:13:00.000Z
---

# Debug Session: Review 5e0b776 Findings

## 1. Symptoms & Review Findings
1. **Finding 1 (P1): First daily candle created during playback uses synthetic price and full minute volume**
   - Locations: `src/hooks/useChartLifecycle.ts:826–843` and `682-721`.
   - Symptom: At 09:30:01 with a TSLA fixture of 10,000 volume and no raw ticks:
     - Playing across 09:30 boundary (new bucket) initializes candle with synthetic price (e.g. 99.6) and synthetic volume (10000).
     - Paused snapshot initializes candle with correct open (101) and volume (0).

## 2. Red Phase Verification
- Replicated in `tests/codex/convergence/5e0b776-review.test.ts`:
  - `5e0b776: starting before RTH must create the same daily candle as pausing` -> **FAILED** (expected 10000 to be 0).

## 3. Root Cause Analysis
- `useChartLifecycle.ts` had duplicated fallback logic.
- While existing bucket update (`lastCandle.time === bucketTime`) had a mitigation to calculate daily candle from `masterData` using `timeframe === '1D' && isSynthetic`, the code for creating *new* buckets (`!lastCandle` and `lastCandle.time !== bucketTime`) did not fully respect this logic. It used `tick.price` instead of the actual `open` from `masterData`, and incorrectly kept synthetic volume.

## 4. Fix Strategy
- Consolidate the `timeframe === '1D' && isSynthetic` logic at the top of the `for (const tick of newlyElapsedTicks)` loop.
- Unify the fallback resolution of open, high, low, close, and volume directly from `masterData` using the exact same constraints.

## 5. Verification & Outcomes
- **Red Phase:** `tests/codex/convergence/5e0b776-review.test.ts` failed as expected.
- **Green Phase:** Refactoring fixed the issue and convergence test now passes.
