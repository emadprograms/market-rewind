---
status: investigating
trigger: grouping still doesn't work properly
updated: 2026-06-02T15:25:00Z
---

# Debug Session: grouping-issue

## Symptoms
- "When I make two charts make group green, the ticker symbols of both should change simultaneusly."
- User reports synchronization is not working despite previous attempts.

## Current Focus
- **Hypothesis:** `setGroup` in `useWorkspaceStore.ts` deletes group tickers when they become empty. Subsequent charts joining the group find no group ticker and fall back to individual tickers, breaking synchronization until a manual ticker change occurs.
- **Test:** Verify `setGroup` logic and `useChartData` fallback behavior.
- **Next Action:** Update `useWorkspaceStore.ts` to stop deleting group tickers and consolidate group synchronization logic.

## Evidence
- `src/store/useWorkspaceStore.ts`: `setGroup` contains logic to delete group tickers from `groupTickers` when a group becomes empty.
- `src/hooks/useChartData.ts`: The `ticker` selector falls back to `state.tickers[chartId]` if `state.groupTickers[group]` is missing.
- `src/hooks/useWorkspace.ts` and `src/hooks/useChartData.ts`: Both hooks attempt to manually sync group tickers on ticker change, which is redundant and potentially prone to race conditions if state is stale.

## Resolution
- **Root Cause:** Deletion of group tickers when groups become empty causes subsequent joiners to fall back to individual tickers, breaking the shared state. Fragmentation of synchronization logic across multiple hooks makes the system fragile.
- **Fix:** 
  1. Remove deletion logic from `setGroup` in `useWorkspaceStore.ts`.
  2. Ensure `setGroup` initializes the group ticker if it's missing when a chart joins.
  3. Move group synchronization logic into `setTicker` action in the store.
  4. Simplify `useWorkspace` and `useChartData` hooks to rely on the store's automatic synchronization.
