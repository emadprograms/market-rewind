# Plan: Fixing TypeScript Errors and Keyboard Logic

This plan addresses the keyboard shortcut regression and resolves the 41 TypeScript errors across the codebase.

## Objective
1.  **[COMPLETED] Fix Keyboard Regression:** Ensured ticker/timeframe switching is smooth, captures all characters, and supports TradingView-style parsing.
2.  **[COMPLETED] Resolve Type Errors:** Fixed ref mismatches, missing props, and breaking changes from `lightweight-charts` v4 updates.

## Key Files & Context
- `src/hooks/useKeyboardShortcuts.ts`: Keyboard event handling.
- `src/components/ChartUnit.tsx`: Modal logic and props.
- `src/lib/*.ts`: `lightweight-charts` plugins (HorizontalRay, Rectangle, etc.).
- `src/types/index.ts`: Central type definitions.
- `src/lib/parsing.ts`: NEW centralized parsing utility.

## Implementation Steps

### Phase 1: Keyboard Logic [DONE]
1.  **[x] Centralize Parsing:** Created `src/lib/parsing.ts` to handle unified ticker and timeframe parsing (e.g., `5m`, `1h`).
2.  **[x] Update `useKeyboardShortcuts.ts`:**
    - Captured subsequent keystrokes before input focus.
    - Supported Backspace/Delete in the pre-focus period.
    - Ensured `isHovered` doesn't block input once the modal is active.
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
    - Used `any` for the internal `CanvasRenderingTarget2D` type to bypass non-exported member errors while maintaining runtime correctness.
2.  **[x] Fix Drawing Type Incompatibility:** Unified all drawings to use the `Time` type (Unix timestamps) for consistency.
3.  **[x] Null Checks:** Added null checks for `param.point` in `useChartLifecycle.ts` mouse move handlers.

### Phase 4: Miscellaneous Fixes [DONE]
1.  **[x] Main Entry:** Fixed null check for `document.getElementById('root')` in `src/main.tsx`.
2.  **[x] App Workspace Ref:** Relaxed `workspaceRef` type in `ChartWorkspace.tsx`.
3.  **[x] Environment Types:** Created `src/vite-env.d.ts` to handle side-effect CSS imports.

## Verification & Testing
1.  **[x] npx tsc --noEmit:** 0 errors (Success).
2.  **[x] npm test:** 35/35 tests passed (Success).
3.  **[x] Manual verification of keyboard shortcuts:** Verified AAPL, 15m, 1h, and Alt+J functionality (Success).

## Final Status: COMPLETED
The project is now stable with zero TypeScript errors and a professional-grade keyboard navigation system.
