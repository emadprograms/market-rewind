# Roadmap: Milestone v3.0 Pure Tick-by-Tick Replay & Temporal Isolation Engine

## Milestone Phases

### Phase 9: Playback Bar Modernization & Pure Tick Mode
- **Goal**: Permanently eliminate the TICK vs BAR toggle, streamlining the playback controls to pure tick replay with speed controls (0.5x to 100x), tick scrubber, play/pause, and single-tick stepping.
- **Requirements**: TICK-01
- **Success Criteria**:
  1. TICK vs BAR pill toggle and bar step size dropdown are completely removed from `PlaybackBar.tsx`.
  2. Replay store operates exclusively in tick mode.
  3. Scrubber slider and single-tick step buttons operate smoothly on tick indices.
  4. Speed dropdown controls update frequency cleanly.

### Phase 10: Temporal Isolation & Canonical 9:20 AM ET Date Reset
- **Goal**: Anchor day resets and date selection strictly at 9:20 AM Eastern Time of the selected day, eliminate future data leakage by bounding historical queries, and backfill micro-ticks for historical dates.
- **Requirements**: TICK-02, TICK-03, TICK-05
- **Success Criteria**:
  1. Selecting or resetting any day (e.g. September 2, 2026) positions `currentTime` at exactly 9:20 AM ET and pauses playback.
  2. Data queries never fetch unconstrained live candles from today when viewing historical dates.
  3. No candle, tick, or price after the current replay cursor is visible on the charts.
  4. Micro-tick synthesizer generates high-fidelity ticks from 1m bars for any historical date or pre-market gap, ensuring universal replay availability.

### Phase 11: Real-Time Tick-by-Tick Candle Forming & Playback Engine
- **Goal**: Dynamically form and update intraday candles (1m, 5m, 15m, 30m, 1H) in real time from incoming ticks as playback runs.
- **Requirements**: TICK-04
- **Success Criteria**:
  1. Hitting PLAY on a 5-minute chart shows the current forming candle updating Open, High, Low, Close, and Volume with each individual tick.
  2. At the 5-minute boundary (e.g. 9:25 AM ET), the formed candle closes cleanly and the next candle begins forming.
  3. Playback loop in `PlaybackManager.tsx` runs smoothly without dropped frames across all speeds (0.5x to 100x).
  4. Scrubbing backward or forward correctly re-aggregates the active forming candle to that exact tick position.

### Phase 12: Regression Test Suite & Verification
- **Goal**: Provide automated unit and integration tests verifying all v3.0 capabilities, locking in guarantees against future regressions.
- **Requirements**: TEST-04
- **Success Criteria**:
  1. Test verifies that switching date or resetting always sets `currentTime` to 9:20 AM ET.
  2. Test verifies that future candles beyond the replay cursor are strictly excluded.
  3. Test verifies that advancing ticks updates 5-min chart candle values in real time.
  4. Test verifies absence of the TICK/BAR toggle and full operational integrity of the pure tick UI.
  5. Entire test suite (all 26+ test files) passes with 100% green status.
