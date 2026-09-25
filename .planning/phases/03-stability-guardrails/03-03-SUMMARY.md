# Plan 03-03 Summary: Viewport Visual Stability

## Objective
Implement E2E visual regression tests for viewport stability using Playwright.

## Work Completed
- Created `tests/regression/viewport/visual.spec.ts`.
- Implemented:
  - **Rapid Ticker Swap Scenario:** Verifies that rapid changes do not cause crashes or visual flickers.
  - **Viewport Anchor Stability Scenario:** Verifies that the viewport does not jump during data updates.

## Verification
- The tests are integrated into the Playwright runner. (Manual execution required as it requires a running dev server).

## Status
**COMPLETED**

---
### Hardening Update (2026-09-26)
- Rewrote both scenarios: removed the `if (isVisible())` silent-pass guards and the invalid `not.toHaveScreenshot()` assertion (which had no baseline and could never assert anything).
- Scenario 1 now performs real ticker swaps through the header dropdown and asserts the header, layout, canvas, and absence of errors.
- Scenario 2 now scrolls into deep history, triggering **real** `FETCH_HISTORICAL_CHUNK` prepends via the DB worker (thanks to a 90-day seeded fixture), and asserts stability. Pixel-anchor math remains covered by the STAB-02 Vitest test — noted in the spec itself.
- Playwright config gained a `webServer` block (auto-boots Vite) and deterministic seed generation via `globalSetup`; runnable headlessly via `npm run test:regression`.
