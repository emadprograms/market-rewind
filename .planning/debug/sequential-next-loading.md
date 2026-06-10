---
status: investigating
trigger: "when I click next, one chart loads. then when I click next another chart loads."
created: 2025-06-03T12:00:00Z
updated: 2025-06-03T12:00:00Z
---

## Current Focus

hypothesis: Either (A) the main-thread rendering cost of updating multiple charts (filter -> resample -> setData) is causing visible sequential stutters, or (B) the user is referring to navigating between dates/tickers via some "Next" mechanism not yet identified, which would trigger the initial sequential loading bottleneck.
test: 1. Add timing logs to `resampleData` and `setData`. 2. Search for any other "Next" buttons in the UI.
expecting: If A, logs will show sequential blocking of the main thread. If B, a new "Next" mechanism will be found.
next_action: Add timing logs to `useChartData.ts` (resampling) and `useChartLifecycle.ts` (setData).

## Symptoms

expected: Advancing time via "next" button should update all charts simultaneously and instantaneously if data is already loaded.
actual: Charts seem to load one by one when clicking "next".
errors: None reported.
reproduction: Click "next" button in playback controls.
started: [TBD]

## Eliminated

## Evidence

- timestamp: 2025-06-03T12:30:00Z
  checked: `usePlaybackStore.ts`, `useChartData.ts`, `useMarketSimulator.ts`
  found: Clicking "Next" calls `stepForward`, which updates `currentTime` in the Zustand store. `useChartData.ts` uses this `currentTime` inside a `useMemo` to filter `localMasterData`.
  implication: Advancing time does NOT trigger any new DB requests. The data is already in memory. The "loading" the user sees must be rendering lag or some other sequential process.## Resolution

root_cause: 
fix: 
verification: 
files_changed: []
