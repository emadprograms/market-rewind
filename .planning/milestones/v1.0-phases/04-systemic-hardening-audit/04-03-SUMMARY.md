---
phase: 04-systemic-hardening-audit
plan: 03
subsystem: chart-lifecycle
tags: [refactor, stability, decomposition]
dependency_graph:
  requires: ["04-02"]
  provides: ["thin-orchestrator-lifecycle"]
  affects: ["useChartLifecycle", "useChartViewport", "useChartDrawings"]
tech-stack:
  added: ["specialized-hooks-pattern"]
  patterns: ["priority-viewport-control", "interaction-isolation"]
key-files:
  - src/hooks/chart/useChartDrawings.ts
  - src/hooks/chart/useChartViewport.ts
  - src/hooks/useChartLifecycle.ts
decisions:
  - "Extracted drawing interaction logic to useChartDrawings to reduce useChartLifecycle size."
  - "Implemented a prioritized viewport sync system in useChartViewport (Prepend > Manual Shift > Auto-Reveal)."
  - "Converted useChartLifecycle into a thin orchestrator that coordinates specialized hooks."
metrics:
  duration: "approx 30 mins"
  completed_date: "2026-06-02"
---

# Phase 04 Plan 03: Interaction & Viewport Extraction Summary

Successfully decomposed the `useChartLifecycle` god-hook into two specialized hooks: `useChartDrawings` and `useChartViewport`.

## Changes

### 1. `useChartDrawings`
- Extracted all `subscribeClick`, `subscribeCrosshairMove`, and `subscribeDblClick` logic.
- Isolated coordinate-to-price transformations and deletion logic.
- Hook now handles all Ray/Rect creation and removal interactions.

### 2. `useChartViewport`
- Extracted `setVisibleLogicalRange` and `scrollToRealTime` logic.
- Implemented a priority queue for viewport mutations:
  - **Priority 1: History Prepend** - Ensures viewport stability when new historical data is added.
  - **Priority 2: Manual Shift** - Maintains the user's relative position at the end of the chart during live updates.
  - **Priority 3: Auto-Reveal** - Triggers `scrollToRealTime` during replay when the user is near the data edge.
- Exposed `syncViewport` and `checkAutoReveal` for orchestration.

### 3. `useChartLifecycle` (Refactored)
- Now acts as a thin orchestrator.
- Delegates drawing interactions to `useChartDrawings`.
- Delegates viewport management to `useChartViewport`.
- Reduced cognitive load and improved maintainability by removing 100+ lines of imperative logic.

## Deviations from Plan
None - plan executed exactly as written.

## Self-Check: PASSED
- [x] `src/hooks/chart/useChartDrawings.ts` created and functional.
- [x] `src/hooks/chart/useChartViewport.ts` created and functional.
- [x] `src/hooks/useChartLifecycle.ts` refactored to orchestrator.
- [x] Types verified via `tsc --noEmit`.
- [x] All tasks committed.
