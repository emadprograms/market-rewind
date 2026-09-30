# Milestone v4.3 Requirements: Live Data Stabilization and Testing

## Overview
Milestone v4.3 resolves the four P1 and P2 defects discovered during the final live-browser verification (96ca478) documented in `docs/reviews/FINAL-LIVE-BROWSER-REVIEW-96ca478.md`. 
The primary goal is to ensure stability, proper context switching, temporal isolation, and UI consistency across real-data playback, pauses, timeframe changes, and symbol switches.

As strictly requested, all fixes will follow a Test-Driven Development (TDD) approach: focused unit and Playwright tests replicating all four failure modes are implemented first. Code fixes follow in subsequent phases and must ensure all tests pass continuously.

---

## Requirements

### Category 1: Test-First Harness & Review Reproduction (LIVE-TEST)
- [ ] **LIVE-TEST-01**: Diagnostic Unit Test Suite replicating all 4 failure modes from the `FINAL-LIVE-BROWSER-REVIEW-96ca478.md` review: volume mismatch on pause, old symbol history on new symbol chart, unsorted data on timeframe/rewind, and live price mismatch on pause.
- [ ] **LIVE-TEST-02**: Playwright E2E Verification Suite testing the exact workflows outlined in the review: play/pause transitions for daily volume, TSLA to AAPL symbol switches retaining old chart lines, rapid 5m->1m->5m timeframe switches with rewinds, and daily live price comparison across play/pause states.
- [ ] **LIVE-TEST-03**: Red Phase Execution Verification: all failure probes execute and fail predictably against the baseline, confirming genuine defect reproduction before altering application code.

### Category 2: Unified Daily Volume & Live Price Policy (LIVE-VOL)
- [ ] **LIVE-VOL-01**: Unified Daily Volume Aggregation: define a single source/coverage policy for daily aggregation and apply it to both snapshot and live playback, ensuring daily OHLCV exact equality across live and paused paths.
- [ ] **LIVE-VOL-02**: Stable Live Price Display: use the latest eligible price for the chart's own symbol at the cursor in both play and pause states. Prevent the daily "Live" price from reverting to a historical bar's close when paused.

### Category 3: Render Context Transitions & Delayed Responses (LIVE-CONTEXT)
- [ ] **LIVE-CONTEXT-01**: Strict Render-Context Changes: treat symbol, date, timeframe, and dataset-generation changes as explicit render-context changes. Replace the full series when the historical prefix changes, even if bar count and ending timestamp match.
- [ ] **LIVE-CONTEXT-02**: Discard Obsolete Responses: do not render old-symbol history as a new symbol while its request is pending. Discard any delayed or obsolete network responses that do not match the current context generation.

### Category 4: Merge Boundaries & Data Ordering (LIVE-ORDER)
- [ ] **LIVE-ORDER-01**: Strict Timestamp Ordering: enforce ordering and uniqueness at the history merge boundary. Merge valid responses by timestamp with a defined duplicate policy, validating strict ordering before rendering.
- [ ] **LIVE-ORDER-02**: Error State Handling: preserve the last valid chart state on a rejected update and expose a meaningful loading/error state rather than silently continuing with a stale chart.

### Category 5: Systematic Verification & Zero Regressions (LIVE-VERIFY)
- [ ] **LIVE-VERIFY-01**: Full Green Phase Regression Verification: all 4 review probes, all Playwright tests, and all existing 366+ tests pass cleanly.

---

## Traceability Matrix

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIVE-TEST-01 | Phase 34 | Pending |
| LIVE-TEST-02 | Phase 34 | Pending |
| LIVE-TEST-03 | Phase 34 | Pending |
| LIVE-VOL-01  | Phase 35 | Pending |
| LIVE-VOL-02  | Phase 35 | Pending |
| LIVE-CONTEXT-01 | Phase 36 | Pending |
| LIVE-CONTEXT-02 | Phase 36 | Pending |
| LIVE-ORDER-01 | Phase 37 | Pending |
| LIVE-ORDER-02 | Phase 37 | Pending |
| LIVE-VERIFY-01 | Phase 38 | Pending |
