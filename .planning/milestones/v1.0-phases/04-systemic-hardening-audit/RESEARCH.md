# Phase 04: Systemic Hardening & Audit - Research

**Researched:** 2026-06-02
**Domain:** Systemic Architecture, Technical Debt, and Maintainability
**Confidence:** HIGH

## Summary

The `market-rewind` project has reached a state of "stabilized fragility." While Phases 01-03 resolved immediate viewport and synchronization bugs, the underlying implementation is characterized by high coupling and manual state synchronization. 

The primary source of fragility is the **`useChartLifecycle` hook**, a "god-hook" (>600 lines) that orchestrates everything from chart creation and plugin management to complex viewport range shifts and drawing interactions. This monolith makes the system prone to regressions; a change in "Auto-Reveal" logic can unexpectedly break "Infinite Scroll Prepending" because both share the same scope and mutate the same chart API.

**Primary recommendation:** Decompose `useChartLifecycle` into four specialized managers (`ChartInitializer`, `PluginManager`, `DrawingManager`, and `ViewportController`) and migrate the main-thread `sql.js` operations to a Web Worker to eliminate UI stutters.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Chart Rendering | Browser / Client | — | Handled by `lightweight-charts` canvas. |
| Data Resampling | Logic Layer | — | `resampleData` utility transforms raw DB data to timeframe-specific bars. |
| Replay Synchronization | State Layer | Logic Layer | `usePlaybackStore` provides the time; filtered by `useChartData`. |
| DB Query Execution | Worker Thread | Data Layer | **Proposed**: Move `sql.js` execution to Worker to avoid main-thread blocking. |
| Drawing State | State Layer | Logic Layer | Managed in `useWorkspaceStore` and passed via props to plugins. |
| Viewport Control | Logic Layer | Browser / Client | Orchestrated by `ViewportController` (proposed) using `setVisibleLogicalRange`. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.3.1 | UI Framework | Project standard. |
| TypeScript | 6.0.3 | Type Safety | Primary language. |
| lightweight-charts | 4.2.1 | Financial Charting | Core visualization engine. |
| Zustand | 5.0.14 | State Management | Global playback and workspace state. |
| sql.js | 1.10.3 | Local Database | WASM-based SQLite. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | 4.1.7 | Unit/Integration Testing | Primary test runner. |
| Playwright | 1.60.0 | E2E Testing | Visual and interaction testing. |

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| lightweight-charts | npm | 6+ yrs | High | tradingview/lightweight-charts | [OK] | Approved |
| zustand | npm | 4+ yrs | High | pmndrs/zustand | [OK] | Approved |
| sql.js | npm | 8+ yrs | Medium | sql-js/sql.js | [OK] | Approved |

## Architecture Patterns

### System Architecture Diagram (Proposed Refactor)

```text
[User Input] 
      │
      ▼
[useWorkspaceStore] ───► [useChartData] ───► [DatabaseWorker] ──► [sql.js]
      │                          │                                  │
      │                          ▼                                  ▼
      │                  [resampleData (lib)] ◄──────────────── [Raw DB Data]
      │                          │
      │                          ▼
      │             ┌─── [useChartLifecycle (Orchestrator)] ───┐
      │             │            │            │                │
      │             ▼            ▼            ▼                ▼
      │      [ChartInit]   [PluginMgr]   [DrawingMgr]    [ViewportCtrl]
      │             │            │            │                │
      │             └────────────┴─────┬──────┴────────────────┘
      │                                │
      │                                ▼
      │                  [lightweight-charts Canvas]
      │                          │
      │                          └─► [Plugins: Shading, VP, Rays, Rects]
```

### Recommended Project Structure
```
src/
├── components/      # Pure UI
├── hooks/           # Orchestration
│   ├── chart/       # Decomposed chart logic
│   │   ├── useChartInit.ts       # Base config & series creation
│   │   ├── useChartPlugins.ts    # Lifecycle of plugins
│   │   ├── useChartDrawings.ts   # Event listeners for rays/rects
│   │   └── useChartViewport.ts   # Range shifting & auto-reveal
│   └── useChartLifecycle.ts      # Thin orchestrator
├── lib/             # Pure logic / DB / Plugins
│   └── workers/
│       └── db.worker.ts          # SQL.js execution context
└── store/           # Global state
```

### Decomposition Plan: `useChartLifecycle`

| New Hook | Responsibilities | Key API / State |
|----------|------------------|-----------------|
| `useChartInit` | `createChart`, setup `localization`, `timeScale` configs, `addCandlestickSeries`, `addHistogramSeries`. | `chartRef`, `priceSeriesRef` |
| `useChartPlugins` | Attach/detach `SessionShading`, `VolumeProfile`, `HorizontalRay`, `Rectangle`, `Trade`. Sync plugin state (e.g., `setEnabled`). | `pluginRefs` |
| `useChartDrawings` | `subscribeClick`, `subscribeDblClick`, `subscribeCrosshairMove`. Logic for ray/rect creation and deletion. | `onUpdateDrawings` |
| `useChartViewport` | `setVisibleLogicalRange`, `scrollToRealTime`, prepend-history shifting, auto-reveal logic. | `lastDataCountRef`, `pendingHistoryPrependRef` |

