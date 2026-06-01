# Requirements: Market Rewind Stability Baseline

**Defined:** 2026-06-01
**Core Value:** The system must be deterministic and stable; a user should be able to replay markets and manage layouts without unpredictable viewport jumps or synchronization failures.

## v1 Requirements

### Viewport Stability (STAB)
- [ ] **STAB-01**: Charts must load without "single candle" snaps upon ticker or timeframe changes.
- [ ] **STAB-02**: Infinite scroll data prepending must preserve the visual anchor without violent viewport jumps.
- [ ] **STAB-03**: `scrollToRealTime` must only execute after data is fully hydrated and the initialization lock is released.
- [ ] **STAB-04**: The viewport must remain stable during replay ticks unless the user is at the right edge (Auto-Reveal).

### Selection & Grouping (SYNC)
- [ ] **SYNC-01**: Clicking any element within a `ChartUnit` (header, canvas, buttons) must immediately select that chart.
- [ ] **SYNC-02**: Charts assigned to a group must synchronize their ticker symbol immediately upon component mount.
- [ ] **SYNC-03**: Ticker changes in a group leader must propagate to all group members without "one-render-later" lags.
- [ ] **SYNC-04**: Group membership changes must be reflected visually and logically in real-time.

### Quality & Maintenance (QUAL)
- [ ] **QUAL-01**: Implement a regression test suite specifically for Viewport Stability (simulating ticker changes and scroll prepends).
- [ ] **QUAL-02**: Implement a regression test suite for Group Synchronization (simulating mount and ticker updates).
- [ ] **QUAL-03**: Produce a `FRAGILITY.md` map documenting high-risk interactions between hooks (`useChartData` $ightarrow$ `useChartLifecycle` $ightarrow$ `useWorkspace`).
- [ ] **QUAL-04**: Perform a Technical Debt Audit and resolve critical systemic fragility (e.g., "God Hook" patterns in `useChartLifecycle`).

## v2 Requirements
- [ ] **QUAL-05**: Integration tests for end-to-end replay scenarios.
- [ ] **QUAL-06**: Automated performance regression benchmarks for chart rendering.

## Out of Scope
- New feature requests.
- UI redesigns not related to stability (e.g., theme changes).

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STAB-01 | Phase 1 | Pending |
| STAB-02 | Phase 1 | Pending |
| STAB-03 | Phase 1 | Pending |
| STAB-04 | Phase 1 | Pending |
| SYNC-01 | Phase 2 | Pending |
| SYNC-02 | Phase 2 | Pending |
| SYNC-03 | Phase 2 | Pending |
| SYNC-04 | Phase 2 | Pending |
| QUAL-01 | Phase 3 | Pending |
| QUAL-02 | Phase 3 | Pending |
| QUAL-03 | Phase 4 | Pending |
| QUAL-04 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-01*
*Last updated: 2026-06-01 after initialization*
