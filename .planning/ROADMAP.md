# Stability Baseline Roadmap

## Phases

- [x] **Phase 1: Viewport Stabilization** - Eliminate violent viewport jumps and ensure deterministic chart loading.
- [ ] **Phase 2: Selection & Grouping Hardening** - Ensure 100% reliable focus and symbol synchronization.
- [ ] **Phase 3: Stability Guardrails** - Build automated regression tests for critical stability paths.
- [ ] **Phase 4: Systemic Hardening & Audit** - Map architectural fragility and resolve systemic technical debt.

## Phase Details

### Phase 1: Viewport Stabilization

**Goal**: Eliminate violent viewport jumps and ensure deterministic chart loading.
**Depends on**: Nothing
**Requirements**: STAB-01, STAB-02, STAB-03, STAB-04
**Success Criteria** (what must be TRUE):

  1. Ticker or timeframe changes occur without "single candle" snaps.
  2. Infinite scroll data prepending preserves the visual anchor without viewport shifts.
  3. Viewport remains stationary during replay ticks unless the user is at the right edge (Auto-Reveal).
  4. `scrollToRealTime` executes only after data is fully hydrated and the initialization lock is released.

**Plans**: TBD
**UI hint**: yes

### Phase 2: Selection & Grouping Hardening

**Goal**: Ensure 100% reliable focus and symbol synchronization across the workspace.
**Depends on**: Phase 1
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04
**Success Criteria** (what must be TRUE):

  1. Clicking any element in a `ChartUnit` (header, canvas, buttons) immediately focuses that chart.
  2. Grouped charts synchronize their ticker symbol immediately upon component mount.
  3. Ticker changes in a group leader propagate to all members without "one-render-later" lag.
  4. Group membership changes are reflected visually and logically in real-time.

**Plans**: TBD
**UI hint**: yes

### Phase 3: Stability Guardrails

**Goal**: Build automated regression tests to prevent future regressions in viewport and grouping.
**Depends on**: Phase 2
**Requirements**: QUAL-01, QUAL-02
**Success Criteria** (what must be TRUE):

  1. Automated test suite verifies viewport stability during ticker/timeframe changes.
  2. Automated test suite verifies viewport stability during data prepends (infinite scroll).
  3. Automated test suite verifies group synchronization on mount and symbol updates.

**Plans**: TBD

### Phase 4: Systemic Hardening & Audit

**Goal**: Map architectural fragility and resolve systemic technical debt to ensure long-term maintainability.
**Depends on**: Phase 3
**Requirements**: QUAL-03, QUAL-04
**Success Criteria** (what must be TRUE):

  1. `FRAGILITY.md` map exists and documents high-risk interactions between `useChartData`, `useChartLifecycle`, and `useWorkspace`.
  2. Critical "God Hook" patterns in `useChartLifecycle` are refactored into smaller, testable utilities.
  3. Systemic fragility identified in the audit is resolved and verified.

**Plans**: TBD

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Viewport Stabilization | 1/1 | Completed | 2023-10-27 |
| 2. Selection & Grouping Hardening | 2/5 | In Progress|  |
| 3. Stability Guardrails | 0/0 | Not started | - |
| 4. Systemic Hardening & Audit | 0/0 | Not started | - |
