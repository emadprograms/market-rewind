# Milestone v3.0 Requirements: Pure Tick-by-Tick Replay & Temporal Isolation Engine

## Requirements

### Pure Tick Replay Architecture
- [x] **TICK-01**: Pure Tick Mode & Streamlined Playback Bar
  - Eliminate the "TICK vs BAR" mode toggle pill and the BAR step size dropdown.
  - Playback operates strictly in tick format with speed multiplier (0.5x - 100x), tick scrubber, single-tick stepping, and play/pause.

### Temporal Isolation & Date Management
- [x] **TICK-02**: Canonical 9:20 AM ET Day Reset
  - Selecting any date or resetting to start must jump the replay cursor directly to 9:20 AM Eastern Time of that date and pause.
- [x] **TICK-03**: Absolute Temporal Isolation (Zero Future Data Leak)
  - All candle and tick queries must be strictly bounded to the requested historical date.
  - Intraday charts must strictly filter out any candle or tick after the active replay timestamp.
  - Daily charts must strictly exclude future dates beyond the selected replay day.
- [x] **TICK-05**: Universal Tick Availability via Fallback Micro-Tick Synthesis
  - Provide realistic 4-tick/min micro-tick synthesis for dates or pre-market intervals where raw streaming ticks are absent, ensuring every symbol and day is replayable.

### Real-Time Candle Forming & Engine
- [x] **TICK-04**: Real-Time Intraday Candle Forming from Ticks
  - On any timeframe (1m, 5m, 15m, 30m, 1H), incoming ticks during playback dynamically update the forming candle's High, Low, Close, and Volume.
  - At the timeframe boundary, the candle closes and the subsequent candle forms smoothly.
  - Seeking or scrubbing cleanly reconstructs the forming candle state up to that tick index.

### Verification & Testing
- [x] **TEST-04**: Automated Regression Test Suite
  - Unit and integration tests verifying 9:20 AM ET positioning, future candle exclusion, 5-minute candle live tick updates, and streamlined UI controls.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TICK-01 | Phase 9 | Complete |
| TICK-02 | Phase 10 | Complete |
| TICK-03 | Phase 10 | Complete |
| TICK-05 | Phase 10 | Complete |
| TICK-04 | Phase 11 | Complete |
| TEST-04 | Phase 12 | Complete |
