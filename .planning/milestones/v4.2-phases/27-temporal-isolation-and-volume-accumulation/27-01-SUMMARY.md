# Phase 27 Summary: Temporal Isolation & Volume Accumulation

**Milestone:** v4.1 Replay Convergence, State Machine Synchronization & Transition Integrity
**Phase:** 27 — Temporal Isolation & Volume Accumulation
**Plan:** 27-01
**Status:** Completed & Verified

---

## 1. Work Completed

### A. Forming Candle Look-Ahead Protection Across Entire Interval (REV-FORM-01)
- In `src/hooks/useChartData.ts`, updated constituent bar filtering to detect forming candles across the entire forming interval:
  `const isConstituentForming = isReplayMode && bMs <= effectiveCutoff && bMs + 60000 > effectiveCutoff;`
- Prevented lookahead leaks at any second before bucket close (e.g. at 09:20:01, 1 second past boundary, the forming candle bounds high/low/close to known open, preventing exposure of the completed minute high 105).
- Verified: Both `reviewTransitions.test.tsx` (PROBE 5) and `tests/codex/review/data.test.ts` pass cleanly.

### B. Multi-Minute Fallback Constituent Volume Accumulation (REV-FORM-02)
- In `src/hooks/useChartLifecycle.ts`, added `syntheticBucketVolumesRef` mapping each constituent minute's timestamp to its volume within the current higher-timeframe candle bucket.
- Replaced the single-minute overwrite (`lastCandle.volume = tickVol`) with constituent summation across the bucket:
  `totalBucketVol = sum(syntheticBucketVolumesRef.current.minutes.values())`.
- Guaranteed that subsequent frames within the same minute update that constituent minute without compounding (preserving DIAG 6), while advancing to new minutes accumulates prior minute volumes (e.g. 1000 + 200 = 1200).
- Verified: Both `reviewTransitions.test.tsx` (PROBE 4) and `tests/codex/review/review.test.ts` pass cleanly.

### C. Session Tick Loader Generation Guard (REV-FORM-03)
- In `src/App.tsx`, added `sessionGenRef` to `loadStreamingTicks`.
- Monotonically incremented the generation token on every session load invocation and verified `currentGen === sessionGenRef.current` after `Promise.all(...)` before committing `allTicks`, `targetMs`, and `currentTime`.
- Prevented race conditions where late responses for older dates overwrite newer date selections.
- Verified: Both `reviewSessionRace.test.tsx` (PROBE 7) and `tests/codex/review/race.test.ts` pass cleanly.

---

## 2. Verification Results

- Unit Tests:
  - PROBE 4 (5m fallback volume accumulation): PASS
  - PROBE 5 (1s past boundary lookahead protection): PASS
  - PROBE 7 (Session tick race condition guard): PASS
  - Codex `tests/codex/review/review.test.ts`: ALL 3 PASS
  - Codex `tests/codex/review/data.test.ts`: PASS
  - Codex `tests/codex/review/race.test.ts`: PASS
  - Codex `tests/codex/diagnosis/diagnostic.test.ts`: ALL 7 PASS
  - Codex `tests/codex/diagnosis/data.test.ts`: ALL 4 PASS
- Backend: 11/11 pytest tests pass
- 6 out of 7 review probes now pass (only PROBE 6 remains for Phase 28).
