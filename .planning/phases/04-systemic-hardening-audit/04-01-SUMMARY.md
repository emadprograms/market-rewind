---
phase: 04-systemic-hardening-audit
plan: 01
subsystem: plugin-renderers
tags: [type-safety, hardening]
dependency-graph:
  requires: []
  provides: [type-safe-renderers]
  affects: [src/lib/*Plugin.ts]
tech-stack:
  added: [ChartTarget, ChartScope interfaces]
  patterns: [Interface-based constraint for library internals]
key-files:
  - src/types/index.ts
  - src/lib/SessionShading.ts
  - src/lib/VolumeProfilePlugin.ts
  - src/lib/HorizontalRayPlugin.ts
  - src/lib/RectanglePlugin.ts
  - src/lib/TradePlugin.ts
decisions:
  - "Defined ChartTarget and ChartScope in src/types/index.ts to mirror lightweight-charts internal primitive renderer types, allowing removal of 'any' in plugin draw methods."
metrics:
  duration: "1 hour"
  completed_date: "2026-06-02"
---

# Phase 04 Plan 01: Type Hardening Summary

Eliminated `any` types in plugin renderers by introducing dedicated internal interfaces for chart targets and scopes.

## Completed Tasks

| Task | Name | Status | Files |
| ---- | ----------- | ------ | ---------------------------- |
| 1 | Define Plugin Internal Interfaces | Done | src/types/index.ts |
| 2 | Harden Plugin Renderers | Done | src/lib/*.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed malformed file ends**
- **Found during:** Task 2
- **Issue:** Some `replace` operations accidentally duplicated closing braces or added trailing fragments.
- **Fix:** Cleaned up trailing syntax in `SessionShading.ts`, `VolumeProfilePlugin.ts`, `HorizontalRayPlugin.ts`, `RectanglePlugin.ts`, and `TradePlugin.ts`.
- **Files modified:** All 5 plugin files.

## Verification Results

- `npx tsc --noEmit`: Confirmed no remaining `any` types in plugin renderers. (Note: unrelated errors in `useChartLifecycle.ts` persist but are out of scope).
- Grep search for `draw(target: any)` in `src/lib/*Plugin.ts`: 0 matches.

## Self-Check: PASSED
