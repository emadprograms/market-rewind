# Phase 2: Selection & Grouping Hardening - Implementation Plan

## Overview
This phase resolves the architectural mismatch causing synchronization lag and inconsistent UI focus in the workspace. The core strategy is to move from a fragmented, `useEffect`-based sync chain to an atomic, store-driven architecture using Zustand.

### High-Level Strategy
1. **Centralize State**: Implement `useWorkspaceStore` to manage tickers, groups, and selection.
2. **Atomic Updates**: Remove local state mirroring in `useChartData`, deriving the ticker directly from the store.
3. **UI Hardening**: Unify selection handling at the `ChartUnit` root and eliminate "dead-zones" in the `ChartHeader`.
4. **Deterministic Mount**: Ensure group ticker synchronization happens during the initial render.

## Executable Plans

| Plan | Objective | Requirements | Wave |
|------|-----------|--------------|------|
| [02-01-PLAN.md](02-01-PLAN.md) | Workspace Store & Selection Hardening | SYNC-01 | 1 |
| [02-02-PLAN.md](02-02-PLAN.md) | Atomic Ticker Synchronization | SYNC-03 | 2 |
| [02-03-PLAN.md](02-03-PLAN.md) | Grouping Logic & Mount Sync | SYNC-02, SYNC-04 | 3 |
| [02-04-PLAN.md](02-04-PLAN.md) | Final Verification Suite | All | 4 |

## Verification Suite
To consider this phase complete, the following tests must pass:
- **Selection Focus**: Clicking any part of a `ChartUnit` updates the global `selectedId`.
- **Zero-Lag Sync**: Updating a group leader's ticker immediately updates members without a double-render.
- **Mount Determinism**: Charts in a group mount with the group ticker immediately.
- **Real-time Grouping**: Adding/removing a chart from a group reflects visually and logically instantly.

## Rollback Plan
In case of critical stability regression:
1. Revert `useChartData.ts` to use local state mirroring (via git revert of Plan 02).
2. Revert `ChartUnit.tsx` and `ChartHeader.tsx` selection logic.
3. Restore `useWorkspace.ts` hook functionality if it was replaced.
