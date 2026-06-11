# Phase 05 Review: Data Pipeline & Resampling Hardening

This document contains independent reviews of the Phase 05 plan from multiple AI perspectives to ensure architectural robustness and implementation correctness.

## 🤖 Gemini Review
**Focus: Architecture & Performance**
**Verdict: APPROVED (with suggestions)**

### Analysis
The transition from $O(N)$ to $O(tail)$ is the highlight of this plan. By introducing a hybrid caching strategy, the system solves the "shape-shifting" candle problem while simultaneously removing a significant bottleneck from the playback loop. The mathematical alignment between `stepForward` and the resampling buckets is sound.

### Suggestions
- **Cache Invalidation:** The plan mentions invalidating the cache when `timeframe` or `ticker` changes. I strongly recommend adding a test case where the timeframe is toggled *during* active playback to ensure the `lastClosedBucketEnd` is reset and the cache is purged without leaving stale candles from the previous timeframe.
- **Memory Footprint:** While $O(tail)$ processing is fast, the `cachedCandles` array grows linearly with the session length. For extremely large datasets, consider if a fixed-size sliding window or a more specialized data structure is needed, though for standard trading sessions, a simple array is likely sufficient.

---

## ✍️ Claude Review
**Focus: Edge Cases & Correctness**
**Verdict: APPROVED (with flags)**

### Analysis
The "Session-Break Rule" is a critical requirement that is correctly identified. Forcing a bucket close at session transitions prevents the dangerous merging of PRE and REG data, which would otherwise distort OHLC values. The TDD approach outlined in the validation matrix is comprehensive.

### Flags & Edge Cases
- **Variable Candle Lengths:** By splitting at session boundaries "regardless of whether the time boundary was reached," the system will produce candles of varying durations. This is the correct behavior for the domain, but it should be explicitly documented in the `VALIDATION.md` so that it isn't mistaken for a bug during manual verification.
- **Data Gaps:** The plan assumes a continuous stream of 1m bars. If there are gaps in the `localMasterData` (missing bars), `resampleData` should be verified to ensure it doesn't inadvertently merge bars across a gap if that gap represents a session transition or a significant time jump.
- **Temporal Precision:** Ensure that all time comparisons use strict integer milliseconds. Avoid any floating-point division that could lead to "off-by-one-ms" errors in bucket boundary calculations.

---

## 💻 Codex / OpenCode Review
**Focus: Implementation & Technical Integrity**
**Verdict: APPROVED**

### Analysis
The implementation path is clear and surgical. The use of `Math.floor` for bucket anchors and `Math.ceil` for playback steps is the industry standard for time-series alignment.

### Technical Notes
- **UTC Parsing:** The `replace(' ', 'T') + 'Z'` approach for DB strings is a pragmatic shortcut. However, if the database format ever changes (e.g., to include milliseconds or different separators), this will break. I recommend wrapping this in a dedicated `parseUTCDate` utility function to centralize the logic.
- **Array Allocation:** The operation `[...cachedCandles, ...resampledTail]` occurs on every playback tick. In JavaScript, this creates a new array reference, which might trigger frequent GC (Garbage Collection) during high-speed playback. If performance jitter is observed, consider updating a pre-allocated TypedArray or using a more stable reference for the render loop.
- **Null Safety:** Ensure `resampleData` has an explicit guard clause for `null` or `undefined` input to prevent the "Cannot read property 'time' of undefined" errors when the `tailData` filter returns an empty set.
