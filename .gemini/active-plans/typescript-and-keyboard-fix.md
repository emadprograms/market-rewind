# Plan: Fixing TypeScript Errors and Keyboard Logic

This plan addresses the keyboard shortcut regression and resolves the 41 TypeScript errors across the codebase.

## Objective
1.  **Fix Keyboard Regression:** Ensure ticker/timeframe switching is smooth, captures all characters, and supports TradingView-style parsing.
2.  **Resolve Type Errors:** Fix ref mismatches, missing props, and breaking changes from `lightweight-charts` v4 updates.
3.  **Global Selection System:** Implement a focused-chart state so shortcuts "always work" regardless of mouse position.

## Key Files & Context
- `src/hooks/useKeyboardShortcuts.ts`: Keyboard event handling.
- `src/components/ChartUnit.tsx`: Modal logic and props.
- `src/lib/*.ts`: `lightweight-charts` plugins (HorizontalRay, Rectangle, etc.).
- `src/types/index.ts`: Central type definitions.
- `src/lib/parsing.ts`: NEW centralized parsing utility.
- `src/hooks/useWorkspace.ts`: Workspace and selection state.

## Implementation Steps

### Phase 1: Keyboard Logic [DONE]
1.  **[x] Centralize Parsing:** Created `src/lib/parsing.ts` to handle unified ticker and timeframe parsing (e.g., `5m`, `1h`).
2.  **[x] Update `useKeyboardShortcuts.ts`:**
    - Captured subsequent keystrokes before input focus.
    - Supported Backspace/Delete in the pre-focus period.
3.  **[x] Update `ChartUnit.tsx`:**
    - Used the centralized parsing utility for input handling.
    - Added a small delay to `onBlur` to prevent accidental closure.

### Phase 2: Ref & Prop Type Alignment [DONE]
1.  **[x] Relax Ref Types:** Updated `useKeyboardShortcuts`, `useChartLifecycle`, `useTradeManager`, and `ChartCanvas` to accept `React.RefObject<T | null>`.
2.  **[x] Implement Null Guards:** Ensured all usages of these relaxed refs are guarded by strict null checks.
3.  **[x] Fix Component Props:** Updated `ChartWorkspace.tsx` and `App.tsx` to pass the required `onTimeframeChange` prop to `ChartUnit`.

### Phase 3: Lightweight Charts v4 API Compatibility [DONE]
1.  **[x] Update Plugin Interfaces:** In `HorizontalRayPlugin.ts`, `RectanglePlugin.ts`, `SessionShading.ts`, `TradePlugin.ts`, and `VolumeProfilePlugin.ts`:
    - Replaced deprecated types with v4 counterparts.
2.  **[x] Fix Drawing Type Incompatibility:** Unified all drawings to use the `Time` type (Unix timestamps) for consistency.
3.  **[x] Null Checks:** Added null checks for `param.point` in `useChartLifecycle.ts` mouse move handlers.

### Phase 4: Miscellaneous Fixes [DONE]
1.  **[x] Main Entry:** Fixed null check for `document.getElementById('root')` in `src/main.tsx`.
2.  **[x] App Workspace Ref:** Relaxed `workspaceRef` type in `ChartWorkspace.tsx`.
3.  **[x] Environment Types:** Created `src/vite-env.d.ts` to handle side-effect CSS imports.

### Phase 5: Global Selection System [IN PROGRESS]
1.  **Workspace State:**
    - Update `useWorkspace.ts` to track `selectedChartId`.
    - Implement `handleSelectChart` logic.
2.  **Global Capturing:**
    - Update `useKeyboardShortcuts.ts` to trigger if a chart is `isSelected`, even if `isHovered` is false.
    - Expand `isHovered` detection to the **entire chart card** (including header).
3.  **Visual Feedback:**
    - Update `ChartUnit.tsx` to display a visual "Selected" indicator (blue border/glow).
    - Ensure clicking anywhere on a chart unit selects it.

## Verification & Testing
1.  **npx tsc --noEmit:** 0 errors.
2.  **npm test:** 35/35 tests passed.
3.  **Selection Verification:** 
    - Click a chart -> visual indicator appears.
    - Move mouse to sidebar -> type "AAPL" -> selected chart changes.
    - Hover a different chart -> type "TSLA" -> hovered chart changes (hover takes priority).
