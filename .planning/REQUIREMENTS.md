# Milestone v3.2 Requirements: High-Performance Chart Playback & Data Reliability Engine

## Overview
This milestone resolves two critical UX and performance bottlenecks in Market Rewind:
1. Chart CPU saturation and unresponsiveness during playback (allowing smooth user panning and zooming while playback is running).
2. Intermittent single-candle loading bug upon initial chart mount.

---

## Requirements

### Category 1: Single-Candle Reliability & Data Load Guards (DATA)

- [ ] **DATA-01**: The chart initialization logic must not clip historical bars before `globalTime` is established, defaulting to unbounded display for non-replay initial loads.
- [ ] **DATA-02**: The candle loader must validate query responses and trigger an immediate fallback retry if a non-daily query returns an anomalous single bar.
- [ ] **DATA-03**: The chart lifecycle must suppress rendering transient single bars while background history loading (`isLoadingHistory`) is in progress.
- [ ] **DATA-04**: The system must log diagnostic warnings whenever filtering reduces loaded bars to <= 1 when raw data contains multiple bars.

### Category 2: Decoupled High-Performance Playback (PERF)

- [ ] **PERF-01**: High-frequency playback ticks from `usePlaybackStore` (`currentTime`, `latestTick`, `symbolTicks`) must be decoupled from the React component tree via ref-based external subscriptions to prevent full-tree re-renders on every animation frame.
- [ ] **PERF-02**: Forming candle updates during playback must execute directly against lightweight-charts via `series.update()` in O(1) time without triggering `series.setData()`.
- [ ] **PERF-03**: The chart hook must bypass O(N) `filteredData` and `resampleData` array operations on high-frequency playback ticks, computing forming candle deltas incrementally.
- [ ] **PERF-04**: Completed candle commits at bucket boundaries must be throttled to boundary transitions only.

### Category 3: Viewport & Lifecycle Stabilization (VIEW)

- [ ] **VIEW-01**: The viewport synchronization (`syncViewport`) must not override or fight user mouse dragging/panning during active playback.
- [ ] **VIEW-02**: The 1D extended-hours price line must update via targeted lightweight-charts price line API calls without causing lifecycle re-renders.
- [ ] **VIEW-03**: Automated tests must verify that playback state changes do not trigger cascading React re-renders and that panning remains functional.
- [ ] **VIEW-04**: All existing 44 test suites (251+ tests) and production build must pass with zero regressions.

---

## Future Requirements (Out of Scope for v3.2)
- Multi-symbol aggregated tape view (TAPE-02)
- Limit order book paper trading execution matching engine (ORDER-02)
- Session recording and video/CSV export (EXPORT-01)
- Advanced indicator overlays (VWAP, EMA ribbons) (INDICATORS-01)

---

## Traceability Matrix

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 18 | Pending |
| DATA-02 | Phase 18 | Pending |
| DATA-03 | Phase 18 | Pending |
| DATA-04 | Phase 18 | Pending |
| PERF-01 | Phase 19 | Pending |
| PERF-02 | Phase 19 | Pending |
| PERF-03 | Phase 19 | Pending |
| PERF-04 | Phase 19 | Pending |
| VIEW-01 | Phase 20 | Pending |
| VIEW-02 | Phase 20 | Pending |
| VIEW-03 | Phase 20 | Pending |
| VIEW-04 | Phase 20 | Pending |
