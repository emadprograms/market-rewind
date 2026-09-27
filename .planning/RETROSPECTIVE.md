# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v3.1 — Pure Streaming DuckDB Replay Engine, Global Multi-Asset Sync & Playwright Hardening

**Shipped:** 2026-09-26  
**Phases:** 5 | **Plans:** 5 | **Requirements:** 14/14 Satisfied  

### What Was Built
- Clean elimination of SQLite WASM, `sql.js`, and `historical.duckdb`, converging on a single unified DuckDB dataset (`streaming.duckdb`).
- Universal multi-ticker playback synchronization advancing AAPL, AMD, NVDA, and SPY in true temporal lockstep.
- Sub-millisecond continuous simulation clock engine with dynamic rate scaling and jitter-free tick interpolation.
- O(1) incremental candle formatting (<0.05ms per frame) replacing full O(N) array re-parsing.
- High-frequency Time & Sales tape streaming with local timezone formatting, millisecond precision, and instant scroll.

### What Worked
- **Test-first bug harnesses**: Writing failing Playwright E2E and Vitest unit tests before modifying engine code isolated reproduction scenarios precisely (Phases 14 & 17).
- **Single data authority**: Retiring historical DuckDB and SQLite eradicated subtle fallback branching and future data leaks.
- **Timestamp pre-caching & binary search**: Indexing tick and candle timestamps into Float64/Int32 typed arrays eliminated frame drops during 100x replay bursts.

### What Was Inefficient
- Dual-database legacy architecture was kept in place too long through v2.0 and v3.0, requiring complex fallback resolution branches that eventually had to be torn out in Phase 13.

### Patterns Established
- **Single Source of Truth**: All market replay queries (from 1s bars to daily aggregates) must flow through `streaming.duckdb` dynamic aggregation.
- **Universal Replay Clock**: Time belongs to the workspace simulation session, not individual charts.
- **Zero Future Data Leakage**: Replay cursors strictly clamp temporal bounds `[sessionStart, currentReplayTime]`.

### Key Lessons
1. Never compromise on temporal bounds: fallback queries without date ceilings will inevitably leak future data in edge cases.
2. High-speed playback loops must avoid string-based Date parsing inside animation frames; pre-compute timestamps on load.

---

## Milestone: v3.0 — Pure Tick-by-Tick Replay & Temporal Isolation Engine

**Shipped:** 2026-09-26  
**Phases:** 4 | **Plans:** 4  

### What Was Built
- Pure tick replay mode: eliminated legacy TICK vs BAR toggle in favor of direct tick playback.
- Canonical 9:20 AM ET date reset with clean session state.
- Real-time intraday candle forming dynamically updating open/high/low/close with incoming ticks.
- Comprehensive automated regression test suite.

### What Worked
- Simplifying the user mental model by removing synthetic bar stepping made replay behavior predictable and intuitive.

### What Was Inefficient
- Still relied on micro-tick synthesis for dates without tick coverage, which was later superseded by authentic tick data in v3.1.

---

## Milestone: v2.0 — Tick-by-Tick Streaming Engine & Modern UI

**Shipped:** 2026-09-26  
**Phases:** 4 | **Plans:** 4  

### What Was Built
- Direct connection to DuckDB `streaming.duckdb` and `historical.duckdb` via local backend service.
- Dynamic `time_bucket()` candlestick aggregation down to sub-second resolutions.
- Live Time & Sales tape component and dark financial terminal layout.

### What Worked
- DuckDB's vectorized query performance enabled sub-50ms candlestick aggregation across millions of rows.

### What Was Inefficient
- Introducing two DuckDB databases created synchronization friction that was ultimately unified in v3.1.

---

## Milestone: v1.0 — Stability Guardrails & Multi-Chart Core

**Shipped:** 2026-09-25  
**Phases:** 4 | **Plans:** 14  

### What Was Built
- Multi-chart grid layouts, resizable panels, and selection/symbol grouping synchronization.
- Viewport stability during historical candle prepend.
- Hook modularization and web worker offloading for database operations.

### What Worked
- Decomposing the monolithic chart hook into specialized hooks early prevented architectural debt in the UI layer.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Process Evolution |
|-----------|--------|-------|-----------------------|
| v1.0 | 4 | 14 | Initial modularization & stability guardrails |
| v2.0 | 4 | 4 | DuckDB backend integration & high-performance UI |
| v3.0 | 4 | 4 | Pure tick replay & temporal isolation |
| v3.1 | 5 | 5 | Test-first E2E bug harness & unified streaming engine |

### Cumulative Quality

| Milestone | Total Tests Passing | Core Tech Debt Removed |
|-----------|--------------------|------------------------|
| v1.0 | 18 unit / 2 E2E | Monolithic hooks decomposed |
| v2.0 | 45 unit / 5 E2E | Browser memory pressure relieved via streaming |
| v3.0 | 85 unit / 10 E2E | TICK vs BAR duality removed |
| v3.1 | 145 unit / 15 E2E | SQLite, sql.js, and dual-DB architecture removed |

### Top Lessons (Verified Across Milestones)

1. **Test-first bug reproduction is indispensable**: Writing reproducing E2E tests before touching core architecture prevents subtle regression loops.
2. **One unified storage engine beats hybrid fallbacks**: Managing multiple databases or fallback layers adds exponential complexity compared to a single optimized data source.
