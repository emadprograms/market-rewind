# Roadmap: Milestone v3.1 Pure Streaming DuckDB Replay Engine & Global Multi-Asset Simulator

## Milestone Overview
Re-architect Market Rewind to run exclusively on `streaming.duckdb`, synchronizing real-time market playback across all active charts and groups simultaneously, with strict date boundaries, removal of legacy SQLite/Vercel artifacts, and a comprehensive test-first Playwright/unit test suite.

---

## Phase Structure

| Phase | Name | Goal | Requirements | Success Criteria |
|-------|------|------|--------------|------------------|
| 13 | Legacy & Historical Cleanup | Remove `sql.js`, SQLite WASM workers, and `historical.duckdb` dependencies so the app builds cleanly and runs solely on `streaming.duckdb`. | CLEAN-01, CLEAN-02, CLEAN-03 | 3 |
| 14 | Test-First Harness & Bug Reproduction | Author Playwright E2E and Vitest specs capturing date reset leakage, multi-asset playback freeze, group desync, and genuine tick streaming. | TEST-01, TEST-02, TEST-03, TEST-04 | 4 |
| 15 | Date Reset Hardening & Pure Tick Replay | Eliminate unconstrained tape fallback, enforce strict date boundaries, handle market holidays cleanly, and remove 4-micro-tick synthesis caps. | REPLAY-01, REPLAY-02, REPLAY-03 | 3 |
| 16 | Global Multi-Asset Playback Synchronization | Implement universal replay clock and multi-ticker transport so PLAY advances all open charts (e.g. AAPL + AMD) and group charts simultaneously. | SYNC-01, SYNC-02, SYNC-03, SYNC-04 | 4 |
| 17 | End-to-End Verification & Hardening | Run all Playwright E2E specs and Vitest suites end-to-end to confirm 100% green verification of all fixes and zero regressions. | TEST-01, TEST-02, TEST-03, TEST-04 | 3 |

---

## Phase Details

### Phase 13: Legacy & Historical Cleanup
**Goal**: Completely decouple the project from `sql.js`, SQLite WASM files, and `historical.duckdb`, ensuring all candle aggregation and tick fetching query `streaming.duckdb` directly.
- **Requirements**: `CLEAN-01`, `CLEAN-02`, `CLEAN-03`
- **Success Criteria**:
  1. `sql.js` and `@types/sql.js` removed from `package.json`, `public/sql-wasm.wasm` and `src/lib/workers/db.worker.ts` removed.
  2. All queries in `streamingClient.ts` and UI hooks query `streaming.duckdb` (no calls to `historical.duckdb`).
  3. `npm run build` and `npm test` execute with zero SQLite references.

### Phase 14: Test-First Harness & Bug Reproduction
**Goal**: Create robust Playwright E2E and Vitest tests targeting each reported issue before making core engine modifications.
- **Requirements**: `TEST-01`, `TEST-02`, `TEST-03`, `TEST-04`
- **Success Criteria**:
  1. Playwright and Vitest test for Date Reset asserts that resetting to Sept 7, 2026 (or holidays) does not load Sept 24/25 ticks.
  2. Playwright and Vitest test for Multi-Asset Replay asserts that clicking PLAY advances candles on both Chart 0 (AAPL) and Chart 1 (AMD).
  3. Test asserts that assigning a chart to a group whose ticker is AMD correctly displays and streams AMD updates.
  4. Test asserts that tick replay streams raw ticks without synthesizing 4-micro-ticks or capping at 4,200 bars.

### Phase 15: Date Reset Hardening & Pure Tick Replay
**Goal**: Fix date reset logic, eliminate unconstrained `/api/stream/tape` fallback, provide holiday/weekend status indicators, and stream genuine ticks from `streaming.duckdb`.
- **Requirements**: `REPLAY-01`, `REPLAY-02`, `REPLAY-03`
- **Success Criteria**:
  1. Date reset strictly queries ticks within `[startTime, endTime]` and never calls unconstrained tape or future dates.
  2. If a selected day has no trading sessions (holiday/weekend), a clear status indicator is shown, preventing phantom replay.
  3. Replay buffer loads genuine ticks from `streaming.duckdb` without 4-micro-tick synthesis or 4,200-bar caps.

### Phase 16: Global Multi-Asset Playback Synchronization
**Goal**: Implement a universal market timeline in the playback engine that drives all active charts, groups, and tickers in parallel.
- **Requirements**: `SYNC-01`, `SYNC-02`, `SYNC-03`, `SYNC-04`
- **Success Criteria**:
  1. Universal replay clock coordinates current replay timestamp across all workspace charts.
  2. Multi-ticker tick buffer fetches and streams ticks for all open chart tickers (e.g. AAPL, AMD, NVDA).
  3. Real-time candle formation updates simultaneously on all visible charts as playback progresses.
  4. Group assignments and ticker changes dynamically subscribe to the corresponding ticker at the current replay cursor.

### Phase 17: End-to-End Verification & Hardening
**Goal**: Verify all Playwright E2E specs and Vitest test suites against the live streaming backend, ensuring flawless real-time simulation.
- **Requirements**: All Milestone v3.1 Requirements
- **Success Criteria**:
  1. Playwright test suite passes completely green (`npx playwright test`).
  2. Vitest test suite passes completely green (`npm test`).
  3. Application build passes cleanly (`npm run build`).
