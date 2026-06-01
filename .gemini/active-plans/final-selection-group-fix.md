# Plan: Final Fix for Selection and Grouping Regressions

This plan addresses the persistent issues with chart selection (focus) and symbol grouping (synchronization).

## Objective
1.  **Bulletproof Selection:** Ensure that clicking *anywhere* on a chart unit (including buttons and canvas) immediately selects it.
2.  **Reliable Group Sync:** Ensure that charts in a group are synchronized on mount and during all ticker/group changes.
3.  **Clear Visual Feedback:** Ensure the "Selected" state is unmistakably visible.

## Key Files & Context
- `src/hooks/useChartData.ts`: Ticker sync logic.
- `src/components/ChartUnit.tsx`: Selection event handling and visual state.
- `src/index.css`: Selection styling.

## Implementation Steps

### Phase 1: Robust Selection Capture
1.  **Update `ChartUnit.tsx`**:
    - Add `onMouseDownCapture` to the outermost `.chart-card` container.
    - This ensures the selection logic fires during the **Capture Phase** (top-down), before any child element (ticker search, dropdowns) can call `e.stopPropagation()`.
    - Example: `<div onMouseDownCapture={() => onSelect?.()} ...>`
    - Remove the redundant `onClick` handlers from `.chart-header` and `.chart-panes`.

### Phase 2: Fixing Group Sync on Mount
1.  **Update `useChartData.ts`**:
    - Initialize `prevGroupTickerRef` with `null` instead of `groupTicker`.
    - This forces the `useEffect` to detect a difference between `groupTicker` (which is often a string like "SPY") and the ref on the very first render, triggering a sync to the correct group symbol immediately.

### Phase 3: Visual Polish (The "White" Border Fix)
1.  **Update `index.css`**:
    - Increase the `box-shadow` intensity and border-width for `.is-selected` to ensure it's high-contrast in the OLED theme.
    - Ensure `.is-selected` has a higher `z-index` to prevent neighbors from overlapping its border.
2.  **Update `ChartUnit.tsx`**:
    - Ensure `borderTop` (group color) doesn't completely mask the `is-selected` glow. (The glow is a box-shadow, so it should be fine).

## Verification
- **Cold Boot Sync:** Refresh page with 2 charts in "Red" group (SPY). Change one to AAPL. Refresh again. Both should show AAPL.
- **Click anywhere selection:** 
    - Click the ticker name -> Chart should select.
    - Click a timeframe button -> Chart should select.
    - Click the gear icon -> Chart should select.
    - Click the chart canvas -> Chart should select.
- **Visuals:** Selected chart should have a distinct blue glow.
