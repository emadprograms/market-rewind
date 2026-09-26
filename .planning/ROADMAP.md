# Roadmap

## Completed Milestones

### Milestone v3.1: Pure Streaming DuckDB Replay Engine & Global Multi-Asset Simulator ✅
- **Shipped**: 2026-09-26
- **Phases**: 13–17 (5 phases, 5 plans, 100% verified)
- **Archive**: [v3.1-ROADMAP.md](./milestones/v3.1-ROADMAP.md) | [v3.1-REQUIREMENTS.md](./milestones/v3.1-REQUIREMENTS.md) | [v3.1-MILESTONE-AUDIT.md](./v3.1-MILESTONE-AUDIT.md)
- **Key Deliverables**:
  - Removed `sql.js`, SQLite WASM workers, and `historical.duckdb` dependencies entirely.
  - Multi-ticker simultaneous playback synchronization (AAPL, AMD, NVDA, SPY).
  - Universal simulation clock engine with sub-millisecond tick timing.
  - O(1) incremental candle updates (<0.05ms per frame) eliminating animation lag.
  - High-frequency Time & Sales tape streaming with millisecond precision and local timezone support.

### Milestone v3.0: Pure Tick-by-Tick Replay & Temporal Isolation Engine ✅
- **Shipped**: 2026-09-26
- **Phases**: 9–12 (4 phases, 4 plans, 100% verified)
- **Archive**: [v3.0-ROADMAP.md](./milestones/v3.0-ROADMAP.md) | [v3.0-REQUIREMENTS.md](./milestones/v3.0-REQUIREMENTS.md)

### Milestone v2.0: Tick-by-Tick Streaming Engine & Modern UI ✅
- **Shipped**: 2026-09-26
- **Phases**: 5–8 (4 phases, 4 plans, 100% verified)
- **Archive**: [v2.0-ROADMAP.md](./milestones/v2.0-ROADMAP.md) | [v2.0-REQUIREMENTS.md](./milestones/v2.0-REQUIREMENTS.md)

### Milestone v1.0: Stability Guardrails & Multi-Chart Core ✅
- **Shipped**: 2026-09-25
- **Phases**: 1–4 (4 phases, 4 plans, 100% verified)

---

## Backlog / Next Milestone Candidates

- **TAPE-02**: Multi-symbol aggregated tape view (Time & Sales currently displays single focused symbol).
- **ORDER-02**: Paper trading execution matching engine with limit order book simulation.
- **EXPORT-01**: Replay session recording and export to video or tick CSV.
- **INDICATORS-01**: Multi-timeframe indicator overlays (VWAP, EMA ribbons, Volume Profile enhancements).
