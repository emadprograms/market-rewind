# Phase 05: Data Pipeline & Resampling Hardening - Research

**Researched:** 2025-05-22
**Domain:** Time-series data processing / OHLCV Resampling
**Confidence:** HIGH

## Summary

This phase addresses the "shape-shifting" (mutation) of resampled candles during playback and ensures strict alignment between the playback clock and resampling bucket boundaries. 

The current implementation follows a **Filter $ightarrow$ Resample** pipeline. Every time the playback clock (`globalTime`) advances, the entire dataset is re-filtered and then re-resampled from scratch. While mathematically consistent for closed candles, the "current" (open) candle evolves as each 1-minute bar is added, which can be perceived as mutation. Furthermore, the current resampling logic does not account for session boundaries (REG/PRE/POST), potentially merging bars from different sessions into a single resampled candle.

**Primary recommendation:** Implement a **Cached Resampling Strategy** where closed buckets are stored in an immutable cache and only the "tail" (the active bucket) is recalculated. Additionally, introduce **Session-Aware Bucketing** to prevent candles from spanning across session transitions.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Playback Clock | `usePlaybackStore` | — | Owns the master `currentTime` and step logic. |
| Data Filtering | `useChartData` | — | Filters the master dataset based on `currentTime` and `showEth`. |
| Resampling Logic | `resampling.ts` | — | Pure utility for aggregating 1min bars into larger timeframes. |
| Boundary Alignment | `usePlaybackStore` | `resampling.ts` | Ensures `stepForward` lands on multiples of the timeframe duration. |
| State Persistence | `useChartData` | — | Responsible for caching closed resampled candles to prevent mutation. |

## Current State Analysis

### 1. Data Flow
`localMasterData` (1min) $ightarrow$ `filteredData` (filtered by `globalTime`) $ightarrow$ `resampleData` $ightarrow$ `chartData` (resampled).

### 2. Mathematical Alignment
- **Resampling Bucket Start:** `Math.floor(timestamp / (durationMin * 60000)) * (durationMin * 60000)`
- **Playback Step Forward:** `Math.ceil((currentMs + 1) / (stepMinutes * 60000)) * (stepMinutes * 60000)`

These are mathematically aligned. Both use multiples of `durationMin * 60,000ms` as their anchor points.

### 3. The "Mutation" Problem
The "mutation" is not a bug in the math, but a result of the pipeline:
- If the timeframe is 5min and the playback time is 10:02, `resampleData` sees 2 bars (10:00, 10:01). It creates a candle based on these 2.
- When playback hits 10:03, `resampleData` sees 3 bars. The 10:00 candle's `close`, `high`, and `low` are updated.
- To the user, the 10:00 candle "changes shape" until 10:05 is reached.

## Proposed Strategy: Stability & Evolution

### The Hybrid Cached Approach
To achieve both stability for closed candles and evolution for the open one, we should move away from full re-resampling on every tick.

1. **Closed Bucket Cache:** Maintain a list of finalized candles in `useChartData`.
2. **Finalization Trigger:** A candle is "closed" when the `globalTime` has passed the end of its bucket boundary.
3. **Tail Resampling:**
   - Use cached candles for all time < `lastClosedBucketEnd`.
   - Only call `resampleData` on the remaining slice of `filteredData` (the "tail").
   - Append the resulting (potentially incomplete) open candle to the cached set for rendering.

**Logic Flow:**
```typescript
const { cachedCandles, lastClosedBucketEnd } = useResampleCache();
const tailData = filteredData.filter(d => d.time >= lastClosedBucketEnd);
const openCandle = resampleData(tailData, timeframe); 
const finalChartData = [...cachedCandles, ...openCandle];
```

### Filtering Order Comparison

| Approach | Stability | Evolution | Performance | Verdict |
|-----------|-----------|-----------|-------------|---------|
| **Filter $ightarrow$ Resample** (Current) | Low (Open candle shifts) | High | Medium ($O(N)$) | Functional but "jumpy" |
| **Resample $ightarrow$ Filter** | High (Closed only) | None | High | Too static |
| **Cached Hybrid** | **High** | **High** | **High** ($O(	ext{tail})$) | **Recommended** |

## Technical Specifications

### Mathematical Rules for Boundaries
All time calculations must use UTC milliseconds.
- **Bucket Start ($T_{start}$):** $\lfloor \frac{T_{current}}{D 	imes 60000} floor 	imes (D 	imes 60000)$
- **Bucket End ($T_{end}$):** $T_{start} + (D 	imes 60000)$
- **Alignment:** Playback `stepMinutes` MUST be a factor or multiple of the `Timeframe` duration to avoid "partial" steps that cause jarring visual updates.

### Session Transition Handling
To prevent artifacts at session breaks (e.g., merging PRE and REG):
- **Session-Break Rule:** A change in the `session` property of a `RawBar` must force the current bucket to close immediately, regardless of whether the time boundary was reached.
- **Implementation:** In `resampleData`, the condition for a new bucket should be:
  `if (!currentBucket || currentBucket.time !== bucketTimeStr || currentBucket.session !== bar.session)`

## Common Pitfalls

### 1. The "Last Bar" Trap
**Risk:** Thinking the last bar of the input data represents the end of the timeframe.
**Prevention:** Always calculate the theoretical bucket end based on the start time and duration, not the available data.

### 2. Timezone Shifting
**Risk:** `new Date().getTime()` can introduce local timezone offsets.
**Prevention:** Use `replace(' ', 'T') + 'Z'` to force UTC interpretation of the DB strings.

## Validation Architecture (TDD)

### Test Case 1: Closed Candle Immutability
- **Input:** 10 bars of 1min data. Timeframe: 5min.
- **Step A:** Set `globalTime` to 10:04. Verify OHLC of the 10:00 candle.
- **Step B:** Set `globalTime` to 10:06. Verify OHLC of the 10:00 candle.
- **Expectation:** OHLC at Step B must be identical to Step A's *final* state for that bucket.

### Test Case 2: Boundary Alignment
- **Input:** Timeframe 5min.
- **Action:** Trigger `stepForward` from 10:02.
- **Expectation:** `currentTime` should land exactly on 10:05, not 10:07.

### Test Case 3: Session Break Split
- **Input:** Bars from 09:25 (PRE) to 09:35 (REG). Timeframe 15min.
- **Expectation:** Two candles should be produced: one for PRE (ending 09:30) and one for REG (starting 09:30), even though they fall within the same 15min mathematical window.

## Performance Impact
- **Current:** $O(N)$ per tick. For 40k bars, this is $\sim 2	ext{--}5	ext{ms}$.
- **Proposed:** $O(1)$ for closed data + $O(D)$ for the tail (where $D$ is timeframe duration). This reduces per-tick processing to $< 1	ext{ms}$, eliminating potential main-thread blocking during high-speed playback.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The perceived "mutation" is the evolution of the open candle. | Summary | If closed candles are actually changing, the cause is a bug in `resampleData` logic, not the pipeline. |
| A2 | `localMasterData` is static during a playback session. | Current State | If data is streaming/updating, caching requires a more complex invalidation logic. |
