# Market Rewind - TypeScript Conversion & Modularization

## Overview

The `market-rewind` frontend was successfully converted from a JavaScript "God Component" structure to a modularized, strongly-typed React application using TypeScript.

## Refactoring Breakdown

The 1275-line legacy `ChartUnit.jsx` was decomposed into specialized components and hooks, strictly following a props-down architecture with no global state libraries like Redux or React Context.

### 1. Types (`src/types/index.ts`)
A central types definition file was created to manage shared domain interfaces, ensuring strict typing across components and plugins.

### 2. Custom Hooks (`src/hooks/`)
Extracted the core business logic into 4 specialized hooks:
*   `useChartData.ts`: Manages data fetching, filtering, resampling, and infinite scroll state.
*   `useTradeManager.ts`: Manages trade state, P&L, and canvas-based trade line dragging.
*   `useKeyboardShortcuts.ts`: Manages input state and drawing triggers.
*   `useChartLifecycle.ts`: Owns the `lightweight-charts` instance, plugins, and handles render updates.

### 3. UI Components (`src/components/`)
Created atomic UI components that form the visual structure of the chart layout:
*   `ChartHeader.tsx`: Contains controls for tickers, timeframes, display toggles, drawing mode, and layout maximization.
*   `ChartCanvas.tsx`: Hosts the actual lightweight-charts container and orchestrates drawing interactions.
*   `TradeControls.tsx`: Provides the Buy/Sell and trade size inputs.
*   `TradeBadge.tsx`: Displays live P&L and trade exit mechanisms.
*   `DrawingStatus.tsx`: Shows keyboard shortcuts and active drawing instructions.
*   `ChartUnit.tsx`: Re-written as a lean layout orchestrator that stitches together the hooks and UI components.

### 4. Plugins & Utilities (`src/lib/`)
All `lightweight-charts` plugin implementations were converted from JavaScript to TypeScript, retaining their class-based patterns per project requirements.
*   `HorizontalRayPlugin.ts`
*   `RectanglePlugin.ts`
*   `SessionShading.ts`
*   `TradePlugin.ts`
*   `VolumeProfilePlugin.ts`
*   `db.ts`, `resampling.ts`, `timezones.ts` were strictly typed.

### 5. Application Orchestration (`src/App.tsx`)
The top-level `App` component was converted to TypeScript, fully typing the unified replay engine, layout grid mapping, and persistent state logic. Added robust `localStorage` error handling and safety guards to prevent crashes from malformed persistent data.

## Key Technical Decisions
*   **No Global State:** Retained the prop-drilling architecture (ChartUnit passing handlers to children) to maintain the existing mental model of the application.
*   **Circular References Handled:** Solved circular dependencies between `useChartLifecycle` and `useTradeManager` through careful mapping of `MutableRefObject` inputs (e.g., `tradePluginRef`).
*   **Compilation:** Eliminated `any` types where viable to ensure build safety. Project compiles and serves strictly over Vite using `npm run build`.
*   **Global PnL Aggregation**: Implemented a synchronization pattern where individual `ChartUnit`s report their Realized and Unrealized PnL to the `App` component, which aggregates them in the bottom replay bar for a portfolio-wide view.
*   **Mount-Phase Guards**: Implemented `isFirstRender` refs in synchronization hooks to prevent state-fighting between session initialization and group-wide ticker updates. This ensures user-selected starting parameters are respected on boot.
*   **React Namespace Reliability**: Standardized React imports across all hooks and components to ensure compatibility with modern bundlers and prevent runtime reference errors.

## Testing & Quality Assurance
A rigorous test suite was implemented using **Vitest** and **React Testing Library** to ensure the stability of the refactored architecture.

### Testing Tiers
*   **Unit Testing**: Validates core utilities including the `resampleData` logic and `getTzForTicker` mapping.
*   **Hook Testing**: Rigorously tests `useTradeManager` for financial accuracy, focusing on cumulative entry prices, partial closes, and position flipping.
*   **Stress Testing**: Pushes the system to its boundaries, testing midnight UTC transitions, raw data gaps, floating-point precision in P&L, and the ref-handshake between lifecycle and trade hooks.

The project has undergone a full Technical Integrity Audit and is currently rated as **Stable**.

