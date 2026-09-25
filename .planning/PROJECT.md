# Market Rewind - Pure Tick-by-Tick Replay & Temporal Isolation Engine

## What This Is
Market Rewind is a high-performance local-first market replay and charting analysis tool. Following the DuckDB streaming engine integration in Milestone v2.0, Milestone v3.0 refines Market Rewind into a pure, institutional-grade tick-by-tick replay platform with strict temporal isolation (zero future data leaks), canonical 9:20 AM ET date resets, real-time tick-by-tick candle building on all timeframes, and 100% test coverage.

## Core Value
High-fidelity, deterministic tick-by-tick market replay with sub-second timeframes, real-time candle aggregation, Time & Sales tape, and absolute temporal isolation (no future data leakage).

## Current Milestone: v3.0 Pure Tick-by-Tick Replay & Temporal Isolation Engine

**Goal:** Transform the replay experience into an uncompromising, pure tick-by-tick system: eliminate confusing mode toggles, anchor day resets to 9:20 AM ET, ensure candles on any timeframe (1min, 5min, 15min, 1H) update live on every tick without leaking future data, and backfill micro-ticks for historical dates.

**Target features:**
- **Exclusively Tick Replay**: Remove TICK vs. BAR mode toggle; user controls speed (0.5x - 100x), scrub slider, step, and play/pause.
- **Canonical 9:20 AM ET Day Reset**: Switching to or resetting any day immediately positions the cursor at 9:20 AM ET of that day.
- **Zero Future Data Leakage**: Strict boundary enforcement ensuring no candles or ticks beyond the current replay cursor are visible.
- **Real-Time Forming Candle Updates on All Timeframes**: On a 5-min (or any) chart, playing actively updates the candle's High, Low, Close, and Volume on each tick.
- **Universal Tick Availability**: Real Databento/Capital ticks from `streaming.duckdb` plus automatic micro-tick synthesis from 1m bars for complete historical coverage.
- **Rigorous Regression Tests**: Comprehensive test suite covering resets, temporal filtering, and tick-by-tick candle updates.

## Requirements

### Validated
- ✓ Basic market replay engine (v1.0)
- ✓ Local-first storage (v1.0)
- ✓ Multi-chart layouts and resizable panels (v1.0)
- ✓ Viewport stabilization and infinite scroll (v1.0)
- ✓ Selection & symbol grouping synchronization (v1.0)
- ✓ DuckDB integration to `streaming.duckdb` and `historical.duckdb` (v2.0)
- ✓ Dynamic `time_bucket()` candlestick aggregation (v2.0)
- ✓ Time & Sales / Order Flow Tape component (v2.0)
- ✓ Dark financial terminal UI refresh (v2.0)

### Active (Milestone v3.0)
- [ ] **TICK-01**: Pure Tick Replay Mode (remove TICK vs BAR toggle; streamline playback bar to speed, scrub, step, play/pause).
- [ ] **TICK-02**: Canonical 9:20 AM ET Date Reset (selecting or resetting any day jumps to 9:20 AM ET and pauses).
- [ ] **TICK-03**: Strict Temporal Isolation (hard cap queries and filters at current replay time; zero future data leakage).
- [ ] **TICK-04**: Real-Time Candle Forming (intraday candles on all timeframes evolve live tick-by-tick as replay plays).
- [ ] **TICK-05**: Universal Tick Synthesis (generate 4 micro-ticks per minute when raw streaming ticks are absent or during pre-market gaps).
- [ ] **TEST-04**: Automated Regression Test Suite (verify 9:20 AM ET reset, future data hiding, 5-min candle tick updates, and UI controls).

### Out of Scope
- Direct cloud broker order execution (focus is offline high-fidelity tick replay).
- Modifying the upstream `data-harvester` database (all queries are strictly read-only).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pure Tick Replay Architecture | Mode switching between bar and tick creates confusing UX and subtle timeline desyncs. Making replay strictly tick-based provides consistent institutional mechanics. | — Decided |
| Micro-Tick Intraminute Synthesis | While `streaming.duckdb` has 43.6M+ ticks, older dates or gaps in premarket need ticks. Synthesizing 4 micro-ticks per minute from 1m bars guarantees zero-failure tick playback. | — Decided |
| Bucket Slice Aggregation | Rather than maintaining mutable chart state that leaks historical closes, the forming candle is calculated deterministically from ticks in the active bucket `[bucketStartMs, currentTime]`. | — Decided |

---
*Last updated: 2026-09-26 after milestone v3.0 initialization*