### Anti-Patterns to Avoid

- **Manual Ref Synchronization (HOTSPOT):** Using `useRef` to track `lastTicker`, `lastTf`, etc., to manually calculate diffs in `useEffect`. 
  - *Fix:* Use a declarative state machine or a custom `usePrevious` hook paired with a reducer for viewport transitions.
- **Main-Thread DB Blocking:** Calling `db.exec` on the main thread.
  - *Fix:* Move to a Web Worker.
- **Type Erosion in Plugins:** Using `target: any` and `scope: any` in `ISeriesPrimitivePaneRenderer.draw`.
  - *Fix:* Define `ChartTarget` and `ChartScope` interfaces based on `lightweight-charts` internal structures to remove `any`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State Transitions | Complex `if/else` for replay/loading/hydrated | Simple State Machine (XState or Reducer) | Prevents "impossible states" (e.g., hydrating while loading history). |
| Date Parsing | `d.time.replace(' ', 'T') + 'Z'` | `date-fns` or `dayjs` | The current string replacement is brittle across different environments. |

## Common Pitfalls

### Pitfall 1: The Viewport Collision
**What goes wrong:** The "Auto-Reveal" logic and "Prepend History" logic both call `setVisibleLogicalRange` in the same render cycle, causing one to overwrite the other.
**Why it happens:** Both reside in the same `useChartLifecycle` scope and compete for the `timeScale` API.
**How to avoid:** Centralize all viewport mutations into a `ViewportController` that queues updates or prioritizes them (Prepend > Auto-Reveal).

### Pitfall 2: Plugin Memory Leaks
**What goes wrong:** Plugins are attached but not properly detached or cleaned up on ticker changes, leading to orphaned event listeners.
**Why it happens:** Inconsistent `detached()` implementation and reliance on `useEffect` cleanup.
**How to avoid:** Implement a strict `PluginManager` that ensures `detached()` is called for every attached primitive.

## Code Examples

### Proposed Viewport Controller Interface
Instead of scattered `setVisibleLogicalRange` calls:
```typescript
interface ViewportController {
  shiftRight(bars: number): void;
  anchorToPoint(time: Time): void;
  maintainPositionOnPrepend(newFirstIndex: number): void;
  scrollToRealTime(): void;
}
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `useChartLifecycle` is the primary source of fragility | Summary | If fragility is actually in `useChartData`, decomposition won't fix it. |
| A2 | `sql.js` causes main-thread blocking | Anti-Patterns | If the DB is small enough, Worker overhead might exceed the benefit. |
| A3 | `lightweight-charts` internal types are stable enough for interfaces | Anti-Patterns | If internals change frequently, custom interfaces will break. |

## Open Questions (RESOLVED)

1. **How to handle `sql.js` Worker communication efficiently?**
   - **Resolution**: Return `RawBar[]` from the worker to keep the main thread logic simple and avoid complex serialization of sql.js internal objects.
   - Recommendation: Return `RawBar[]` from worker to keep the main thread "dumb".

2. **Should `useChartData` also be decomposed?**
   - **Resolution**: Keep for now, but separate `resampleData` into a pure utility to allow for easier testing and potential future migration to a worker.
   - Recommendation: Keep for now, but separate `resampleData` into a pure utility.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Web Workers | DB Migration | ✓ | — | Main thread (current) |
| OPFS | DB Persistence | ✓ | — | In-memory DB |
| WASM | sql.js | ✓ | — | — |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUAL-03 | `FRAGILITY.md` Map | doc | N/A | ❌ Wave 0 |
| QUAL-04 | God-Hook Decomposition | unit | `vitest run tests/unit/hooks/chart/*` | ❌ Wave 0 |
| STAB-02 | Prepend Stability | integration | `vitest run tests/integration/viewport.test.ts` | ✅ Existing |
| HARD-01 | No Main-Thread DB Block | perf | `vitest run tests/performance/db.perf.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/hooks/chart/useChartInit.test.ts` — verify base setup.
- [ ] `tests/unit/hooks/chart/useChartViewport.test.ts` — verify range logic in isolation.
- [ ] `tests/performance/db.perf.test.ts` — benchmark main-thread vs worker DB access.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Ticker/Timeframe validation in `useWorkspaceStore`. |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL Injection | Tampering | Parameterized queries in `db.ts` (already implemented). |
| XSS | Spoofing | React's default escaping. |

## Sources

### Primary (HIGH confidence)
- `src/hooks/useChartLifecycle.ts` - Deep analysis of complexity.
- `src/hooks/useChartData.ts` - Analysis of data flow.
- `src/lib/db.ts` - Analysis of `sql.js` implementation.
- `src/lib/*Plugin.ts` - Review of primitive implementations.
- `package.json` - Dependency versions.

### Secondary (MEDIUM confidence)
- Official `lightweight-charts` documentation regarding primitives.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Verified.
- Architecture: HIGH - Based on direct code reading of the "god-hook".
- Pitfalls: HIGH - Specifically identified in the current implementation.

**Research date:** 2026-06-02
**Valid until:** 2026-06-30
