---
quick_id: 260928-time-slider
slug: time-based-playback-slider
status: complete
date: 2026-09-28
---

# Quick Task Summary: Time-Based Playback Scrubber Slider

## Overview
Replaced the tick-index-based scrubber slider with an authentic, time-based replay scrubber. Users can now prepare in pre-market at 09:20 AM ET, smoothly scrub to 09:29 AM or 09:30 AM ET with second-by-second linear precision, and hit PLAY to resume live replay without look-ahead bias or playback lockup.

## Root Cause & Need
1. **Non-Linear Tick Density**: Ticks are clustered heavily at market open (e.g. tens of thousands between 09:30 and 10:30), while pre-market has very few ticks. A tick-based slider squeezed the entire pre-market preparation window into an unusable 0.1% fraction of the slider.
2. **Arbitrary Units**: Users want to scrub to specific session times (e.g. 09:20 AM, 09:29 AM, 09:30 AM) rather than guessing arbitrary tick numbers (e.g. tick 3120).
3. **Temporal Isolation & Simulation Freezing**: `seekTickTime` used `Math.abs(tMs - targetMs)`. When seeking to 09:29 AM ET, it selected the closest tick in the future (the 09:30 AM market open tick). This leaked future prices and caused `advanceSimulationTime` to freeze because `targetTimeMs < currentTickTime` triggered endless seek resets.

## Changes Made

1. **`src/store/usePlaybackStore.ts`**:
   - Refactored `seekTickTime`:
     - Replaced linear scan and `minDiff` with logarithmic binary search $O(\log N)$ finding the last tick occurring at or before `targetMs` (`isoToMs(tick.time) <= targetMs`).
     - Strictly enforces temporal isolation: ticks occurring after `targetMs` are never applied.
     - Implemented reverse backward scanning for `latestTickBySymbol` so multi-asset states update in $O(1)$ amortized time during 60 FPS slider dragging.
     - Handled pre-market seeking before the first trade (`currentTickIndex: -1`, `currentTick: null`) and seamless forward consumption into the first tick.

2. **`src/components/PlaybackBar.tsx`**:
   - Converted the scrubber range input into a time-based slider:
     - `min={minTime}` and `max={maxTime}` dynamically derived from session data and initial anchor `currentTime`.
     - `value={sliderValue}` bound to current simulation time.
     - `step={1000}` (1 second) for clean, exact second-by-second scrubbing.
     - `onChange={(e) => seekTickTime(parseInt(e.target.value, 10))}`.
   - Formatted interactive session progress label:
     - Displays `{formatTimeOnly(sliderValue)} / {formatTimeOnly(maxTime)}` (e.g. `09:29:00 / 16:00:00`) in the session ticker's timezone.
     - Subtle secondary tick count indicator `({currentTickIndex + 1}/{totalTicks})` for full observability.
   - Updated `togglePlay`: if the session reached the end, clicking Play restarts from `minTime`.

3. **`tests/regression/mocks/replayJourney.ts`**:
   - Upgraded `seekScrubber` helper to support setting either Unix millisecond timestamps or index numbers on the time-based slider.

4. **`tests/setup.ts` & `vitest.config.ts`**:
   - Added `fileParallelism: false` and `beforeEach(() => { localStorage.clear(); })` to eliminate DuckDB file lock contention and test pollution.

5. **`tests/unit/timeBasedSlider.test.tsx`**:
   - Added unit test suite verifying time-based slider bounds, value binding, time label formatting, 09:29 AM scrubbing, and 09:30 AM open scrubbing.

6. **`tests/unit/timeSeekingPlayback.test.ts`**:
   - Added integration test suite verifying the complete preparation and playback workflow:
     - 09:20 AM ET preparation anchor.
     - 09:29 AM ET scrubbing without look-ahead bias.
     - Smooth continuous playback advancing from 09:29 AM through market open at 09:30 AM.
     - 09:30 AM open seeking and backward rewinding.

## Verification
- **Unit & Regression Tests**: All 47 test files passed (`47/47 passed, 274/274 tests passed`).
- **Production Build**: `npm run build` succeeded in 890ms with 0 errors.
