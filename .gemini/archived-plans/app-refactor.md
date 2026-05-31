# Plan: App.tsx Decomposition & Modularization

## Objective
Decompose `App.tsx` from a "God Component" into a layered architecture to improve maintainability, testability, and performance.

## Current Issues
- **Overloaded Responsibility:** Manages DB I/O, session state, layout logic, and UI rendering in one file.
- **State Bloat:** Every small change (e.g., moving a resize gutter) triggers a re-render of the entire application tree.
- **Fragility:** High risk of regression when updating layout logic because it's intertwined with DB initialization.

---

## Target Architecture

### 1. Logic Layer (Custom Hooks)
Move business logic and state management into dedicated hooks in `src/hooks/`. Persistence (localStorage) should be encapsulated within these hooks.

| Hook | Responsibility | State Managed |
| :--- | :--- | :--- |
| `useDatabase` | DB initialization, metadata fetching, file upload. | `isDbLoaded`, `dbStatus`, `tickers`, `isLoading` |
| `useSession` | Session pre-flight config and time logic. | `selectedDate`, `sessionTicker`, `entryTime`, `isSessionStarted` |
| `useWorkspace` | Layouts, panel sizes, and resize pointer logic. | `layoutMode`, `panelSizes`, `maximizedId`, `activeGutter` |
| `usePortfolio` | Aggregating PnL from all active charts. | `globalPnL` (realized/unrealized totals) |
| `useDrawings` | Managing persistent chart drawings. | `drawings` (by ticker) |

*Note: All handlers returned from these hooks must be wrapped in `useCallback` to ensure stable references for memoized components.*

### 2. Component Layer (Specialized UI)
Move presentational and scoped logic into `src/components/`.

| Component | Responsibility | Key Props/Hooks |
| :--- | :--- | :--- |
| `Sidebar` | Navigation, status indicators, and global utility links. | `useDatabase`, `useSession` |
| `SessionConfig` | The pre-flight configuration card. | `useSession`, `tickers` |
| `ChartWorkspace` | The dynamic grid, gutter management, and `ChartUnit` mapping. | `useWorkspace`, `useSession` |

### 3. Orchestration Layer (`App.tsx`)
`App.tsx` will act as a lean state machine, resolving the high-level application state:
`LOADING` $\rightarrow$ `UPLOAD_DB` $\rightarrow$ `CONFIG_SESSION` $\rightarrow$ `ACTIVE_REPLAY`.

---

## Implementation Phases

### Phase 1: State Extraction (Hooks)
1. Create `src/hooks/useDatabase.ts`. Extract `checkLocalDatabase`, `loadMetaData`, and `handleFileUpload`.
2. Create `src/hooks/useSession.ts`. Extract session config state, `getUtcTimeFromEt`, and localStorage persistence for session settings.
3. Create `src/hooks/useWorkspace.ts`. Extract `layoutMode`, `panelSizes`, and the pointer event handlers. Encapsulate layout persistence in localStorage.
4. Create `src/hooks/usePortfolio.ts`. Extract `globalPnL` and the `handlePnLUpdate` logic.
5. Create `src/hooks/useDrawings.ts`. Extract the drawings state and `handleUpdateDrawings`.

### Phase 2: UI Componentization
1. Create `src/components/Sidebar.tsx`. Migrate the `<aside>` block.
2. Create `src/components/SessionConfig.tsx`. Migrate the "Configure Session" card.
3. Create `src/components/ChartWorkspace.tsx`. Migrate the `<main>` grid logic and the `ChartUnit` mapping loop. Ensure it is optimized to prevent re-renders on layout changes.

### Phase 3: App.tsx Integration
1. Replace inline logic with the new hooks.
2. Implement the state-machine logic to switch between UI views.
3. Replace large JSX blocks with the new components.
4. Clean up remaining unused imports and helper functions.

---

## Verification Plan

### Functional Checks
- [ ] **DB Flow:** Verify `market_data.db` still loads correctly and tickers are populated.
- [ ] **Session Flow:** Verify that changing date/ticker in config updates the actual charts upon initialization.
- [ ] **Layout Flow:** Verify that all layout modes (1, 2v, 2h, 3, 4) still render correctly.
- [ ] **Resize Flow:** Verify that dragging gutters still updates panel sizes in real-time.
- [ ] **Maximization:** Verify that maximizing a chart still hides others and fills the screen.

### Performance Check
- [ ] **Render Profiling:** Use React DevTools to confirm that updating a panel size in `ChartWorkspace` no longer triggers a re-render of the `Sidebar` or `App` root.
