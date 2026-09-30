# Roadmap: Market Rewind

## Completed Milestones

### Milestone v4.1: Replay Convergence, State Machine Synchronization & Transition Integrity ✅
- **Shipped**: 2026-09-30
- **Phases**: 25–28 (4 phases, 4 plans, 100% verified)
- **Archive**: [v4.1-ROADMAP.md](./milestones/v4.1-ROADMAP.md) | [v4.1-REQUIREMENTS.md](./milestones/v4.1-REQUIREMENTS.md) | [v4.1-MILESTONE-AUDIT.md](./milestones/v4.1-MILESTONE-AUDIT.md)

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

## Current Milestone: v4.2 State Machine Convergence & Temporal Strictness

### Phase 29: Test-First Harness & Review Reproduction
- **Goal:** Build the complete automated TDD regression suite replicating all 3 P1 failure modes from `docs/reviews/2026-09-30-replay-review.md` in unit tests (`tests/unit/rereviewProbes.test.ts`) and Playwright tests (`tests/regression/journey/12-replay-convergence.spec.ts`), ingest the local codex rereview probes into `tests/codex/rereview/`, and verify Red failure state against current baseline.
- **Requirements Covered:** CONV-TEST-01, CONV-TEST-02, CONV-TEST-03, CONV-TEST-04
- **Success Criteria:**
  1. Diagnostic unit test suites and Playwright journey tests are added and execute in failing (Red) state against current codebase.
  2. Failure modes match review findings: seek→play fallback volume loss (drops to 200 instead of >=1000), switched symbol 5m candle future high leak at 09:21 (150 instead of 101), and daily candle 09:30:01 future minute high leak (150 instead of 101).

### Phase 30: Snapshot Fallback Constituent Volume Hydration
- **Goal:** Reconstruct and preserve constituent fallback volume state upon snapshot hydration in `useChartLifecycle.ts`, ensuring that seeking into a multi-minute candle followed by playback retains completed constituent minute volumes without double-counting.
- **Requirements Covered:** CONV-VOL-01, CONV-VOL-02
- **Success Criteria:**
  1. Hydrating a seek snapshot restores constituent minute volume state rather than wiping it.
  2. Resuming playback at 09:21:01 retains the 1,000 shares from the 09:20 minute and adds the 200 shares from the 09:21 minute.
  3. Probe 1 in `review.test.ts` turns 100% Green.

### Phase 31: Timeframe-Aware Source Duration & Switched Symbol Protection
- **Goal:** Parameterize forming candle containment in `useChartData.ts` with the actual duration of source bars. When switching symbols without matching global minute history, ensure unclosed source bars (e.g. 5m, 15m) never expose completed high, low, close, or volume before the source bucket closes.
- **Requirements Covered:** CONV-TIME-01, CONV-TIME-02
- **Success Criteria:**
  1. `candidateBars` protection accounts for source bar duration rather than assuming 60 seconds.
  2. A switched symbol at 09:21 displays opening-price placeholder/currently known values (101) rather than the unclosed 5m bar's final high (150).
  3. Probe 2 in `data.test.ts` turns 100% Green.

### Phase 32: Daily Forming Candle RTH & Minute Boundary Containment
- **Goal:** Rebuild daily candle aggregation in `useChartData.ts` to strictly observe RTH session hours and forming-minute boundaries. Ensure unclosed minute bars never expose their completed OHLCV at 09:30:01, and exclude pre/post market trades from daily candles.
- **Requirements Covered:** CONV-DAILY-01, CONV-DAILY-02
- **Success Criteria:**
  1. Daily candle aggregation at 09:30:01 only admits completed bars plus eligible elapsed events in the forming minute.
  2. The forming daily candle at 09:30:01 exposes current open (101) rather than the unclosed minute's completed high (150).
  3. Pre/post market events never contribute to daily OHLCV.
  4. Probe 3 in `data.test.ts` turns 100% Green.

### Phase 33: State Machine Convergence & Systematic Verification
- **Goal:** Verify that continuous play, direct seek, seek-then-play, and rewind-and-replay produce identical candles across all timeframes. Run the complete Playwright E2E journey suite, full Vitest suite (70+ files), backend pytest suite, and production build with zero regressions.
- **Requirements Covered:** CONV-VERIFY-01
- **Success Criteria:**
  1. All 3 review probes and Layer 1/2 tests pass 100% cleanly.
  2. All 11 diagnostic suites and 7 previous review suites pass.
  3. Full unit suite (366+ tests) and backend pytest (11/11) pass.
  4. Playwright E2E journey tests pass offline and deterministically.
  5. `npm run build` exits 0.

---

## Backlog / Next Milestone Candidates
- **TAPE-02**: Multi-symbol aggregated tape view.
- **ORDER-02**: Paper trading execution matching engine with limit order book simulation.
- **EXPORT-01**: Replay session recording and export to video or tick CSV.
- **INDICATORS-01**: Multi-timeframe indicator overlays (VWAP, EMA ribbons, Volume Profile enhancements).
