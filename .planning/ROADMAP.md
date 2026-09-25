# Roadmap: Milestone v2.0 Tick-by-Tick Streaming Engine & Modern UI

## Milestone Phases

### Phase 5: Test Infrastructure Baseline & Fixes
- **Goal**: Resolve test runner failures, establish mock environment stability, and verify existing test baseline passes cleanly.
- **Requirements**: TEST-01
- **Success Criteria**:
  1. Vitest test runner executes all existing test suites without localStorage/zustand TypeError crashes.
  2. Baseline suite passes cleanly with zero errors.

### Phase 6: DuckDB Backend Service & Streaming API
- **Goal**: Implement a high-performance Python data service connecting to `data-harvester`'s `streaming.duckdb` and `historical.duckdb`, exposing REST and streaming endpoints for symbols, ticks, and dynamic candle resampling.
- **Requirements**: DATA-01, DATA-02, DATA-03, DATA-04
- **Success Criteria**:
  1. Service connects read-only to `../data-harvester/data/streaming.duckdb` and queries 37.8M+ ticks without lock contention.
  2. Endpoints return symbol lists (`QQQ`, `US100`, `TSLA`, etc.) and metadata with sub-50ms latency.
  3. Dynamic `time_bucket()` aggregation delivers candles across `1s`, `5s`, `15s`, `1m`, `5m`, `15m`, `1h`, `1d`.
  4. Raw tick streaming and paginated chunk retrieval endpoints function with high throughput.

### Phase 7: Tick-by-Tick Replay Engine & Live Candle Synthesis
- **Goal**: Build the client-side tick replay state machine with millisecond precision, single-tick stepping forward/backward, variable speed playback, and dynamic candle building.
- **Requirements**: REPLAY-01, REPLAY-02, REPLAY-03, REPLAY-04, TEST-02
- **Success Criteria**:
  1. User can step forward and backward by a single tick, updating the chart price and time indicator.
  2. Playback speed can be set between 0.5x and 100x or instant.
  3. Incoming ticks dynamically update the open, high, low, close, volume, and tick count of the current candle in real time.
  4. Multiple grouped charts synchronize tick progression without drift.
  5. Unit tests verify replay clock, stepping, and candle synthesis algorithms.

### Phase 8: Time & Sales Tape & Modern Financial UI Upgrade
- **Goal**: Integrate a live Time & Sales order flow tape, sub-second timeframe switcher, dark terminal UI refresh, and end-to-end integration tests.
- **Requirements**: UI-01, UI-02, UI-03, UI-04, TEST-03
- **Success Criteria**:
  1. Time & Sales / Tick Tape displays live streaming prints with price, size, timestamp, bid, ask, and uptick/downtick styling.
  2. UI controls allow instant timeframe switching down to `1s`, `5s`, `15s`, and live symbol selection from `streaming.duckdb`.
  3. Replay scrubber bar displays tick metrics (current tick, total ticks, timestamp) and allows smooth seeking.
  4. Integration tests verify full UI interaction, replay controls, and Time & Sales streaming.
