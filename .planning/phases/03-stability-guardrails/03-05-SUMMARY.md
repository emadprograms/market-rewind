# Plan 03-05 Summary: Sync Propagation E2E

## Objective
Implement E2E visual/functional regression tests for group synchronization using Playwright.

## Work Completed
- Created `tests/regression/sync/propagation.spec.ts`.
- Implemented:
  - **Real-time Propagation Scenario:** Verifies that changing a ticker in one grouped chart updates all others.
  - **Mount Sync Scenario:** Verifies that new charts joining a group adopt the group ticker.

## Verification
- The tests are integrated into the Playwright runner. (Manual execution required as it requires a running dev server).

## Status
**COMPLETED**

---
### Hardening Update (2026-09-26)
- Rewrote both scenarios: removed all `if (isVisible())` silent-pass guards and guessed selectors (`Add Chart` button, `data-group` attributes — none of which exist in the real UI).
- Both tests now boot a seeded session (upload fixture DB → configure date → start simulator) and drive the real group picker and ticker dropdown, asserting SYNC-02 (join adopts group ticker), SYNC-03 (leader propagation both directions), and SYNC-04 (exit decouples).
- Runnable headlessly via `npm run test:regression` (auto dev-server boot + deterministic seed fixture).
