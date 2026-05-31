# Future Plans: Repository Future-Proofing & Stability

To ensure `market-rewind` remains stable as its complexity increases, the following engineering initiatives are proposed. The goal is to move from manual verification to **automated enforcement**.

## 1. Automated Quality Gate (GitHub CI)
Currently, code quality is verified manually via `npm run test`. We should implement a CI pipeline to prevent regressions from reaching the `main` branch.

*   **Workflow:** `.github/workflows/ci.yml`
*   **Actions:**
    *   **Linting:** Ensure code adheres to styling rules.
    *   **Type Safety:** Run `tsc --noEmit` to catch silent type mismatches.
    *   **Unit/Integration Tests:** Run the existing Vitest suite.
*   **Enforcement:** Block merges if any check fails.

## 2. End-to-End (E2E) Regression Testing
Since the application relies heavily on DOM-specific interactions (resizing, canvas rendering, OPFS access), logic tests are insufficient.

*   **Tool:** [Playwright](https://playwright.dev/)
*   **Key Scenarios:**
    *   **The "First Run" Flow:** Verify DB upload and session configuration.
    *   **Layout Resilience:** Change layouts (1 to 4 charts) and verify all canvases mount correctly.
    *   **Multi-Chart Sync:** Verify that changing a ticker in one group-member updates the others.
    *   **Trade Execution:** Simulate a buy/sell and verify the `TradeBadge` appears and tracks correctly.

## 3. Visual Regression Testing
The high-density "Grid-4" layout is sensitive to CSS changes. A minor tweak in `index.css` could break the UI in smaller viewports.

*   **Tool:** Playwright Visual Comparisons.
*   **Strategy:** Capture "Golden Snapshots" of the 4-chart layout and Chart Header. Fail builds if CSS changes cause unintended pixel shifts or element overlaps.

## 4. OPFS Schema & Migration Strategy
As a local-first application, changes to the data fetching or resampling logic could cause issues with cached data in the browser's Origin Private File System (OPFS).

*   **Strategy:** Implement a `SCHEMA_VERSION` constant in `src/lib/db.ts`.
*   **Behavior:** On app load, compare the current app version with the version stored in the local DB. If a mismatch is detected, trigger a controlled migration or cache invalidation to prevent "bricking" the user's session.

## 5. Performance Budgets
To prevent the "State Storm" issues from returning, we should enforce performance budgets.

*   **Metric:** Maximum React re-renders during a 10-second chart pan.
*   **Metric:** Maximum frame time (aim for <16ms for 60FPS) during high-frequency resampling.
*   **Tool:** Custom performance benchmarks (extending `tests/performance/`).
