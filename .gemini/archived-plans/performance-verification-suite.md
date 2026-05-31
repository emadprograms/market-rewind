# Plan: Rigorous Performance Verification Suite

## Objective
Provide mathematical and empirical proof that the 1-minute chart interaction lag has been eliminated by verifying the Big-O complexity of rendering and the elimination of the React render storm.

## Scope
This suite moves beyond micro-benchmarks to system-level verification of `SessionShadingPlugin` and `useChartLifecycle`.

---

## Test 1: Slicing Complexity & Boundaries (`slicing.perf.test.ts`)

**Goal:** Prove that `SessionShadingPlugin._getViewData()` complexity is $O(	ext{VisibleBars})$ and handles edge cases gracefully.

**Setup:**
- Mock `ISeriesApi` to return two different datasets:
    - Dataset A: 100 bars.
    - Dataset B: 100,000 bars.
- Mock `ITimeScaleApi` to return a `visibleLogicalRange` of 100 bars (e.g., `from: 0, to: 100`).

**Execution:**
1. **Complexity Check:** Measure execution time of `_getViewData()` for Dataset A vs Dataset B using `process.hrtime.bigint()`.
2. **Boundary Check (Far Out):** Set `visibleLogicalRange` to indices completely outside the data (e.g., `-500` to `-400`). Verify an empty array is returned immediately without errors.

**Success Criteria:**
- Dataset B execution time must be within a small constant factor (e.g., < 2x) of Dataset A.
- Boundary checks must return `[]` without attempting to iterate over the full dataset.

---

## Test 2: Cache Efficiency Validation (`cache.perf.test`)

**Goal:** Prove that the plugin's internal cache prevents redundant calculations during stable viewports.

**Setup:**
- Instantiate `SessionShadingPlugin` with a standard dataset.
- Mock `ITimeScaleApi` to provide a stable `visibleLogicalRange`.

**Execution:**
1. **Cold Start:** Call `_getViewData()` and measure time ($T_1$) via `process.hrtime.bigint()`.
2. **Warm Hit:** Call `_getViewData()` immediately again with the same range and measure time ($T_2$).
3. **Cache Miss:** Change the `visibleLogicalRange` slightly, call `_getViewData()` and measure time ($T_3$).

**Success Criteria:**
- $T_2$ must be near-instant ($T_2 \approx 0$), proving the cache hit.
- $T_3$ should be comparable to $T_1$.

---

## Test 3: React Render-Cycle & State Stability (`render.perf.test.ts`)

**Goal:** Prove that panning the chart no longer triggers full React component re-renders, except when functional state changes.

**Setup:**
- Use `@testing-library/react` to render a mock component utilizing `useChartLifecycle`.
- Use a ref-based counter in the component body to track render counts.
- Mock the `IChartApi` and its `timeScale().subscribeVisibleLogicalRangeChange` method.

**Execution:**
1. **Stability Check:** Simulate a pan within the "End" zone (e.g., index moves $1000.1 	o 1000.5$). Verify **0** re-renders occur.
2. **Threshold Check:** Simulate crossing the `isAtEnd` threshold (e.g., $1000.5 	o 999.4$). Verify exactly **1** re-render occurs.
3. **Stress Pan:** Trigger the range change callback 100 times within a stable zone. Verify **0** re-renders.

**Success Criteria:**
- Render count must be 0 during stable pans.
- Exactly 1 render occurs per `isAtEnd` state flip.

---

## Test 4: Memory & Allocation Stability (`allocation.perf.test.ts`)

**Goal:** Verify that `Intl.DateTimeFormat` is truly a singleton and not re-instantiated during render loops.

**Setup:**
- Use `vi.spyOn(Intl, 'DateTimeFormat')`.

**Execution:**
1. Run a loop that triggers `getSessionType` 1,000 times.
2. Check the call count of the `Intl.DateTimeFormat` constructor.

**Success Criteria:**
- The constructor must be called **0 times** during the loop (since the singleton is created at module load).

---

## Summary of Metrics for "Pass"

| Test | Metric | Expected Result |
| :--- | :--- | :--- |
| **Slicing** | $T(100	ext{k bars}) / T(100	ext{ bars})$ | $\approx 1$ |
| **Cache** | $T(	ext{Warm Hit}) / T(	ext{Cold Start})$ | $\approx 0$ |
| **Renders** | Renders per 100 stable range updates | $0$ |
| **Memory** | `Intl.DateTimeFormat` calls per loop | $0$ |
