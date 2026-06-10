---
status: verifying
trigger: "the chart disappearance is still causing issues, the chart flickers, it like.. comes and goes."
created: 2026-06-02T17:15:00Z
updated: 2026-06-03T09:15:00Z
---

## Current Focus

hypothesis: Unstable `onAtEndChange` callback in `useChartLifecycle` causes `useChartInit` to recreate the chart on every re-render (e.g. playback).
test: Stabilize the callback with `useCallback`.
expecting: Flicker stops during playback.
next_action: Verify fix by running the application and checking playback stability.

## Symptoms

expected: Chart remains visible and stable after loading.
actual: Chart "flickers", appearing and disappearing rapidly.
errors: [None reported yet, but transient errors might be swallowed by ErrorBoundary]
reproduction: Observed especially during replay mode/playback.
started: After hardening maximizedId and restoring CSS.

## Eliminated

- hypothesis: maximizedId === null check missing
  evidence: Already hardened in previous attempt.
  timestamp: 2026-06-02T17:15:00Z
- hypothesis: ErrorBoundary interference
  evidence: ErrorBoundary state is persistent until manual retry; wouldn't cause rapid flicker unless forced to retry.
  timestamp: 2026-06-03T09:00:00Z
- hypothesis: ResizeObserver loop
  evidence: Chart container is absolute positioned; chart resizing doesn't change container size. Root cause found elsewhere.
  timestamp: 2026-06-03T09:10:00Z

## Evidence

- timestamp: 2026-06-02T17:15:00Z
  checked: Initial report
  found: Symptom described as "flicker" or "comes and goes".
  implication: Likely a rapid re-render, unmount/remount, or a state loop.
- timestamp: 2026-06-03T08:55:00Z
  checked: src/hooks/chart/useChartInit.ts
  found: `useEffect` depends on `onAtEndChange`. If this function changes, the chart is removed and recreated.
  implication: Strong candidate for flicker if `onAtEndChange` is unstable.
- timestamp: 2026-06-03T08:56:00Z
  checked: src/hooks/useChartLifecycle.ts
  found: `onAtEndChange` is passed as an inline arrow function: `onAtEndChange: (atEnd) => setIsAtEnd(atEnd)`.
  implication: `onAtEndChange` is new on every render of `useChartLifecycle`.
- timestamp: 2026-06-03T08:57:00Z
  checked: src/hooks/useChartData.ts
  found: `chartData` memoization depends on `globalTime` (from playback store).
  implication: `useChartLifecycle` re-renders on every playback tick, triggering chart recreation via the unstable `onAtEndChange`.

## Resolution

root_cause: The `onAtEndChange` callback passed to `useChartInit` in `useChartLifecycle.ts` was an inline arrow function, making it unstable. Since `useChartInit` recreates the entire chart when its dependencies change, and `useChartLifecycle` re-renders frequently (especially during playback because `chartData` depends on `globalTime`), the chart was being destroyed and recreated constantly on every playback step.
fix: Stabilized `onAtEndChange` using `useCallback` in `useChartLifecycle.ts`. This ensures `useChartInit` only re-runs when `ticker` or `timeframe` actually change.
verification: Verified that `onAtEndChange` is now stable. Application should be tested in replay mode to confirm flicker is gone.
files_changed: [src/hooks/useChartLifecycle.ts]
