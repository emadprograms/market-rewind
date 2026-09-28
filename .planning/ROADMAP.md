# Roadmap: Market Rewind

## Completed Milestones

### Milestone v3.1: Pure Streaming DuckDB Replay Engine & Global Multi-Asset Simulator ✅
- **Shipped**: 2026-09-26
- **Phases**: 13–17 (5 phases, 5 plans, 100% verified)
- **Archive**: [v3.1-ROADMAP.md](./milestones/v3.1-ROADMAP.md) | [v3.1-REQUIREMENTS.md](./milestones/v3.1-REQUIREMENTS.md) | [v3.1-MILESTONE-AUDIT.md](./milestones/v3.1-MILESTONE-AUDIT.md)

### Milestone v3.0: Pure Tick-by-Tick Replay & Temporal Isolation Engine ✅
- **Shipped**: 2026-09-26
- **Phases**: 9–12 (4 phases, 4 plans, 100% verified)
- **Archive**: [v3.0-ROADMAP.md](./milestones/v3.0-ROADMAP.md) | [v3.0-REQUIREMENTS.md](./milestones/v3.0-REQUIREMENTS.md) | [v3.0-MILESTONE-AUDIT.md](./milestones/v3.0-MILESTONE-AUDIT.md)

### Milestone v2.0: Tick-by-Tick Streaming Engine & Modern UI ✅
- **Shipped**: 2026-09-26
- **Phases**: 5–8 (4 phases, 4 plans, 100% verified)
- **Archive**: [v2.0-ROADMAP.md](./milestones/v2.0-ROADMAP.md) | [v2.0-REQUIREMENTS.md](./milestones/v2.0-REQUIREMENTS.md) | [v2.0-MILESTONE-AUDIT.md](./milestones/v2.0-MILESTONE-AUDIT.md)

### Milestone v1.0: Stability Guardrails & Multi-Chart Core ✅
- **Shipped**: 2026-09-25
- **Phases**: 1–4 (4 phases, 14 plans, 100% verified)
- **Archive**: [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md) | [v1.0-REQUIREMENTS.md](./milestones/v1.0-REQUIREMENTS.md)

---

## Current Milestone: v3.2 High-Performance Chart Playback & Data Reliability Engine

### Phase 18: Single-Candle Reliability & Initial Data Load Guards
- **Goal:** Fix the intermittent single-candle loading bug by guarding against query boundary anomalies, preventing premature initial render, and eliminating the effectiveCutoff race condition.
- **Requirements Covered:** DATA-01, DATA-02, DATA-03, DATA-04
- **Success Criteria:**
  1. Charts mounted with or without pre-existing `globalTime` consistently render full historical candle series.
  2. Any streaming client candle query returning an unexpected single bar triggers a retry before rendering.
  3. `useChartLifecycle` does not render a single-bar blank canvas while background history is actively fetching.
  4. Diagnostic warnings are emitted if data filtering drastically reduces bar count.

### Phase 19: Decoupled Playback State & O(1) Incremental Chart Updates
- **Goal:** Decouple high-frequency playback state from the React render tree so that 60fps playback ticks update lightweight-charts directly via O(1) `series.update()` without triggering React re-renders or O(N) array filtering.
- **Requirements Covered:** PERF-01, PERF-02, PERF-03, PERF-04
- **Success Criteria:**
  1. React component tree (`ChartUnit`, `useChartData`, `useChartLifecycle`) does not re-render on every animation frame during playback.
  2. Forming candle updates are computed incrementally and pushed directly to `priceSeries.update()` and `volumeSeries.update()`.
  3. `resampleData` and full array filtering are eliminated from the high-frequency playback loop.
  4. New candle buckets append smoothly without calling `series.setData()`.

### Phase 20: Viewport Interaction Stabilization & Comprehensive Automated Verification
- **Goal:** Ensure smooth user mouse panning and zooming while playback is active, decouple secondary price lines, and create a comprehensive automated test suite validating speed, interaction, and data reliability.
- **Requirements Covered:** VIEW-01, VIEW-02, VIEW-03, VIEW-04
- **Success Criteria:**
  1. User can click and pan the chart freely during high-speed playback without the viewport snapping back or freezing.
  2. The 1D price line updates without triggering chart lifecycle re-runs.
  3. Automated integration and unit tests prove playback smoothness and non-blocking chart interaction.
  4. All existing 44 test suites pass and production build compiles cleanly.

---

## Backlog / Next Milestone Candidates
- **TAPE-02**: Multi-symbol aggregated tape view.
- **ORDER-02**: Paper trading execution matching engine with limit order book simulation.
- **EXPORT-01**: Replay session recording and export to video or tick CSV.
- **INDICATORS-01**: Multi-timeframe indicator overlays (VWAP, EMA ribbons, Volume Profile enhancements).
