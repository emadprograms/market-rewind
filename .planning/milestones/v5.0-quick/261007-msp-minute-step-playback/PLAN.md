# Quick Task 261007-msp: Minute-Based Playback Stepping Controls

## Goal
Replace sub-second single-tick stepping with configurable minute-based stepping (1m, 5m, 10m, 15m, 30m, 1 tick) in the bottom playback bar, providing a STEP selector dropdown and dedicated unit/integration tests.

## Problem Statement
Previously, clicking "Step Forward" or "Step Backward" advanced or rewound the replay cursor by exactly 1 tick in `bufferedTicks`. Since ticks are recorded sub-second (often tens or hundreds of milliseconds apart), clicking the step forward button appeared to do nothing visually on candlestick charts.

## Implementation Details
1. **`usePlaybackStore.ts`**:
   - `stepForward()`: When `stepMinutes > 0`, calculates the next minute boundary (`Math.ceil((currentMs + 1000) / stepMs) * stepMs`) clamped to session data bounds, and invokes `seekTickTime(targetMs)` to update the replay position, ticks, and charts deterministically. When `stepMinutes <= 0`, steps by single tick.
   - `stepBackward()`: When `stepMinutes > 0`, calculates the previous minute boundary (`Math.floor((currentMs - 1000) / stepMs) * stepMs`) clamped to session data bounds, and invokes `seekTickTime(targetMs)`. When `stepMinutes <= 0`, steps by single tick.
2. **`PlaybackBar.tsx`**:
   - Added a `STEP` selector control next to the playback controls with options: `1m` (default), `5m`, `10m`, `15m`, `30m`, and `1 tick`.
   - Updated button tooltips and `aria-label`: `Step ${stepMinutes}m Forward` / `Step ${stepMinutes}m Backward` (or `Step 1 Tick Forward`/`Backward`).
   - Added `data-testid="playback-step-select"`, `data-testid="step-forward-btn"`, and `data-testid="step-backward-btn"`.
3. **Tests**:
   - Added comprehensive test suite in `tests/unit/playbackMinuteStepping.test.tsx` verifying 1m, 5m, 10m, 15m step forward, step backward, boundary alignment, clamping at start/end of session, and UI dropdown interactions.
   - Updated existing integration and regression tests for test IDs and step mode options.
