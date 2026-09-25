# Phase 01: Viewport Stabilization - Research

**Researched:** 2026-06-01
**Domain:** Charting Viewport & Data Hydration
**Confidence:** HIGH

## Summary

The "violent viewport jumps" and "single candle snaps" are primarily caused by the asynchronous nature of data loading and the lack of a robust "hydration lock" during chart transitions (ticker/timeframe changes). 

Currently, `useChartLifecycle` attempts to maintain the viewport when data updates, but the transition from "empty chart" to "first batch of data" often triggers a default `scrollToRealTime()` via a `setTimeout` of 80ms. This race condition, combined with `lightweight-charts`' auto-scaling and logical range updates, leads to the perceived "snap".

Infinite scroll prepending is partially handled by `pendingHistoryPrependRef`, but the logical range adjustment is calculated based on the index of the old first candle, which can be imprecise if data is resampled or filtered.

**Primary recommendation:** Implement a formal `HydrationState` (LOCK/UNLOCK) to prevent any viewport movement until data is fully loaded and rendered, and replace the `setTimeout` based `scrollToRealTime` with a deterministic event-driven trigger.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Data Fetching | API/Database | — | `fetchMarketData` and `fetchHistoricalChunk` handle raw data retrieval. |
| Data Resampling | Hooks (Logic) | — | `useChartData` transforms raw bars into timeframe-specific candles. |
| Viewport Control | Browser (Chart API) | Hooks (Lifecycle) | `lightweight-charts` API controls the visible range; `useChartLifecycle` orchestrates the timing. |
| Hydration Locking | Hooks (Lifecycle) | — | Managing the "Loading -> Ready" state to prevent premature scrolling. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| lightweight-charts | 4.x | Core charting engine | Industry standard for high-performance financial charts. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| React | 18.x | UI Framework | Standard project stack. |

**Installation:**
No new packages required.

## Architecture Patterns

### System Architecture Diagram

`[Ticker/TF Change]` $ightarrow$ `[useChartData: Clear Data]` $ightarrow$ `[fetchMarketData]` $ightarrow$ `[useChartData: Set LocalMasterData]` $ightarrow$ `[useChartLifecycle: setData]` $ightarrow$ `[Wait for Render]` $ightarrow$ `[Trigger scrollToRealTime]`

### Recommended Project Structure
Current structure is sufficient. Modifications will be focused in:
- `src/hooks/useChartLifecycle.ts`
- `src/hooks/useChartData.ts`

### Pattern 1: The Hydration Lock
**What:** A state variable `isHydrated` that is set to `false` when ticker/TF changes and `true` only after the first successful `setData` call and a subsequent render cycle.
**When to use:** During any transition that clears the chart data.
**Example:**
```typescript
const [isHydrated, setIsHydrated] = useState(false);
// On ticker change:
setIsHydrated(false);
// After setData:
requestAnimationFrame(() => setIsHydrated(true));
```

### Anti-Patterns to Avoid
- **`setTimeout` for sync:** Using `setTimeout(() => scrollToRealTime(), 80)` is non-deterministic and causes the "snap" if the data arrives slower or faster than 80ms.
- **Manual Index Calculation for Prepends:** Relying on `findIndex` in `useChartLifecycle` for prepending data can be fragile if the data source is modified.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Viewport Scrolling | Custom scroll logic | `timeScale().scrollToRealTime()` | Built-in LWC API is optimized for time-series. |
| Data Resampling | Custom aggregation | `resampleData` (existing lib) | Already handles the project's specific timeframe logic. |

## Common Pitfalls

### Pitfall 1: The "Single Candle" Snap
**What goes wrong:** The chart renders one candle, `scrollToRealTime` triggers, the viewport centers on that candle, then the rest of the data arrives, and the chart scales out violently.
**Why it happens:** `setData` is called, but the internal LWC render loop hasn't completed before the scroll command is issued.
**How to avoid:** Use `requestAnimationFrame` or a specific "data ready" event to ensure the chart has processed the full dataset.

### Pitfall 2: Visual Anchor Drift during Prepend
**What goes wrong:** The chart jumps slightly when old data is prepended.
**Why it happens:** LWC logical ranges are index-based. When data is added to the start, index 0 becomes index N. If the `setVisibleLogicalRange` update doesn't perfectly match the new index of the old first candle, a jump occurs.
**How to avoid:** Use `timeScale().setVisibleLogicalRange` with absolute time values if possible, or ensure the `oldLogicalRange` is captured *immediately* before the update.

## Code Examples

### Deterministic Scroll to End
```typescript
// Source: Analysis of useChartLifecycle.ts
// Proposed change: Replace setTimeout with a more robust check
useEffect(() => {
  if (isHydrated && chartData.length > 0) {
    chartRef.current?.timeScale().scrollToRealTime();
    setIsHydrated(false); // Reset lock
  }
}, [isHydrated, chartData]);
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | LWC `setData` is synchronous in terms of API call, but asynchronous in the rendering process. | Common Pitfalls | If LWC is synchronous, the `setTimeout` is redundant but harmless. |
| A2 | The current `pendingHistoryPrependRef` logic is the root of the drift. | Architecture Patterns | The drift might be caused by something else in the LWC timeScale. |

## Open Questions (RESOLVED)

1. **Exact trigger for Auto-Reveal?**
   - **Decision:** Implement a constant `AUTO_REVEAL_THRESHOLD = 10` (candles).
   - **Rationale:** Based on typical user interaction, 10 candles provides a sufficient buffer to allow users to look back slightly without being snapped forward, while still ensuring they follow the price action when near the edge.
   - **Resolution:** This decision is now integrated into the implementation plan (Task 5).

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements $ightarrow$ Test Map
| Req ID | Behavior | Test Type | Test Case |
|--------|----------|-----------|-------------------|
| STAB-01 | Ticker change $ightarrow$ No snap | integration | `tests/integration/viewport.test.ts` (New) |
| STAB-02 | Prepend data $ightarrow$ No jump | integration | `tests/integration/viewport.test.ts` (New) |
| STAB-03 | Scroll to real time $ightarrow$ After hydration | unit | `tests/hooks/useChartLifecycle.test.ts` (New) |
| STAB-04 | Replay tick $ightarrow$ Stable viewport | integration | `tests/integration/viewport.test.ts` (New) |

### Wave 0 Gaps
- [ ] `tests/integration/viewport.test.ts` — Required to simulate ticker changes and data loading.
- [ ] `tests/hooks/useChartLifecycle.test.ts` — Required to verify the lock mechanism.

## Security Domain
Step 2.6: SKIPPED (no security-related external dependencies identified)

## Sources

### Primary (HIGH confidence)
- Analysis of `src/components/ChartCanvas.tsx`
- Analysis of `src/hooks/useChartLifecycle.ts`
- Analysis of `src/hooks/useChartData.ts`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries added.
- Architecture: HIGH - Based on direct analysis of the current codebase.
- Pitfalls: HIGH - Identified specific race conditions in `useChartLifecycle`.

**Research date:** 2026-06-01
**Valid until:** 2026-07-01
