# Phase 05 Validation Matrix: Data Pipeline & Resampling Hardening

This document maps the requirements of Phase 05 to specific "Truths" and the automated/manual methods used to verify them.

## Requirement Mapping

| Req ID | Requirement | Observable Truth | Verification Method | Test Artifact |
|--------|-------------|------------------|---------------------|----------------|
| **DATA-01** | Session-aware resampling | Candles are split exactly at session boundaries (PRE/REG/POST) regardless of time bucket. | `npm test src/lib/resampling.test.ts` (Test Case: Session Break Split) | `src/lib/resampling.test.ts` |
| **DATA-02** | Hybrid caching (Immutable closed candles) | Closed candles (T < lastClosedBucketEnd) remain identical when globalTime advances. | `npm test src/hooks/useChartData.test.ts` (Test Case: Closed Candle Immutability) | `src/hooks/useChartData.test.ts` |
| **DATA-03** | Playback boundary alignment | `stepForward` results in `currentTime` landing precisely on resampled bucket boundaries. | `npm test src/store/usePlaybackStore.test.ts` (Test Case: Boundary Alignment) | `src/store/usePlaybackStore.test.ts` |
| **DATA-04** | Performance optimization (O(tail)) | `resampleData` processing time for ticks is minimized by only processing the tail. | `npm test src/unit/resampling.stress.test.ts` (O(tail) stress test) | `src/unit/resampling.stress.test.ts` |

## Verification Truths

### Truth 1: Session-Aware Splits
- **Condition**: Data contains bars crossing from PRE $\rightarrow$ REG session.
- **Expectation**: Resampler produces two separate candles, even if they fit in one timeframe bucket. 
- **Note**: This results in "variable candle lengths" where some candles may be shorter than the mathematical timeframe duration. This is expected behavior.
- **Pass Criteria**: `candles.length` increases by 1 at session transition.
- **Status**: **PASSED**

### Truth 2: Closed Candle Immutability
- **Condition**: `globalTime` advances past the end of a 5m bucket.
- **Expectation**: The OHLC of that 5m bucket never changes again regardless of further time advances.
- **Pass Criteria**: `previousOHLC === currentOHLC` for all indices $<$ `lastClosedIndex`.
- **Status**: **PASSED**

### Truth 3: Precise Playback Steps
- **Condition**: `currentTime` is 10:02, `stepMinutes` is 5.
- **Expectation**: After `stepForward()`, `currentTime` is exactly 10:05.
- **Pass Criteria**: `currentTime % (5 * 60000) === 0`.
- **Status**: **PASSED**

### Truth 4: O(tail) Complexity
- **Condition**: Total dataset size increases (e.g., 10k $\rightarrow$ 40k bars).
- **Expectation**: The execution time of `resampleData` during a playback tick remains constant.
- **Pass Criteria**: Average processing time per tick $< 0.5\text{ms}$.
- **Status**: **PASSED**

### Truth 5: Cache Lifecycle Integrity
- **Condition**: User changes `timeframe` or `ticker` during active playback.
- **Expectation**: The `cachedCandles` are purged and `lastClosedBucketEnd` is reset to 0.
- **Pass Criteria**: `cachedCandles.length` resets and recalculates from scratch.
- **Status**: **PASSED**

### Truth 6: Data Gap Robustness
- **Condition**: `localMasterData` contains gaps (missing 1m bars) across a session transition or a large time jump.
- **Expectation**: `resampleData` does not incorrectly merge bars from different sessions or disjoint time periods into a single candle.
- **Pass Criteria**: Resampled candle count matches expected session-break count.
- **Status**: **PASSED**

## Final Verdict: PASSED
All "must_haves.truths" from the Phase 05 plan have been empirically verified by automated tests. The hybrid caching strategy provides stable candles and high-performance resampling.
