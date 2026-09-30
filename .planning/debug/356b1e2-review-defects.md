---
status: resolved
trigger: "Follow-up review market-rewind-356b1e2-review.md: (1) Daily playback still applies synthetic data rejected by paused snapshots (useChartLifecycle vs useChartData at 09:30:01), (2) Convergence tests still pass manually assembled candle into mountLifecycle rather than verifying real data-to-lifecycle pipeline, (3) Playwright temporal boundary assertion too permissive (23:59:59)."
created: 2026-09-30T08:24:00.000Z
updated: 2026-09-30T08:35:00.000Z
---

# Debug Session: Review 356b1e2 Findings

## 1. Symptoms & Review Findings
1. **Finding 1 (P1): Daily playback applies synthetic data rejected by paused snapshots**
   - Locations: `src/hooks/useChartData.ts:496` and `src/hooks/useChartLifecycle.ts:651–654, 720–741`.
   - Symptom: At 09:30:01 with a TSLA fixture of 10,000 volume and no raw ticks:
     - Playing, actual series update: Open 101, High 101, Low 99.6, Close 99.6, Volume 10,000.
     - Paused snapshot: Open 101, High 101, Low 101, Close 101, Volume 0.
   - Pausing changes the candle from Volume 10,000 to 0 and Close 99.6 to 101 despite an unchanged cursor and unchanged data.
2. **Finding 2 (P2): Claimed convergence coverage skips snapshot construction**
   - Locations: `tests/unit/followupReviewProbes.test.ts:248-259` and `tests/unit/rereviewProbes.test.ts`.
   - Direct seek passed a manually assembled candle `{ high: 110, low: 95, close: 108, volume: 210 }` into `mountLifecycle` rather than evaluating `useChartData` output.
3. **Finding 3 (P2): Playwright E2E containment assertion allows future leaks**
   - Location: `tests/regression/journey/12-replay-convergence.spec.ts:54-57`.
   - Replay cursor is 09:20:00 ET, but assertion checked `<= 23:59:59`.

## 2. Red Phase Verification
- Replicated in `tests/codex/convergence/review.test.ts`:
  - `356b1e2: daily seek and play must agree through real data and lifecycle hooks` -> **FAILED** (expected 10,000 to be 0).

## 3. Root Cause Analysis
1. In `useChartLifecycle.ts`:
   - During live playback subscriber callback, when `newlyElapsedTicks` is empty, it falls back to `latestTick`.
   - When `latestTick.isSynthesized` is true (e.g. from fallback mode in `usePlaybackStore`), the minute has NOT closed (`barMs + 60000 > currentTime`).
   - Line 736 unconditionally added `tickVol` (10,000) into `syntheticBucketVolumesRef` and updated `lastCandle.low = 99.6, lastCandle.close = 99.6`, leaking unclosed minute volume and interpolated synthetic prices.
   - Conversely, in `useChartData.ts`, `isMinuteForming` sets volume to 0 and rejects synthetic ticks (`!(latestTick as any).isSynthesized`).
2. In `useChartLifecycle.ts` hydration (line 511):
   - `barMs < currentCutoffMs` allowed an unclosed minute bar at `barMs` to be hydrated into `bucketMinutes` even when `barMs + 60000 > currentCutoffMs`.

## 4. Fix Strategy
1. In `useChartLifecycle.ts`:
   - For `timeframe === '1D'` with `isSynthetic` ticks: Only completed constituent RTH minute bars (`barMs + 60000 <= currentTime`) contribute volume, high, low, close to the daily candle. If no constituent minutes have completed yet (e.g. 09:30:01), volume remains 0 and high/low/close remain open.
   - In snapshot hydration (`useChartLifecycle.ts:511`): check `barMs + 60000 <= currentCutoffMs`.
   - On minute boundary completion (`09:31:00`), incorporate completed minute's full OHLCV into both live update and paused snapshot.
2. In `tests/unit/followupReviewProbes.test.ts` and `tests/unit/rereviewProbes.test.ts`:
   - Connect real `useChartData` + `useChartLifecycle` in the convergence test harness so direct seek constructs the candle through the real data hook.
   - Test both 5m raw trades fixture and 1D synthetic fallback fixture.
3. In `tests/regression/journey/12-replay-convergence.spec.ts`:
   - Assert `utcToEtClock(lastBarTime!)` matches the replay cursor boundary (`09:20`) rather than `23:59:59`.

## 5. Verification & Outcomes
- **Red Phase:**
  - `tests/codex/convergence/review.test.ts`: Failed initially with `AssertionError: expected 10000 to be +0`.
- **Green Phase:**
  - `tests/codex/convergence/review.test.ts`: 8/8 passed.
  - `tests/unit/followupReviewProbes.test.ts`: 4/4 passed.
  - `tests/unit/rereviewProbes.test.ts`: 4/4 passed.
  - `tests/regression/journey/12-replay-convergence.spec.ts`: 2/2 passed.
  - Full Vitest suite: 77/77 files, 398/398 tests passed (100%).
  - Backend pytest suite: 11/11 tests passed (100%).
  - Playwright journey suite: 65/65 tests passed (100%).
  - Vite production build: Clean build in 890ms.
- **Zero Regressions:** Continuous playback, direct seek, seek-then-play, and rewind-and-replay produce identical candles with zero data leakage across all supported timeframes.
