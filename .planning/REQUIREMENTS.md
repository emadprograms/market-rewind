# Milestone v4.0 Requirements: Canonical Single-Database (`streaming.db`) Replay Engine & Defect Elimination

## Overview
This milestone establishes a canonical, single-database architecture powered exclusively by `streaming.duckdb` (retiring `historical.duckdb` entirely), and eliminates the 9 core playback, lifecycle, volume, and timeline defects identified in `market-rewind-diagnosis-and-plan.md`.

All defect fixes follow a strict Test-Driven Development (TDD) discipline: unit tests and Playwright integration tests are created first, verified to fail predictably, and then resolved phase-by-phase until all 11 diagnostic suites pass alongside the existing regression suite.

---

## Requirements

### Category 1: Test Harness & Red-Phase Verification (TEST)
- [ ] **TEST-01**: Diagnostic Vitest Test Suite replicating all 9 failure modes from `market-rewind-diagnosis-and-plan.md` (volume recounting on clock updates, intra-frame trade omission, older history render skips, empty history first-candle startup, buffer cursor desync on multi-symbol merge, fallback volume compounding, ETH-off live filtering, symbol switch price leakage, 5m future OHLC leakage, and stale session response overwrite).
- [ ] **TEST-02**: Diagnostic Playwright E2E Suite verifying end-to-end browser manifestations (TSLA 09:20 premarket load, timeline seek across historical & tick periods, symbol switch after open, and multi-symbol Time & Sales isolation).
- [ ] **TEST-03**: Red Phase Execution Verification: all diagnostic test suites execute and fail predictably against the baseline, confirming genuine defect reproduction before altering code.

### Category 2: Pure Single-Database (`streaming.db`) Engine (DATA)
- [ ] **DATA-01**: Pure `streaming.duckdb` Architecture: permanently purge all references, configuration options, connections, schema checks, and fallback queries to `historical.duckdb` / `historical_db` from `backend/streaming_service` (`duckdb_client.py`, `server.py`) and frontend (`streamingClient.ts`).
- [ ] **DATA-02**: Dynamic High-Performance Aggregation: all historical candles (from sub-second to 1D) are built solely from raw `ticks` in `streaming.duckdb` via DuckDB `time_bucket()` with sub-50ms execution, eliminating Frankenstein dual-database splicing.
- [ ] **DATA-03**: Strict Session Isolation in DuckDB Queries: intraday queries respect RTH vs ETH/PRE sessions natively in DuckDB, and 1D queries strictly filter RTH (09:30–16:00 ET).

### Category 3: Event-Driven Playback Ingestion & Canonical Forming (INGEST)
- [ ] **INGEST-01**: Event-Deduplicated Volume & High/Low Aggregation: chart playback subscriber must track consumed tick event IDs/timestamps, aggregating all trades crossed by the replay clock during each frame rather than recounting the latest tick on clock updates.
- [ ] **INGEST-02**: Elimination of Fallback Volume Compounding: eliminate synthetic multi-thousand volume injection on premarket fallback frames and prevent higher-timeframe reconstruction from exposing future candle high/low values before time arrives.
- [ ] **INGEST-03**: First-Candle Initialization on Empty History: direct canvas subscriber must synthesize the first forming candle when history finishes empty and new ticks arrive, unfreezing playback snapshots when ticks stream in.
- [ ] **INGEST-04**: Multi-Symbol Ingestion Cursor Stability: `addSymbolTicks` must preserve `currentTickIndex` and `currentTime` cursor stability when sorting or deduplicating the global buffer.
- [ ] **INGEST-05**: Strict ETH / Extended Hours Playback Filtering: live subscriber and candle aggregator must strictly respect `showEth` toggle during active playback, never painting premarket ticks when ETH is disabled.

### Category 4: Renderer Integrity & Session Generation Guards (RENDER)
- [ ] **RENDER-01**: Comprehensive Historical Reconciliation: `useChartLifecycle` must replace the series with `setData()` whenever earlier bars or historical prefixes change, even if the last bar timestamp matches.
- [ ] **RENDER-02**: Atomic Symbol Switching: changing tickers must cleanly reset and flush chart series, preventing old symbol price data from leaking into the new symbol view.
- [ ] **RENDER-03**: Session Generation & Request Cancellation: session and tick loading requests must carry monotonic session generation tokens and `AbortController` cancellation so stale network responses cannot overwrite newer sessions or rewind the replay clock.
- [ ] **RENDER-04**: Time & Sales Symbol Filtering: Time & Sales tape must strictly filter the tick stream by the active chart's symbol badge, eliminating cross-instrument trade pollution in multi-symbol sessions.

### Category 5: Stable Timeline Scrubber & Systematic Verification (SCRUB)
- [ ] **SCRUB-01**: Fixed Session Scrubber Bounds: scrubber bounds are anchored to fixed exchange session hours (e.g. 04:00 - 20:00 ET or 09:20 - 16:00 ET) rather than moving dynamically with buffered tick ranges.
- [ ] **SCRUB-02**: Precise Integer-Second Timeline Seeking: slider steps snap to integer seconds with zero millisecond drifting, providing explicit `HH:MM:SS` jump input and drag-preview with single-seek commit.
- [ ] **SCRUB-03**: Full Green Phase Regression Verification: all diagnostic tests and all 60 existing test suites (328+ tests) pass cleanly with zero regressions.

---

## Traceability Matrix

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEST-01 | Phase 21 | Pending |
| TEST-02 | Phase 21 | Pending |
| TEST-03 | Phase 21 | Pending |
| DATA-01 | Phase 21 | Pending |
| DATA-02 | Phase 21 | Pending |
| DATA-03 | Phase 21 | Pending |
| INGEST-01 | Phase 22 | Pending |
| INGEST-02 | Phase 22 | Pending |
| INGEST-03 | Phase 22 | Pending |
| INGEST-04 | Phase 22 | Pending |
| INGEST-05 | Phase 22 | Pending |
| RENDER-01 | Phase 23 | Pending |
| RENDER-02 | Phase 23 | Pending |
| RENDER-03 | Phase 23 | Pending |
| RENDER-04 | Phase 23 | Pending |
| SCRUB-01 | Phase 24 | Pending |
| SCRUB-02 | Phase 24 | Pending |
| SCRUB-03 | Phase 24 | Pending |
