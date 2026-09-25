# Milestone v2.0 Requirements: Tick-by-Tick Streaming Engine & Modern UI

## Requirements

### Data Layer & DuckDB Integration
- [ ] **DATA-01**: Direct Python backend service connecting read-only to `../data-harvester/data/streaming.duckdb` (37.8M+ ticks) and `historical.duckdb`.
- [ ] **DATA-02**: Fast REST/WebSocket API endpoints exposing available symbols, time ranges, and tick counts.
- [ ] **DATA-03**: Dynamic candlestick resampling via DuckDB `time_bucket()` supporting sub-second (`1s`, `5s`, `15s`) and minute/hourly intervals (`1m`, `5m`, `15m`, `30m`, `1h`, `1d`).
- [ ] **DATA-04**: High-throughput raw tick streaming and paginated chunk retrieval for deep historical replay without browser memory exhaustion.

### Tick-by-Tick Replay Engine
- [ ] **REPLAY-01**: Millisecond-accurate replay clock with play, pause, seek, and single-tick stepping (step forward, step backward).
- [ ] **REPLAY-02**: Configurable replay speed multiplier (0.5x, 1x, 5x, 10x, 50x, 100x, Max/Instant).
- [ ] **REPLAY-03**: Real-time candle synthesizer: incoming ticks update the current candle's open, high, low, close, volume, and tick count in real time on the chart.
- [ ] **REPLAY-04**: Synchronized multi-chart tick replay across grouped charts (e.g. 1-second and 1-minute charts of the same ticker advancing in lockstep).

### Modern UI & Order Flow Visuals
- [ ] **UI-01**: Real-time Time & Sales / Tick Tape widget displaying tick timestamp, symbol, price, size, bid, ask, and uptick/downtick color coding.
- [ ] **UI-02**: Modernized dark-mode terminal layout with enhanced playback scrubber, live tick metrics (current tick, total ticks, timestamp), and quick-switch symbol dropdown populated from live DB.
- [ ] **UI-03**: Sub-second and high-frequency timeframe selector buttons in chart headers (`1s`, `5s`, `15s`, `1m`, `5m`, `15m`, `1h`, `1d`).
- [ ] **UI-04**: Bid/Ask spread and current market price badge overlay on charts.

### Quality, Tests & Guardrails
- [ ] **TEST-01**: Fix existing unit and integration test suites (resolve jsdom zustand localStorage mock issue).
- [ ] **TEST-02**: Unit tests for tick parsing, candle aggregation, and replay store state transitions.
- [ ] **TEST-03**: Integration tests for tick playback stepping, speed adjustment, and Time & Sales rendering.

## Future Requirements (Deferred)
- **FUT-01**: Level 2 DOM (Depth of Market) ladder visualization.
- **FUT-02**: Multi-symbol replay synchronizer with simulated cross-asset order flow.

## Out of Scope
- Direct live broker execution (focus is offline high-fidelity tick replay).
- Modifying the upstream `data-harvester` database (all queries are strictly read-only).

## Traceability
*(To be populated by ROADMAP.md)*
