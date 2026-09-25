---
phase: 03-stability-guardrails
plan: 01
subsystem: Testing Infrastructure
tags: [playwright, msw, vitest, mocking]
dependency-graph:
  requires: []
  provides: [regression-tooling]
  affects: [all-stability-tests]
tech-stack:
  added: [playwright, @playwright/test, msw]
  patterns: [API-Driven Range Assertion, Simulation Driver]
key-files:
  - playwright.config.ts
  - tests/helpers/chart-simulation.test.ts
decisions:
  - "Used Playwright for E2E/Visual regression and Vitest for logical stability tests"
  - "Implemented a lightweight-charts API simulation layer to avoid testing the mock"
metrics:
  duration: "30m"
  completed: "2025-06-02"
---

# Phase 03 Plan 01: Setup Testing Infrastructure Summary

Established the testing infrastructure required for regression guardrails.

## Completed Tasks

| Task | Name | Status | Commit |
|------|------|--------|--------|
| 1 | Install Testing Tooling | Completed | ed11d13 |
| 2 | Configure Playwright | Completed | ed11d13 |
| 3 | Create Chart Simulation Helper | Completed | ed11d13 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Vitest file discovery**
- **Found during:** Task 3
- **Issue:** Vitest did not pick up `tests/helpers/chart-simulation.ts` because it didn't match the default `*.test.ts` or `*.spec.ts` glob.
- **Fix:** Renamed the file to `tests/helpers/chart-simulation.test.ts`.
- **Files modified:** `tests/helpers/chart-simulation.test.ts`
- **Commit:** `ed11d13`

## Self-Check: PASSED

- [x] `playwright` and `msw` installed (verified via `npm list`)
- [x] `playwright.config.ts` created and verified (verified via `npx playwright test --list`)
- [x] `tests/helpers/chart-simulation.test.ts` provides functional mocks (verified via `npx vitest run`)
- [x] All tasks committed.
