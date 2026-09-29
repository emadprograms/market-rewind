# Milestone v4.1 Requirements: Replay Convergence, State Machine Synchronization & Transition Integrity

## Overview
Milestone v4.1 resolves all 8 architectural and transition findings documented in `market-rewind-review-2026-09-29.md`. The core goal is achieving strict state-machine convergence: ensuring that playing, seeking, rewinding, switching symbols, and changing dates all produce mathematically identical chart state, volume totals, and temporal boundaries.

All defect fixes follow strict Test-Driven Development (TDD): unit and Playwright tests replicating all 7 review probes are created first, confirmed failing in the Red phase, and then resolved phase-by-phase until 100% green status is achieved with zero regressions.

---

## Requirements

### Category 1: Test Harness & Review Reproduction (REV-TEST)
- [ ] **REV-TEST-01**: Diagnostic Unit Test Suite `tests/unit/reviewTransitions.test.ts` replicating all 7 transition probes from `market-rewind-review-2026-09-29.md` (Time & Sales hook order crash, post-seek volume doubling, post-rewind trade suppression, multi-minute fallback volume drop, stale tick session overwrite, 1s-past-boundary look-ahead leak, and slider premarket loss after seek).
- [ ] **REV-TEST-02**: Diagnostic Playwright E2E Suite `tests/regression/journey/11-review-e2e-hardening.spec.ts` verifying actual drawer toggling, non-empty row price inspection, symbol switching, and slider bounds with a post-open first-tick fixture.
- [ ] **REV-TEST-03**: Red Phase Execution Verification: all review transition test probes execute and fail predictably against the baseline, confirming genuine defect reproduction before altering application code.

### Category 2: UI Hook Order & Cursor State Synchronization (REV-SYNC)
- [ ] **REV-SYNC-01**: React Rules of Hooks Compliance in `TimeAndSales.tsx`: move `usePlaybackStore` and all hook subscriptions unconditionally to top-level, guaranteeing opening and closing the panel never triggers hook count mismatch errors.
- [ ] **REV-SYNC-02**: Consumed-Tick Cursor Coherence on Seek & Snapshot: `lastConsumedTimeRef` and `lastConsumedTickRef` in `useChartLifecycle` are synchronized with seeks, rewinds, and snapshot renders so playing after seeking never re-counts already rendered trades.
- [ ] **REV-SYNC-03**: Consumed-Tick Cursor Coherence on Rewind: backward seeking updates `lastConsumedTimeRef` to the target seek time, enabling replay after rewind to properly aggregate elapsed intermediate trades without suppression.
- [ ] **REV-SYNC-04**: O(log N) Binary-Search Ingestion Cursor: replace linear iteration over all symbol ticks with binary search using `lastConsumedTimeRef` and early loop termination, eliminating redundant timestamp parsing per frame.

### Category 3: Temporal Isolation & Fallback Volume (REV-FORM)
- [ ] **REV-FORM-01**: Comprehensive Forming Bucket Look-Ahead Protection: forming candle synthesis in `useChartData` bounds the entire forming bucket interval (`bMs <= effectiveCutoff && bMs + durationMs > effectiveCutoff`), ensuring completed candle high/low/volume values are never exposed at any second before bucket close.
- [ ] **REV-FORM-02**: Constituent Volume Accumulation in Multi-Minute Fallbacks: when synthesizing higher timeframe candles from fallback ticks, accumulate earlier constituent minute volumes within the bucket rather than overwriting with only the latest minute's volume; ensure all synthetic ticks carry `isSynthesized: true`.
- [ ] **REV-FORM-03**: Session Tick Loader Generation Guard: apply monotonic session generation tokens and cancellation to the `loadTicksForSession` workflow in `src/App.tsx`, preventing late tick responses from older dates from overwriting the active session time.

### Category 4: Scrubber Session Anchoring & Systematic Verification (REV-VERIFY)
- [ ] **REV-SCRUB-01**: Fixed Session Scrubber Bounds: anchor scrubber `minTime` and `maxTime` in `PlaybackBar.tsx` to the configured session entry time and session close, remaining completely invariant when seeking forward.
- [ ] **REV-VERIFY-01**: Full Green Phase Regression Verification: all 7 transition probes, all 11 diagnostic suites, all 62 existing test suites (341+ tests), backend pytest suites, and Playwright E2E suites pass with zero errors.

---

## Traceability Matrix

| Requirement | Phase | Status |
|-------------|-------|--------|
| REV-TEST-01 | Phase 25 | Complete |
| REV-TEST-02 | Phase 25 | Complete |
| REV-TEST-03 | Phase 25 | Complete |
| REV-SYNC-01 | Phase 26 | Complete |
| REV-SYNC-02 | Phase 26 | Complete |
| REV-SYNC-03 | Phase 26 | Complete |
| REV-SYNC-04 | Phase 26 | Complete |
| REV-FORM-01 | Phase 27 | Complete |
| REV-FORM-02 | Phase 27 | Complete |
| REV-FORM-03 | Phase 27 | Complete |
| REV-SCRUB-01 | Phase 28 | Pending |
| REV-VERIFY-01 | Phase 28 | Pending |
