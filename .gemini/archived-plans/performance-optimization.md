# Implementation Plan: 1-Minute Chart Performance Optimization

## Objective
Eliminate UI lag and stuttering during chart interactions (panning/zooming) on 1-minute timeframes by removing expensive JS operations and redundant React re-renders.

## Key Files & Context
- `src/lib/SessionShading.ts`: Contains high-frequency date formatting and inefficient data mapping.
- `src/hooks/useChartLifecycle.ts`: Contains a high-frequency state update causing global re-renders.
- `src/lib/VolumeProfilePlugin.ts`: secondary area for cache optimization.

---

## Implementation Steps

### Phase 1: Optimize `SessionShadingPlugin` (`src/lib/SessionShading.ts`)

#### 1.1 Singleton Date Formatter
- **Current:** `Intl.DateTimeFormat` is instantiated inside `getSessionType`, which is called for every bar on every frame.
- **Change:** Move the `formatter` constant to the top-level scope of the file.
- **Goal:** Reduce CPU overhead by eliminating thousands of object instantiations per second.

#### 1.2 Visible Range Slicing
- **Current:** `_getViewData` maps the entire `this._series.data()` array to create coordinate objects, regardless of visibility.
- **Change:** Use `visibleRange.from` and `visibleRange.to` to slice the data array *before* mapping.
- **Goal:** Change complexity from $O(TotalBars)$ to $O(VisibleBars)$.

#### 1.3 Calculation Caching
- **Current:** `_getViewData` re-calculates everything on every call.
- **Change:** Implement a cache that stores the result of `_getViewData`. Invalidate the cache only when `visibleRange` or `barSpacing` changes significantly.
- **Goal:** Avoid redundant coordinate calculations during stable viewports.

#### 1.4 Pre-calculate Session Types
- **Current:** `getSessionType` is called during the `draw()` loop.
- **Change:** Move the session type determination into the `_getViewData` mapping phase. Store the `type` ('PRE', 'RTH', etc.) on the bar object.
- **Goal:** Ensure the `draw()` method performs only simple canvas operations.

---

### Phase 2: Reduce React Re-render Frequency (`src/hooks/useChartLifecycle.ts`)

#### 2.1 Eliminate High-Frequency State Ticks
- **Current:** `subscribeVisibleLogicalRangeChange` calls `setChartUpdateTick(t => t + 1)`, triggering a full React component re-render on every pixel of movement.
- **Change:** Remove the `setChartUpdateTick` call from this listener.
- **Goal:** Stop "State Storms" that block the main thread during interaction.

#### 2.2 Throttled `isAtEnd` Updates
- **Current:** `setIsAtEnd` is called on every range change.
- **Change:** Wrap the `setIsAtEnd` logic in a check to only update state when the value actually changes (`if (isAtEnd !== newValue) setIsAtEnd(newValue)`).
- **Goal:** Minimize React render cycles to only when functional UI state changes.

---

### Phase 3: `VolumeProfilePlugin` Polish (`src/lib/VolumeProfilePlugin.ts`)

#### 3.1 Cache Robustness
- **Change:** Refine the `_lastLogicalRange` comparison in `_getViewData` to ensure that tiny floating-point shifts don't trigger full re-binning of volume data.
- **Goal:** Stabilize the VP render during slow pans.

---

## Verification & Testing

### 1. Performance Profiling (The "Proof")
- **Baseline:** Use Chrome DevTools Performance tab to record a 5-second drag. Note the "Long Tasks" (red bars) and the number of `Intl` object creations.
- **Post-Fix:** Record the same action. Verify that "Long Tasks" have disappeared and the frame rate stays near 60 FPS.

### 2. Functional Regression
- **Session Shading:** Verify that PRE/RTH/POST shading still appears correctly and aligns with the bars.
- **UI Elements:** Verify that the "Scroll to End" button still appears/disappears correctly when reaching the end of the data.
- **Plugin Toggles:** Toggle "Extended Hours" and "Volume Profile" to ensure they still respond immediately.

### 3. Stress Test
- Load a chart with >10,000 bars on a 1-minute timeframe and pan rapidly. Verify no stuttering occurs.
