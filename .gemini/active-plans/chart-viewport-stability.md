# Implementation Plan: Chart Loading & Viewport Stability

## 1. Problem Statement
The chart exhibits three critical instability patterns:
1. **The "Last Candle" Snap:** Upon switching tickers or timeframes, the chart often renders only the most recent candle or snaps to a weird position, making it feel like data is missing.
2. **The "Infinite Scroll Jump":** While scrolling back to load historical data, the chart occasionally jumps to the start of the timeline or snaps violently to the end.
3. **The "Wrong Day" Load:** Initial loads sometimes center on an incorrect date or range before correcting itself.

## 2. Root Cause Analysis

### 2.1 The `scrollToRealTime` Race Condition
In `useChartLifecycle.ts`, a `setTimeout(() => ..., 80)` is used to snap the chart to the end. 
- **Issue:** This fires regardless of whether the data is fully hydrated or if the user is in the middle of an infinite scroll load. 
- **Impact:** If `isLoadingHistory` toggles, the `useEffect` runs, fails the `isSameContext` check (or passes it but triggers the `else` block), and forces a snap to the end, interrupting the user's scroll.

### 2.2 Unstable Logical Range Shifting
The history prepending logic calculates a `newFirstIndex` and shifts the `visibleLogicalRange`.
- **Issue:** Logical indices in `lightweight-charts` are volatile when data is prepended. If the range is shifted using a simple index offset without accounting for the exact bar spacing and current viewport state, the chart "jumps".
- **Impact:** Violent viewport shifts during infinite scroll.

### 2.3 Non-Atomic Data Updates
Data is fetched in `useChartData` and passed to `useChartLifecycle`.
- **Issue:** The chart is updated as soon as `chartData` changes. If the resampler or DB query returns partial results first, the chart renders those, then snaps to the end, then updates again.
- **Impact:** Visual flickering and "single candle" loads.

## 3. Proposed Solution: "Deterministic Viewport Management"

### 3.1 Phase 1: The "Initialization Lock"
We will introduce a strict state machine for chart loading to replace `setTimeout`.

- **New State:** `isInitializing` (boolean) in `useChartLifecycle`.
- **Logic:** 
  - When `ticker` or `timeframe` changes, `isInitializing = true`.
  - `scrollToRealTime` is ONLY called when `isInitializing` transitions from `true` $ightarrow$ `false` AND `chartData.length > 0`.
  - Background history loads (`isLoadingHistory`) will **NOT** trigger the initialization lock.

### 3.2 Phase 2: Guarded Viewport Updates
We will rewrite the `useEffect` that handles data updates in `useChartLifecycle.ts` to be "Scroll-Aware".

- **The Fix:** 
  - Separate "Full Reset" (Ticker/TF change) from "Incremental Update" (Infinite Scroll/Replay Tick).
  - If the update is an **Incremental Update**, we strictly preserve the `visibleLogicalRange` and only shift it if we are prepending data.
  - If the update is a **Full Reset**, we clear the series and then apply the `scrollToRealTime` only after the first batch of data is rendered.

### 3.3 Phase 3: Robust History Prepending
Replace index-based shifting with a more stable approach.

- **The Fix:** 
  - Instead of `setVisibleLogicalRange`, we will calculate the exact number of bars added.
  - We will use `timeScale().scrollToPosition()` or a more precise logical shift that accounts for the `oldLogicalRange` relative to the *time* of the first bar, ensuring the visual "anchor" remains fixed.

### 3.4 Phase 4: Atomic Data Handshake
Ensure `useChartData` only emits `chartData` when it is "complete" for the requested window.

- **The Fix:** 
  - Implement a "Data Ready" flag in `useChartData`.
  - `useChartLifecycle` will wait for `dataReady === true` before attempting the initial `scrollToRealTime`.

## 4. Detailed Implementation Steps

### Step 1: Modify `src/hooks/useChartData.ts`
- Add `isInitialLoading` state.
- Set `isInitialLoading = true` at the start of the `load()` function and `false` only after `setLocalMasterData` and `setIsLoadingHistory(false)` are called.
- Return `isInitialLoading` to the component.

### Step 2: Modify `src/hooks/useChartLifecycle.ts` (The Core Fix)
1. **State Update:** Add `isInitializing` ref/state.
2. **Refactor Data Effect:**
   - Split the `useEffect` into two: 
     - `useEffect` for **Context Changes** (Ticker/TF): Sets `isInitializing = true`, clears data, and triggers the final snap.
     - `useEffect` for **Data Updates**: Handles the `setData` calls.
3. **Remove `setTimeout`:** Replace with a logic check: `if (!isInitializing && firstLoadComplete) { ... }`.
4. **Fix Infinite Scroll Shift:**
   - Refine the `pendingHistoryPrependRef` logic to use a more stable shift.
   - Ensure `isLoadingHistory` does not trigger a full viewport reset.

### Step 3: Verification & Testing
- **Test 1 (The Snap):** Rapidly switch between 5 different tickers. Verify that each chart loads its history and snaps to the end *once* without flickering or showing a single candle.
- **Test 2 (The Jump):** Scroll back aggressively to trigger 3-4 history chunks. Verify that the viewport stays anchored and doesn't jump to the start.
- **Test 3 (The Reset):** Trigger a "Reset to Open" while mid-scroll. Verify the transition is smooth.
- **Test 4 (The Date):** Load a ticker on a specific `selectedDate`. Verify the chart starts exactly on that date.

## 5. Expected Outcome
- **Zero "Single Candle" loads.**
- **Rock-solid infinite scroll** with no random jumps.
- **Deterministic loading sequence** where the chart only snaps to the end when it is actually "ready".
