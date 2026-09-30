---
phase: 34-test-first-harness-and-review-reproduction
plan: 01
status: completed
executed_at: 2026-09-30
requirements:
  - LIVE-TEST-01
  - LIVE-TEST-02
  - LIVE-TEST-03
---

# Summary 34-01: Test-First Harness & Review Reproduction

## Overview
Added complete diagnostic test coverage for the 4 failure modes documented in `docs/reviews/FINAL-LIVE-BROWSER-REVIEW-96ca478.md`:
1. `tests/unit/liveReview.test.ts`:
   - PROBE 1: Daily volume stability across play and pause.
   - PROBE 2: TSLA -> AAPL symbol switch full dataset replacement.
   - PROBE 3: History pagination merge timestamp sort order & uniqueness.
   - PROBE 4: Daily "Live" price line stability across play and pause.
2. `tests/regression/journey/13-live-review-reproduction.spec.ts`:
   - LIVE-E2E-1: Daily volume stability across play and pause.
   - LIVE-E2E-2: TSLA -> AAPL symbol switch candle clearing.
   - LIVE-E2E-3: Rapid 5m -> 1m -> 5m timeframe switching and scrubber Home key rewind.
   - LIVE-E2E-4: Daily Live price line stability on 1D chart.
3. Verified Red Phase execution: probes replicate defects and fail predictably against current baseline.
