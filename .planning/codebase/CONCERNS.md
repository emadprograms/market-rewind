# Codebase Concerns

**Analysis Date:** 2026-06-01

## Tech Debt

**Chart Lifecycle Management:**
- Issue: `src/hooks/useChartLifecycle.ts` has become a "God Hook", managing initialization, resize observers, event handlers, data synchronization, and timezone formatting in a single file.
- Files: `src/hooks/useChartLifecycle.ts`
- Impact: High complexity makes the charting logic difficult to test, maintain, and extend. A bug in one area (e.g., drawing) can easily affect another (e.g., data rendering).
- Fix approach: Decompose the hook into smaller, specialized hooks: `useChartInit`, `useChartEvents`, `useChartDataSync`, and `useChartFormatting`.

**Race Condition Handling:**
- Issue: Use of `setTimeout` to force `scrollToRealTime` after data loading.
- Files: `src/hooks/useChartLifecycle.ts` (line 349)
- Impact: Fragile timing-dependent behavior. May fail on slower devices or with larger datasets.
- Fix approach: Implement a proper callback or promise-based synchronization mechanism that triggers once the chart library has finished rendering the provided data.

**Simplified Trade Logic:**
- Issue: Hardcoded 1% offset for SL/TP placement.
- Files: `src/hooks/useTradeManager.ts` (line 42)
- Impact: Unrealistic trade simulations. Not suitable for high-volatility assets or different timeframes.
- Fix approach: Implement dynamic offset calculation based on Average True Range (ATR) or allow user-defined offset percentages.

## Known Bugs

**Event Subscription Stability:**
- Symptoms: Potential memory leaks or "unsubscribe" errors requiring `try-catch` wrappers.
- Files: `src/hooks/useChartLifecycle.ts` (line 238)
- Trigger: Rapid ticker or timeframe changes causing frequent mount/unmount cycles of the chart lifecycle.
- Workaround: Wrapped in `try-catch` to prevent app crashes during cleanup.

## Security Considerations

**WASM Integrity:**
- Risk: `sql-wasm.wasm` is fetched from the root without Subresource Integrity (SRI) hashes.
- Files: `src/lib/db.ts` (line 11)
- Current mitigation: None.
- Recommendations: Add SRI hashes to the fetch request or move the WASM loading to a more controlled build-time asset pipeline.

**OPFS Memory Usage:**
- Risk: Loading entire SQLite databases into memory via `arrayBuffer()`.
- Files: `src/lib/db.ts` (line 23)
- Current mitigation: Uses OPFS for persistence.
- Recommendations: Explore using a streaming approach or a database engine that supports partial loading/paging from disk to avoid browser tab crashes with multi-gigabyte databases.

## Performance Bottlenecks

**Data Transformation Overhead:**
- Problem: `chartData` is mapped to `VPDataBar` and other formats on every render cycle.
- Files: `src/hooks/useChartLifecycle.ts` (line 265)
- Cause: O(n) transformation inside a hook that triggers frequently.
- Improvement path: Memoize the formatted data using `useMemo` and only re-calculate when the raw `chartData` reference actually changes.

**Large File I/O:**
- Problem: Reading the entire `.db` file from OPFS into a `Uint8Array`.
- Files: `src/lib/db.ts` (line 25)
- Cause: Synchronous-like load of the entire database binary.
- Improvement path: Use a more efficient database driver that doesn't require the full binary in memory.

## Fragile Areas

**Drawing Synchronization:**
- Files: `src/hooks/useChartLifecycle.ts`
- Why fragile: The sync between the `drawings` state and the individual plugins (`HorizontalRayPlugin`, `RectanglePlugin`) is handled by multiple interdependent `useEffect` hooks.
- Safe modification: Centralize plugin updates into a single "Sync" coordinator or a custom event bus.
- Test coverage: Gaps in integration tests for complex drawing interactions (e.g., deleting rays while zooming).

## Test Coverage Gaps

**Chart Interaction Testing:**
- What's not tested: Mouse interaction logic (click, dbl-click, drag) for drawing and trade management.
- Files: `src/hooks/useChartLifecycle.ts`, `src/hooks/useTradeManager.ts`
- Risk: Regressions in drawing/trading UX are likely and hard to detect without manual testing.
- Priority: High
