---
quick_id: 261009-b4e
slug: make-the-seek-longer-it-s-very-short-mak
description: "Make the seek scrubber bar much longer and mark timestamps along the seek bar with intervals, start/end marks, and hover preview"
status: complete
date: "2026-10-09"
---

# Quick Task 261009-b4e: Extend Playback Seek Bar and Mark Timestamps

## Summary of Changes
1. **Extended Seek Bar**:
   - Removed the restrictive `maxWidth: '420px'` limitation on `.playback-seek-container`.
   - Set container to `flex: 1` with `minWidth: '240px'`, and track wrapper to `flex: 1`, allowing the seek bar to expand dynamically to use all available horizontal space in `PlaybackBar.tsx` between the transport controls and speed/tape controls (expanding the slider width from ~140px to ~600-1100px depending on screen resolution).

2. **Marked Timestamps Along the Seek Bar**:
   - Implemented dynamic timeline marks calculation adapting to session duration (hourly marks for full-day sessions, sub-hour intervals for shorter sessions).
   - Explicitly marked key trading session milestones: `09:20` (Pre-market entry in blue) and `09:30` (Market Open in green, staggered with distinct accent tick line) whenever covered by the session bounds.
   - Marked start time (0%) and end time (100%) as well as intermediate milestone timestamps (e.g. 10:00, 11:00, 12:00, 13:00, 14:00, 15:00) with vertical tick lines and labels formatted in the session ticker's timezone.
   - Connected `<datalist id="playback-time-markers">` to `<input type="range" list="playback-time-markers">` for native browser tick alignment.

3. **Interactive Hover Timestamp Preview**:
   - Added mouse tracking on `.playback-scrubber-wrapper` to calculate precise time at the cursor.
   - Rendered a floating timestamp preview badge (`playback-hover-timestamp`) and vertical indicator line showing the exact time where a scrub click will seek.

4. **Tests & Compatibility**:
   - Retained all existing test IDs: `playback-time-slider`, `playback-time-label`, `time-jump-input`, `tick-counter`.
   - Created comprehensive unit tests in `tests/unit/playbackBarExtendedSeek.test.tsx` testing layout expansion, datalist generation, timestamp marks, hover preview, and interval adaptation.
   - All tests pass (including existing time-based slider tests and playback seeking suites).
