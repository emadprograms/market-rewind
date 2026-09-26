---
status: resolved
trigger: "User reported that progress isn't real-time. Ticks load for the day but play on fixed intervals instead of their real-time timestamps. If 17 updates happen within one second in real market time, all 17 updates must happen within that 1-second window at their respective real-time market offsets."
created: 2026-09-26T12:15:00Z
updated: 2026-09-26T12:37:00Z
symptoms:
  expected: "Tick playback must advance based on real market timestamp deltas scaled by replay speed. Multiple ticks in the same second must emit proportionally within that second, and gaps between trades must be respected proportionally without emitting synthetic fake ticks."
  actual: "Playback originally advanced on fixed synthetic timer intervals (e.g. setInterval 1000/speed in PlaybackManager or 50ms/speed in server.py), advancing 1 tick per interval regardless of actual timestamp deltas."
  error_messages: "None (behavioral / timing defect)"
  timeline: "Fixed continuous simulation clock engine implemented in usePlaybackStore and PlaybackManager; verified by comprehensive unit tests and Playwright E2E suite."
---

## Root Cause
1. `PlaybackManager.tsx` previously stepped replay by running a fixed `setInterval(() => tick(1), 1000 / playbackSpeed)`. Every interval advanced exactly 1 tick index, completely disregarding the real timestamps of trades.
2. In `backend/streaming_service/server.py`, the WebSocket streaming play loop similarly had a hardcoded `await asyncio.sleep(0.05 / self.speed)` per tick.
3. Pre-market quiet period edge case: when replay started before regular market open (e.g. 09:20 ET vs 09:30 open), `advanceSimulationTime` needed to allow continuous time progression without stalling on unreached ticks.

## Resolution
1. **Continuous Simulation Clock in Store (`usePlaybackStore.ts`)**:
   - Added `advanceSimulationTime(targetTimeMs: number)` which updates `currentTime: targetTimeMs` continuously.
   - Evaluates all buffered ticks up to `targetTimeMs`: when 17 trades occur in 1 second, all 17 are consumed at their exact millisecond offsets; when no trades occur, the clock advances in real time without advancing tick indices.
2. **Animation Frame Loop in Frontend (`PlaybackManager.tsx`)**:
   - Replaced fixed-cadence `setInterval` with `requestAnimationFrame` loop calculating elapsed wall time:
     $$\Delta t_{\text{market}} = \Delta t_{\text{wall}} \times \text{playbackSpeed}$$
     $$\text{currentTime} = \text{currentTime} + \Delta t_{\text{market}}$$
3. **Proportional WebSocket Streaming (`backend/streaming_service/server.py`)**:
   - Updated `play_loop` to calculate timestamp deltas $(\Delta t = t_{i+1} - t_i)$ between consecutive ticks and sleep $(\Delta t / \text{speed})$.
4. **Deterministic Loading State (`isLoadingTicks`)**:
   - Added `isLoadingTicks` to prevent race conditions during initial DuckDB tick fetching.
5. **Timezone Harmonization (`timezones.ts`, `useChartData.ts`, `useSession.ts`, `App.tsx`)**:
   - Centralized `getUtcTimeFromEt` ensuring consistent UTC bounds querying against DuckDB.

## Verification
- **Unit Suite (`tests/unit/realtimePlayback.test.ts`)**: 4/4 passing tests verifying clustered tick bursts (17 ticks in 1s), quiet periods, multi-ticker synchronization, and pre-open advance.
- **Playwright Suite (`tests/regression/replay/realtimePlayback.spec.ts`)**: 3/3 passing tests verifying continuous real-time market playback, speed scaling (10x), and quiet period clock progression.
- **Full E2E Suite (`npx playwright test --workers=1`)**: 13/13 passing tests.
