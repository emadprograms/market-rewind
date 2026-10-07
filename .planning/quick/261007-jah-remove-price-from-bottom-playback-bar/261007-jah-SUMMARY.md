---
status: complete
date: 2026-10-07
task: 261007-jah
title: Remove price from bottom playback bar
---

# Quick Task Summary: Remove Price from Bottom Playback Bar

## Overview
Removed the dynamic price and spread badge from `PlaybackBar.tsx` so that the transport controls (Play/Pause, Step Forward, Step Backward, Reset) remain stationary and stable during playback, stepping, and scrubbing.

## Changes Made
1. **`src/components/PlaybackBar.tsx`**:
   - Removed the `{/* Price & Spread Badge */}` JSX element that rendered dynamic price and bid/ask spread directly before the transport controls.
   - Removed the unused `currentTick` selector from `usePlaybackStore`.
   - Ensured playback controls stay locked in position right after the replay time display.
2. **`tests/unit/playbackBarSliderSeek.test.tsx`**:
   - Added unit test verifying that price values are not rendered in the playback bar even when active tick data exists in the store, and that transport controls remain properly rendered and accessible.
3. **`tests/integration/tickReplay.test.tsx` & `tests/regression/replay/tickReplayDateReset.test.tsx`**:
   - Updated existing test assertions that previously expected `$180.00` and `$218.00` in the playback bar to verify that price badges are absent from the bottom bar.

## Verification
- Production build succeeded (`npm run build` in 1.02s).
- All 83 test suites passed cleanly (`npm test` — 433 tests passed, 2 skipped, 0 failed).
