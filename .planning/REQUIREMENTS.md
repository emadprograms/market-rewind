# Milestone v4.2 Requirements: State Machine Convergence & Temporal Strictness

## Overview
Milestone v4.2 resolves the three remaining P1 transition and look-ahead defects documented in `docs/reviews/2026-09-30-replay-review.md`. The primary goal is mathematical equivalence and state-machine convergence: ensuring that continuous playback, direct seeking, seek followed by play, and rewind-and-replay produce identical chart state, volume totals, and temporal boundaries.

All fixes follow strict Test-Driven Development (TDD): focused unit and Playwright tests replicating all three review probes are added first, confirmed failing in the Red phase, and then resolved phase-by-phase until 100% green status is achieved with zero regressions.

---

## Requirements

### Category 1: Test-First Harness & Review Reproduction (CONV-TEST)
- [x] **CONV-TEST-01**: Diagnostic Unit Test Suite `tests/unit/rereviewProbes.test.ts` replicating all 3 P1 failure modes from `docs/reviews/2026-09-30-replay-review.md` (seek→play fallback volume loss, switched-symbol unclosed 5m price leak, and daily forming candle intra-minute leak).
- [x] **CONV-TEST-02**: Combined Data-to-Renderer Transition Harness (Layer 2) proving that continuous play, direct seek, seek-then-play, and rewind-and-replay produce identical candles without double counting or volume drops.
- [x] **CONV-TEST-03**: Playwright E2E Convergence Suite `tests/regression/journey/12-replay-convergence.spec.ts` testing exact seeking, symbol switching without elapsed ticks, and RTH opening minute daily chart boundaries in an offline browser environment.
- [x] **CONV-TEST-04**: Red Phase Execution Verification: all three review failure probes execute and fail predictably against the baseline, confirming genuine defect reproduction before altering application code.

### Category 2: Fallback Volume Hydration & Retention (CONV-VOL)
- [ ] **CONV-VOL-01**: Snapshot Fallback Volume State Hydration: when hydrating a snapshot in `useChartLifecycle.ts`, preserve or reconstruct constituent minute volume state so that seeking into a multi-minute candle followed by play retains completed minute volumes rather than dropping to only the current minute.
- [ ] **CONV-VOL-02**: Zero Double Counting on Resume: ensure resuming playback after snapshot hydration accumulates new elapsed trades without re-adding already hydrated volume.

### Category 3: Source Duration & Switched Symbol Protection (CONV-TIME)
- [ ] **CONV-TIME-01**: Source-Resolution Aware Forming Candle Protection: parameterize forming candle containment in `useChartData.ts` by the actual duration of source bars rather than hardcoding 60 seconds.
- [ ] **CONV-TIME-02**: Switched Symbol Local History Containment: when switching symbols where global minute history is absent and local timeframe history is used, ensure unfinished source candles (e.g. 5m, 15m) never expose completed high, low, close, or volume before the source bucket closes.

### Category 4: Daily Candle RTH & Minute Boundary Containment (CONV-DAILY)
- [ ] **CONV-DAILY-01**: Daily Forming Candle Minute Isolation: build daily candles from completed RTH bars plus eligible elapsed events in the forming minute, preventing unclosed minute highs/lows/volumes from leaking into daily candles.
- [ ] **CONV-DAILY-02**: Strict RTH Session Filtering for Daily OHLCV: ensure premarket (PRE) and after-hours (POST) trades and bars are strictly excluded from daily candle OHLCV calculations.

### Category 5: Systematic Verification & Zero Regressions (CONV-VERIFY)
- [ ] **CONV-VERIFY-01**: Full Green Phase Regression Verification: all 3 review probes, all 11 diagnostic suites, all previous 7 review suites, all 70 existing test files (366+ tests), backend pytest suite, and all Playwright journey tests pass 100% cleanly.

---

## Traceability Matrix

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONV-TEST-01 | Phase 29 | Complete |
| CONV-TEST-02 | Phase 29 | Complete |
| CONV-TEST-03 | Phase 29 | Complete |
| CONV-TEST-04 | Phase 29 | Complete |
| CONV-VOL-01  | Phase 30 | Pending |
| CONV-VOL-02  | Phase 30 | Pending |
| CONV-TIME-01 | Phase 31 | Pending |
| CONV-TIME-02 | Phase 31 | Pending |
| CONV-DAILY-01| Phase 32 | Pending |
| CONV-DAILY-02| Phase 32 | Pending |
| CONV-VERIFY-01| Phase 33 | Pending |
