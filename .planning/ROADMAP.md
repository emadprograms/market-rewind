# Roadmap: Market Rewind

## Completed Milestones

### Milestone v4.0: Canonical Single-Database (`streaming.db`) Replay Engine & Defect Elimination ✅
- **Shipped**: 2026-09-29
- **Phases**: 21–24 (4 phases, 4 plans, 100% verified)
- **Archive**: [v4.0-ROADMAP.md](./milestones/v4.0-ROADMAP.md) | [v4.0-REQUIREMENTS.md](./milestones/v4.0-REQUIREMENTS.md) | [v4.0-MILESTONE-AUDIT.md](./milestones/v4.0-MILESTONE-AUDIT.md)

### Milestone v3.2: High-Performance Chart Playback & Data Reliability Engine ✅
- **Shipped**: 2026-09-28
- **Phases**: 18–20 (3 phases, 3 plans, 100% verified)
- **Archive**: [v3.2-ROADMAP.md](./milestones/v3.2-ROADMAP.md) | [v3.2-REQUIREMENTS.md](./milestones/v3.2-REQUIREMENTS.md) | [v3.2-MILESTONE-AUDIT.md](./milestones/v3.2-MILESTONE-AUDIT.md)

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

## Milestone Details: v4.0 Canonical Single-Database (`streaming.db`) Replay Engine & Defect Elimination ✅

### Phase 21: Test-First Harness & Pure Single-DB (`streaming.db`) Backend Purge ✅
- **Goal:** Build the complete TDD harness replicating all 9 failure modes from `market-rewind-diagnosis-and-plan.md` in unit and Playwright tests, verify Red failure state, and permanently eliminate `historical.duckdb` from backend and frontend, routing all candle aggregation through DuckDB `time_bucket()` on `streaming.duckdb`.
- **Requirements Covered:** TEST-01, TEST-02, TEST-03, DATA-01, DATA-02, DATA-03
- **Status:** Complete (100% verified)

### Phase 22: Event-Driven Playback Ingestion & Canonical Candle Aggregation ✅
- **Goal:** Fix volume overcounting, trade omission, and premarket fallback defects by introducing event-aware tick tracking, intra-frame trade aggregation, empty history first-candle startup, and strict ETH filtering during active playback.
- **Requirements Covered:** INGEST-01, INGEST-02, INGEST-03, INGEST-04, INGEST-05
- **Status:** Complete (100% verified)

### Phase 23: Canvas Lifecycle Reconciliation, Session Guards & Tape Filtering ✅
- **Goal:** Resolve canvas history omission, symbol-switch price leakage, out-of-order session overwrites, and multi-symbol tape trade pollution.
- **Requirements Covered:** RENDER-01, RENDER-02, RENDER-03, RENDER-04
- **Status:** Complete (100% verified)

### Phase 24: Scrubber Timeline Stabilization & Full Autonomous E2E Verification ✅
- **Goal:** Anchor the timeline scrubber to a stable exchange session domain with integer-second precision and exact time seeking, and verify that all 11 diagnostic suites and 60 regression suites pass cleanly with zero defects.
- **Requirements Covered:** SCRUB-01, SCRUB-02, SCRUB-03
- **Status:** Complete (100% verified)

---

## Backlog / Next Milestone Candidates
- **TAPE-02**: Multi-symbol aggregated tape view.
- **ORDER-02**: Paper trading execution matching engine with limit order book simulation.
- **EXPORT-01**: Replay session recording and export to video or tick CSV.
- **INDICATORS-01**: Multi-timeframe indicator overlays (VWAP, EMA ribbons, Volume Profile enhancements).
