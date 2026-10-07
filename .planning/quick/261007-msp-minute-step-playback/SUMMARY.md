---
status: complete
task: 261007-msp
date: 2026-10-07
description: Minute-based playback stepping controls with step selector (1m, 5m, 10m, 15m, 30m, 1 tick)
---

# Quick Task Summary: 261007-msp Minute-Based Playback Stepping Controls

## Objective
Enable minute-based stepping (1 minute, 5 minute, 10 minute, 15 minute, 30 minute, and 1 tick) for forward and backward playback controls in the bottom bar with an intuitive STEP selector dropdown.

## Key Changes
1. **`src/store/usePlaybackStore.ts`**:
   - Updated `stepForward` and `stepBackward` to advance/rewind by `stepMinutes` (1m, 5m, 10m, 15m, etc.) aligned to boundary times and clamped within data bounds using `seekTickTime`.
   - Maintained single-tick fallback when `stepMinutes === 0`.
2. **`src/components/PlaybackBar.tsx`**:
   - Added `STEP` selector dropdown beside the playback transport controls (`1m`, `5m`, `10m`, `15m`, `30m`, `1 tick`).
   - Dynamically updated forward/backward button titles and aria-labels (`Step ${stepMinutes}m Forward`, etc.).
   - Added test attributes `data-testid="playback-step-select"`, `data-testid="step-forward-btn"`, and `data-testid="step-backward-btn"`.
3. **Tests**:
   - Added `tests/unit/playbackMinuteStepping.test.tsx` (11 tests covering 1m/5m/10m/15m forward/backward, boundary clamping, intermediate alignment, dropdown store sync, and UI click stepping).
   - Updated `tests/integration/tickReplay.test.tsx`, `tests/regression/replay/tickReplayDateReset.test.tsx`, `tests/unit/tickPlaybackStore.test.ts`, and `tests/unit/realTickPlayback.test.ts` to support configurable step sizes.
