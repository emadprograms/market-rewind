# Market Rewind - Pure Streaming DuckDB Replay Engine & Global Multi-Asset Simulator

## What This Is
Market Rewind is a high-performance local-first market replay and charting analysis tool. Starting in Milestone v3.1, Market Rewind runs **exclusively on `streaming.duckdb`** (retiring `historical.duckdb`, `sql.js`/SQLite, and Vercel entirely). It delivers institutional-grade real-time market simulation across multiple synchronized charts, sub-second timeframes, strict date boundary isolation, real-time tick streaming without synthetic bar caps, and 100% test-driven verification.

## Core Value
High-fidelity, deterministic tick-by-tick market replay with sub-second timeframes, real-time candle aggregation directly from `streaming.duckdb`, multi-symbol global playback synchronization, and absolute temporal isolation (zero future data leakage).

## Current Milestone: Milestone v3.2 — High-Performance Chart Playback & Data Reliability Engine

**Goal:** Eliminate CPU hogging and UI freezing during market playback by decoupling high-frequency playback state from the React render tree, executing O(1) direct canvas series updates via lightweight-charts, preventing viewport drag-fighting during playback, and resolving the intermittent single-candle loading bug with robust data validation and initialization safeguards.

## Validated Requirements
- ✓ Basic market replay engine (v1.0)
- ✓ Local-first storage (v1.0)
- ✓ Multi-chart layouts and resizable panels (v1.0)
- ✓ Viewport stabilization and infinite scroll (v1.0)
- ✓ Selection & symbol grouping synchronization (v1.0)
- ✓ DuckDB integration to `streaming.duckdb` (v2.0)
- ✓ Dynamic `time_bucket()` candlestick aggregation (v2.0)
- ✓ Time & Sales / Order Flow Tape component (v2.0)
- ✓ Dark financial terminal UI refresh (v2.0)
- ✓ **TICK-01**: Pure Tick Replay Mode (v3.0)
- ✓ **TICK-02**: Canonical 9:20 AM ET Date Reset (v3.0)
- ✓ **TICK-03**: Strict Temporal Isolation (v3.0)
- ✓ **TICK-04**: Real-Time Candle Forming (v3.0)
- ✓ **TEST-04**: Automated Regression Test Suite (v3.0)
- ✓ **CLEAN-01 – CLEAN-03**: Legacy SQLite & DuckDB Cleanup (v3.1)
- ✓ **TEST-01 – TEST-04**: Test-First Playwright/Vitest Bug Harness (v3.1)
- ✓ **REPLAY-01 – REPLAY-03**: Strict Date Reset & Pure Tick Replay (v3.1)
- ✓ **SYNC-01 – SYNC-04**: Global Multi-Asset Playback Synchronization (v3.1)
- ✓ **PERF-01**: O(1) Incremental Candle Updates (<0.05ms) (v3.1)
- ✓ **TAPE-01**: High-Frequency Millisecond Time & Sales Streaming (v3.1)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pure Streaming DuckDB Storage (`streaming.duckdb`) | Dual-database architecture (`historical` + `streaming`) and legacy SQLite caused subtle data blending leaks, complex fallback branches, and date desyncs. Relying solely on `streaming.duckdb` (101.4M ticks) simplifies data flow and guarantees true tick fidelity. | — Adopted in v3.1 |
| Universal Market Timeline | Replay clock must advance global market time rather than an individual symbol's tick buffer, enabling multi-chart setups (e.g. AAPL + AMD) to progress in parallel like a real trading session. | — Adopted in v3.1 |
| Strict Temporal Query Boundaries | Never fall back to unconstrained tape endpoints or future dates. If no data exists for a day (e.g. holiday), the UI explicitly indicates the session is closed rather than loading subsequent days. | — Adopted in v3.1 |
| Test-First Playwright & Unit Hardening | Write reproducible Playwright and Vitest tests proving the failures and establishing expected behaviors before making core architectural changes. | — Adopted in v3.1 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-26 after starting Milestone v3.1*
