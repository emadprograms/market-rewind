# Market Rewind - Pure Streaming DuckDB Replay Engine & Global Multi-Asset Simulator

## What This Is
Market Rewind is a high-performance local-first market replay and charting analysis tool. Starting in Milestone v3.1, Market Rewind runs **exclusively on `streaming.duckdb`** (retiring `historical.duckdb`, `sql.js`/SQLite, and Vercel entirely). It delivers institutional-grade real-time market simulation across multiple synchronized charts, sub-second timeframes, strict date boundary isolation, real-time tick streaming without synthetic bar caps, and 100% test-driven verification.

## Core Value
High-fidelity, deterministic tick-by-tick market replay with sub-second timeframes, real-time candle aggregation directly from `streaming.duckdb`, multi-symbol global playback synchronization, and absolute temporal isolation (zero future data leakage).

## Current Milestone: v3.1 Pure Streaming DuckDB Replay Engine, Global Multi-Asset Sync & Playwright Hardening

**Goal:** Re-architect Market Rewind to run exclusively on `streaming.duckdb`, synchronizing real-time market playback across all active charts and groups simultaneously, with strict date boundaries, removal of legacy SQLite/Vercel artifacts, and a comprehensive test-first Playwright/unit test suite.

**Target features:**
- **CLEAN-01**: Remove all `sql.js`, SQLite WASM workers (`db.worker.ts`), and `historical.duckdb` dependencies; remove Vercel artifacts.
- **TICK-06**: Strict date reset and temporal isolation — prevent unconstrained tape fallbacks that leak future dates; cleanly handle non-trading days and pre-market gaps.
- **TICK-07**: Pure real-time tick replay — eliminate synthetic 4-micro-tick caps (4,200 bars) and stream raw ticks directly from `streaming.duckdb`.
- **SYNC-05**: Global multi-asset playback synchronization — pressing PLAY advances a universal timeline across all open charts (AAPL, AMD, SPY, etc.) and group-assigned charts simultaneously.
- **TEST-05**: Comprehensive test-first suite — dedicated Playwright E2E and Vitest unit tests verifying all bug reproductions and expected playback behaviors.

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
