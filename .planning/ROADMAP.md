# Stability Baseline Roadmap

## Phases

- [x] **Phase 1: Viewport Stabilization** - Eliminate violent viewport jumps and ensure deterministic chart loading.
- [ ] **Phase 2: Selection & Grouping Hardening** - Ensure 100% reliable focus and symbol synchronization.
- [x] **Phase 3: Stability Guardrails** - Build automated regression tests for critical stability paths.
- [x] **Phase 4: Systemic Hardening & Audit** - Map architectural fragility and resolve systemic technical debt to ensure long-term maintainability.

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
  2. Grouped charts synchronize their ticker symbol immediately upon mount.
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

**Plans**:

- [ ] 03-01-PLAN.md — Setup testing infrastructure (Playwright/MSW)
- [ ] 03-02-PLAN.md — Logical viewport regression tests (Vitest)
- [ ] 03-03-PLAN.md — Visual viewport regression tests (Playwright)
- [ ] 03-04-PLAN.md — Logical group sync regression tests (Vitest)
- [ ] 03-05-PLAN.md — Visual group sync regression tests (Playwright)

### Phase 4: Systemic Hardening & Audit

**Goal**: Map architectural fragility and resolve systemic technical debt to ensure long-term maintainability.
**Depends on**: Phase 3
**Requirements**: HARD-01, HARD-02, HARD-03, HARD-04
**Success Criteria** (what must be TRUE):

  1. `useChartLifecycle` is decomposed into specialized hooks.
  2. All plugin renderers use strict interfaces instead of `any`.
  3. Viewport stability is maintained during concurrent Prepend/Auto-Reveal operations.
  4. Database operations are offloaded to a Web Worker to prevent main-thread blocking.

**Plans**:

- [x] 04-01-PLAN.md — Type hardening for plugin renderers
- [x] 04-02-PLAN.md — Extraction of base chart and plugin init
- [x] 04-03-PLAN.md — Extraction of drawings and prioritized viewport control
- [ ] 04-04-PLAN.md — Migration of sql.js to Web Worker
