# Phase 03: Stability Guardrails - Research

**Researched:** 2025-05-22
**Domain:** Automated Regression Testing (Viewport & Synchronization)
**Confidence:** HIGH

## Summary

This research focuses on establishing automated guardrails for two critical stability domains: Viewport Stability (QUAL-01) and Group Synchronization (QUAL-02). The goal is to move from manual verification to a deterministic, automated suite that prevents regressions in the complex interactions between data fetching, chart rendering, and workspace state.

The primary technical challenge is that `lightweight-charts` is a canvas-based library, making traditional DOM-based assertions (like `screen.getByText`) useless for verifying visual positioning. We must rely on mocking the chart API and asserting on the calls made to `setVisibleLogicalRange` and `scrollToRealTime`, or implement high-level integration tests that simulate the data-flow cycles.

**Primary recommendation:** Use a hybrid testing strategy combining **Vitest with deep API mocking** for logical stability (range calculations) and **Playwright** for visual stability (canvas state and synchronization), leveraging a custom "Simulation Driver" to bypass UI flakiness.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Viewport Range Calc | API / Backend | Browser | Calculated based on data length and current range; enforced via API calls to the chart |
| Scroll Anchoring | Browser / Client | — | Managed by `useChartLifecycle` reacting to data prepends |
| Ticker Sync | API / Backend | Browser | Store-driven; `useWorkspaceStore` triggers re-renders in all grouped components |
| Group Membership | Browser / Client | — | Purely a state management concern in `useWorkspaceStore` |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vitest | ^2.0.0 | Unit/Integration tests | Fast, native ESM support, matches project current setup |
| @testing-library/react | ^16.0.0 | Component mounting | Standard for React hook/component testing |
| Playwright | ^1.40.0 | E2E / Visual Regression | Best-in-class for browser automation and canvas snapshots |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| msw | ^2.0.0 | API Mocking | To simulate data prepends and ticker changes deterministically |

**Installation:**
```bash
npm install -D playwright @playwright/test msw
npx playwright install
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| playwright | npm | 4 yrs | 10M+/wk | microsoft/playwright | [ASSUMED] | Approved |
| msw | npm | 5 yrs | 1M+/wk | mswjs/msw | [ASSUMED] | Approved |

*slopcheck was unavailable at research time, all packages above are tagged `[ASSUMED]` and the planner must gate each install behind a `checkpoint:human-verify` task.*

## Architecture Patterns

### Recommended Project Structure
```
tests/
├── regression/
│   ├── viewport/
│   │   ├── stability.test.ts      # Logical range assertions (Vitest)
│   │   └── visual.spec.ts         # Visual snapshot tests (Playwright)
│   └── sync/
│       ├── grouping.test.ts       # Store propagation tests (Vitest)
│       └── propagation.spec.ts    # Multi-chart sync tests (Playwright)
└── helpers/
    └── chart-simulation.ts        # Mock implementations of lightweight-charts
```

### Pattern 1: API-Driven Range Assertion
Instead of checking pixels, we assert that the correct `logicalRange` is requested from the chart when data changes.
**Example:**
```typescript
// Assert that prepend preserves range
const oldRange = { from: 10, to: 110 };
const newDataLength = 150; // 50 bars prepended
expect(mockTimeScale.setVisibleLogicalRange).toHaveBeenCalledWith({
  from: 10 + 50, 
  to: 110 + 50
});
```

### Anti-Patterns to Avoid
- **Pixel-based testing for ranges:** Canvas coordinates change based on window size; always test against `logicalRange`.
- **`waitForTimeout` for sync:** Use `await screen.findBy...` or Playwright's auto-waiting to avoid flakiness in group propagation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Browser Automation | Custom Puppeteer scripts | Playwright | Built-in auto-waiting, better trace viewer, and multi-browser support |
| API Interception | Manual `fetch` overrides | MSW | Declarative handlers and better integration with Vitest |

## Common Pitfalls

### Pitfall 1: The "One-Render-Later" Lag
**What goes wrong:** Ticker changes propagate to the store, but the chart doesn't update until the next tick, causing tests to fail.
**Why it happens:** React batching and the asynchronous nature of `lightweight-charts` initialization.
**How to avoid:** Use `act()` in Vitest and `expect().toPass()` or `waitFor` in Playwright.

### Pitfall 2: Mocking the "God Hook"
**What goes wrong:** Trying to mock `useChartLifecycle` completely makes the test a "test of the mock".
**Why it happens:** The hook is too large and does too many things.
**How to avoid:** Mock the *underlying library* (`lightweight-charts`), not the hook. This ensures we test the actual logic inside the hook.

## Code Examples

### Viewport Stability Simulation (Vitest)
```typescript
// Simulation of STAB-02: Infinite Scroll Prepend
it('should shift logical range when data is prepended', async () => {
  const { result } = renderHook(() => useChartLifecycle({ ...params }));
  
  // 1. Setup initial state
  act(() => { params.chartData = initialData; }); 
  const initialRange = { from: 0, to: 100 };
  mockTimeScale.getVisibleLogicalRange.mockReturnValue(initialRange);

  // 2. Simulate prepend
  act(() => {
    params.pendingHistoryPrependRef.current = {
      oldFirstTime: initialData[0].time,
      oldLogicalRange: initialRange
    };
    params.chartData = [...prependedData, ...initialData];
  });

  expect(mockTimeScale.setVisibleLogicalRange).toHaveBeenCalledWith({
    from: initialRange.from + prependedData.length,
    to: initialRange.to + prependedData.length
  });
});
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Playwright is compatible with current CI/Environment | Standard Stack | Installation failure during execution |
| A2 | `lightweight-charts` can be effectively mocked via API | Architecture Patterns | Tests become flaky or untrustworthy |

## Open Questions

1. **Visual Snapshots**: Should we use Playwright's `toHaveScreenshot` for the charts, or is it too unstable due to varying data?
   - Recommendation: Use it only for "Empty State" or "Static Data" snapshots. For dynamic stability, rely on API assertions.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All Tests | ✓ | v24.16.0 | — |
| npm | Package Mgmt | ✓ | 11.13.0 | — |
| Browser | Playwright | ✓ | — | Headless Chromium |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest + Playwright |
| Config file | `vitest.config.ts` / `playwright.config.ts` |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm run test:regression` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUAL-01 | ViewportStability | Integration | `vitest tests/regression/viewport/stability.test.ts` | ❌ Wave 0 |
| QUAL-02 | GroupSync | Integration | `vitest tests/regression/sync/grouping.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:unit`
- **Per wave merge:** `npm run test:regression`
- **Phase gate:** Full regression suite green before `/gsd:verify-work`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Ticker validation in `useWorkspaceStore` |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via Ticker | Tampering | Strict alphanumeric regex in `validateTicker` |

## Sources

### Primary (HIGH confidence)
- codebase: `src/hooks/useChartLifecycle.ts` - Logic for range shifting and hydration.
- codebase: `src/store/useWorkspaceStore.ts` - Logic for group ticker propagation.
- official docs: `tradingview.github.io/lightweight-charts` - API for `setVisibleLogicalRange`.

### Secondary (MEDIUM confidence)
- codebase: `tests/integration/viewport.test.ts` - Existing race-condition test pattern.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Standard JS testing tools.
- Architecture: HIGH - Based on canvas-specific testing constraints.
- Pitfalls: MEDIUM - Derived from common React/Canvas integration issues.

**Research date:** 2025-05-22
**Valid until:** 2025-06-22
