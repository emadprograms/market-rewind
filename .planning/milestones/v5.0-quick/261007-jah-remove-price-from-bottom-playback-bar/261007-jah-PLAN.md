---
quick_id: 261007-jah
slug: remove-price-from-bottom-playback-bar
description: "Remove price and spread display from bottom playback bar to keep playback controls in a fixed position"
---

# Quick Task 261007-jah: Remove Price from Bottom Playback Bar

## Problem Statement
The bottom playback bar currently renders a dynamic price & spread badge (`${currentTick.price.toFixed(2)} (${currentTick.bid} / ${currentTick.ask})`) between the replay time display and the playback transport controls (Step Back, Play/Pause, Step Forward, Reset). Because ticks arrive intermittently or have varying digit widths, and the badge conditionally appears when `currentTick` is present, the Play/Pause button and adjacent transport controls constantly shift position horizontally across the bar during playback and scrubbing. This makes clicking the Play/Pause button frustrating and inconvenient. Furthermore, current price and bid/ask levels are already prominently rendered directly on the chart canvas y-axis price scale.

## Target Behavior
- Remove the price & spread badge from `src/components/PlaybackBar.tsx`.
- Keep playback transport controls (Play/Pause, Step Backward, Step Forward, Reset) positioned consistently next to the time display without horizontal jumping.
- Clean up unused `currentTick` selector from `PlaybackBar.tsx`.
- Add unit test coverage in `tests/unit/playbackBarSliderSeek.test.tsx` ensuring that the price and spread badge is not rendered in the playback bar even when active tick data exists in the store.

## Execution Plan

### Task 1: Remove Price & Spread Badge from PlaybackBar
- In `src/components/PlaybackBar.tsx`:
  - Remove `const currentTick = usePlaybackStore((state) => state.currentTick);`.
  - Remove the `{/* Price & Spread Badge */}` JSX block (lines 250-270).

### Task 2: Add Unit Test in `tests/unit/playbackBarSliderSeek.test.tsx`
- Assert that price values (e.g. `$350.00`) are not rendered in the `PlaybackBar` even when ticks are loaded and `currentTick` is populated in `usePlaybackStore`.
- Verify the Play/Pause button remains accessible and functional.

### Task 3: Run Full Test Suite & Verification
- Execute `npm test` to verify all unit, integration, and regression tests pass without errors.
- Create `261007-jah-SUMMARY.md` and update `.planning/STATE.md`.
