# Plan: Fixing Chart Selection and Group Syncing Regressions

This plan addresses the regressions in chart selection (click-to-select) and symbol grouping/synchronization.

## Objective
1.  **Restore Selection:** Fix the `onClick` handler and CSS so charts can be selected via click.
2.  **Fix Group Sync:** Ensure symbols sync correctly across grouped charts on mount and during selection.

## Key Files & Context
- `src/components/ChartUnit.tsx`: Outermost container for selection logic.
- `src/components/ChartHeader.tsx`: Header needs to trigger selection.
- `src/components/ChartWorkspace.tsx`: Needs to pass correct group ticker props.
- `src/hooks/useChartData.ts`: Handles the ticker synchronization logic.
- `src/index.css`: Visual feedback for selection.

## Implementation Steps

### Phase 1: Fixing Selection Logic
1.  **Update `ChartHeader.tsx`**:
    - Add `onSelect` to props.
    - Attach `onClick={onSelect}` to the main header `div`.
2.  **Update `ChartUnit.tsx`**:
    - Move `onClick={() => onSelect?.()}` from the outer `.chart-card` to the inner `.chart-panes`.
    - Pass `onSelect` to `ChartHeader`.
    - This ensures that clicking either the header or the canvas selects the chart without being blocked by child `stopPropagation()`.
3.  **Update `index.css`**:
    - Ensure `.chart-card.is-selected` has `border-color: #42a5f5 !important;` (OLED glass theme) and a subtle glow.

### Phase 2: Fixing Group Syncing
1.  **Update `ChartWorkspace.tsx`**:
    - **Crucial Fix:** In the `map` function, change `groupTicker={groupTickers[chartGroups[i]] as string}` to `groupTicker={groupTickers[chartGroups[i] || 'none']}`.
    - This ensures that charts with a group correctly receive the shared ticker state.
2.  **Update `useChartData.ts`**:
    - Modify the "Group-to-Ticker Sync" `useEffect`.
    - Remove the `isFirstRender` block to allow synchronization on mount.
    - Ensure that if `groupTicker` is provided and different from the current `ticker`, it updates immediately.

## Verification
- **Selection:** Click Chart 1 header -> blue border appears. Click Chart 2 canvas -> blue border moves to Chart 2.
- **Group Sync:** Set Chart 1 and Chart 2 to "Red" group. Change Chart 1 to "AAPL" -> Chart 2 should instantly change to "AAPL".
- **Mount Sync:** Refresh page with "Red" group set to "TSLA" -> Both charts should load "TSLA" on start.
