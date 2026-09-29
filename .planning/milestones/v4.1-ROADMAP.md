# Roadmap: Market Rewind

## Completed Milestones

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

## Current Milestone: v4.1 Replay Convergence, State Machine Synchronization & Transition Integrity

### Phase 25: Test-First Transition & Review Harness
- **Goal:** Build the complete automated TDD harness replicating all 7 review probes from `market-rewind-review-2026-09-29.md` in unit tests (`tests/unit/reviewTransitions.test.ts`) and Playwright tests (`tests/regression/journey/11-review-e2e-hardening.spec.ts`), and verify Red failure state against current baseline.
- **Requirements Covered:** REV-TEST-01, REV-TEST-02, REV-TEST-03
- **Success Criteria:**
  1. Diagnostic unit test suite and Playwright journey tests are added and execute in failing (Red) state against current codebase.
  2. Failure modes match review findings: hook-order throw on tape toggle, post-seek volume doubling, rewind trade omission, fallback volume drop, stale tick date overwrite, 1s look-ahead leak, and scrubber premarket domain loss.

### Phase 26: Playback State Synchronization & Cursor Coherence
- **Goal:** Fix the React hook-order crash in `TimeAndSales.tsx` and synchronize the consumed-tick cursor across seeking, rewinding, and snapshot mounting in `useChartLifecycle.ts`. Replace per-frame linear tick scans with O(log N) binary search.
- **Requirements Covered:** REV-SYNC-01, REV-SYNC-02, REV-SYNC-03, REV-SYNC-04
- **Success Criteria:**
  1. `TimeAndSales.tsx` renders without throwing when toggling between closed and open states.
  2. `useChartLifecycle` synchronizes `lastConsumedTimeRef` with seek snapshots so playing after a seek never re-counts rendered trades.
  3. Replay after rewind aggregates intermediate trades properly without suppression.
  4. Intra-frame tick consumption uses binary-search cursor advancement, terminating loops early upon reaching `currentTime`.

### Phase 27: Temporal Isolation & Volume Accumulation
- **Goal:** Protect forming candles against look-ahead leaks across the entire forming interval, accumulate constituent minute volumes in multi-minute fallbacks, and eliminate the session tick loader race condition in `src/App.tsx`.
- **Requirements Covered:** REV-FORM-01, REV-FORM-02, REV-FORM-03
- **Success Criteria:**
  1. Forming candle synthesis bounds the entire bucket interval so no completed high/low/volume leaks 1s past the boundary.
  2. Multi-minute fallbacks accumulate prior constituent minute volumes instead of overwriting with only the latest minute.
  3. `App.tsx` guards `loadTicksForSession` with session generation tokens and cancellation so older date responses cannot overwrite active session time.

### Phase 28: Scrubber Session Anchoring & Systematic Verification
- **Goal:** Anchor the timeline scrubber to fixed session start and end times independently of `currentTime`, harden Playwright tests to open and inspect the tape, and verify that all review probes and regression suites pass 100% cleanly.
- **Requirements Covered:** REV-SCRUB-01, REV-VERIFY-01
- **Success Criteria:**
  1. Scrubber `minTime` remains firmly anchored to session start (e.g. 09:20 ET) after seeking to 09:34 or beyond.
  2. Playwright E2E suite explicitly opens the tape, verifies rows and symbol isolation, and tests slider bounds.
  3. All 7 review probes pass (Green phase).
  4. All 62 test suites (341+ tests) and backend pytest suite pass with zero regressions.

---

## Backlog / Next Milestone Candidates
- **TAPE-02**: Multi-symbol aggregated tape view.
- **ORDER-02**: Paper trading execution matching engine with limit order book simulation.
- **EXPORT-01**: Replay session recording and export to video or tick CSV.
- **INDICATORS-01**: Multi-timeframe indicator overlays (VWAP, EMA ribbons, Volume Profile enhancements).
