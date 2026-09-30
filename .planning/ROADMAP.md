# Milestone v4.3 Roadmap: Live Data Stabilization and Testing

**5 phases** | **10 requirements mapped** | All covered ✓

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 34 | Test-First Harness & Review Reproduction | Replicate all 4 live review failure modes in unit and Playwright tests before altering any code | LIVE-TEST-01, LIVE-TEST-02, LIVE-TEST-03 | 3 |
| 35 | Unified Daily Volume & Live Price Policy | Align daily volume aggregation and live price calculation across live and paused states | LIVE-VOL-01, LIVE-VOL-02 | 3 |
| 36 | Render Context Transitions | Prevent old symbol history from remaining on screen during and after a symbol switch | LIVE-CONTEXT-01, LIVE-CONTEXT-02 | 3 |
| 37 | Merge Boundaries & Data Ordering | Guarantee sorted, unique data when merging history and expose meaningful errors if updates fail | LIVE-ORDER-01, LIVE-ORDER-02 | 3 |
| 38 | Systematic Verification & Zero Regressions | Ensure all new and existing tests pass cleanly with no regressions | LIVE-VERIFY-01 | 2 |

### Phase Details

**Phase 34: Test-First Harness & Review Reproduction**
Goal: Replicate all 4 live review failure modes in unit and Playwright tests before altering any code
Requirements: LIVE-TEST-01, LIVE-TEST-02, LIVE-TEST-03
Success criteria:
1. Unit tests added mimicking pausing volume differences, symbol switches, timeframe sequence ordering issues, and live price mismatch.
2. Playwright E2E tests capturing these workflows visually and logically.
3. Tests confirm red phase (fail predictably).

**Phase 35: Unified Daily Volume & Live Price Policy**
Goal: Align daily volume aggregation and live price calculation across live and paused states
Requirements: LIVE-VOL-01, LIVE-VOL-02
Success criteria:
1. Pausing during real-data playback does not suddenly jump daily volume.
2. Live price stays identical regardless of play/pause state.
3. Corresponding unit and Playwright tests (from Phase 34) now pass.

**Phase 36: Render Context Transitions**
Goal: Prevent old symbol history from remaining on screen during and after a symbol switch
Requirements: LIVE-CONTEXT-01, LIVE-CONTEXT-02
Success criteria:
1. Switching symbol correctly clears old canvas data and blocks pending requests.
2. Full prefix replacement implemented instead of reusing bar counts.
3. Relevant unit and Playwright tests now pass.

**Phase 37: Merge Boundaries & Data Ordering**
Goal: Guarantee sorted, unique data when merging history and expose meaningful errors if updates fail
Requirements: LIVE-ORDER-01, LIVE-ORDER-02
Success criteria:
1. Rapid timeframe switching and rewinding correctly sorts merged chunks.
2. If data is unsorted, it cleanly rejects rather than rendering a stale/invalid chart.
3. Relevant tests pass.

**Phase 38: Systematic Verification & Zero Regressions**
Goal: Ensure all new and existing tests pass cleanly with no regressions
Requirements: LIVE-VERIFY-01
Success criteria:
1. 100% of the 366+ existing tests pass.
2. 100% of the new tests pass.
