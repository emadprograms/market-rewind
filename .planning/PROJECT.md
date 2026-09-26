# Market Rewind - Pure Tick-by-Tick Replay & Temporal Isolation Engine

## What This Is
Market Rewind is a high-performance local-first market replay and charting analysis tool. Following the DuckDB streaming engine integration in Milestone v2.0, Milestone v3.0 established Market Rewind as a pure, institutional-grade tick-by-tick replay platform with strict temporal isolation (zero future data leaks), canonical 9:20 AM ET date resets, real-time tick-by-tick candle building on all timeframes, and 100% test coverage.

## Core Value
High-fidelity, deterministic tick-by-tick market replay with sub-second timeframes, real-time candle aggregation, Time & Sales tape, and absolute temporal isolation (no future data leakage).

## Current State: Milestone v3.0 Shipped (2026-09-26)
- **Pure Tick Replay**: TICK vs. BAR mode toggle permanently removed; pure tick transport with variable speed multiplier (`0.5x` - `100x`), scrubber slider, single-tick stepping, and play/pause.
- **Canonical 9:20 AM ET Day Reset**: Switching to or resetting any day immediately positions the cursor at 9:20 AM ET of that day and pauses.
- **Zero Future Data Leakage**: Strict boundary enforcement ensuring no candles or ticks beyond the active replay cursor are visible.
- **Real-Time Forming Candle Updates on All Timeframes**: Intraday candles (1min, 5min, 15min, 1H) update High, Low, Close, and Volume dynamically on every incoming tick.
- **Universal Tick Availability**: Direct streaming from `streaming.duckdb` (101.4M ticks) with automatic micro-tick fallback synthesis for pre-market gaps.
- **Rigorous Automated Verification**: Full Vitest suite passing (27 files, 113 tests) + Playwright regression E2E suite passing (4 specs).

## Validated Requirements
- ✓ Basic market replay engine (v1.0)
- ✓ Local-first storage (v1.0)
- ✓ Multi-chart layouts and resizable panels (v1.0)
- ✓ Viewport stabilization and infinite scroll (v1.0)
- ✓ Selection & symbol grouping synchronization (v1.0)
- ✓ DuckDB integration to `streaming.duckdb` and `historical.duckdb` (v2.0)
- ✓ Dynamic `time_bucket()` candlestick aggregation (v2.0)
- ✓ Time & Sales / Order Flow Tape component (v2.0)
- ✓ Dark financial terminal UI refresh (v2.0)
- ✓ **TICK-01**: Pure Tick Replay Mode (v3.0)
- ✓ **TICK-02**: Canonical 9:20 AM ET Date Reset (v3.0)
- ✓ **TICK-03**: Strict Temporal Isolation (v3.0)
- ✓ **TICK-04**: Real-Time Candle Forming (v3.0)
- ✓ **TICK-05**: Universal Tick Synthesis (v3.0)
- ✓ **TEST-04**: Automated Regression Test Suite (v3.0)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pure Tick Replay Architecture | Mode switching between bar and tick creates confusing UX and subtle timeline desyncs. Making replay strictly tick-based provides consistent institutional mechanics. | — Validated in v3.0 |
| Micro-Tick Intraminute Synthesis | While `streaming.duckdb` has 101.4M+ ticks, older dates or gaps in premarket need ticks. Synthesizing 4 micro-ticks per minute from 1m bars guarantees zero-failure tick playback. | — Validated in v3.0 |
| Bucket Slice Aggregation | Rather than maintaining mutable chart state that leaks historical closes, the forming candle is calculated deterministically from ticks in the active bucket `[bucketStartMs, currentTime]`. | — Validated in v3.0 |

---
*Last updated: 2026-09-26 after completing Milestone v3.0*
